# Product Analytics

Karibu uses **Mixpanel** for product analytics, instrumented on **both** the
backend and the web app. The provider sits behind a thin, swappable wrapper on
each side — swapping vendors is a single-file change.

- Backend wrapper: `apps/backend/src/utils/analytics.ts`
- Web wrapper: `apps/web/src/lib/analytics.ts`

Analytics is **optional and no-op by default**: if the token env var is unset, the
wrappers do nothing (mirrors the Sentry setup in `utils/errorReporter.ts`).

## Why both sides

- **Web** captures behavior the server can never see — page views and passive
  engagement (a learner opens a microlearning and leaves without sending a
  message). This is the primary reason to use a dedicated analytics tool: the data
  doesn't exist in Postgres.
- **Backend** captures authoritative business/usage events that must survive
  ad-blockers and closed tabs, stamped with a verified, non-spoofable role + user
  id from the JWT auth context.

## Configuration

Backend (`apps/backend/src/config/env.ts`):

- `MIXPANEL_TOKEN` — optional; analytics disabled when unset.
- `MIXPANEL_API_HOST` — default `api.mixpanel.com`; use `api-eu.mixpanel.com` for
  EU data residency.

Web (read directly from `process.env`):

- `NEXT_PUBLIC_MIXPANEL_TOKEN` — optional; analytics disabled when unset.
- `NEXT_PUBLIC_MIXPANEL_API_HOST` — optional; e.g. `api-eu.mixpanel.com`.

## Conventions

- **Event names**: Title Case `Object Action`, past tense (`Microlearning
  Completed`). Defined once in the `EVENTS` map of each wrapper — never inline a
  raw string at a call site.
- **Property keys**: `snake_case`.
- **Global identity on every event**: `distinct_id` (user id), `role`
  (`admin`/`user`), `organization_id`. On the backend these are injected by the
  wrapper; on the web they are Mixpanel **super properties** registered at
  `identifyUser()` time, so they ride on every event automatically.

## Events

| Event | Side | Properties | Fired from |
|---|---|---|---|
| `User Logged In` | backend | `login_method`: password \| token | `routes/auth.ts` |
| `Message Sent` | backend | `chat_type`: microlearning \| discussion; `microlearning_id?` | `routes/chat.ts` (`POST /chat/ml`, `POST /chat/assistant`) |
| `Microlearning Completed` | backend | `microlearning_id`, `completion_path`: tool \| classifier | `routes/chat.ts` (both completion paths) |
| `Microlearning Viewed` | web | `microlearning_id`, `$duration` (dwell) | `app/ml/[id]/page.tsx` |
| `$mp_web_page_view` | web | (Mixpanel built-in) | `providers/AnalyticsProvider.tsx` on route change |

Notes:

- The two chat surfaces (structured ML chat and free-form "ask me anything") are a
  **single** `Message Sent` event differentiated by `chat_type`. To use one surface
  as a funnel step, filter the step on `chat_type` (e.g. `chat_type = discussion`).
- `Microlearning Viewed` is fired on view **unmount** with a dwell duration
  (`startTimer` on mount → `track` on unmount). "Opened but didn't act" = a user
  with `Microlearning Viewed` for an ML but no `Message Sent` for it.

## Web wiring

`AnalyticsProvider` (mounted in `app/layout.tsx` inside `QueryProvider`):

- Initializes the SDK once.
- Keeps the identified user in sync with `useAuth()` — identify on login,
  re-identify after reload, `reset()` on logout.
- Tracks a pageview on every client-side route change (`track_pageview: false` in
  init avoids double-counting the initial load).
