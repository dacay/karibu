# Teambridge integration — development notes

A standalone Hono service that bridges Teambridge ↔ Karibu around nurse onboarding and microlearning verification. Runs as its own pnpm workspace package under `integrations/teambridge` (not part of `apps/backend`).

End-to-end loop:

1. Teambridge sends `shift_created` / `shift_updated` webhooks. We resolve the assigned nurse(s) and, the first time we see a (nurse, facility) pair, invite the nurse to the right Karibu org via `POST /team/invite` and create + assign a Teambridge task template carrying the nurse's Karibu sign-in link.
2. The nurse opens the link, completes a verification microlearning in Karibu. Karibu fires an outbound webhook back at us (`POST /webhooks/karibu/ml-completed`).
3. We mark the shift's "Karibu Completed" field via the Open API, persist the verification, and delete the now-redundant Teambridge task.
4. Every subsequent shift the same nurse is assigned to at the same facility is auto-marked "Karibu Completed" by the shift_updated handler — no extra ML completion required.

## Why a separate package

`apps/*` is reserved for product-facing services (the backend API and the web client). Integrations live under `integrations/*` because they have different operational characteristics:

- **Different SLA.** Webhook receivers must respond 2xx within 5 seconds; a slow Teambridge call cannot queue behind user-facing requests.
- **Different auth model.** Inbound HMAC signature verification, not user JWTs.
- **Different secret blast radius.** Teambridge `client_secret` and webhook secret should not share a process with user-auth secrets.
- **Different failure domain.** A crash here must not affect login or chat.
- **Different scaling.** Webhook bursts (e.g. Teambridge replaying after their outage) should not push you to scale the user API.

Same monorepo for shared types and tooling, but its own runtime, deploy, and (eventually) its own Drizzle migration project.

## Run it

```bash
cp .env.example .env                           # fill in client id/secret + webhook secret + DATABASE_URL + per-org API keys
pnpm install                                   # from repo root, hoisted via workspace
pnpm --filter integrations-teambridge db:push  # sync the integrations schema to your DB
pnpm --filter integrations-teambridge dev
```

`dev` uses `tsx watch`. `start` runs once. `typecheck` runs `tsc --noEmit` (no build output — the service is run from source via tsx).

DB scripts: `db:push` (sync schema directly — current workflow during development), `db:generate` (create a migration file — to be used once we cut over to migrations for prod), `db:migrate` (apply pending migrations), `db:studio` (drizzle studio).

## Architecture

```
index.ts          Hono app + bootstrap (token → schema → listen). Registers
                  /webhooks/teambridge and /webhooks/karibu/ml-completed.
config.ts         Env loading, throws on missing required vars
auth.ts           Auth0 client_credentials → bearer token, with refresh (Open API only)
schema.ts         One-time tenant discovery: shift collection + location +
                  Karibu Completed field; users; tasks (assignee + template);
                  roles. Throws at boot on any missing/wrong-shape field.
teambridge.ts     Three Teambridge transports:
                    • Open API (OAuth) for shift/user reads + shift writes
                      (`getShift`, `getUser`, `setShiftField` via PUT).
                    • "Web" API (static bearer at api.teambridge.com) for
                      task templates (`createTaskTemplate`), task assignment
                      (`assignTask` → /collections/v2/create_record), and
                      record deletion (`deleteRecords` → /collections/delete_records).
                  The unified Open API rejects task writes with
                  COLLECTION_TYPE_NOT_SUPPORTED, hence the dual transports.
karibu.ts         Authenticated Karibu backend client, scoped per facility
karibu_webhook.ts Inbound POST /webhooks/karibu/ml-completed handler. Resolves
                  (karibuUserId, organizationId) → (nurse, facility, first shift),
                  persists the verification row, sets Karibu Completed on the
                  first shift, deletes the verification task instance.
onboarding.ts     First-time (nurse, facility) flow. Claim row → invite to
                  Karibu → mint task template → assign template to nurse.
                  Captures karibu_user_id, account_id, first_shift_id on the
                  invite row for later use by karibu_webhook + future shifts.
facilities.ts     Loads facility-id → Karibu org mapping JSON at boot, resolves
                  API key env vars, exposes `getFacilityByKaribuOrgId` for
                  reverse lookup from inbound Karibu webhooks.
signature.ts      HMAC SHA-256 webhook verification (Teambridge inbound only).
state.ts          Postgres-backed dedup + shift snapshot diffing
webhook.ts        Teambridge webhook handler: verify → dedup → fetch shift →
                  diff → onboard new (nurse, facility) pairs → auto-apply
                  Karibu Completed for any already-verified pair.
logger.ts         pino, pretty in dev
db/
  schema.ts     Drizzle schema (pgSchema('integrations'), teambridge_* tables)
  client.ts     postgres-js + drizzle wrapper
  migrations/   drizzle-kit generated SQL
drizzle.config.ts  drizzle-kit config (scoped to teambridge_* tables only)
```

