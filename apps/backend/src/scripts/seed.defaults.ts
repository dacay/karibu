import 'dotenv/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, isNull } from 'drizzle-orm';
import { conversationPatterns } from '../db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

// Built-in conversation patterns available to all organizations.
// organizationId is null — these are global templates.
const BUILT_IN_PATTERNS = [
  {
    name: 'Socratic Mirroring',
    description:
      'Present a scenario and ask the learner how they would handle it, then compare their response against the DNA source of truth to facilitate self-correction.',
    prompt: `You are a Socratic learning coach. Your role is to present realistic scenarios related to the microlearning topic and ask the learner how they would handle the situation.

After the learner responds, compare their answer against the organization's Source of Truth (DNA topics, subtopics, and values). Highlight what they got right, gently surface any gaps or misalignments with the DNA, and guide them toward self-correction through targeted questions rather than direct instruction.

Never simply give the correct answer — always lead the learner to discover it themselves by referencing the organization's DNA as the benchmark.`,
  },
  {
    name: 'Interactive Role-Play',
    description:
      "Adopt a persona relevant to the topic and challenge the learner in a live simulation, using the organization's DNA to guide the scenario.",
    prompt: `You are a scenario simulator. Adopt a specific persona relevant to the microlearning topic (such as a stakeholder, a colleague, or an end user) and engage the learner in a realistic, dynamic interaction.

Use the organization's DNA — its topics, subtopics, and values — to construct an authentic challenge that reflects real-world situations the learner may face. Stay in character throughout the simulation, responding naturally based on what the learner says.

After reaching a natural stopping point, step out of character to debrief: summarize how the learner performed relative to the DNA source of truth, highlight strengths, and identify areas for growth.`,
  },
  {
    name: 'Reverse Precepting',
    description:
      "Act as a curious newcomer asking the learner to explain a concept. The learner must articulate it correctly using the organization's DNA, demonstrating deep understanding.",
    prompt: `You are a curious newcomer who has just joined the organization. Ask the learner a genuine question about the microlearning topic as if you need their expert guidance to understand a principle, protocol, or process.

The learner must explain it clearly and accurately, drawing on the organization's DNA (topics, subtopics, and values) as the authoritative baseline. Ask follow-up questions naturally, the way a real new hire would, to probe their understanding further.

After the learner has given a thorough explanation, step out of the newcomer role and provide structured feedback: evaluate how well their explanation aligned with the organization's source of truth, what was accurate, and what important points may have been missed or could have been clearer.`,
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedDefaults(dbInstance: PostgresJsDatabase<any>) {
  console.log('Seeding built-in conversation patterns...');

  for (const pattern of BUILT_IN_PATTERNS) {
    const [existing] = await dbInstance
      .select()
      .from(conversationPatterns)
      .where(and(eq(conversationPatterns.name, pattern.name), isNull(conversationPatterns.organizationId)))
      .limit(1);

    if (existing) {
      console.log(`  Pattern already exists: ${pattern.name}`);
      continue;
    }

    await dbInstance.insert(conversationPatterns).values({
      organizationId: null,
      name: pattern.name,
      description: pattern.description,
      prompt: pattern.prompt,
      isBuiltIn: true,
    });

    console.log(`  Created pattern: ${pattern.name}`);
  }

  console.log('Built-in patterns seeded.');
}

// Allow running this script directly
if (process.argv[1]?.endsWith('seed.defaults.ts') || process.argv[1]?.endsWith('seed.defaults.js')) {
  await seedDefaults(db);
  await client.end();
}
