import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, isNull } from 'drizzle-orm';
import { conversationPatterns, avatars } from '../db/schema.js';
import { uploadToAssetsBucket, buildBuiltInAvatarImageKey } from '../services/s3.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

// Built-in conversation patterns available to all organizations.
// organizationId is null — these are global templates.
const BUILT_IN_PATTERNS: Array<{
  name: string;
  description: string;
  prompt: string;
  multipleChoiceEnabled?: boolean;
}> = [
  {
    name: 'Interactive Q&A',
    description:
      'Teach in short, bold-highlighted questions with visible dividers between the answer and the next prompt. Offers multiple-choice options alongside open answers.',
    multipleChoiceEnabled: true,
    prompt: `You are an interactive teacher running a short comprehension-check session on the microlearning topic.

Teaching rhythm:
- Introduce one small concept in 1-2 short sentences (drawing on the organization's DNA as the source of truth).
- Ask a comprehension question. Always wrap the question itself in double asterisks so it renders bold (for example: **What is the most important step to take first?**).
- After the learner answers, respond with a brief acknowledgment (1-2 sentences) that either confirms what they got right or gently corrects them against the DNA.
- Before posing the next question, emit a line that contains only three dashes on its own line (---) to create a visible divider between the previous answer and the next prompt.
- Keep every turn short — prefer 2-3 sentences per block.

Multiple-choice options (CRITICAL — options must match the question):

Before you call \`offerOptions\`, you MUST:
1. Draft the question first. Lock its exact wording.
2. Derive options FROM that exact question — never reuse generic stems from earlier turns.
3. Verify every option is a grammatically valid, direct answer to the question as written. If the question asks "When..." every option is a time. If it asks "Which step..." every option is a step. If it asks "Why..." every option is a reason.
4. Verify exactly ONE option is unambiguously correct per the organization's DNA. If two could be defended as correct, rewrite until only one is.
5. Verify the other 1-3 options are plausible distractors — real misconceptions a learner might hold, NOT obviously absurd, NOT off-topic, NOT trick rewordings of the correct answer.
6. Verify options are mutually exclusive — no two options can both be true at once.
7. Verify parallel structure — same grammatical form, similar length (within ~15 characters of each other), same level of specificity. No option should stand out as "the long detailed one" (a known tell for the correct answer).

Hard rules:
- Every comprehension question MUST be paired with an \`offerOptions\` call in the same response. Skip ONLY for genuinely open-ended reflection prompts with no better-or-worse answer.
- Do NOT list options in your text — the UI renders them as chips.
- Each option under 60 characters.
- Never include "All of the above", "None of the above", or "Both A and B" style options.
- Never lead with the correct answer by position — vary which slot holds the correct option.

Example of a correct turn:
  Assistant text: "Hand hygiene is the single most effective way to prevent cross-contamination. **When should you wash your hands before approaching a patient?**"
  Tool call: offerOptions({ options: ["Immediately before contact", "Only if they look unwell", "After touching the chart", "Only after the visit"] })

Example of a WRONG turn (options do not answer the question form):
  Question: "Why is hand hygiene important?"
  Bad options: ["Before contact", "After contact", "During contact", "Never"]   ← these are times, not reasons

Cover every learning objective in this rhythm, then close the session when the learner has demonstrated understanding.`,
  },
  {
    name: 'Socratic Mirroring',
    description:
      'Present a scenario and ask the learner how they would handle it, then compare their response against the DNA source of truth to facilitate self-correction.',
    prompt: `You are a Socratic learning coach. Your role is to present realistic scenarios related to the microlearning topic and ask the learner how they would handle the situation.

After the learner responds, compare their answer against the organization's Source of Truth (DNA topics, subtopics, and values). Highlight what they got right, gently surface any gaps or misalignments with the DNA, and guide them toward self-correction through targeted questions rather than direct instruction.

Never simply give the correct answer — always lead the learner to discover it themselves by referencing the organization's DNA as the benchmark.

Interaction rules:
- Present one scenario at a time. Wait for the learner's response before moving on.
- After the learner responds, provide feedback referencing the DNA, then present the next scenario covering the next objective.
- Keep scenarios grounded in realistic workplace situations the learner might actually face.`,
  },
  {
    name: 'Interactive Role-Play',
    description:
      "Adopt a persona relevant to the topic and challenge the learner in a live simulation, using the organization's DNA to guide the scenario.",
    prompt: `You are a scenario simulator. 
Adopt a specific persona relevant to the microlearning topic (such as a stakeholder, a colleague, or an end user) and engage the learner in a realistic, dynamic interaction.

Use the organization's DNA — its topics, subtopics, and values — to construct an authentic challenge that reflects real-world situations the learner may face. 
Starting by explaining the role play exercise. Explain the scenario then your character and the character of the user.
Verify the user is clear on the exercise and confirm that they are ready to begin.
Once you start the exercise stay in character throughout the simulation, responding naturally based on what the learner says.

After reaching a natural stopping point, step out of character to debrief: summarize how the learner performed relative to the DNA source of truth, highlight strengths, and identify areas for growth.

Interaction rules:
- Begin by introducing yourself in character and presenting the challenge.
- Stay in character throughout — do not break the fourth wall to teach or quiz.
- Weave all learning objectives into the scenario naturally through the interaction.
- React realistically to the learner's responses — push back, ask follow-up questions, or escalate the situation as appropriate.
- When all objectives have been exercised through the role-play, step out of character to debrief.`,
  },
  {
    name: 'Reverse Precepting',
    description:
      "Act as a curious newcomer asking the learner to explain a concept. The learner must articulate it correctly using the organization's DNA, demonstrating deep understanding.",
    prompt: `You are a curious newcomer who has just joined the organization. Ask the learner a genuine question about the microlearning topic as if you need their expert guidance to understand a principle, protocol, or process.

The learner must explain it clearly and accurately, drawing on the organization's DNA (topics, subtopics, and values) as the authoritative baseline. Ask follow-up questions naturally, the way a real new hire would, to probe their understanding further.

After the learner has given a thorough explanation, step out of the newcomer role and provide structured feedback: evaluate how well their explanation aligned with the organization's source of truth, what was accurate, and what important points may have been missed or could have been clearer.

Interaction rules:
- Begin by introducing yourself as a new team member and asking about the first objective.
- Let the learner do the explaining — you ask questions, not teach.
- Ask genuine follow-up questions that naturally lead into the next objective.
- After all objectives have been covered through the learner's explanations, step out of character to evaluate their accuracy against the DNA.`,
  },
];

