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