## Key design decisions

**Schema discovery at startup, not hardcoded.** Teambridge collection IDs and field IDs are per-tenant — they differ between sandbox and prod. `discoverSchema()` runs once at boot, fetches every needed collection + field, and caches them for the process lifetime. Discovered:
- Shift: collection id, Location field, Assignee field, **Karibu Completed** field (BOOLEAN → write `"true"`; SINGLE_SELECT → write the option named `Completed`, stored as a UUID).
- User: collection id, Email field, Roles field.
- Task: collection id, Assignee field, **Task Template** field (SINGLE_SELECT typed but options are dynamic — they're template UUIDs we mint via the web API).
- Roles: collection id + name field, used to resolve `TEAMBRIDGE_ELIGIBLE_ROLES`.

Discovery is by *name* (e.g. `Karibu Completed`, `Task Template`) when the field type alone isn't unique. Boot throws on the first missing or mismatched field — fail loud rather than silently miss. Restart required after Teambridge schema edits (cache is per-process, no live reload).

**Facility filter is a JSON file, not a DB.** `facilities.sandbox.json` / `facilities.prod.json` map Teambridge location UUIDs to Karibu orgs. Each entry holds:
- `name` — display name.
- `karibu_base_url` — the Karibu org's subdomain URL.
- `karibu_api_key_env` — the *name* of an env var that holds that org's API key (never the key itself; secrets stay in `.env`).
- `karibu_organization_id` — the Karibu org UUID. Used by `getFacilityByKaribuOrgId()` to reverse-map from the inbound ML-completed webhook payload back to a facility.

Pick which file to load via `FACILITIES_FILE`. Boot throws on any missing field or duplicate `karibu_organization_id`. Reason: the universe of facilities is small and mostly static; a config file is auditable and trivially reloadable. Secrets stay out of git via the env-var indirection.

**Karibu backend calls go through a per-facility client.** `karibu.ts` exposes `karibuFetch(facility, path, init)`, which prefixes the org's base URL and adds `Authorization: Bearer <api_key>` from the facility's resolved key. Each Karibu org is a tenant on its own subdomain; routing is by which facility a webhook resolves to. Add typed wrappers (e.g. `inviteUser`) on top of `karibuFetch` as endpoints land.

**First-time nurse onboarding is gated by role.** `TEAMBRIDGE_ELIGIBLE_ROLES` is a comma-separated list of Teambridge role names (e.g. `RN,LPN,CNA`). At boot, those names are resolved to role UUIDs by listing records on the roles collection — boot throws if any name is unknown. The eligibility check happens **before** the DB claim: a cheap SELECT short-circuits already-onboarded pairs, then we fetch the user and skip if their roles don't intersect the eligible set. **No row is written for ineligible nurses**, so a later role change is picked up automatically on the next webhook with nothing to clean up. If `TEAMBRIDGE_ELIGIBLE_ROLES` is empty, the filter is off and a warn fires at boot ("set this in production").

**Auth token cache + scheduled refresh.** `getAccessToken()` returns the cached token if it has >60s left, otherwise re-fetches. There's also a 1h `setInterval` that proactively refreshes. The 60s skew prevents a request going out with a token about to expire. `inFlight` deduplicates concurrent fetches under a thundering herd.

**Webhook processing is async; we return 200 immediately.** Teambridge expects a 2xx within 5 seconds and only retries on non-2xx. We dedup, fire-and-forget the actual work, return 200. Errors during processing are logged but **not retried** — there's no DLQ. If durability matters, this needs a queue.

**Dedup and shift snapshots are persisted in Postgres.** `state.ts` writes to `integrations.teambridge_events` (one row per webhook event, PK on `event_id`) and `integrations.teambridge_shift_snapshots` (one row per shift, latest fields only). Dedup is atomic via `INSERT … ON CONFLICT DO NOTHING`; snapshot diffing runs in a transaction with `SELECT … FOR UPDATE` so two webhooks for the same shift don't race. Restarts no longer wipe state. See "Data layer" below.

**Signature verification is optional.** `VERIFY_WEBHOOK_SIGNATURE=false` bypasses HMAC checks for debugging connectivity / payload shape without a valid secret. Logs a `warn` every request when disabled. Don't ship with this off.

**HMAC scheme:** `sha256(secret, "${timestamp}.${rawBody}")`, signature header may be prefixed with `sha256=`, timestamp must be within ±5min. `crypto.timingSafeEqual` after length check.

**Diff is shallow + JSON-stringify based.** `state.ts:shallowDiff` compares top-level field values via `JSON.stringify`. Good enough for primitive shift fields and shallow objects; will report nested-equal-but-reordered objects as changed. Field IDs are translated to human names via `schema.fieldName()` only at log time.

## Webhook flows

### Teambridge → integration: `POST /webhooks/teambridge`

1. Verify HMAC (or skip if disabled) → 400 on mismatch.
2. Parse JSON → 400 on invalid.
3. If `event_type` is not in `HANDLED_EVENT_TYPES` (currently `shift_created`, `shift_updated`) → 200 ignored.
4. Return 200 and process asynchronously (Teambridge expects 2xx in <5s):
   - GET shift record by `record_id` via Open API.
   - Resolve facility via location field; ignore if untracked.
   - Dedup against `teambridge_events` (atomic insert).
   - Diff vs previous snapshot in `teambridge_shift_snapshots`.
   - For each assignee:
     - **Onboard** if no `(nurse, facility)` row in `teambridge_nurse_facility_invites` → invite to Karibu, mint task template (web API), assign template to nurse (web API), persist `karibu_user_id`, `account_id`, `first_shift_id`, `task_record_id` on the row.
     - **Auto-apply** Karibu Completed on this shift if a `(nurse, facility)` row exists in `teambridge_nurse_facility_verifications` (the nurse already verified at this facility — every new shift inherits the field).

### Karibu → integration: `POST /webhooks/karibu/ml-completed`

1. Optional bearer check (`KARIBU_WEBHOOK_BEARER`); skipped if env unset.
2. Body `{ karibuUserId, organizationId, microlearningId, completedAt, email? }`.
3. Reverse-map `organizationId` → facility via `getFacilityByKaribuOrgId`. Untracked → 200 ignored.
4. Resolve `(karibu_user_id, facility_id)` → invite row in `teambridge_nurse_facility_invites`. Missing → 200 ignored (we never onboarded that user at that facility).
5. Insert `teambridge_nurse_facility_verifications` row (PK `(nurse, facility, ml_id)`, idempotent).
6. PUT `Karibu Completed` on the originating shift (`first_shift_id`) via Open API.
7. POST `/collections/delete_records` (web API) to remove the now-redundant task instance from Teambridge.
8. Steps 6 and 7 are best-effort — failures are logged; we always return 200 because Karibu won't retry. The verification row is what gates the future-shifts auto-apply, so even if Teambridge calls fail the data side is consistent.

## Gotchas

- **`type: "module"` + `.js` imports.** All internal imports use `.js` extensions even though the source is `.ts`. Required for ESM resolution under `tsx` and Node ESM. Don't strip them.
- **`facilities.ts` reads JSON synchronously at import time and resolves `karibu_api_key_env` against `process.env`.** A missing file, malformed JSON, or any unset API key env var throws on import — no graceful fallback. Intentional: a misconfigured facility map should fail boot, not silently route to the wrong org or no org at all.
- **No build step.** This service runs from source via `tsx`. There's no `outDir` — `tsconfig.json` has `noEmit: true`. If we ever need to ship a compiled bundle (e.g. for Railway), this needs a real build config.
- **Per-tenant `.env` and per-tenant facility map.** Sandbox vs prod aren't isolated by code — they're isolated by which env file and which facilities JSON you point at. Make sure they match (sandbox secret + sandbox facility UUIDs, etc).
- **`actor.user_id` from the webhook is captured but unused.** The processor logs `actor?.name` only. If you need to attribute changes back to a Teambridge user, the field is already on the event payload.

## Deploy expectations

The service is designed to deploy independently of `apps/backend` and `apps/web`:

- **Process boundary.** This is its own long-running process — token refresh interval, in-memory caches, webhook listener. It is **not** mounted as a route on the backend.
- **Per-app deploy targets.** Each Vercel/Railway project should set its **Root Directory** to the package folder and configure an **Ignored Build Step** that returns 0 (skip) when nothing inside that folder changed (`git diff --quiet HEAD^ HEAD -- integrations/teambridge`). A push to `apps/backend` should not redeploy this service, and vice versa.
- **No build artifact.** Runs from source via `tsx`. There is no `dist/`. If a hosting target requires a compiled bundle, the `tsconfig.json` (`noEmit: true`) and the `start` script need updating.

## Data layer

State lives in the **same Postgres instance as `apps/backend`**, in a separate `integrations` schema with table names prefixed `teambridge_*`. The reasoning:

- One Postgres instance keeps backups, monitoring, and connection pooling unified.
- A separate schema gives a permission boundary, a clean teardown (`DROP SCHEMA integrations CASCADE`), and makes it trivial to split into its own DB later via `pg_dump --schema=integrations`.
- One shared schema for all integrations (rather than schema-per-vendor) suits a single-team setup; revisit if integration ownership ever splits.
- The integration owns its own Drizzle config and migration history, separate from `apps/backend`'s. Same DB host, two independent migration tools.

**Tables** (defined in `src/db/schema.ts`):

- `integrations.teambridge_events` — one row per accepted webhook. Columns: `event_id` (PK), `event_type`, `account_id`, `record_id`, `actor_user_id`, `actor_name`, `received_at`. Used for dedup (PK conflict) and as a lightweight audit trail.
- `integrations.teambridge_shift_snapshots` — one row per shift, latest state only. Columns: `record_id` (PK), `fields` (jsonb), `updated_at`. Used as the diff baseline.
- `integrations.teambridge_nurse_facility_invites` — one row per (nurse, facility) pair we've ever onboarded. PK `(nurse_id, facility_id)`. Columns: `karibu_invited_at`, `task_created_at`, `task_template_id` (server-assigned), `task_template_display_id` (`task.template.<uuid>` we mint), `task_record_id` (the assigned task instance), `karibu_user_id`, `first_shift_id` (the shift whose webhook triggered onboarding — what gets marked Completed when verification finishes), `account_id` (captured for the web-API delete call), `created_at`. Acts as the early-skip gate in `onboardNurseToFacility`.
- `integrations.teambridge_nurse_facility_verifications` — one row per `(nurse, facility, microlearning_id)` ML completion received from Karibu. Columns: `karibu_user_id`, `verified_at`, `received_payload jsonb`. Presence of any row for `(nurse, facility)` causes `processShiftUpdate` to auto-apply Karibu Completed on every subsequent shift assigned to that nurse at that facility.

**Coexistence with future integrations.** `drizzle.config.ts` scopes drizzle-kit to *this* integration only via `tablesFilter: ['teambridge_*']` and stores migration history in its own table `integrations.__drizzle_migrations_teambridge`. A future integration in `integrations/<name>/` should mirror this pattern with its own table prefix and tracking table — both can write into the shared `integrations` schema without stepping on each other's migrations. The first migration uses `CREATE SCHEMA IF NOT EXISTS "integrations"` so whichever integration migrates first wins.

**Schema sync is via `db:push` for now**, not generated migration files. Drizzle-kit diffs `src/db/schema.ts` against the live DB and applies the change directly. Cheap and fast while the schema is iterating; the tradeoff is no audit trail and no protection against destructive changes (column rename → drop+recreate). Cutover plan: switch to `db:generate` + `db:migrate` before this service takes real prod webhooks. From that point on, every schema change ships as a tracked migration file.

**Events are recorded only for tracked facilities.** Dedup lives inside `processShiftUpdate` *after* the facility-tracked check, so events for facilities not in the JSON map never write a row. Side effect: a duplicate webhook for an untracked facility costs one extra `getShift` call (the dedup short-circuit doesn't run until we know the facility), but TB only retries on non-2xx so this is rare.

**Events table has a TTL.** `TEAMBRIDGE_EVENT_RETENTION_DAYS` (default 30) caps row retention; an hourly `setInterval` in `index.ts:startEventCleanupLoop` runs `DELETE … WHERE received_at < now() - INTERVAL <days>`. Dedup only needs minutes of memory (TB retries fast), so anything older is incidental audit. With the reorder + TTL, the table size becomes constant in steady state regardless of facility count or runtime. Set `TEAMBRIDGE_EVENT_RETENTION_DAYS=0` to disable cleanup entirely. Snapshots are bounded by the number of distinct shifts and don't grow on update.

## Open follow-ups

- Switch from `db:push` to `db:generate` + `db:migrate` before this service receives prod webhooks (see "Data layer").
- HMAC the inbound Karibu webhook (currently optional bearer only — `KARIBU_WEBHOOK_BEARER`).
- Re-onboarding lifecycle: today the `(nurse, facility)` invite row is "ever onboarded" forever. If a nurse never completes the ML and the original task is dismissed, no re-trigger fires. Consider gating early-skip on verification state, and reacting to assignee-removed events to clean up stale tasks.
- Real facility mapping (sandbox JSON still has `REPLACE_ME_WITH_KARIBU_ORG_UUID`).
- Linked-record name resolution (Assignee, Location, Shift Group come back as raw UUIDs in shift payloads — diff logs would read better with names).
- Vercel/Railway: configure independent deploy projects with Ignored Build Step path filters.

## Endpoints quick reference

Teambridge:
- Open API (OAuth bearer): `GET /v1/collections`, `GET /v1/collections/{id}/fields`, `GET /v1/collections/{id}/records[/{recordId}]`, `PUT /v1/collections/{id}/records/{recordId}` (note: PUT, not PATCH — Teambridge's `updateRecord` is partial-update under PUT).
- Web API (static bearer at `api.teambridge.com`): `POST /tasks/template`, `POST /collections/v2/create_record`, `POST /collections/delete_records`. None of these are documented in the openapi.json bundled in this repo.

Karibu backend (consumed via `karibuFetch`, scoped per facility): `POST /team/invite`. Response shape: `{ invited: { email, userId, link }[], alreadyExists: { email, userId, link }[], failed: string[] }`. Both arrays carry sign-in links — the integration reads `invited[0] ?? alreadyExists[0]` so it doesn't care whether the user was just created or pre-existing.

## Required env vars

```
DATABASE_URL                     # Postgres (shared with apps/backend, integrations schema)
TEAMBRIDGE_CLIENT_ID             # Open API OAuth client
TEAMBRIDGE_CLIENT_SECRET
TEAMBRIDGE_WEB_TOKEN             # Static bearer for the web API (templates / assign / delete)
TEAMBRIDGE_WEBHOOK_SECRET        # HMAC for inbound Teambridge webhooks
TEAMBRIDGE_ELIGIBLE_ROLES        # Comma-separated role names; empty disables filter
FACILITIES_FILE                  # facilities.sandbox.json or facilities.prod.json
KARIBU_WEBHOOK_BEARER            # Optional; bearer for inbound /webhooks/karibu/ml-completed
KARIBU_NURSING_HOME_API_KEY      # Per-facility — name comes from each facility's karibu_api_key_env
```
