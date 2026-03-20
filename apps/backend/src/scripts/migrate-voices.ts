import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { avatars } from '../db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {

  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

// ElevenLabs voice ID → Deepgram Aura-2 voice ID
const VOICE_MAP: Record<string, string> = {
  '56AoDkrOh6qfVPDXZ7Pt': 'aura-2-asteria-en',  // Cassidy → Asteria
  'AZnzlk1XvdvUeBnXmlld': 'aura-2-luna-en',      // Domi → Luna
  'EXAVITQu4vr4xnSDxMaL': 'aura-2-hera-en',      // Bella → Hera
  'MF3mGyEYCl7XYWbV9V6O': 'aura-2-athena-en',    // Elli → Athena
  'LcfcDJNUP1GQjkzn1xUU': 'aura-2-aurora-en',    // Emily → Aurora
  'pNInz6obpgDQGcFmaJgB': 'aura-2-orion-en',     // Adam → Orion
  'ErXwobaYiN019PkySvjV': 'aura-2-arcas-en',     // Antoni → Arcas
  'VR6AewLTigWG4xSOukaG': 'aura-2-zeus-en',      // Arnold → Zeus
  'TxGEqnHWrfWFTfGW9XjX': 'aura-2-orpheus-en',  // Josh → Orpheus
  'yoZ06aMxZJJ28mfd3POQ': 'aura-2-apollo-en',    // Sam → Apollo
};

const all = await db.select({ id: avatars.id, name: avatars.name, voiceId: avatars.voiceId }).from(avatars);

let updated = 0;
for (const avatar of all) {
  const newVoiceId = VOICE_MAP[avatar.voiceId];
  if (newVoiceId) {

    await db.update(avatars).set({ voiceId: newVoiceId }).where(eq(avatars.id, avatar.id));
    console.log(`  ${avatar.name}: ${avatar.voiceId} → ${newVoiceId}`);
    updated++;
  }
}

console.log(`\nMigrated ${updated} of ${all.length} avatars.`);
await client.end();
