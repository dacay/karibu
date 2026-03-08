# Development Guide

This file provides guidance for developers and AI assistants working with this codebase.

## Project Overview

Karibu Backend is a TypeScript API server built with **Hono** (lightweight web framework), **Drizzle ORM** (PostgreSQL), and **Pino** (structured logging). The server is designed to run on both traditional Node.js environments (EC2) and serverless platforms (Vercel).

## Development Commands

### Basic Commands
- `pnpm dev` - Start development server with hot reload (uses tsx watch)
- `pnpm build` - Compile TypeScript to JavaScript (output: `dist/`)
- `pnpm start` - Run production build from `dist/`

### Database Commands
- `pnpm db:generate` - Generate SQL migrations from Drizzle schema
- `pnpm db:migrate` - Apply migrations to database
- `pnpm db:push` - Push schema changes directly without migrations (development only)
- `pnpm db:studio` - Open Drizzle Studio GUI for database exploration

> **During development, always use `pnpm db:push`. Do not generate migrations until the initial production release.**

### Type Checking
- `pnpm tsc --noEmit` - Run TypeScript type checking without building

## Architecture

### Configuration System
All configuration is validated at startup using Zod schemas in `src/config/env.ts`:
- Environment variables are loaded via `dotenv/config` import
- Validation fails fast with detailed error messages if config is invalid
- Type-safe config exported as `env` object
- CORS_ORIGIN supports comma-separated list of origins (parsed into array)

### Database Layer (Drizzle ORM)
- **Connection**: Uses `postgres` library (not `pg`) with connection pooling
- **Schema**: Define tables in `src/db/schema.ts` using Drizzle's table definitions
- **Workflow**: Edit schema → `pnpm db:generate` → `pnpm db:migrate` (or `db:push` for dev)
- **Migrations**: Generated SQL files stored in `src/db/migrations/`
- **Export pattern**: Both `db` (Drizzle client) and `sql` (raw Postgres connection) are exported from `src/db/index.ts`

### Logging (Pino)
- **Development**: Pretty-printed with colors (via `pino-pretty` transport)
- **Production**: Raw JSON output for log aggregation
- **HTTP logging**: Automatic via `hono-pino` middleware (logs all requests/responses)
- **Convention**:
  - Ongoing processes end with `...` (e.g., "Server is running...")
  - Completed actions end with `.` (e.g., "Database connection failed.")
- **Usage**: Import `logger` from `src/config/logger.ts`

### Middleware Stack
Middleware applied in order (see `src/index.ts`):
1. `pinoLogger` - HTTP request/response logging
2. `corsMiddleware` - CORS with configurable origins from env
3. Application routes

### Routing Pattern
Routes are modular and registered via `registerRoutes()` in `src/routes/index.ts`:
- Each route module exports a Hono instance
- Routes are mounted using `app.route()` in the registration function
- Example: `health.ts` exports a Hono app with `/status` endpoint

### Module System
- **Type**: ES Modules (`"type": "module"` in package.json)
- **Import style**: Always use `.js` extension in imports (e.g., `from './config/env.js'`)
- **TypeScript config**: Uses `NodeNext` module resolution

## Database Schema Development

To add new tables:
1. Edit `src/db/schema.ts` with Drizzle table definitions
2. Run `pnpm db:generate` to create migration SQL
3. Run `pnpm db:migrate` to apply to database
4. For rapid iteration: Use `pnpm db:push` to skip migration files

Example schema pattern:
```typescript
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

## Deployment Targets

This backend supports multiple deployment environments:
- **EC2/Traditional Node.js**: Full feature support, async logging
- **Vercel Serverless**: Pino runs in sync mode, JSON logs captured automatically
- **Supabase Postgres**: Use connection string format: `postgresql://postgres:[PASSWORD]@[PROJECT_REF].supabase.co:5432/postgres`

## Environment Variables

Required variables (see `.env.example`):
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production/test)
- `LOG_LEVEL` - Pino log level (fatal/error/warn/info/debug/trace)
- `DATABASE_URL` - PostgreSQL connection string
- `CORS_ORIGIN` - Comma-separated list of allowed origins

