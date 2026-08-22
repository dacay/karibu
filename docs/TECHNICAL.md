# Karibu — Technical Documentation

**Repo:** `KaribuAI/karibu` (monorepo)
**Last updated:** 2026-08-22

This document captures *what the system is*, *how it is built*, and — most importantly — **why it is built the way it is**. The "why" entries are decisions that were made deliberately and should not be casually reversed. Where a decision is a deliberate short-term trade-off, it is marked **[Temporary]** and listed again in "Open items and known gaps" at the end.

Day-to-day development detail lives in the in-repo docs:

| File | Scope |
|---|---|
| `DEVELOPMENT.md` (root) | Monorepo overview, DNA feature concept, flagging |
| `CONVENTIONS.md` | Code style (mandatory reading before first PR) |
| `apps/backend/DEVELOPMENT.md` | Backend architecture, S3/IAM, reports, avatars, guardrails |
| `apps/web/DEVELOPMENT.md` | Web routing, avatars, reports, flagging UX |
| `integrations/teambridge/DEVELOPMENT.md` | Teambridge integration, in depth |
| `docs/analytics.md` | Mixpanel event taxonomy and wiring |
| `docs/scripts.md` | Operator scripts |

---

## 1. What Karibu is

Karibu is a **multi-tenant, AI-driven workplace microlearning platform**, piloted in healthcare / long-term-care (nursing homes). The product loop is:

1. An organization (a facility) uploads its own documents — policies, handbooks, procedures.
2. Those documents are chunked, embedded, and stored in a vector database.
3. An LLM proposes and then synthesizes a structured knowledge tree from them ("**DNA**": Topic → Subtopic → Value). A human admin approves every generated value.
4. Admins create **microlearnings** (MLs): short, ~5-minute conversational lessons scoped to selected topics/subtopics, driven by a **conversation pattern** (the teaching method) and delivered by an **avatar** (persona + voice).
5. Learners (nurses) are grouped, assigned **sequences** of MLs, and work through them as a chat — with voice in and voice out if they want it.
6. Learners also get a free-form assistant ("ask me anything") grounded in the same org knowledge.
7. Admins see completion metrics, flagged messages, per-learner history, and externally-produced report files.

Two structural product commitments run through everything:

- **The organization's own knowledge is the source of truth.** Personas shape tone only; they never carry backstory or competing facts. General LLM knowledge is labeled as such and can be blocked entirely per org.
- **Human-in-the-loop on generated knowledge.** No LLM-synthesized value reaches a learner without an admin approving it.

---

## 2. Repository layout

```
karibu/
├── apps/
│   ├── backend/          Hono API server (TypeScript, ESM)
│   └── web/              Next.js 16 App Router frontend
├── integrations/
│   └── teambridge/       Standalone Hono webhook service (Teambridge ↔ Karibu)
├── docs/                 Cross-cutting docs (analytics, scripts, this file)
├── CONVENTIONS.md
├── DEVELOPMENT.md
├── package.json          Root scripts + pnpm overrides
└── pnpm-workspace.yaml   packages: apps/*, integrations/*
```

### Decisions

- **pnpm workspaces, no Turborepo/Nx.** Three packages, each with its own deploy target; a build orchestrator was not worth the config. Root `package.json` just proxies the handful of commands used daily (`dev:backend`, `dev:web`, `dev:db:push`, `create-org`, `add-admin`, `reset-password`).
- **`apps/*` is for product-facing services; `integrations/*` is for third-party bridges.** The split is operational, not cosmetic — see §11.
- **pnpm overrides pin `@smithy/types` and `@smithy/smithy-client`** in the root manifest to keep the AWS SDK v3 transitive tree consistent. Don't remove without re-testing S3 + CloudFront calls.
- **`.gitignore` ignores all `*.md` except `docs/*.md`, `DEVELOPMENT.md`, `README.md`, `CONVENTIONS.md`.** This was to keep scratch/AI-assistant notes out of the repo. If you add a doc, put it in `docs/` or name it `DEVELOPMENT.md`, otherwise it will be silently ignored. `.claude/`, `.cursor/` and `integrations/teambridge/*.json` (facility maps) are also ignored.

---

## 3. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Backend framework | **Hono** 4 | Lightweight, works on Node (EC2) and serverless (Vercel) |
| Runtime | Node ESM (`"type": "module"`) | **All internal imports must carry the `.js` extension**, even from `.ts` sources — `NodeNext` resolution |
| Dev runner | `tsx watch` | Backend `build` = `tsc` → `dist/`; Teambridge has **no build**, runs from source |
| ORM | **Drizzle** + `postgres` (postgres-js) | Not `pg`. Both `db` (Drizzle) and `sql` (raw) exported from `src/db/index.ts` |
| Database | PostgreSQL | Backend uses `public`; Teambridge uses a separate `integrations` schema in the *same* instance |
| Vector DB | **ChromaDB Cloud** | Two collections: per-org documents, and one global Karibu manual |
| Logging | **Pino** + `hono-pino` | Pretty in dev, JSON in prod |
| Validation | **Zod** 4 + `@hono/zod-validator` | Also validates env at boot — fail fast |
| LLM | **OpenAI** via Vercel **AI SDK v6** | Default chat model `gpt-5.1`; classifier `gpt-5-mini`; embeddings `text-embedding-3-small` |
| Agent framework | `@mastra/core` | **Instantiated but effectively unused** — `new Mastra({})` with no agents registered. It is a placeholder; the real work is direct AI SDK `streamText` calls |
| Images | **Google Gemini** (`gemini-2.5-flash-image`) | ML cover images |
| Voice | **Deepgram** (Aura-2 TTS, nova-3 STT) | `@ai-sdk/elevenlabs` is a dependency but ElevenLabs is **not** wired in |
| Email | **Postmark** | Invitations / sign-in links |
| SMS | **Twilio** | Notification channel, opt-in via env |
| Storage | **AWS S3** (3 buckets) + **CloudFront** | See §7 |
| Frontend | **Next.js 16** App Router, React 19 | Turbopack in dev, port 3001 |
| UI | **Tailwind v4** + shadcn/ui (Radix) + lucide | `components.json` present; `src/components/ui/*` is generated shadcn code |
| Data fetching | **TanStack Query v5** | Plus `@ai-sdk/react` `useChat` for streaming |
| Errors | **Sentry** (`@sentry/node`, `@sentry/nextjs`) | Optional — no-op without DSN |
| Analytics | **Mixpanel**, both sides | Optional — no-op without token |

### Decisions

- **Hono over Express/Fastify** for portability across EC2 and serverless, and for its native `streamSSE` / Web-standard `Response` support (used by AI SDK streaming and the learner SSE feed).
- **Every optional integration degrades to a no-op rather than a boot failure.** Sentry, Mixpanel, Deepgram, Gemini, Postmark, CloudFront, and the reports bucket all follow this pattern. Required-at-boot: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `OPENAI_API_KEY`, and the three `CHROMA_*` values. This is intentional: a missing analytics token must never take down a facility's training.
- **Mastra is vestigial.** If you never build multi-step agents, deleting `src/ai/mastra.ts`'s `Mastra` instance (keeping the exported `openai` / `deepgram` providers) is safe and removes a dependency.

