import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, isNull } from 'drizzle-orm';
import { organizations, avatars } from '../db/schema.js';
import { BUILT_IN_AVATARS } from '../config/built-in-avatars.js';

// One-off backfill: set default_avatar_id on any organization that lacks one,
// using the first built-in avatar (BUILT_IN_AVATARS[0]) as the fallback.
//
// Run this BEFORE `db:push` applies the NOT NULL constraint — against the live
// DB the column is still nullable, so the `isNull` filter matches legacy rows.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

async function backfill() {
  const client = postgres(DATABASE_URL!);
  const db = drizzle(client);

  const fallbackName = BUILT_IN_AVATARS[0].name;
  const [fallback] = await db
    .select({ id: avatars.id })
    .from(avatars)
    .where(and(eq(avatars.name, fallbackName), isNull(avatars.organizationId)))
    .limit(1);

  if (!fallback) {
    console.error(
      `Fallback built-in avatar "${fallbackName}" not found. Run db:seed:defaults first.`,
    );
    await client.end();
    process.exit(1);
  }

  const updated = await db
    .update(organizations)
    .set({ defaultAvatarId: fallback.id })
    .where(isNull(organizations.defaultAvatarId))
    .returning({ id: organizations.id, subdomain: organizations.subdomain });

  console.log(`Backfilled ${updated.length} organization(s) with default avatar "${fallbackName}" (${fallback.id}).`);
  for (const o of updated) console.log(`  - ${o.subdomain} (${o.id})`);

  await client.end();
}

backfill();
