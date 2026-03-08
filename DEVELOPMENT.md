# Karibu Monorepo

This is a monorepo containing all Karibu services and clients.

## Apps

- [Backend](apps/backend/DEVELOPMENT.md) — API server
- [Web](apps/web/DEVELOPMENT.md) — Next.js App Router frontend

## Setup

This repo uses pnpm workspaces. Install dependencies from the root:

```bash
pnpm install
```

## DNA Feature

### Concept

DNA represents an organization's synthesized knowledge extracted from uploaded documents via ChromaDB embeddings and LLM. It spans both the backend (schema, synthesis jobs, API routes) and the frontend (discovery UI, approval flows, status display).

It is structured as a three-level hierarchy:

```
Topic → Subtopic → Value
```

- **Topic** — top-level knowledge domain (e.g. "Leadership Philosophy")
- **Subtopic** — a specific aspect within a topic; its `description` acts as the ChromaDB query anchor for synthesis and re-synthesis
- **Value** — the actual LLM-generated content extracted from document chunks; subject to human approval

### Data Model Decisions

**Three levels, not two.** Although topics and subtopics define structure, values are stored separately because:
- Human approval (HITL requirement) must be tied to specific generated content
- Rejected values are kept in the database (not deleted) so re-synthesis avoids regenerating the same content
- Re-synthesis adds a new value alongside existing ones, leaving history intact

**No embeddings stored in Postgres.** Document chunk embeddings live exclusively in ChromaDB. Topics/subtopics/values in Postgres are the structured output — not the vector store.

**Re-synthesis flow.** When re-synthesizing a subtopic:
1. Take the subtopic `description` as the ChromaDB query
2. Retrieve relevant document chunks
3. Feed to LLM → generate new value
4. Insert new value with `approval: pending`
5. Set `synthesisStatus: done` on the subtopic

**`source` field on topics and subtopics.** Distinguishes manually created entries (always `status: active` on insert) from auto-discovered ones (inserted as `status: suggested`, requiring admin confirmation before synthesis runs).

**`status` on topics and subtopics** (`suggested | active | rejected`). Only meaningful for discovered entries — manual entries skip straight to `active`. Synthesis only runs on `active` subtopics.

**`synthesisStatus` on subtopics** (`idle | running | done | failed`). Tracks async synthesis job state independently of values. Prevents double-triggering and distinguishes "never synthesized" from "synthesis failed" (both have no values otherwise).

**`approval` on values** (`pending | approved | rejected`). Values are always LLM-generated and always require human review. A subtopic can have multiple approved values over time — re-synthesis creates new values alongside existing ones. Rejected values are kept as history.

### Discovery Flow

When documents are uploaded, a discovery tool proposes topics and subtopics:
1. LLM scans document chunks → suggests topics and subtopics
2. All suggestions are immediately persisted with `source: discovered, status: suggested`
3. Admin reviews suggestions (page-reload safe — nothing is ephemeral)
4. Admin confirms or rejects each suggestion
5. Confirmed subtopics become `status: active` and are eligible for synthesis

### Synthesis Status vs Value Approval

These are two separate concerns:

| Field | Lives on | Tracks |
|---|---|---|
| `synthesisStatus` | Subtopic | Async LLM job state |
| `approval` | Value | Human review of generated content |

## Message Flagging Feature

Learners can flag any chat message (in ML or assistant chat) as potentially inaccurate. Admins review and resolve flags from the admin dashboard at `/flagged`.

- **Data model & API**: See [Backend DEVELOPMENT.md](apps/backend/DEVELOPMENT.md#message-flagging)
- **Frontend UX**: See [Web DEVELOPMENT.md](apps/web/DEVELOPMENT.md#message-flagging)
