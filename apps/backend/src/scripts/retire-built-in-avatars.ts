import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, isNull } from 'drizzle-orm';
import { organizations, users, avatars } from '../db/schema.js';

// One-off cleanup after the built-in avatar roster was replaced.
//
// The seed matches built-in avatars by name, so renaming them inserts a fresh
// set and leaves the previous rows behind — still referenced by
// organizations.default_avatar_id and users.preferred_avatar_id (both plain
// uuids, no FK, so nothing errors; the references simply go stale).
//
// This script repoints those references onto the replacement avatar, then
// deletes the retired rows. Run it AFTER `pnpm db:seed:defaults`.
//
//   pnpm retire-built-in-avatars --dry-run   # report only
//   pnpm retire-built-in-avatars

// Retired avatar name -> replacement avatar name.
const REPLACEMENTS: Record<string, string> = {
  Amara: 'Sofia',
  Mei: 'Maria',
  Nora: 'Ana',
  Julian: 'Daniel',
  Diego: 'Alex',
};

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

async function retire() {
  const client = postgres(DATABASE_URL!);
  const db = drizzle(client);

  async function findBuiltIn(name: string) {
    const [row] = await db
      .select({ id: avatars.id })
      .from(avatars)
      .where(and(eq(avatars.name, name), isNull(avatars.organizationId)))
      .limit(1);
    return row;
  }

  if (dryRun) console.log('Dry run — no changes will be written.\n');

  for (const [oldName, newName] of Object.entries(REPLACEMENTS)) {
    const retired = await findBuiltIn(oldName);
    if (!retired) {
      console.log(`  ${oldName}: already gone, skipping.`);
      continue;
    }

    const replacement = await findBuiltIn(newName);
    if (!replacement) {
      console.error(
        `  ${oldName}: replacement "${newName}" not found. Run "pnpm db:seed:defaults" first.`,
      );
      await client.end();
      process.exit(1);
    }

    const orgRows = await db
      .select({ id: organizations.id, subdomain: organizations.subdomain })
      .from(organizations)
      .where(eq(organizations.defaultAvatarId, retired.id));

    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.preferredAvatarId, retired.id));

    console.log(
      `  ${oldName} -> ${newName}: ${orgRows.length} org default(s), ${userRows.length} learner preference(s).`,
    );
    for (const o of orgRows) console.log(`      org  ${o.subdomain} (${o.id})`);
    for (const u of userRows) console.log(`      user ${u.email} (${u.id})`);

    if (dryRun) continue;

    await db
      .update(organizations)
      .set({ defaultAvatarId: replacement.id })
      .where(eq(organizations.defaultAvatarId, retired.id));

    await db
      .update(users)
      .set({ preferredAvatarId: replacement.id })
      .where(eq(users.preferredAvatarId, retired.id));

    await db.delete(avatars).where(eq(avatars.id, retired.id));
    console.log(`      deleted retired avatar ${retired.id}`);
  }

  console.log(dryRun ? '\nDry run complete.' : '\nRetired built-in avatars cleaned up.');
  await client.end();
}

retire();
