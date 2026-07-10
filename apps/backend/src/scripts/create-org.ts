import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, isNull } from 'drizzle-orm';
import { organizations, users, avatars } from '../db/schema.js';
import { BUILT_IN_AVATARS } from '../config/built-in-avatars.js';
import { hashPassword } from '../utils/crypto.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

// Parse CLI arguments: --name "Org Name" --subdomain acme --admin-email admin@acme.com --admin-password secret123
function parseArgs(): { name: string; subdomain: string; adminEmail: string; adminPassword: string } {

  const args = process.argv.slice(2).filter((a) => a !== '--');
  const map = new Map<string, string>();

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    if (key && value) map.set(key, value);
  }

  const name = map.get('name');
  const subdomain = map.get('subdomain');
  const adminEmail = map.get('admin-email');
  const adminPassword = map.get('admin-password');

  if (!name || !subdomain || !adminEmail || !adminPassword) {
    console.error('Usage: tsx src/scripts/create-org.ts --name "Org Name" --subdomain acme --admin-email admin@acme.com --admin-password secret123');
    process.exit(1);
  }

  return { name, subdomain, adminEmail, adminPassword };
}

async function createOrg() {

  const { name, subdomain, adminEmail, adminPassword } = parseArgs();

  const client = postgres(DATABASE_URL!);
  const db = drizzle(client);

  // Resolve the fallback built-in avatar (default_avatar_id is required).
  const fallbackName = BUILT_IN_AVATARS[0].name;
  const [fallbackAvatar] = await db
    .select({ id: avatars.id })
    .from(avatars)
    .where(and(eq(avatars.name, fallbackName), isNull(avatars.organizationId)))
    .limit(1);

  if (!fallbackAvatar) {
    console.error(`Built-in avatar "${fallbackName}" not found. Run "pnpm db:seed:defaults" first.`);
    await client.end();
    process.exit(1);
  }

  // Create organization
  const [org] = await db
    .insert(organizations)
    .values({ name, subdomain, defaultAvatarId: fallbackAvatar.id })
    .returning();

  console.log(`Organization created: ${org.name} (subdomain: ${org.subdomain}, id: ${org.id})`);

  // Create admin user
  const hashed = await hashPassword(adminPassword);
  const [admin] = await db
    .insert(users)
    .values({
      email: adminEmail,
      password: hashed,
      role: 'admin',
      organizationId: org.id,
    })
    .returning();

  console.log(`Admin user created: ${admin.email}`);

  console.log('\nDone!');
  await client.end();
}

createOrg().catch((err) => {
  console.error('Failed to create organization:', err);
  process.exit(1);
});