---

## 4. Multi-tenancy and identity

### Tenancy model

- One `organizations` row per facility, keyed by a **unique `subdomain`**.
- **The tenant is resolved from the `Host` header**, not from a path or a token claim: `organizationMiddleware` takes `host.split('.')[0]` (`acme.karibu.ai` → `acme`, `demo.localhost:3000` → `demo`) and loads the org.
- The frontend mirrors this: `NEXT_PUBLIC_API_URL` may be a template containing `{subdomain}`, resolved at runtime from `window.location.hostname` (`lib/api.ts`, `middleware.ts`, `useStreamTTS`). For local dev you set a plain URL with no placeholder.
- The Next.js middleware also writes a `karibu_subdomain` cookie so client components can read the tenant without re-parsing the host.

**Why host-based:** each org gets its own branded URL, logos and assets are laid out per subdomain on the CDN, and every backend request carries the tenant implicitly, so no route can forget to scope itself.

### Org cache

- `organizationMiddleware` consults an in-process **LRU cache with TTL** (`ORG_CACHE_MAX_SIZE`, default 1000; `ORG_CACHE_TTL`, default `15m`).
- Mutations that change cached fields must call `invalidateOrgCache(subdomain)` (e.g. `PATCH /org/config`, logo upload).
- **The TTL exists specifically as the backstop for a missed invalidation** — including invalidation that happened on a different replica, since the cache is per-process. `ORG_CACHE_TTL=0` disables caching entirely, which is the recommended local-dev setting.
- Note: the assistant chat route deliberately reads org rows **live from the DB**, not from this cache, so the knowledge-restriction settings can never be served stale.

### Authentication

- **JWT (HS256 by default), 30-day expiry**, signed with `JWT_SECRET` (min 32 chars), audience-checked against `JWT_AUDIENCE`.
- Every token has a `jti`. **Sessions are revocable**: `auth_sessions` holds one row per issued human token; `authMiddleware` verifies the JWT *and* checks the session row is present and not revoked. A stolen or logged-out token dies immediately rather than lasting 30 days.
- **Two principal kinds, one token format.** `kind: 'user'` (validated against `auth_sessions`) and `kind: 'service'` (validated against `api_keys`, joined to `service_accounts` for the org). Service principals always carry `role: 'admin'`.
- **Service tokens are rejected by default.** `authMiddleware()` refuses `kind: 'service'` with 403 unless a router opts in with `authMiddleware({ allowApiKey: true })`. Today only `/team` opts in (for the Teambridge integration). **This is the safe-by-default decision: a newly added endpoint can never be reachable by an integration unless someone consciously widens it.**
- **Magic-link / token login.** `auth_tokens` holds long-lived direct-URL login tokens. A learner opens `https://{subdomain}.karibu.ai/?token=…`; Next.js middleware exchanges it server-side at `POST /auth/login`, drops the result in a short-lived `karibu_pending_token` cookie (60 s), redirects to `/`, and `useAuth` moves it into `localStorage`. **Why the cookie hop:** the exchange happens in middleware (server) but the token must land in `localStorage` (client), and the URL must be cleaned so the token isn't left in history or referrers.
- **Client token storage is `localStorage`** (`karibu_token`, `karibu_user`), not an httpOnly cookie. This was chosen because the SPA talks to a *different origin* (the API subdomain) and needs to attach `Authorization` headers itself, including on WebSocket and SSE URLs. Accepted trade-off: XSS exposure.
- **WebSocket and SSE authenticate via `?token=` query param**, because browsers cannot set headers on `EventSource` or `WebSocket`. Both verify the JWT and the session before upgrading/streaming.
- The stored `user` object is a login-time snapshot; `useAuth` reconciles server-owned fields (e.g. organization name) against `GET /user/me` so a rename propagates without a re-login.

### Roles

Only two: `admin` and `user` (learner). Enforced by `requireRole(...)` per-route or per-router. There is no finer-grained permission system, by design.

---

## 5. Data model (Postgres, `apps/backend/src/db/schema.ts`)

Single file, 349 lines, ~25 tables. Highlights and the reasoning behind them:

**Tenancy & identity**
- `organizations` — `subdomain` (unique), `pronunciation` (for TTS), `learnerTerm`/`learnerTermPlural` (facilities call learners different things: "nurses", "staff", "team members" — the UI uses these strings), `expirationIntervalHours` (default 8), `defaultAvatarId` (**NOT NULL**), `restrictToKnowledgeBase`, `knowledgeRedirectMessage`, `allowLanguageSelection`, `logoUpdatedAt`.
- `users` — email is unique **per organization** (`users_email_org_unique`), not globally: the same person can exist in two facilities. bcrypt password, optional E.164 `phoneNumber`, `firstName`/`lastName`, `preferredAvatarId`, `language`, `fontSize`, `onboardingCompletedAt`.
- `auth_sessions`, `auth_tokens`, `service_accounts`, `api_keys`, `notification_logs`.

**Learning content**
- `microlearning_sequences` → `microlearnings` (`position` for ordering, `topicIds`/`subtopicIds` as JSONB arrays, `patternId`, `imageS3Key`, `completionWebhookUrl`, `confettiEnabled`, status `draft|published`).
- `user_groups` (with an `isAll` flag for the implicit "everyone" cohort) → `user_group_members`.
- `microlearning_sequence_assignments` — **assignment is sequence→group, never ML→user.** Individual MLs are reached through their sequence; standalone MLs (no sequence) are visible to everyone in the org.
- `microlearning_progress` — `active | completed | expired`, with `openedAt`, `completedAt`, `expiredAt`.
- `conversation_patterns` — `organizationId` **nullable: null means a built-in global pattern**. Carries `prompt`, `multipleChoiceEnabled`, `responseLength`.
- `avatars` — `organizationId` nullable (null = built-in). Identity (`name`, image) is shared; **voice and persona live per-language in a `localizations` JSONB** (`{ en: { voiceId, description }, es: {…} }`).

**Conversations**
- `chats` — **`id` is a client-generated string** (from AI SDK `useChat`), not a server UUID, so the client can stream into a chat before the server has persisted it. Type `microlearning | discussion`.
- `chat_messages` — `parts` JSONB in AI SDK `UIMessage` format. Persisted whole rather than normalized, so message shape can evolve with the SDK without migrations.
- `flagged_messages` — `open | reviewed | dismissed`, optional learner `reason`.

**Knowledge**
- `documents` — S3 pointer + `status` (`uploaded | processing | processed | failed`) + `chromaDocumentId`.
- `dna_topics` / `dna_subtopics` / `dna_values` — see §6.

### Schema-level decisions worth preserving