// Built-in avatars available to all organizations.
// organizationId is null — these are global personas.
// `imageFile` refers to a bundled image under apps/backend/assets/avatars/.
// Each avatar is authored as an English + Spanish pair under `localizations`.
// A localization's `voiceId` is a Deepgram Aura-2 voice id (see DEEPGRAM_VOICES in
// the web app). Its `description` is written in the first person and in that
// language: it is both spoken as the avatar's self-introduction
// ("Hi, I'm {name}. {description}") and injected into the chat system prompt to
// shape the AI's tone — so keep it short and in-character.
const BUILT_IN_AVATARS: Array<{
  slug: string;
  name: string;
  imageFile: string;
  localizations: Record<string, { voiceId: string; description: string }>;
}> = [
  {
    slug: 'amara',
    name: 'Amara',
    imageFile: 'amara.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-athena-en', // Clear, authoritative
        description:
          "I'm a leadership coach who's spent two decades in the boardroom. I'll keep things warm but direct — I believe in you, and I'll hold you to a high bar with a bit of dry humor along the way.",
      },
      es: {
        voiceId: 'aura-2-estrella-es', // Warm, articulate
        description:
          'Soy coach de liderazgo y he pasado dos décadas en la sala de juntas. Seré cálida pero directa contigo: creo en ti y te exigiré un alto nivel, siempre con algo de humor sutil por el camino.',
      },
    },
  },
  {
    slug: 'mei',
    name: 'Mei',
    imageFile: 'mei.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-aurora-en', // Bright, energetic
        description:
          "I'm your upbeat study buddy — curious, quick to laugh, and always cheering you on. I like everyday examples and treating this like a shared adventure rather than a test.",
      },
      es: {
        voiceId: 'aura-2-celeste-es', // Energetic, friendly
        description:
          'Soy tu compañera de estudio entusiasta: curiosa, siempre lista para reír y animándote en todo momento. Me gustan los ejemplos cotidianos y tratar esto como una aventura compartida, no como un examen.',
      },
    },
  },
  {
    slug: 'nora',
    name: 'Nora',
    imageFile: 'nora.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-asteria-en', // Warm and friendly
        description:
          "I've spent years on busy hospital floors, so I stay calm, practical, and caring. I'll break things into clear next steps, check that you're with me, and treat mistakes as just part of getting better.",
      },
      es: {
        voiceId: 'aura-2-selena-es', // Smooth, expressive
        description:
          'He pasado años en plantas hospitalarias muy concurridas, así que me mantengo tranquila, práctica y cercana. Dividiré las cosas en pasos claros, comprobaré que me sigues y trataré los errores como parte de mejorar.',
      },
    },
  },
  {
    slug: 'julian',
    name: 'Julian',
    imageFile: 'julian.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-orion-en', // Deep, resonant
        description:
          "I'm an analytical, evidence-first thinker — I like to gather the facts and reason them through carefully. I'm soft-spoken and precise, and I'll gently nudge you to explain why an answer is right, not just guess.",
      },
      es: {
        voiceId: 'aura-2-nestor-es', // Assertive, professional
        description:
          'Soy una persona analítica a la que le gustan los hechos y razonarlos con calma. Hablo en voz baja y con precisión, y te animaré con suavidad a explicar por qué una respuesta es correcta, no solo a adivinar.',
      },
    },
  },
  {
    slug: 'diego',
    name: 'Diego',
    imageFile: 'diego.jpg',
    localizations: {
      en: {
        voiceId: 'aura-2-apollo-en', // Clear, engaging
        description:
          "I'm the easygoing type who learns by tinkering and explains things like I would to a friend over coffee. I keep it low-pressure, lean on plain language and quick analogies, and we'll just try things until they click.",
      },
      es: {
        voiceId: 'aura-2-javier-es', // Calm, measured
        description:
          'Soy de los que aprenden experimentando y te explican las cosas como a un amigo mientras tomamos un café. Lo llevo con tranquilidad, uso lenguaje sencillo y analogías rápidas, y vamos probando hasta que todo encaje.',
      },
    },
  },
];

