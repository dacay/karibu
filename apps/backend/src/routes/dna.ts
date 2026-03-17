import { Hono } from 'hono';
import { eq, and, asc, ne } from 'drizzle-orm';
import { generateText } from 'ai';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { dnaTopics, dnaSubtopics, dnaValues, documents } from '../db/schema.js';
import { queryDocuments, sampleDocumentChunks } from '../services/chromadb.js';
import { openai } from '../ai/mastra.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

const dnaRouter = new Hono();

dnaRouter.use('*', authMiddleware());

/**
 * GET /dna
 * List all topics with nested subtopics and values for the current organization.
 */
dnaRouter.get('/', requireRole('admin'), async (c) => {

  const auth = c.get('auth');

  const topics = await db
    .select()
    .from(dnaTopics)
    .where(eq(dnaTopics.organizationId, auth.organizationId));

  const subtopics = await db
    .select()
    .from(dnaSubtopics)
    .where(eq(dnaSubtopics.organizationId, auth.organizationId));

  const values = await db
    .select()
    .from(dnaValues)
    .where(eq(dnaValues.organizationId, auth.organizationId))
    .orderBy(asc(dnaValues.createdAt), asc(dnaValues.id));

  // Build nested structure
  const result = topics.map((topic) => {
    const topicSubtopics = subtopics
      .filter((s) => s.topicId === topic.id)
      .map((subtopic) => ({
        ...subtopic,
        values: values.filter((v) => v.subtopicId === subtopic.id),
      }));

    return { ...topic, subtopics: topicSubtopics };
  });

  return c.json({ topics: result });
});

/**
 * POST /dna/topics
 * Create a new DNA topic.
 */
dnaRouter.post('/topics', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const body = await c.req.json<{ name: string; description: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: 'Topic name is required.' }, 400);
  }

  const [topic] = await db.insert(dnaTopics).values({
    organizationId: auth.organizationId,
    name: body.name.trim(),
    description: body.description?.trim() ?? '',
  }).returning();

  logger.info({ topicId: topic.id, organizationId: auth.organizationId }, 'DNA topic created.');

  return c.json({ topic }, 201);
});

/**
 * PATCH /dna/topics/:id
 * Update a DNA topic's name and/or description.
 */
