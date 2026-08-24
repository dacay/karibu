# Web Development Guide

This file provides guidance for developers and AI assistants working with the web app.

## Project Overview

Karibu Web is a Next.js App Router application with TypeScript and Tailwind CSS.

## Routing (Admin)

Admin sections use URL-based routing:
- `/` — Dashboard (default for admins)
- `/{section}` — e.g. `/dna`, `/team`, `/microlearnings`, `/flagged`

`src/app/[section]/page.tsx` handles all section routes. It contains `ADMIN_ONLY_SECTIONS` — a set of section IDs that learners cannot access (they get redirected to `/`). Admins can access any route. **Update `ADMIN_ONLY_SECTIONS` whenever a new admin-only section is added.**

Current admin-only sections: `dna`, `microlearnings`, `avatars`, `patterns`, `team`, `flagged`, `reports`

## Avatars

The org's default avatar (set in the Organization section) applies to **all** conversations — microlearning chat and the assistant chat — for both voice/photo and persona. The microlearning form has no avatar field; MLs no longer carry their own avatar.

The chat pages (`app/ml/[id]/page.tsx`, `app/chat/page.tsx`) resolve the effective avatar as: learner's preferred avatar → org default (`profileData.user.defaultAvatarId`, always set) → none. They look the avatar up in the `avatars` list to get its voice + photo; the backend independently resolves the same precedence for the persona text.

## DNA Auto-Discovery

The "Auto-discover" button in the DNA section (`/dna`) calls `POST /dna/discover` to analyze uploaded documents and suggest topic/subtopic structures.

- Suggested items appear inline with an amber "Suggested" badge and Accept/Reject buttons
- Accepting sets `status: active` and shows normal controls (edit, delete, synthesize)
- Rejecting hides the item from the list (`status: rejected` filtered out in display)
- Success/error feedback appears inline below the toolbar

## Admin ML Test Mode

Admins can test a microlearning from the admin panel via the **Test** button in the ML row's dropdown. This opens `/ml/{id}?test=true` in a new tab.

When `?test=true` is present and the user is an admin:
- Previous chat history is **not loaded** — every page load starts a fresh session with a new chat ID
- A **Restart** button appears in the chat header (left of the Voice toggle) to start another fresh session without leaving the page
- Old test chats are preserved in the DB but never surfaced to the admin

Learner behavior is completely unaffected by this parameter.

## Reports

Admins browse organization report files at `/reports` (`ReportsSection`). Report files are uploaded externally to a private S3 bucket under the org's prefix; the page lists them grouped by date (newest first) with a matched description and View/Download actions.

- **Names**: the listed name has both its date and its file extension stripped. Only the extension stripping is client-side (`stripExtension` in `ReportsSection`) — the API `name` keeps it, since `isPdf()` and the server-side description matching both read it.
- **View**: PDFs open in a new tab via a presigned inline URL. Non-PDF files show only a Download action.
- **Download**: presigned attachment URL served with the original filename (date included).
- **Dates**: the date heading comes from `report.date` — a `YYYY-MM-DD` the backend reads off the start or end of the filename (e.g. `2026-07-21 Policy Consistency Review.pdf`), falling back to the S3 upload date when the filename has none. Uploading with a dated filename is the only way to control a report's date, since S3's `LastModified` is not settable. The date is stripped from the name shown in the list. See [Backend DEVELOPMENT.md](../backend/DEVELOPMENT.md#report-dates).
- **Descriptions**: matched server-side by regex against the filename. Edit the `REPORT_DESCRIPTIONS` list in `apps/backend/src/routes/reports.ts` to add a report type — there is no admin UI for this by design, since the set of report types is small and fixed.
- **Backend route**: `GET /reports` — lists files with presigned URLs and matched descriptions. See [Backend DEVELOPMENT.md](../backend/DEVELOPMENT.md#reports).

## Message Flagging

Learners can flag any chat message (ML or assistant) as potentially inaccurate via a hover-revealed flag button. Admins review flags at `/flagged`.

- **Backend route**: `/flags` — POST to flag, GET to list, GET `/flags/count` for badge, PATCH `/:id/status` to resolve
- **DB table**: `flagged_messages` — status: `open | reviewed | dismissed`, optional `reason`
- **Admin dashboard**: Pulsing red glow banner when open flags exist; clicking navigates to `/flagged`
- **Admin sidebar**: "Flagged" nav item with live red badge showing open count

## ID-Only Access Page

Organizations running access mode (`externalIdLoginEnabled` on the org — see [Backend DEVELOPMENT.md](../backend/DEVELOPMENT.md#id-only-access-mode)) get `/access`: a sign-in page whose only field is the ID their institution issued the learner (e.g. a UCSF ID). It is deliberately near-identical to `/login`, minus the password.

- **Page**: `src/app/access/page.tsx`. It reads `GET /org/public` (via `useOrgPublic`) and **redirects to `/login` when the org does not have access mode on**, so the page effectively does not exist for anyone else. The backend rejects ID logins for those orgs regardless — the redirect is UX, not the control.
- **Field label**: from `externalIdLabel` on the org, falling back to "ID" (`externalIdLabelFor()` in `src/hooks/useOrgPublic.ts`). Nothing in the frontend hard-codes "UCSF".
- **Sign-in**: `useAuth().accessLogin(externalId)` → `POST /auth/login` with `{ externalId }`. It stores the same token/user as a password login, plus `karibu_login_mode = "access"` in localStorage.
- **Discoverability**: `/login` shows a "Sign in with your {label}" link when the org has access mode on, and `/access` links back to the admin sign-in. `/` sends a *never-signed-in* visitor to `/login` — learners get the `/access` URL as a home-screen shortcut.

### Where an expired session lands

`/access` is meant to be a shortcut on a shared ward phone, and its sessions are short (12h), so **expiry is the ordinary way a learner returns to a sign-in page** — and it must be the ID page, not the admin login.

Two pieces make that work:

- **`karibu_login_mode`** describes the *device*, not the session. It is set by an access sign-in and deliberately survives both expiry and an explicit sign-out, so the next visitor to that phone still lands on `/access`. A password sign-in clears it, so a device that changes hands corrects itself. `getSignInPath()` in `src/lib/api.ts` reads it, and every signed-out redirect goes through it — the four page guards (`/`, `/[section]`, `/chat`, `/ml/[id]`) and the 401 handler alike. **Never hard-code `/login` in a redirect.**
- **`isTokenExpired()`** lets `loadStoredAuth` (in `useAuth`) treat an expired stored JWT as signed out, instead of rendering the app and waiting for the first request to 401. Without it, a learner reopening the app the next morning gets a flash of a broken screen before the redirect. It only decodes `exp` for routing — the backend stays the sole authority on validity.

A signed-in learner who reopens the shortcut mid-session gets the ID form again rather than resuming, which is deliberate: on a shared phone, silently resuming would drop the next nurse into the previous nurse's account.

If `GET /org/public` cannot be reached, `/access` fails closed and redirects to `/login`.

### Admin side (Team page)

`useExternalIdLogin()` (`src/hooks/useExternalIdLogin.ts`) reads the flag off the shared `["org", "config"]` query. When it is on, the Team section shows the member's ID:

- an optional ID field in the single-invite form and in the edit-member dialog (clearing it revokes that person's access-page entry),
- the ID next to the member's email in the list, and searchable alongside email and name.

All of it is hidden for other orgs, and the payload key is omitted entirely so stored values are never touched. Client-side validation (`isValidExternalId`) mirrors the backend's schema; duplicates come back from the API as a 409.