## Code Style Conventions

See [CONVENTIONS.md](../../CONVENTIONS.md) for the general style guide.

@../../CONVENTIONS.md

### Backend-Specific Conventions

- **TypeScript**: Strict mode enabled, all imports must use `.js` extensions
- **Error handling**: Use Pino's structured logging with error context: `logger.error({ error }, 'message')`

## S3 Storage

The backend uses two separate S3 buckets:

- **Documents bucket** (`S3_DOCS_BUCKET_NAME`) — private, accessed via presigned URLs or direct download
- **Assets bucket** (`S3_ASSETS_BUCKET_NAME`) — CDN-fronted, public read via CloudFront (avatars, org logos)

Each bucket has its own key prefix env var (`S3_DOCS_KEY_PREFIX`, `S3_ASSETS_KEY_PREFIX`) for environment separation (e.g. `prod`, `staging`). Both default to empty.

### Key Structure

**Documents**: `{S3_DOCS_KEY_PREFIX}/{organizationId}/{documentId}.{ext}`
- Uses **organizationId (UUID)** as the folder prefix. Subdomains are mutable — if an org changes their subdomain, stored S3 keys would break. UUIDs are immutable.

**Avatars**: `{S3_ASSETS_KEY_PREFIX}/{subdomain}/avatars/{avatarId}.{ext}`
- Uses **subdomain** as the folder prefix. This matches the CDN URL structure, so CloudFront serves everything under the org's subdomain path.

**Org logos**: `{S3_ASSETS_KEY_PREFIX}/{subdomain}/logo-{light|dark}.png`
- Same subdomain-scoped pattern. Uploaded by admins via the Organization config page.
- Uploaded with `Cache-Control: no-cache` so CloudFront revalidates on every request (logos change infrequently but must propagate immediately).

### AWS IAM — Minimal Policy
The backend IAM user needs access to both buckets:
```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::karibu-docs/*",
        "arn:aws:s3:::karibu-assets/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "arn:aws:kms:REGION:ACCOUNT_ID:key/KEY_ID"
    }
  ]
}
```
Note: KMS permissions must reference the KMS key ARN, not the S3 bucket ARN.

### ChromaDB Pipeline
The ChromaDB service (`src/services/chromadb.ts`) is fully built with `addDocumentChunks`, `deleteDocumentChunks`, and `queryDocuments`, but is **not yet wired into the document upload route**. Documents are uploaded to S3 and recorded in the DB with status `uploaded` — parsing, chunking, and embedding into ChromaDB still need to be connected.

## Message Flagging

### Data Model

`flagged_messages` table (`src/db/schema.ts`):
- `message_id` — FK to `chat_messages` (cascade delete)
- `chat_id` — FK to `chats` (cascade delete)
- `flagged_by` — FK to `users` (cascade delete)
- `organization_id` — FK to `organizations` (cascade delete)
- `reason` — optional free-text from the learner
- `status` — `open | reviewed | dismissed` (enum: `flagged_message_status`)

### API Routes (`src/routes/flags.ts`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/flags` | any user | Flag a message; validates message belongs to caller's org |
| `GET` | `/flags/count` | admin | Returns `{ count }` of open flags for the org |
| `GET` | `/flags` | admin | Full list with message text, chat type, ML title, flagging user |
| `PATCH` | `/flags/:id/status` | admin | Update status to `reviewed` or `dismissed` |

## AI Assistant Notes

This project includes semantic code search embeddings (qmd) for AI-powered codebase exploration.

**For AI assistants - Search Strategy:**
1. **Prefer qmd tools first** for finding code patterns, similar functionality, or understanding architecture:
   - Use semantic search for concepts ("how is authentication handled?")
   - Use keyword search for specific identifiers
   - Use hybrid query for complex questions

2. **Fall back to Glob/Grep** only if qmd doesn't return sufficient results or for very specific file patterns