dnaRouter.patch('/topics/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string }>();

  const [topic] = await db
    .select()
    .from(dnaTopics)
    .where(and(eq(dnaTopics.id, id), eq(dnaTopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!topic) {
    return c.json({ error: 'Topic not found.' }, 404);
  }

  const [updated] = await db
    .update(dnaTopics)
    .set({
      ...(body.name?.trim() ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
    })
    .where(eq(dnaTopics.id, id))
    .returning();

  return c.json({ topic: updated });
});

/**
 * PATCH /dna/subtopics/:id
 * Update a subtopic's name and/or description.
 */
dnaRouter.patch('/subtopics/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string }>();

  const [subtopic] = await db
    .select()
    .from(dnaSubtopics)
    .where(and(eq(dnaSubtopics.id, id), eq(dnaSubtopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!subtopic) {
    return c.json({ error: 'Subtopic not found.' }, 404);
  }

  const [updated] = await db
    .update(dnaSubtopics)
    .set({
      ...(body.name?.trim() ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
    })
    .where(eq(dnaSubtopics.id, id))
    .returning();

  return c.json({ subtopic: updated });
});

/**
 * DELETE /dna/topics/:id
 * Delete a DNA topic (cascades to subtopics and values).
 */
dnaRouter.delete('/topics/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [topic] = await db
    .select()
    .from(dnaTopics)
    .where(and(eq(dnaTopics.id, id), eq(dnaTopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!topic) {
    return c.json({ error: 'Topic not found.' }, 404);
  }

  await db.delete(dnaTopics).where(eq(dnaTopics.id, id));

  logger.info({ topicId: id, organizationId: auth.organizationId }, 'DNA topic deleted.');

  return c.json({ success: true });
});

/**
 * POST /dna/topics/:topicId/subtopics
 * Create a new subtopic within a topic.
 */
dnaRouter.post('/topics/:topicId/subtopics', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const topicId = c.req.param('topicId');
  const body = await c.req.json<{ name: string; description: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: 'Subtopic name is required.' }, 400);
  }

  // Verify topic belongs to org
  const [topic] = await db
    .select()
    .from(dnaTopics)
    .where(and(eq(dnaTopics.id, topicId), eq(dnaTopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!topic) {
    return c.json({ error: 'Topic not found.' }, 404);
  }

  const [subtopic] = await db.insert(dnaSubtopics).values({
    topicId,
    organizationId: auth.organizationId,
    name: body.name.trim(),
    description: body.description?.trim() ?? '',
  }).returning();

  logger.info({ subtopicId: subtopic.id, topicId, organizationId: auth.organizationId }, 'DNA subtopic created.');

  return c.json({ subtopic }, 201);
});

/**
 * DELETE /dna/subtopics/:id
 * Delete a subtopic (cascades to values).
 */
dnaRouter.delete('/subtopics/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [subtopic] = await db
    .select()
    .from(dnaSubtopics)
    .where(and(eq(dnaSubtopics.id, id), eq(dnaSubtopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!subtopic) {
    return c.json({ error: 'Subtopic not found.' }, 404);
  }

  await db.delete(dnaSubtopics).where(eq(dnaSubtopics.id, id));

  logger.info({ subtopicId: id, organizationId: auth.organizationId }, 'DNA subtopic deleted.');

  return c.json({ success: true });
});

/**
 * POST /dna/subtopics/:id/synthesize
 * Query ChromaDB + LLM to generate value statements for a subtopic.
 */
dnaRouter.post('/subtopics/:id/synthesize', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [subtopic] = await db
    .select()
    .from(dnaSubtopics)
    .where(and(eq(dnaSubtopics.id, id), eq(dnaSubtopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!subtopic) {
    return c.json({ error: 'Subtopic not found.' }, 404);
  }

  // Fetch parent topic for context
  const [topic] = await db
    .select()
    .from(dnaTopics)
    .where(eq(dnaTopics.id, subtopic.topicId))
    .limit(1);

  // Query ChromaDB for relevant chunks
  const queryText = `${topic?.name ?? ''} ${subtopic.name}`.trim();
  const queryResult = await queryDocuments(queryText, auth.organizationId, 10);

  const chunks = queryResult.documents.filter((d): d is string => d !== null && d.length > 0);

  if (chunks.length === 0) {
    return c.json({
      error: 'No relevant document content found. Upload source documents first before synthesizing values.',
    }, 422);
  }

  // Mark as running
  await db
    .update(dnaSubtopics)
    .set({ synthesisStatus: 'running' })
    .where(eq(dnaSubtopics.id, id));

  try {

    const context = chunks.join('\n\n---\n\n');

    const { text } = await generateText({
      model: openai('gpt-4o'),
      prompt: `You are helping define an organization's learning DNA.

Topic: ${topic?.name ?? ''}
Subtopic: ${subtopic.name}
${subtopic.description ? `Description: ${subtopic.description}` : ''}

Your task is to extract value statements strictly from the source document excerpts below. Do not use any outside knowledge or make inferences beyond what is explicitly stated in the excerpts. If the excerpts do not contain relevant information about this subtopic, output nothing.

Extract ${env.DNA_SYNTHESIS_MIN_VALUES} to ${env.DNA_SYNTHESIS_MAX_VALUES} value statements that capture the core principles, beliefs, and important context related to this subtopic, using only what is stated in the excerpts. Each statement should be self-contained and preserve enough detail to be useful when fed into other prompts. Each statement should be on its own line, starting with a dash (-). Do not number them. Keep each statement under ${env.DNA_SYNTHESIS_MAX_WORDS_PER_VALUE} words.

Source excerpts:
${context}`,
    });

    // Parse lines starting with "-"
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'))
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      await db.update(dnaSubtopics).set({ synthesisStatus: 'failed' }).where(eq(dnaSubtopics.id, id));
      return c.json({ error: 'No relevant content found in the uploaded documents for this topic.' }, 422);
    }

    // Delete non-approved values, preserving any previously approved ones
    await db.delete(dnaValues).where(and(eq(dnaValues.subtopicId, id), ne(dnaValues.approval, 'approved')));

    if (lines.length > 0) {
      await db.insert(dnaValues).values(
        lines.map((content) => ({
          subtopicId: id,
          organizationId: auth.organizationId,
          content,
          approval: 'pending' as const,
        }))
      );
    }

    // Mark as done
    await db
      .update(dnaSubtopics)
      .set({ synthesisStatus: 'done', lastSynthesizedAt: new Date() })
      .where(eq(dnaSubtopics.id, id));

    logger.info({ subtopicId: id, valueCount: lines.length }, 'DNA synthesis complete.');

    return c.json({ success: true, valueCount: lines.length });

  } catch (err) {

    await db
      .update(dnaSubtopics)
      .set({ synthesisStatus: 'failed' })
      .where(eq(dnaSubtopics.id, id));

    logger.error({ err, subtopicId: id }, 'DNA synthesis failed.');

    return c.json({ error: 'Synthesis failed. Please try again.' }, 500);
  }
});

/**
 * PATCH /dna/values/:id/content
 * Update the content of a DNA value (marks it as user-edited).
 */
dnaRouter.patch('/values/:id/content', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: 'Content is required.' }, 400);
  }

  const [value] = await db
    .select()
    .from(dnaValues)
    .where(and(eq(dnaValues.id, id), eq(dnaValues.organizationId, auth.organizationId)))
    .limit(1);

  if (!value) {
    return c.json({ error: 'Value not found.' }, 404);
  }

  const [updated] = await db
    .update(dnaValues)
    .set({ content: body.content.trim(), userEdited: true })
    .where(eq(dnaValues.id, id))
    .returning();

  logger.info({ valueId: id, organizationId: auth.organizationId }, 'DNA value content updated by user.');

  return c.json({ value: updated });
});

/**
 * PATCH /dna/values/:id/approval
 * Update the approval status of a DNA value.
 */
dnaRouter.patch('/values/:id/approval', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ approval: 'approved' | 'rejected' }>();

  if (!['approved', 'rejected'].includes(body.approval)) {
    return c.json({ error: 'approval must be "approved" or "rejected".' }, 400);
  }

  const [value] = await db
    .select()
    .from(dnaValues)
    .where(and(eq(dnaValues.id, id), eq(dnaValues.organizationId, auth.organizationId)))
    .limit(1);

  if (!value) {
    return c.json({ error: 'Value not found.' }, 404);
  }

  const [updated] = await db
    .update(dnaValues)
    .set({ approval: body.approval })
    .where(eq(dnaValues.id, id))
    .returning();

  return c.json({ value: updated });
});