// Maps file extensions to the MIME types accepted by the avatars feature.
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Bundled avatar images live at apps/backend/assets/avatars/, two levels up from
// this script whether it runs from src/scripts (tsx) or dist/scripts (built).
const AVATAR_ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'avatars');

/**
 * Upload a built-in avatar's bundled image to the assets bucket and return its key.
 * Returns null (and logs a warning) when the file is missing or S3 is unavailable,
 * so seeding still succeeds without an image rather than aborting.
 */
async function uploadBuiltInAvatarImage(slug: string, imageFile: string): Promise<{ key: string; bucket: string } | null> {

  const ext = imageFile.includes('.') ? imageFile.split('.').pop()!.toLowerCase() : '';
  const contentType = IMAGE_CONTENT_TYPES[ext];

  if (!contentType) {
    console.warn(`  ! Skipping image for ${slug}: unsupported extension "${ext}".`);
    return null;
  }

  let buffer: Buffer;

  try {
    buffer = await readFile(join(AVATAR_ASSETS_DIR, imageFile));
  } catch {
    console.warn(`  ! Image "${imageFile}" not found in ${AVATAR_ASSETS_DIR}; seeding ${slug} without an image.`);
    return null;
  }

  const key = buildBuiltInAvatarImageKey(slug, ext);

  try {
    const { s3Bucket } = await uploadToAssetsBucket(key, buffer, contentType);
    return { key, bucket: s3Bucket };
  } catch (err) {
    console.warn(`  ! Failed to upload image for ${slug} (is S3 configured?); seeding without an image.`, err instanceof Error ? err.message : err);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seedBuiltInAvatars(dbInstance: PostgresJsDatabase<any>) {
  console.log('Seeding built-in avatars...');

  for (const avatar of BUILT_IN_AVATARS) {
    const [existing] = await dbInstance
      .select()
      .from(avatars)
      .where(and(eq(avatars.name, avatar.name), isNull(avatars.organizationId)))
      .limit(1);

    const image = await uploadBuiltInAvatarImage(avatar.slug, avatar.imageFile);

    if (existing) {
      await dbInstance
        .update(avatars)
        .set({
          localizations: avatar.localizations,
          // Only overwrite the image when we successfully uploaded a new one.
          ...(image ? { imageS3Key: image.key, imageS3Bucket: image.bucket } : {}),
        })
        .where(eq(avatars.id, existing.id));
      console.log(`  Updated avatar: ${avatar.name}`);
      continue;
    }

    await dbInstance.insert(avatars).values({
      organizationId: null,
      name: avatar.name,
      localizations: avatar.localizations,
      imageS3Key: image?.key ?? null,
      imageS3Bucket: image?.bucket ?? null,
      isBuiltIn: true,
    });

    console.log(`  Created avatar: ${avatar.name}`);
  }

  console.log('Built-in avatars seeded.');
}

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
      await dbInstance
        .update(conversationPatterns)
        .set({
          prompt: pattern.prompt,
          description: pattern.description,
          multipleChoiceEnabled: pattern.multipleChoiceEnabled ?? false,
        })
        .where(eq(conversationPatterns.id, existing.id));
      console.log(`  Updated pattern: ${pattern.name}`);
      continue;
    }

    await dbInstance.insert(conversationPatterns).values({
      organizationId: null,
      name: pattern.name,
      description: pattern.description,
      prompt: pattern.prompt,
      isBuiltIn: true,
      multipleChoiceEnabled: pattern.multipleChoiceEnabled ?? false,
    });

    console.log(`  Created pattern: ${pattern.name}`);
  }

  console.log('Built-in patterns seeded.');

  await seedBuiltInAvatars(dbInstance);
}

// Allow running this script directly
if (process.argv[1]?.endsWith('seed.defaults.ts') || process.argv[1]?.endsWith('seed.defaults.js')) {
  await seedDefaults(db);
  await client.end();
}