- **`defaultAvatarId` and `preferredAvatarId` are plain `uuid` columns with no FK.** Deliberate: a real FK between `organizations` and `avatars` would be circular (avatars reference orgs). The cost is that a deleted avatar can leave a dangling id — handled by the in-code `BUILT_IN_AVATARS[0]` fallback.
- **Everything else cascades on delete.** Deleting an org removes its users, docs, chats, DNA, flags. `microlearnings.patternId` and `sequenceId` are `set null` instead, so deleting a pattern doesn't destroy MLs.
- **No embeddings in Postgres.** Chunk vectors live only in ChromaDB. Postgres holds the structured, human-approved output.
- **`topicIds`/`subtopicIds` on microlearnings are JSONB arrays, not join tables.** Chosen for simplicity — they are read as a set and never queried relationally. If you ever need "which MLs use this subtopic?", that becomes a scan.

---

## 6. The knowledge pipeline (DNA)

### Ingestion

`POST /documents/upload` (admin) → insert a `documents` row → upload to the docs bucket → **fire-and-forget `processDocument()`**. The processor extracts text (`pdfjs-dist` for PDF, `mammoth` for docx, raw for txt/md), chunks at **500 chars with 100 overlap**, embeds via OpenAI, and writes to ChromaDB with `documentId`/`organizationId` metadata; chunk ids are `${documentId}_chunk_${i}`.

- Upload responds `201` immediately; processing happens after. Status on the row moves `uploaded → processing → processed | failed`.
- Chunk size was picked to sit comfortably inside small embedding models' token limits (the comment references the 256-token ceiling of `all-MiniLM-L6-v2`); 20 % overlap preserves cross-boundary context.
- `upload-manual.ts` deliberately **mirrors the same chunk constants** so the Karibu product manual chunks identically to org documents.
- ⚠️ `apps/backend/DEVELOPMENT.md` still says the ChromaDB pipeline is "not yet wired into the document upload route". **That is stale** — it is wired (`routes/documents.ts:96`). Fix the doc.

### Structure: Topic → Subtopic → Value

Three levels, and the third exists for a specific reason: **approval must attach to generated content, not to structure.**

- `source` on topics/subtopics: `manual` (created by an admin, inserted `active`) vs `discovered` (LLM-proposed, inserted `suggested`).
- `status`: `suggested | active | rejected`. **Synthesis only runs on `active` subtopics.**
- `synthesisStatus` on subtopics: `idle | running | done | failed` — tracks the async job, and distinguishes "never synthesized" from "synthesis failed" (both otherwise look like "no values").
- `approval` on values: `pending | approved | rejected`. **Rejected values are kept, never deleted**, so re-synthesis doesn't regenerate the same rejected content and history stays auditable. Re-synthesis *adds* a value alongside the old ones.
- A subtopic's `description` doubles as **the ChromaDB query anchor** for synthesis. Write descriptions with that in mind — a vague description produces a vague retrieval.

### Auto-discovery

`POST /dna/discover` samples chunks broadly (no query) and asks the model for `DNA_DISCOVERY_MIN_TOPICS`–`MAX_TOPICS` topics with `MIN_SUBTOPICS`–`MAX_SUBTOPICS` each, inserted as `discovered/suggested`. Duplicate topic names (case-insensitive) are skipped.