/**
 * DELETE /dna/values/:id
 * Delete a DNA value.
 */
dnaRouter.delete('/values/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [value] = await db
    .select()
    .from(dnaValues)
    .where(and(eq(dnaValues.id, id), eq(dnaValues.organizationId, auth.organizationId)))
    .limit(1);

  if (!value) {
    return c.json({ error: 'Value not found.' }, 404);
  }

  await db.delete(dnaValues).where(eq(dnaValues.id, id));

  logger.info({ valueId: id, organizationId: auth.organizationId }, 'DNA value deleted.');

  return c.json({ success: true });
});

/**
 * POST /dna/discover
 * Analyze uploaded documents and suggest topic/subtopic structures.
 * Inserts suggestions with source=discovered, status=suggested for admin review.
 */
dnaRouter.post('/discover', requireRole('admin'), async (c) => {

  const auth = c.get('auth');

  // Verify processed documents exist
  const [processedDoc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.organizationId, auth.organizationId), eq(documents.status, 'processed')))
    .limit(1);

  if (!processedDoc) {
    return c.json({
      error: 'No processed documents found. Upload and process source documents first.',
    }, 422);
  }

  // Sample a broad set of chunks for analysis
  const sample = await sampleDocumentChunks(auth.organizationId, 40);
  const chunks = sample.documents.filter((d): d is string => d !== null && d.length > 0);

  if (chunks.length === 0) {
    return c.json({
      error: 'No document content found. Documents may still be processing.',
    }, 422);
  }

  const context = chunks.slice(0, 30).join('\n\n---\n\n');

  // Load existing topic names to avoid duplicates
  const existingTopics = await db
    .select({ name: dnaTopics.name })
    .from(dnaTopics)
    .where(eq(dnaTopics.organizationId, auth.organizationId));

  const existingNames = new Set(existingTopics.map((t) => t.name.toLowerCase()));

  try {

    const { text } = await generateText({
      model: openai('gpt-4o'),
      prompt: `Analyze these organizational document excerpts and suggest a topic/subtopic structure that captures the key knowledge domains.

Return ONLY a JSON array (no markdown, no explanation) in this exact format:
[
  {
    "name": "Topic Name",
    "description": "One sentence describing this knowledge domain",
    "subtopics": [
      { "name": "Subtopic Name", "description": "One sentence describing this aspect" }
    ]
  }
]

Guidelines:
- Suggest 3 to 6 distinct topics covering the major knowledge domains in the excerpts
- Each topic should have 2 to 4 subtopics
- Base all suggestions strictly on the provided excerpts, do not add outside knowledge
- Keep names concise (3-6 words) and descriptions clear

Document excerpts:
${context}`,
    });

    // Strip any markdown code fences the model may have added
    const cleanedText = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

    let suggestions: Array<{
      name: string;
      description: string;
      subtopics: Array<{ name: string; description: string }>;
    }>;

    try {
      suggestions = JSON.parse(cleanedText);
    } catch {
      logger.error({ text }, 'Failed to parse discovery suggestions as JSON.');
      return c.json({ error: 'Discovery failed. Please try again.' }, 500);
    }

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return c.json({ error: 'No topics could be identified from the documents.' }, 422);
    }

    let topicCount = 0;
    let subtopicCount = 0;

    for (const suggestion of suggestions) {

      if (!suggestion.name?.trim()) continue;
      if (existingNames.has(suggestion.name.trim().toLowerCase())) continue;

      const [topic] = await db.insert(dnaTopics).values({
        organizationId: auth.organizationId,
        name: suggestion.name.trim(),
        description: suggestion.description?.trim() ?? '',
        source: 'discovered',
        status: 'suggested',
      }).returning();

      topicCount++;

      if (Array.isArray(suggestion.subtopics)) {
        for (const sub of suggestion.subtopics) {

          if (!sub.name?.trim()) continue;

          await db.insert(dnaSubtopics).values({
            topicId: topic.id,
            organizationId: auth.organizationId,
            name: sub.name.trim(),
            description: sub.description?.trim() ?? '',
            source: 'discovered',
            status: 'suggested',
          });

          subtopicCount++;
        }
      }
    }

    logger.info({ topicCount, subtopicCount, organizationId: auth.organizationId }, 'DNA discovery complete.');

    return c.json({ topicCount, subtopicCount });

  } catch (err) {

    logger.error({ err }, 'DNA discovery failed.');

    return c.json({ error: 'Discovery failed. Please try again.' }, 500);
  }
});

