import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, isNull } from 'drizzle-orm';
import { organizations, users, authTokens, avatars } from '../db/schema.js';
import { hashPassword } from '../utils/crypto.js';
import { seedDefaults, seedBuiltInAvatars } from './seed.defaults.js';
import { BUILT_IN_AVATARS } from '../config/built-in-avatars.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

// Static dev token for easy testing - use POST /auth/login { token: "dev-learner-token" }
const DEV_LEARNER_TOKEN = 'dev-learner-token';

async function seed() {
  console.log('Seeding development data...');

  // Built-in avatars must exist before creating the org (default_avatar_id is required).
  await seedBuiltInAvatars(db);

  const fallbackName = BUILT_IN_AVATARS[0].name;
  const [fallbackAvatar] = await db
    .select({ id: avatars.id })
    .from(avatars)
    .where(and(eq(avatars.name, fallbackName), isNull(avatars.organizationId)))
    .limit(1);
  if (!fallbackAvatar) throw new Error(`Built-in avatar "${fallbackName}" not seeded.`);

  // Create organization or get existing
  const [existingOrg] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.subdomain, 'demo'))
    .limit(1);

  const org = existingOrg ?? (await db
    .insert(organizations)
    .values({ name: 'Karibu Demo', subdomain: 'demo', defaultAvatarId: fallbackAvatar.id })
    .returning()
    .then(([r]) => r));

  console.log(`Organization: ${org.name} (subdomain: ${org.subdomain})`);

  // Upsert admin user
  const adminPassword = await hashPassword('admin123');
  const [admin] = await db
    .insert(users)
    .values({
      email: 'admin@demo.com',
      password: adminPassword,
      role: 'admin',
      organizationId: org.id,
    })
    .onConflictDoUpdate({
      target: [users.email, users.organizationId],
      set: { password: adminPassword },
    })
    .returning();

  console.log(`Admin user: ${admin.email} (password: admin123)`);

  // Upsert learner user
  const learnerPassword = await hashPassword('learner123');
  const [learner] = await db
    .insert(users)
    .values({
      email: 'learner@demo.com',
      password: learnerPassword,
      role: 'user',
      organizationId: org.id,
    })
    .onConflictDoUpdate({
      target: [users.email, users.organizationId],
      set: { password: learnerPassword },
    })
    .returning();

  console.log(`Learner user: ${learner.email} (password: learner123)`);

  // Upsert dev login token for learner
  await db
    .insert(authTokens)
    .values({
      userId: learner.id,
      token: DEV_LEARNER_TOKEN,
      expiresAt: new Date('2099-01-01'),
    })
    .onConflictDoNothing();

  // Seed global defaults (built-in patterns, etc.)
  await seedDefaults(db);

  console.log('\nSeed complete!');
  console.log('  Organization subdomain: demo');
  console.log('  Admin:   admin@demo.com   / admin123');
  console.log('  Learner: learner@demo.com / learner123');
  console.log(`  Learner token: "${DEV_LEARNER_TOKEN}"`);

  await client.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
