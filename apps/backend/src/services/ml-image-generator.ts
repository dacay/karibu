import { GoogleGenAI } from '@google/genai';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { microlearnings, organizations, dnaTopics, dnaSubtopics } from '../db/schema.js';
import { uploadToAssetsBucket, buildMlImageKey, buildOrgLogoKey } from './s3.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { broadcastFeedUpdate } from '../routes/learner-sse.js';

/**
 * Build a prompt for Gemini image generation based on the ML's topic and subtopics.
 */
function buildImagePrompt(
  topicName: string,
  subtopicNames: string[],
  organizationName: string,
): string {
  const subtopicList = subtopicNames.length > 0
    ? ` focusing on ${subtopicNames.join(', ')}`
    : '';

  return (
    `Generate a hyper-realistic, visually striking cover image for a microlearning module. ` +
    `The module is about "${topicName}"${subtopicList} at an organization called "${organizationName}". ` +
    `Create an atmospheric, professional scene that visually represents this topic. ` +
    `The image should work well as a card background with text overlaid on it — ` +
    `use rich colors, depth of field, and cinematic lighting. ` +
    `Do not include any text, logos, or watermarks in the image.`
  );
}

/**
 * Download an image from a URL and return it as a base64 string.
 * Used to fetch the org logo to send to Gemini as reference.
 */
async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { base64: buffer.toString('base64'), mimeType: contentType };
  } catch {
    return null;
  }
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

    // Resolve topic name
    let topicName = 'professional development';
    if (ml.topicId) {
      const [topic] = await db
        .select({ name: dnaTopics.name })
        .from(dnaTopics)
        .where(eq(dnaTopics.id, ml.topicId))
        .limit(1);
      if (topic) topicName = topic.name;
    }

    // Resolve subtopic names
    const subtopicNames: string[] = [];
    if (ml.subtopicIds && ml.subtopicIds.length > 0) {
      for (const stId of ml.subtopicIds) {
        const [st] = await db
          .select({ name: dnaSubtopics.name })
          .from(dnaSubtopics)
          .where(eq(dnaSubtopics.id, stId))
          .limit(1);
        if (st) subtopicNames.push(st.name);
      }
    }

    const prompt = buildImagePrompt(topicName, subtopicNames, org.name);

    const model = env.GEMINI_IMAGE_MODEL;
    logger.info({ mlId, model, prompt }, 'Generating ML cover image with Gemini.');

    const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

    // Try to fetch org logo to include as reference
    const logoKey = buildOrgLogoKey(org.subdomain, 'light');
    const cdnBase = process.env.ASSETS_CDN_URL ?? process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? '';
    const logoUrl = cdnBase ? `${cdnBase}/${logoKey}` : '';

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

    if (logoUrl) {
      const logoData = await fetchImageAsBase64(logoUrl);
      if (logoData) {
        parts.push({
          text: prompt + ` If possible, subtly incorporate the style or colors of the attached organization logo.`,
        });
        parts.push({
          inlineData: { data: logoData.base64, mimeType: logoData.mimeType },
        });
      } else {
        parts.push({ text: prompt });
      }
    } else {
      parts.push({ text: prompt });
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
