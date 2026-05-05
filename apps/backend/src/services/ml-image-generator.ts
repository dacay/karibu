import { GoogleGenAI } from '@google/genai';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { microlearnings, organizations, dnaTopics, dnaSubtopics } from '../db/schema.js';
import {
  uploadToAssetsBucket,
  downloadFromAssetsBucket,
  buildMlImageKey,
  buildOrgLogoKey,
} from './s3.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { broadcastFeedUpdate } from '../routes/learner-sse.js';

/**
 * Build a prompt for Gemini image generation based on the ML's topics and subtopics.
 */
function buildImagePrompt(
  topicNames: string[],
  subtopicNames: string[],
  organizationName: string,
): string {
  const topicList = topicNames.length > 0
    ? topicNames.map((n) => `"${n}"`).join(', ')
    : '"professional development"';

  const subtopicList = subtopicNames.length > 0
    ? ` focusing on ${subtopicNames.join(', ')}`
    : '';

  return (
    `Generate a hyper-realistic, visually striking cover image for a microlearning module. ` +
    `The module is about ${topicList}${subtopicList} at an organization called "${organizationName}". ` +
    `Create an atmospheric, professional scene that visually represents this topic. ` +
    `The image should work well as a card background with text overlaid on it — ` +
    `use rich colors, depth of field, and cinematic lighting. ` +
    `Do not include any text, logos, or watermarks in the image.`
  );
}

/**
 * Load the org logo (light preferred, dark fallback) straight from S3 so we
 * don't depend on a CDN env var being set on the backend. Returns null if
 * neither variant exists.
 */
async function loadOrgLogo(
  subdomain: string,
): Promise<{ base64: string; mimeType: string } | null> {

  for (const variant of ['light', 'dark'] as const) {
    const key = buildOrgLogoKey(subdomain, variant);
    const obj = await downloadFromAssetsBucket(key);
    if (obj) {
      return { base64: obj.body.toString('base64'), mimeType: obj.contentType };
    }
  }

  return null;
}

/**
 * Generate a cover image for a microlearning using Gemini's image generation,
 * upload it to S3, and update the ML record.
 *
 * Runs asynchronously (fire-and-forget from the route handler).
 */
export async function generateMlImage(mlId: string): Promise<void> {
  if (!env.GEMINI_API_KEY) {
    logger.debug('GEMINI_API_KEY not configured — skipping ML image generation.');
    return;
  }

  try {
    // Load the ML with its organization, topic, and subtopics
    const [ml] = await db
      .select()
      .from(microlearnings)
      .where(eq(microlearnings.id, mlId))
      .limit(1);

    if (!ml) {
      logger.warn({ mlId }, 'ML not found for image generation.');
      return;
    }

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, ml.organizationId))
      .limit(1);

    if (!org) return;

    // Resolve topic names
    const topicNames: string[] = [];
    if (ml.topicIds && ml.topicIds.length > 0) {
      const topicRows = await db
        .select({ name: dnaTopics.name })
        .from(dnaTopics)
        .where(inArray(dnaTopics.id, ml.topicIds));
      topicNames.push(...topicRows.map((t) => t.name));
    }

    // Resolve subtopic names
    const subtopicNames: string[] = [];
    if (ml.subtopicIds && ml.subtopicIds.length > 0) {
      const subtopicRows = await db
        .select({ name: dnaSubtopics.name })
        .from(dnaSubtopics)
        .where(inArray(dnaSubtopics.id, ml.subtopicIds));
      subtopicNames.push(...subtopicRows.map((s) => s.name));
    }

    const prompt = buildImagePrompt(topicNames, subtopicNames, org.name);

    const model = env.GEMINI_IMAGE_MODEL;
    logger.info({ mlId, model, prompt }, 'Generating ML cover image with Gemini.');

    const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
    const logo = await loadOrgLogo(org.subdomain);

    if (logo) {
      parts.push({
        text: prompt + ` If possible, subtly incorporate the style or colors of the attached organization logo.`,
      });
      parts.push({ inlineData: { data: logo.base64, mimeType: logo.mimeType } });
      logger.info({ mlId, orgSubdomain: org.subdomain }, 'Attaching org logo to Gemini prompt.');
    } else {
      parts.push({ text: prompt });
      logger.debug({ mlId, orgSubdomain: org.subdomain }, 'No org logo found — prompt-only.');
    }

    const response = await genai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: { responseModalities: ['IMAGE'] },
    });

    const imagePart = response.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data?: string; mimeType?: string } }) => p.inlineData?.data,
    );

    if (!imagePart?.inlineData?.data) {
      logger.warn({ mlId }, 'Gemini returned no image data.');
      return;
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

    // Upload to S3
    const s3Key = buildMlImageKey(org.subdomain, mlId);
    await uploadToAssetsBucket(s3Key, imageBuffer, 'image/png');

    // Update the ML record
    await db
      .update(microlearnings)
      .set({ imageS3Key: s3Key })
      .where(eq(microlearnings.id, mlId));

    // Notify connected learners so their feed cards swap in the new image
    broadcastFeedUpdate(ml.organizationId);

    logger.info({ mlId, s3Key }, 'ML cover image generated and uploaded.');
  } catch (err) {
    logger.error({ err, mlId }, 'Failed to generate ML cover image.');
  }
}