**The sampling algorithm is a deliberate piece of engineering** (`sampleDocumentChunks`, default cap **800**): a naive `get({ limit })` returns a contiguous head slice, which over-represents whichever document was inserted first and only its opening pages. Instead it fetches all of the org's chunk metadata, allocates the cap **round-robin across documents** so one large document cannot monopolize the budget, and picks each document's quota **evenly strided across its full length**, then interleaves the result so downstream truncation stays balanced.
*(The backend doc's "samples up to 40 chunks" line predates this rewrite — the cap is 800.)*

**Suggestions are persisted immediately, not held in memory.** An admin can reload the page mid-review and lose nothing.

### Synthesis vs. generation

Two distinct endpoints, and the difference matters:

| Endpoint | Grounding | Use |
|---|---|---|
| `POST /dna/subtopics/:id/synthesize` | **Strictly** the retrieved document excerpts; the prompt forbids outside knowledge and says to output nothing if the excerpts are irrelevant | The normal path |
| `POST /dna/subtopics/:id/generate` | Broader: org DNA + whatever embeddings exist + the model's general knowledge | **Explicit fallback** when synthesis returns nothing because no relevant document content exists |

Both write values as `pending` and set `synthesisStatus`. Output shape (count, max words per value) is env-tunable: `DNA_SYNTHESIS_MIN_VALUES` (5), `MAX_VALUES` (10), `MAX_WORDS_PER_VALUE` (50).

Admins can also create values by hand (auto-approved), edit a value (marks `userEdited`), approve/reject individually, or **approve all pending under a subtopic** in one click.

---

## 7. Storage, CDN, and assets

**Three S3 buckets, each with its own key-prefix env var** (`prod`, `staging`, … for environment separation):

| Bucket | Access | Key structure | Rationale |
|---|---|---|---|
| `S3_DOCS_BUCKET_NAME` | Private, presigned | `{prefix}/{organizationId}/{documentId}.{ext}` | **organizationId (UUID)** because subdomains are mutable — a rename would orphan every key |
| `S3_ASSETS_BUCKET_NAME` | Public read via CloudFront | `{prefix}/{subdomain}/avatars/{id}.{ext}`, `{prefix}/{subdomain}/logo-{light\|dark}.png`, `{prefix}/{subdomain}/ml-images/{mlId}.png` | **subdomain** because it mirrors the CDN URL structure the browser hits |
| `S3_REPORTS_BUCKET_NAME` | Private, presigned, **written externally** | `{prefix}/{organizationId}/…` | Same immutability rationale as docs |

The two different key conventions are intentional and documented — don't "unify" them without understanding both reasons.

**Cache strategy for assets** — this was redesigned once (commit "Completely redesign image versioning"):
- Logos upload with `Cache-Control: no-cache` so CloudFront revalidates each request; they change rarely but must propagate instantly.
- The backend additionally issues a **targeted CloudFront invalidation** for the specific key on avatar/logo upload. Requires `CLOUDFRONT_DISTRIBUTION_ID`; silently skipped when absent, and always fire-and-forget — an invalidation failure logs a warning and never fails the upload.
- The frontend builds **versioned URLs** (`?v={timestamp}` from `logoUpdatedAt` / `updatedAt`) via `getVersionedAssetUrl()`. Belt and braces: version-busting works even where invalidation doesn't.
- `useLogo` **probes** the CDN for a custom logo and falls back to the bundled Karibu logo on 404, so a facility that never uploaded one still renders correctly.

The minimal IAM policy (three buckets + `s3:ListBucket` on reports + `cloudfront:CreateInvalidation` + KMS on the *key* ARN) is spelled out in `apps/backend/DEVELOPMENT.md` — copy it from there.

---

## 8. The conversational layer

This is the heart of the product and where most of the subtle decisions live. Everything is in `apps/backend/src/routes/chat.ts` (~1,075 lines).

### Two surfaces

| | Microlearning chat (`POST /chat/ml`) | Assistant / AMA (`POST /chat/assistant`) |
|---|---|---|
| Scope | One ML: its topics, subtopics, approved DNA values | Whole org knowledge + Karibu manual |
| Prompt | Conversation pattern + persona + objectives + DNA + guardrails | Fixed assistant prompt + persona + guardrails |
| Tools | `searchKnowledge`, `setLanguage`, optional `offerOptions`, `markLearningComplete` | `searchKnowledge`, `searchKaribuManual`, `reportSource`, `setLanguage` |
| Completion | Yes (tool + classifier safety net) | N/A |
| Source badges | No | Yes |

Both use `streamText` with `stopWhen: stepCountIs(3)` and return `toUIMessageStreamResponse`, persisting via `saveChat` in `onFinish` (idempotent inserts, `ON CONFLICT DO NOTHING`).

### System prompt composition (ML)

Order matters and was chosen for recency effects:

1. **Conversation pattern prompt** (the teaching method) — or `DEFAULT_ML_SYSTEM_PROMPT` if the ML has no pattern.
2. **Persona block** — explicitly subordinate: *"must never override the instructional method, the learning objectives, or the organizational source of truth."*
3. **Response-length guide** — from the pattern's `responseLength` (`short` ≈15–30 words / `medium` ≈40–90 / `long` 120+); null means the admin opted out.
4. Organization name, learner name.
5. Topics, learning objectives (subtopics), **approved DNA values** labeled as "primary source of truth".
6. Behavioral guidelines (or, if already completed, a "you may answer freely now" block).
7. **Language directive.**
8. **`HIPAA_GUARDRAIL` — always last**, so it has end-of-prompt recency and overrides anything above.

### The `__start__` convention

The learner's first message is the literal string `__start__`, sent by the client as a system trigger so **the AI opens the lesson** rather than the learner having to say something. The prompt explains this explicitly so the model doesn't respond to it literally.

### Guardrails

**1. HIPAA guardrail (always on, every user-facing prompt).**
Karibu is **not HIPAA compliant** and must never accept, store, repeat, or reason over PHI. The prompt enumerates identifiers (names, initials, DOB, room/bed, diagnoses tied to an individual, medications for an individual, care notes) and instructs a redirect to the charge nurse.
The important refinement (commit "allow anonymous patient referencing"): **generic clinical questions are explicitly NOT PHI and must be answered normally.** The prompt carries a worked contrast pair — "What if the patient has a fever within the first 15 minutes of a transfusion?" (answer) vs "My patient in room 12 spiked a fever…" (decline). The first version over-refused and made the assistant useless for real clinical education.

**2. Knowledge restriction (per-org, default OFF).**
Motivated by liability: an ungrounded answer the facility never authored still arrives wearing the facility's badge.
- Two columns: `restrict_to_knowledge_base` (default false, so existing orgs are unchanged) and `knowledge_redirect_message` (facilities use different titles — charge nurse, DON, supervisor — so the referral text is admin-authored; blank falls back to `DEFAULT_KNOWLEDGE_REDIRECT`).
- **Applies to the assistant only.** ML chat is already scoped to its objectives and has no source-labeling signal to gate on.
- **Enforcement is a tool gate, not a post-filter.** The model must call `reportSource` *before* writing its answer. When the toggle is on and the model reports `general`, `reportSource.execute` returns a `BLOCKED:` directive carrying the org's referral text instead of `'Recorded.'`. **Because the tool call lands before any answer tokens exist, zero ungrounded content is ever generated** — and the model then emits the referral itself, which keeps it in the learner's language and in the session persona at no safety cost.
- `knowledgeRestrictionDirective()` is placed *before* `HIPAA_GUARDRAIL` so HIPAA keeps last position. Its only job is to make the model report honestly — the gate can't fire otherwise.
- **Known limitation, accepted:** enforcement depends on honest self-reporting. A turn mislabeled `source` bypasses it. Same reliability ceiling the source badges already operate under — a strong guardrail, not a guarantee.

### Source labeling (assistant)

`reportSource` takes one of `source | document | manual | general | conversational`:

| Value | Meaning | UI badge |
|---|---|---|
| `source` | Approved DNA values | "{Org} Verified" |
| `document` | Uploaded document chunks | Document badge |
| `manual` | Karibu product manual | Manual badge |
| `general` | Model's own knowledge | "General Knowledge" |
| `conversational` | Greetings, thanks, acknowledgments, clarifying questions, capability descriptions | **No badge** |
| `restricted` (metadata only) | A blocked answer turned into a referral | **No badge** |

**Why `conversational` exists:** without it, "Hi!" and "You're welcome" were being labeled General Knowledge, which made the badge noise and eroded trust in it. **Why `restricted` renders no badge:** labeling a referral "General Knowledge" would tell the learner the exact opposite of what happened.

`searchKnowledge` returns two labeled sections in one call — `[Source Knowledge]` (approved DNA values, prioritized) and `[Document Knowledge]` (vector hits) — and the prompt forbids echoing those labels into the response.

### Completion detection — two paths

1. **`markLearningComplete` tool.** The prompt insists the model deliver its closing remarks **and** call the tool in the *same* response, never closing and then waiting.
2. **Classifier safety net** (`services/completion-classifier.ts`). In practice the model sometimes writes the closing text and stops. After the stream finishes, a cheap `gpt-5-mini` `generateObject` call inspects the finished conversation against the objectives and returns a strict boolean. If it agrees, progress is updated **on the same turn** instead of the next one.
   - The update is guarded by `status = 'active'` and `.returning()`, so it can't double-fire against the tool path.
   - **Returns false on any error** — completion stays off rather than risking a false positive.
   - Analytics distinguishes the two via `completion_path: tool | classifier`, which is your instrument for measuring how often the primary path fails.

Both paths fire the per-ML completion webhook (§9) and emit `Microlearning Completed`.

### Language

- Supported: **`en`, `es`** (`LANGUAGE_CODES`; `en` is always the default and fallback).
- Stored on `users.language`; drives the language directive, the avatar's localized voice, and the localized persona text.
- **`setLanguage` is a tool**, so a learner can just *ask* mid-conversation ("¿Puedes hablar español?"). The Zod enum guarantees only supported languages can be set. The route tracks the change and returns it in message metadata (`languageChanged`) so the client can re-render and switch the TTS voice mid-session.
- `organizations.allow_language_selection` hides the picker org-wide. **[Temporary]** — the schema comment says it plainly: a pilot-era toggle with **no admin UI**, set directly in SQL, to be replaced by a proper per-org language policy when multi-language ships fully.

### Avatars and personas

**One avatar per conversation, resolved by precedence** (`resolveSessionAvatar`):

1. Learner's `users.preferred_avatar_id` (learners only — admins skip this, so admins always see the org default when testing).
2. Org's `organizations.default_avatar_id` — **NOT NULL**, so it is always present.
3. `BUILT_IN_AVATARS[0]` (Amara) — an **in-code constant, no query**, used only if the resolved id has no row (possible because there is no FK).

Decisions:
- **Per-ML avatars were removed.** `microlearnings.avatar_id` is gone and the org default is now required. Rationale: a learner switching persona between lessons in the same sequence was jarring, and per-ML avatars multiplied configuration for no product value.
- **Backend and frontend resolve the same precedence independently** — backend for the persona *text*, frontend for the *voice and photo*.
- Personas are written **in the first person, in each language, describing tone only — deliberately no backstory**, so a persona can never compete with the organization's source of truth. Keep it to one short sentence. The same sentence is spoken as the avatar's self-introduction ("Hi, I'm {name}. {description}").
- Built-in avatars (`src/config/built-in-avatars.ts`, images bundled in `assets/avatars/`): **Maria, Sofia, Daniel, David** (+ Amara as the fallback constant), each with an `en` and `es` Deepgram Aura-2 voice chosen for gender/tone match. The last commit on the branch was "New avatar names (check voice genders)" — **verify voice/gender pairings if you touch this list.**
- `pnpm backfill-org-default-avatar` exists as a one-off for pre-NOT-NULL orgs; run it **before** `db:push` applies the constraint.

### Multiple choice

`offerOptions` (only registered when the pattern has `multipleChoiceEnabled`) attaches 2–4 clickable chips to a question. The tool description is unusually prescriptive — grammatical match to the question, **exactly one** unambiguously correct option, distractors drawn from real misconceptions, mutually exclusive, parallel structure and similar length — because looser wording produced giveaway options. Options are also randomized client-side, and the learner can always still type a free-form answer.

### Voice

- **STT:** `POST /chat/transcribe`, multipart audio → Deepgram **nova-3**. An empty transcript (silence) returns `{ text: '' }` rather than an error.
- **TTS, two paths:**
  - `POST /chat/tts` — one-shot, returns MP3. Simple, used for short utterances.
  - **`WS /chat/tts-stream`** — the real path. The Node server does a raw `ws` upgrade (authenticated via `?token=`), proxies to Deepgram's streaming socket, and returns **raw linear16 PCM at 24 kHz**. Client protocol: `{type:"chunk"|"flush"|"close"}` up, binary audio + `{type:"flushed"|"done"|"error"}` down.
  - **Two hard-won details:** the server **holds Deepgram's `Close` until the `Flush` is acknowledged**, otherwise the tail of the audio is truncated; and text is **chunked by sentence** with a text-cleanup pass before synthesis (commit: "Major improvements on text clean up, switch to sentence chunking and waiting on flush to close the stream"). Don't refactor these away.
  - The client hook (`useStreamTTS`) is a small state machine — `idle → connecting → streaming → draining` — with **pause/resume** (audio suspends while new audio keeps buffering).
- Default voice `aura-2-asteria-en`, overridable per avatar localization and by `DEFAULT_VOICE_ID` / `NEXT_PUBLIC_DEFAULT_VOICE_ID`.
- `organizations.pronunciation` exists so a facility's name is spoken correctly.

---

## 9. Microlearnings, sequences, and the learner feed

- **Assignment path:** sequence → user group → members. `user_groups.isAll` marks the implicit "everyone" cohort, which is unioned into every learner's group set. Standalone MLs (no `sequenceId`) are open to all learners in the org.
- **`GET /microlearnings/feed`** returns the structured learner view: **`active`** (the *next* uncompleted ML per sequence + uncompleted standalones) and **`archive`** (completed/expired). Showing only the next item per sequence is what makes a sequence feel like a path rather than a list.
- **Expiry is lazy, not scheduled.** On each feed read, `active` progress rows older than `organizations.expirationIntervalHours` (default 8) are flipped to `expired`. **No cron, no worker** — the read path is the only place expiry can be observed, so that is where it is computed.
- **Non-sequence MLs are archived after completion** (commit `d6e2f53`), so the feed doesn't accumulate finished one-offs.
- **Real-time updates via SSE.** `GET /learner/stream` holds an in-memory `orgId → Set<sender>` registry; publishing an ML or assigning a sequence calls `broadcastFeedUpdate(orgId)` and connected learners get a `feed:updated` event. Heartbeats keep the connection alive and detect disconnects. **This is per-process** — with multiple replicas, a learner connected to replica A won't see an event triggered on replica B. Fine at pilot scale; needs Redis pub/sub or similar to scale out.
- **Cover images.** On ML create, `generateMlImage()` runs fire-and-forget: it builds a prompt from topic + subtopic names + org name, optionally passes the org's light logo as an `inlineData` reference part to bias palette/style, calls Gemini `generateContent` with `responseModalities: ['IMAGE']`, and writes `imageS3Key`. Best-effort — failures never surface to the create response, and `imageS3Key` is nullable with a gradient placeholder fallback. There is also `POST /microlearnings/:id/regenerate-image`. Because it's async, an ML can be visible before its image exists.
- **Confetti on completion is per-ML and OFF by default** (`confettiEnabled`). Deliberate: celebratory animation is a per-facility tone decision, and the healthcare pilot didn't want it everywhere.
- **Admin test mode.** `/ml/{id}?test=true` (admins only): never loads prior history, starts a fresh chat id per load, and shows a Restart button. Old test chats stay in the DB but are never surfaced. Learner behavior is untouched by the parameter.
- **Per-ML completion webhook** (`completion_webhook_url`): fire-and-forget POST of `{karibuUserId, organizationId, microlearningId, completedAt, email?}` on completion. **No UI, by design** — this is a developer knob, set via SQL or `pnpm --filter karibu-backend set-ml-webhook <id> <url|--clear>`. The mechanism is generic; Teambridge is its first consumer.

---

## 10. Admin surface

| Section | Route | Notes |
|---|---|---|
| Dashboard | `/` | Metrics; pulsing red banner when open flags exist |
| DNA | `/dna` | Topics/subtopics/values, discovery, synthesis, approvals |
| Microlearnings | `/microlearnings` | Largest admin file (1,356 lines); create/edit, sequences, collapse/expand, kebab "add to sequence", Test |
| Patterns | `/patterns` | Conversation patterns incl. response-length |
| Team | `/team` | 1,367 lines; invites, phone numbers, profile editing, command palette |
| Flagged | `/flagged` | Live red badge with open count |
| Reports | `/reports` | Externally-produced files |
| Avatars | `/avatars` | **Hidden by default** behind `NEXT_PUBLIC_AVATARS_ENABLED` |
| Learner detail | (from Team) | Per-learner history and chat transcripts |

`src/app/[section]/page.tsx` handles all of them and holds **`ADMIN_ONLY_SECTIONS`** — currently `dna, microlearnings, avatars, patterns, team, flagged, reports`. **Adding an admin section without adding it to that set silently exposes it to learners.** This is the single easiest mistake to make in the web app.

### Team / invites

- `POST /team/invite` — bulk, comma-separated emails. **Its response deliberately covers both new and pre-existing users**: `{ invited: […], alreadyExists: […], failed: […] }`, and *both* arrays carry a usable sign-in `link` (reusing the latest `auth_tokens` row, or minting one). This exists because Teambridge calls it for every nurse-facility onboarding and must get a link back regardless of whether the user already existed.
- `POST /team/invite-one` — the admin UI's single-invite path: captures first/last name and E.164 phone up front, and can **suppress the email** (`sendEmail: false`, always suppressed for service tokens) so the admin shares the link themselves.
- `PATCH /team/:userId` — edit profile. Omitting `phoneNumber` leaves it untouched; `""` clears it. **Admins may edit any non-admin member and themselves, but never another admin.**
- `/team` is the **only** router with `allowApiKey: true`.

### Reports

Files are produced **outside** the app and dropped into the reports bucket; the backend only lists and presigns. Two presigned URLs per file — `viewUrl` (inline) and `downloadUrl` (attachment) — expiring after `S3_REPORTS_URL_EXPIRY_SECONDS` (3600). When the bucket isn't configured the route returns `{ reports: [], configured: false }` instead of erroring, so the UI shows an empty state.

**The date problem and its solution.** S3's `LastModified` is upload time and **cannot be set** — even a copy-in-place resets it. Since a report's meaningful date is the period it covers, `parseReportFilename()` reads a `YYYY-MM-DD` from the **start or end** of the filename (separators optional: `2026-07-21`, `2026_07_21`, `20260721`), strips it from the *display* name only, and falls back to the upload date when absent. Impossible dates are rejected; a filename that is only a date keeps its name. **Uploading with a dated filename is the only way to control a report's date.**

**Descriptions are a code constant, not a table.** `REPORT_DESCRIPTIONS` in `routes/reports.ts` is an ordered `{ pattern: RegExp, description }[]`; **first match wins, so order is precedence**. Use `[\s_-]*` between words to absorb separators, always the `i` flag, and **never `g`** (`RegExp.test` is stateful with `g` and returns alternating results). Rationale: a handful of report types, fixed set, no admin UI needed.

### Metrics

`GET /metrics` (admin) computes, in one call: usage frequency (sessions/day), session duration (avg/min/max), messages per day per learner, return visits after completion with a monthly delta, time-to-complete (minutes and message count), and completions this month.

### Accessibility & UX

- **Font size preference** per learner (`sm | base | lg | xl`) applied to the web root font size (`FontSizeSync.tsx`) — a real requirement for the nursing-home workforce, not a nicety.
- Command palette (`cmdk`), phone input (`react-phone-number-input`), optional first-time learner onboarding modal behind `NEXT_PUBLIC_LEARNER_ONBOARDING_ENABLED`.

### Feature flags

`src/lib/features.ts` — **build-time** `NEXT_PUBLIC_*` flags, opt-in convention: **disabled unless the value is exactly `"true"`**. Next inlines these at build time, so **toggling requires a rebuild**. Currently: `NEXT_PUBLIC_AVATARS_ENABLED`, `NEXT_PUBLIC_LEARNER_ONBOARDING_ENABLED`.

---

## 11. Teambridge integration

Full detail lives in `integrations/teambridge/DEVELOPMENT.md` (229 lines) — read it before touching this service. Summary of the decisions:

**The loop:** Teambridge shift webhook → resolve assigned nurse(s) → on first (nurse, facility) pair, invite to the right Karibu org and mint + assign a Teambridge task carrying the sign-in link → nurse completes the verification ML → Karibu fires its completion webhook back → mark "Karibu Completed" on the shift, persist the verification, delete the now-redundant task → **every later shift for that pair is auto-marked**, no repeat ML.

**Why a separate package, not a route on the backend:** different SLA (webhooks must 2xx within 5 s and cannot queue behind user traffic), different auth model (inbound HMAC, not user JWTs), different secret blast radius (Teambridge secrets shouldn't share a process with `JWT_SECRET`), different failure domain (a crash here must not break login or chat), different scaling profile (a Teambridge replay burst shouldn't scale the user API). Same monorepo for shared tooling; **independent runtime and deploy**.

**Other decisions worth knowing:**
- **Schema discovery at boot, never hardcoded.** Teambridge collection/field IDs are per-tenant (sandbox ≠ prod). `discoverSchema()` resolves them by name at startup and **throws on the first missing or mismatched field** — fail loud. Restart required after any Teambridge schema edit.
- **Dual transports.** The OAuth "Open API" handles shift/user reads and shift writes (`PUT`, which is partial-update); a **static-bearer "web" API** at `api.teambridge.com` handles task templates, task assignment, and record deletion — because the unified API rejects task writes with `COLLECTION_TYPE_NOT_SUPPORTED`. None of the web-API endpoints are in the bundled `openapi.json`.
- **Facility map is a JSON file, not a table** (`facilities.prod.json` / `facilities.sandbox.json`, selected by `FACILITIES_FILE`). Small, mostly-static universe; auditable in review. **Secrets stay out of git** via indirection: the file stores the *name* of the env var holding each org's API key, never the key. It is read **synchronously at import** and throws on a missing file, bad JSON, unset key, or duplicate `karibu_organization_id` — a misconfigured map must fail boot rather than route to the wrong facility.
- **Role gating before the DB claim.** `TEAMBRIDGE_ELIGIBLE_ROLES` (e.g. `RN,LPN,CNA`) is resolved to UUIDs at boot. **No row is written for ineligible nurses**, so a later role change is picked up automatically with nothing to clean up. Empty list disables the filter and warns at boot.
- **Return 200 immediately, process async.** Teambridge only retries on non-2xx. Errors are logged and **not retried — there is no DLQ**. If durability ever matters, this needs a queue.
- **State in Postgres, same instance, separate `integrations` schema, `teambridge_*` prefix.** Unified backups/monitoring/pooling, a permission boundary, clean teardown (`DROP SCHEMA integrations CASCADE`), and a trivial future split via `pg_dump --schema=integrations`. `drizzle.config.ts` scopes drizzle-kit with `tablesFilter: ['teambridge_*']` and keeps its own migration table, so a second integration can coexist in the same schema.
- **Dedup is atomic** (`INSERT … ON CONFLICT DO NOTHING` on `teambridge_events`); snapshot diffing runs in a transaction with `SELECT … FOR UPDATE`. Events are recorded **only for tracked facilities**, and the table has a TTL (`TEAMBRIDGE_EVENT_RETENTION_DAYS`, default 30, hourly cleanup) so it stays constant-size.
- **HMAC:** `sha256(secret, "${timestamp}.${rawBody}")`, `sha256=` prefix tolerated, ±5 min window, `timingSafeEqual`. `VERIFY_WEBHOOK_SIGNATURE=false` exists for connectivity debugging and warns on every request — **never ship with it off.**
- **`shift_request_approved` is handled identically to `shift_updated`** because Teambridge emits no `shift_updated` on approval, making the approval event the only assignment signal.
- **`shift_deleted` tears down** the task instance, deactivates + deletes the template, and drops the invite row **last**, so a partial failure still unblocks re-onboarding. `/team/invite` is idempotent and returns the same link, so the nurse-facing URL survives re-onboarding.
- **No build step** — runs from source via `tsx`, `noEmit: true`, no `dist/`. A host that requires a compiled bundle needs config changes.

---

## 12. Observability and analytics

**Logging (Pino).** Pretty in dev, JSON in prod. HTTP logging via `hono-pino` at debug (method/url/status) and trace (headers). The **log-level policy in `CONVENTIONS.md` is a real decision, not boilerplate**: `info` is reserved for *business events you want in production* (document uploaded, user created); routine operations — cache hits, middleware steps, bot auth failures — are `debug`. Keeping production logs small and meaningful was explicit.

**Errors (Sentry).** Both apps; optional. Backend has an `onError` reporter middleware and a `reportMessage` helper; web uploads source maps at build (`SENTRY_AUTH_TOKEN`).

**Analytics (Mixpanel), both sides, behind a thin swappable wrapper** (`backend/src/utils/analytics.ts`, `web/src/lib/analytics.ts`) — vendor swap is a single-file change. No-op without a token.

**Why both sides:** the web captures what the server can never see (page views, a learner who opens an ML and leaves without messaging — data that does not exist in Postgres); the backend captures authoritative events that survive ad-blockers and closed tabs, stamped with a **verified, non-spoofable role + user id from the JWT**.

Conventions: event names are Title Case `Object Action`, past tense, defined once in an `EVENTS` map (**never inline a raw string at a call site**); property keys `snake_case`; `distinct_id` / `role` / `organization_id` on every event (injected by the wrapper on the backend, registered as super properties on the web).

| Event | Side | Key properties |
|---|---|---|
| `User Logged In` | backend | `login_method: password \| token` |
| `Message Sent` | backend | `chat_type: microlearning \| discussion`, `microlearning_id?` |
| `Microlearning Completed` | backend | `microlearning_id`, `completion_path: tool \| classifier` |
| `Microlearning Viewed` | web | `microlearning_id`, `$duration` (dwell, fired on unmount) |
| `$mp_web_page_view` | web | built-in, on route change |

Deliberate: the two chat surfaces share **one** `Message Sent` event differentiated by `chat_type` (filter the funnel step rather than maintaining two events). "Opened but didn't act" = `Microlearning Viewed` with no matching `Message Sent`.

---

## 13. Conventions and workflow

**Read `CONVENTIONS.md` before your first PR.** It is unusual and enforced by habit, not by a linter:

- **No emojis** in code or logs.
- Log strings: `...` for ongoing, `.` for completed.
- **Semicolons on statements but NOT on closing braces of function bodies.**
- **Blank lines inside blocks** (functions, ifs, callbacks) — but **not** inside object literals.
- Backend: strict TypeScript, `.js` extensions on every internal import, structured error logging (`logger.error({ error }, 'message')`).

**Git.** Conventional-commit style with a scope naming the affected packages: `feat(backend, web): …`, `chore(web): …`, `docs(backend, integrations/teambridge): …`. The working branch is **`develop`**. (The clone used to compile this document is shallow — 52 commits from 2026-05-07 to 2026-08-18 — so the reconstruction above draws on the code and the in-repo docs rather than the full commit history.)

**Database workflow — the most important operational decision to know:**

> **During development, always use `pnpm db:push`. Do not generate migrations until the initial production release.**

Drizzle-kit diffs the schema against the live DB and applies it directly. Cheap and fast while iterating; the trade-offs are no audit trail and no protection against destructive changes (a column rename becomes drop + recreate). **[Temporary]** — the cutover to `db:generate` + `db:migrate` is an explicit, still-pending decision for both `apps/backend` and `integrations/teambridge`, and it must happen before either takes real production traffic.

**Local setup:**
```bash
pnpm install                 # from repo root
pnpm dev:backend             # :3000
pnpm dev:web                 # :3001 (turbopack)
pnpm dev:db:push             # sync schema
```
Reach the app at `http://demo.localhost:3000` / `:3001` — a bare `localhost` has no subdomain and the org middleware will 404. Set `ORG_CACHE_TTL=0` locally so org edits show up without a restart.

---

## 14. Operations runbook

All backend scripts run from `apps/backend` and need `DATABASE_URL`.

| Command | Purpose |
|---|---|
| `pnpm db:create-org --name … --subdomain … --admin-email … --admin-password …` | New tenant + first admin (also sets the org default avatar) |
| `pnpm db:add-admin --subdomain … --email … --password …` | Add an admin to an existing org |
| `pnpm db:reset-password` | Reset a user's password |
| `pnpm db:seed:dev` | Demo org + admin + learner for local dev |
| `pnpm db:seed:defaults` | **Global defaults: built-in conversation patterns + built-in avatars (uploads bundled images).** Run this on any fresh database |
| `pnpm db:seed:admins` | Seed admin users |
| `pnpm backfill-org-default-avatar` | One-off; run **before** `db:push` applies the NOT NULL constraint |
| `pnpm retire-built-in-avatars` | Retire built-ins |
| `pnpm set-ml-webhook <mlId> <url\|--clear>` | Configure a per-ML completion webhook |
| `pnpm upload-manual <path.txt> [sourceId]` | Chunk + embed the Karibu product manual into the global Chroma collection. Re-running with the same `sourceId` replaces that source |
| `tsx src/scripts/create-service-account.ts` / `mint-api-key.ts` | Machine identities + long-lived API keys (for integrations) |
| `pnpm db:studio` | Drizzle Studio |

Built-in conversation patterns seeded today: **Interactive Q&A** (multiple choice on), **Socratic Mirroring**, **Interactive Role-Play**, **Reverse Precepting**.

**Deployment shape:** backend and web deploy independently (Vercel/Railway/EC2); Teambridge is a **third, independent long-running process** — it holds in-memory schema caches and a token-refresh interval and must not be mounted on the backend. Each deploy target should set its **Root Directory** to the package folder and use an **Ignored Build Step** with a path filter (`git diff --quiet HEAD^ HEAD -- integrations/teambridge`) so a backend push doesn't redeploy the integration.

---

## 15. Environment variables

### Backend (`apps/backend/.env.example`, validated by Zod at boot)

**Required:** `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `CORS_ORIGIN` (comma-separated URLs), `OPENAI_API_KEY`, `CHROMA_API_KEY`, `CHROMA_TENANT`, `CHROMA_DATABASE`.

**Notable optional / defaulted:**

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `NODE_ENV` / `LOG_LEVEL` | 3000 / development / info | |
| `ORG_CACHE_MAX_SIZE` / `ORG_CACHE_TTL` | 1000 / `15m` | `0` disables caching |
| `JWT_AUDIENCE` / `JWT_EXPIRATION` / `JWT_ALGORITHM` | `https://test.karibu.ai` / `30d` / HS256 | **Change the audience in production** |
| `OPENAI_CHAT_MODEL` | `gpt-5.1` | |
| `OPENAI_CLASSIFIER_MODEL` | `gpt-5-mini` | Completion safety net |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Changing it **invalidates every stored embedding** |
| `DEEPGRAM_API_KEY` | — | Absent ⇒ TTS/STT return 400 |
| `GEMINI_API_KEY` / `GEMINI_IMAGE_MODEL` | — / `gemini-2.5-flash-image` | Absent ⇒ image generation silently skipped. Must be a model that supports image output via `generateContent`, **not** the Imagen `generateImages` API |
| `AWS_*`, `S3_DOCS_*`, `S3_ASSETS_*`, `S3_REPORTS_*` | — | See §7; `S3_MAX_UPLOAD_SIZE_MB` = 20 |
| `CLOUDFRONT_DISTRIBUTION_ID` | — | Absent ⇒ invalidation skipped |
| `CHROMA_COLLECTION_NAME` / `CHROMA_MANUAL_COLLECTION_NAME` | `karibu-documents` / `karibu-manual` | |
| `DNA_SYNTHESIS_*`, `DNA_DISCOVERY_*` | 5/10/50, 3/6/2/4 | Tunable prompt bounds |
| `NOTIFICATION_CHANNELS` + `TWILIO_*` | empty | E.164-validated phone number |
| `POSTMARK_API_KEY` / `POSTMARK_FROM` | — / `noreply@karibu.ai` | Absent ⇒ invite emails skipped |
| `FRONTEND_URL_TEMPLATE` | `http://localhost:3001` | Use `{subdomain}` in staging/prod |
| `SENTRY_DSN`, `MIXPANEL_TOKEN`, `MIXPANEL_API_HOST` | — / — / `api.mixpanel.com` | `api-eu.mixpanel.com` for EU residency |

### Web (`apps/web/.env.local.example`)

`NEXT_PUBLIC_API_URL` (plain URL locally, `{subdomain}` template in staging/prod), `NEXT_PUBLIC_ASSETS_CDN_URL`, `NEXT_PUBLIC_ASSETS_KEY_PREFIX`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_MIXPANEL_TOKEN`, `NEXT_PUBLIC_MIXPANEL_API_HOST`, `NEXT_PUBLIC_DEFAULT_VOICE_ID`, `NEXT_PUBLIC_LEARNER_ONBOARDING_ENABLED`, `NEXT_PUBLIC_AVATARS_ENABLED`. Build-time — **rebuild to change any of them.**

### Teambridge (`integrations/teambridge/.env.example`)

`DATABASE_URL` (shared instance, `integrations` schema), `TEAMBRIDGE_CLIENT_ID`, `TEAMBRIDGE_CLIENT_SECRET`, `TEAMBRIDGE_WEB_TOKEN`, `TEAMBRIDGE_WEBHOOK_SECRET`, `TEAMBRIDGE_ELIGIBLE_ROLES`, `TEAMBRIDGE_EVENT_RETENTION_DAYS`, `FACILITIES_FILE`, `KARIBU_WEBHOOK_BEARER`, plus one `KARIBU_*_API_KEY` per facility (names come from each facility's `karibu_api_key_env`).

---

## 16. Open items and known gaps

**Explicitly deferred decisions (`[Temporary]` above):**

1. **Migrations.** Both `apps/backend` and `integrations/teambridge` still use `db:push`. Cut over to `db:generate` + `db:migrate` before production traffic. This is the highest-priority item on the list.
2. **`allowLanguageSelection` has no admin UI** — SQL only; to be replaced by a proper per-org language policy.
3. **Teambridge HMAC on the inbound Karibu webhook** — currently an optional bearer token only.
4. **Teambridge re-onboarding lifecycle** — the invite row clears only on `shift_deleted` of the originating shift. A nurse who never completes the ML while that shift stands never re-triggers. Consider gating the early-skip on verification state and reacting to assignee-removed events.
5. **Sandbox facility map** still contains `REPLACE_ME_WITH_KARIBU_ORG_UUID`.
6. **Teambridge deploy projects** (independent Vercel/Railway targets with path-filtered ignored build steps) not yet configured.
7. **Linked-record name resolution** in Teambridge — assignee/location/shift-group arrive as raw UUIDs, so diff logs are hard to read.

**Architectural limits to be aware of:**

8. **SSE and the org cache are per-process.** Multiple backend replicas break real-time feed updates across replicas and lengthen cache-staleness windows to the TTL. Needs shared pub/sub to scale horizontally.
9. **No queue, no retry, no DLQ** on any fire-and-forget path: document processing, ML image generation, completion webhooks, Teambridge processing. A failure is logged and lost. Document processing failure is visible (`status: failed`); the others are not.
10. **Guardrails depend on model self-reporting.** Both the source badges and the knowledge restriction assume `reportSource` is called honestly. Accepted, documented, but worth monitoring.
11. **Karibu is not HIPAA compliant.** The prompt guardrail is best-effort mitigation, not compliance. Any move into real clinical workflows needs a BAA-level review of Postgres, S3, ChromaDB Cloud, OpenAI, Deepgram, Gemini, Mixpanel, and Sentry.
12. **No automated tests anywhere in the repo.** No test runner, no CI config. Everything is verified manually. This is the largest quality risk in the codebase.
13. **`localStorage` token storage** — XSS-exposed by design (see §4).
14. **`ADMIN_ONLY_SECTIONS`** must be updated by hand for every new admin section, or the section leaks to learners.
15. **Vestigial dependencies:** `@mastra/core` (instantiated, no agents), `@ai-sdk/elevenlabs` (unused — Deepgram is the TTS provider), `@vercel/analytics` alongside Mixpanel. Safe cleanup targets.
16. **Doc drift to fix:** `apps/backend/DEVELOPMENT.md` still claims the ChromaDB pipeline is not wired into document upload (it is), and still says discovery samples "up to 40 chunks" (the cap is 800 with round-robin striding). It also references `qmd` semantic-search tooling that is not part of this repo.

---

## 17. Getting productive in the codebase

1. Read `CONVENTIONS.md`, then this document, then `apps/backend/DEVELOPMENT.md`.
2. Get a Postgres + ChromaDB Cloud instance and the API keys (OpenAI required; Deepgram/Gemini/Postmark/Twilio/Sentry/Mixpanel optional).
3. `pnpm install` → `pnpm dev:db:push` → `pnpm db:seed:defaults` → `pnpm db:create-org …` → `pnpm dev:backend` + `pnpm dev:web`. Open `http://demo.localhost:3001`.
4. Walk the full loop once by hand: upload a document → auto-discover → accept a topic → synthesize → approve values → create an ML → assign a sequence to the "all" group → complete it as a learner → confirm the metric moves.
5. Read `routes/chat.ts` end to end. It is the product.
6. The three questions that most shape any further work, in order: the **migrations cutover**, **a test harness**, and **whether the deployment will ever need more than one backend replica** (items 1, 12, and 8 above).