/**
 * PATCH /dna/topics/:id/status
 * Accept or reject a suggested topic.
 */
dnaRouter.patch('/topics/:id/status', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ status: 'active' | 'rejected' }>();

  if (!['active', 'rejected'].includes(body.status)) {
    return c.json({ error: 'status must be "active" or "rejected".' }, 400);
  }

  const [topic] = await db
    .select()
    .from(dnaTopics)
    .where(and(eq(dnaTopics.id, id), eq(dnaTopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!topic) {
    return c.json({ error: 'Topic not found.' }, 404);
  }

  const [updated] = await db
    .update(dnaTopics)
    .set({ status: body.status })
    .where(eq(dnaTopics.id, id))
    .returning();

  logger.info({ topicId: id, status: body.status, organizationId: auth.organizationId }, 'DNA topic status updated.');

  return c.json({ topic: updated });
});

/**
 * PATCH /dna/subtopics/:id/status
 * Accept or reject a suggested subtopic.
 */
dnaRouter.patch('/subtopics/:id/status', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ status: 'active' | 'rejected' }>();

  if (!['active', 'rejected'].includes(body.status)) {
    return c.json({ error: 'status must be "active" or "rejected".' }, 400);
  }

  const [subtopic] = await db
    .select()
    .from(dnaSubtopics)
    .where(and(eq(dnaSubtopics.id, id), eq(dnaSubtopics.organizationId, auth.organizationId)))
    .limit(1);

  if (!subtopic) {
    return c.json({ error: 'Subtopic not found.' }, 404);
  }

  const [updated] = await db
    .update(dnaSubtopics)
    .set({ status: body.status })
    .where(eq(dnaSubtopics.id, id))
    .returning();

  logger.info({ subtopicId: id, status: body.status, organizationId: auth.organizationId }, 'DNA subtopic status updated.');

  return c.json({ subtopic: updated });
});

export default dnaRouter;
