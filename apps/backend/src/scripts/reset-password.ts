import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import { organizations, users } from '../db/schema.js';
import { hashPassword } from '../utils/crypto.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

function parseArgs(): { subdomain: string; email: string; password: string } {

  const args = process.argv.slice(2).filter((a) => a !== '--');
  const map = new Map<string, string>();

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    if (key && value) map.set(key, value);
  }

  const subdomain = map.get('subdomain');
  const email = map.get('email');
  const password = map.get('password');

  if (!subdomain || !email || !password) {
    console.error('Usage: tsx src/scripts/reset-password.ts --subdomain acme --email admin@acme.com --password newSecret123');
    process.exit(1);
  }

  return { subdomain, email, password };
}

async function resetPassword() {

  const { subdomain, email, password } = parseArgs();

  const client = postgres(DATABASE_URL!);
  const db = drizzle(client);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.subdomain, subdomain))
    .limit(1);

  if (!org) {
    console.error(`Organization with subdomain "${subdomain}" not found.`);
    await client.end();
    process.exit(1);
  }

  const hashed = await hashPassword(password);
  const [updated] = await db
    .update(users)
    .set({ password: hashed })
    .where(and(eq(users.email, email), eq(users.organizationId, org.id)))
    .returning();

  if (!updated) {
    console.error(`User "${email}" not found in organization "${subdomain}".`);
    await client.end();
    process.exit(1);
  }

  console.log(`Password reset for ${updated.email} (org: ${org.name})`);

  await client.end();
}

resetPassword().catch((err) => {
  console.error('Failed to reset password:', err);
  process.exit(1);
});
