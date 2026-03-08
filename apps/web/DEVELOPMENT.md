# Web Development Guide

This file provides guidance for developers and AI assistants working with the web app.

## Project Overview

Karibu Web is a Next.js App Router application with TypeScript and Tailwind CSS.

## Routing (Admin)

Admin sections use URL-based routing:
- `/` — Dashboard (default for admins)
- `/{section}` — e.g. `/dna`, `/team`, `/microlearnings`, `/flagged`

`src/app/[section]/page.tsx` handles all section routes. It contains `ADMIN_ONLY_SECTIONS` — a set of section IDs that learners cannot access (they get redirected to `/`). Admins can access any route. **Update `ADMIN_ONLY_SECTIONS` whenever a new admin-only section is added.**

Current admin-only sections: `dna`, `microlearnings`, `avatars`, `patterns`, `team`, `flagged`

## Message Flagging

Learners can flag any chat message (ML or assistant) as potentially inaccurate via a hover-revealed flag button. Admins review flags at `/flagged`.

- **Backend route**: `/flags` — POST to flag, GET to list, GET `/flags/count` for badge, PATCH `/:id/status` to resolve
- **DB table**: `flagged_messages` — status: `open | reviewed | dismissed`, optional `reason`
- **Admin dashboard**: Pulsing red glow banner when open flags exist; clicking navigates to `/flagged`
- **Admin sidebar**: "Flagged" nav item with live red badge showing open count
