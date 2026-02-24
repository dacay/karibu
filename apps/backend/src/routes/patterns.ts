import { Hono } from 'hono';
import { eq, and, or, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { conversationPatterns } from '../db/schema.js';
import { logger } from '../config/logger.js';

const patternsRouter = new Hono();

patternsRouter.use('*', authMiddleware());

/**
 * GET /patterns
 * List all built-in patterns and org-specific patterns.
 */
patternsRouter.get('/', requireRole('admin'), async (c) => {

  const auth = c.get('auth');

  const patterns = await db
    .select()
    .from(conversationPatterns)
    .where(
      or(
        isNull(conversationPatterns.organizationId),
        eq(conversationPatterns.organizationId, auth.organizationId),
      )
    );

  return c.json({ patterns });
});

/**
 * POST /patterns
 * Create a new org-specific conversation pattern.
 */
patternsRouter.post('/', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const body = await c.req.json<{ name: string; description: string; prompt: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: 'Pattern name is required.' }, 400);
  }

  if (!body.prompt?.trim()) {
    return c.json({ error: 'Pattern prompt is required.' }, 400);
  }

  const [pattern] = await db
    .insert(conversationPatterns)
    .values({
      organizationId: auth.organizationId,
      name: body.name.trim(),
      description: body.description?.trim() ?? '',
      prompt: body.prompt.trim(),
      isBuiltIn: false,
    })
    .returning();

  logger.info({ patternId: pattern.id, organizationId: auth.organizationId }, 'Conversation pattern created.');

  return c.json({ pattern }, 201);
});

/**
 * PATCH /patterns/:id
 * Update a conversation pattern. Built-in patterns cannot be modified.
 */
patternsRouter.patch('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string; prompt?: string }>();

  const [pattern] = await db
    .select()
    .from(conversationPatterns)
    .where(and(eq(conversationPatterns.id, id), eq(conversationPatterns.organizationId, auth.organizationId)))
    .limit(1);

  if (!pattern) {
    return c.json({ error: 'Pattern not found.' }, 404);
  }

  if (pattern.isBuiltIn) {
    return c.json({ error: 'Built-in patterns cannot be modified.' }, 403);
  }

  const [updated] = await db
    .update(conversationPatterns)
    .set({
      ...(body.name?.trim() ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() } : {}),
      ...(body.prompt?.trim() ? { prompt: body.prompt.trim() } : {}),
    })
    .where(eq(conversationPatterns.id, id))
    .returning();

  logger.info({ patternId: id, organizationId: auth.organizationId }, 'Conversation pattern updated.');

  return c.json({ pattern: updated });
});

/**
 * DELETE /patterns/:id
 * Delete an org-specific conversation pattern. Built-in patterns cannot be deleted.
 */
patternsRouter.delete('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [pattern] = await db
    .select()
    .from(conversationPatterns)
    .where(and(eq(conversationPatterns.id, id), eq(conversationPatterns.organizationId, auth.organizationId)))
    .limit(1);

  if (!pattern) {
    return c.json({ error: 'Pattern not found.' }, 404);
  }

  if (pattern.isBuiltIn) {
    return c.json({ error: 'Built-in patterns cannot be deleted.' }, 403);
  }

  await db.delete(conversationPatterns).where(eq(conversationPatterns.id, id));

  logger.info({ patternId: id, organizationId: auth.organizationId }, 'Conversation pattern deleted.');

  return c.json({ success: true });
});

export default patternsRouter;
