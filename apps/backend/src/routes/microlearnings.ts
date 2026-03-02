import { Hono } from 'hono';
import { eq, and, asc } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { microlearnings, microlearningSequences, microlearningSequenceAssignments, userGroups } from '../db/schema.js';
import { logger } from '../config/logger.js';

const microlearningsRouter = new Hono();

microlearningsRouter.use('*', authMiddleware());

// ─── Microlearnings ───────────────────────────────────────────────────────────

/**
 * GET /microlearnings
 * List all microlearnings for the org.
 */
microlearningsRouter.get('/', requireRole('admin'), async (c) => {

  const auth = c.get('auth');

  const mls = await db
    .select()
    .from(microlearnings)
    .where(eq(microlearnings.organizationId, auth.organizationId))
    .orderBy(asc(microlearnings.createdAt));

  return c.json({ microlearnings: mls });
})

/**
 * POST /microlearnings
 * Create a new microlearning.
 */
microlearningsRouter.post('/', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const body = await c.req.json<{
    title: string;
    status?: 'draft' | 'published';
    topicId?: string | null;
    subtopicIds?: string[];
    patternId?: string | null;
    avatarId?: string | null;
    sequenceId?: string | null;
    position?: number | null;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: 'Title is required.' }, 400);
  }

  const [ml] = await db
    .insert(microlearnings)
    .values({
      organizationId: auth.organizationId,
      title: body.title.trim(),
      status: body.status ?? 'draft',
      topicId: body.topicId ?? null,
      subtopicIds: body.subtopicIds ?? [],
      patternId: body.patternId ?? null,
      avatarId: body.avatarId ?? null,
      sequenceId: body.sequenceId ?? null,
      position: body.position ?? null,
    })
    .returning();

  logger.info({ microlearningId: ml.id, organizationId: auth.organizationId }, 'Microlearning created.');

  return c.json({ microlearning: ml }, 201);
})

/**
 * PATCH /microlearnings/:id
 * Update a microlearning.
 */
microlearningsRouter.patch('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    status?: 'draft' | 'published';
    topicId?: string | null;
    subtopicIds?: string[];
    patternId?: string | null;
    avatarId?: string | null;
    sequenceId?: string | null;
    position?: number | null;
  }>();

  const [existing] = await db
    .select()
    .from(microlearnings)
    .where(and(eq(microlearnings.id, id), eq(microlearnings.organizationId, auth.organizationId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Microlearning not found.' }, 404);
  }

  const updates: Partial<typeof existing> = {};
  if (body.title?.trim()) updates.title = body.title.trim();
  if ('status' in body && body.status) updates.status = body.status;
  if ('topicId' in body) updates.topicId = body.topicId ?? null;
  if ('subtopicIds' in body) updates.subtopicIds = body.subtopicIds ?? [];
  if ('patternId' in body) updates.patternId = body.patternId ?? null;
  if ('avatarId' in body) updates.avatarId = body.avatarId ?? null;
  if ('sequenceId' in body) updates.sequenceId = body.sequenceId ?? null;
  if ('position' in body) updates.position = body.position ?? null;

  const [updated] = await db
    .update(microlearnings)
    .set(updates)
    .where(eq(microlearnings.id, id))
    .returning();

  logger.info({ microlearningId: id, organizationId: auth.organizationId }, 'Microlearning updated.');

  return c.json({ microlearning: updated });
})

/**
 * DELETE /microlearnings/:id
 * Delete a microlearning.
 */
microlearningsRouter.delete('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(microlearnings)
    .where(and(eq(microlearnings.id, id), eq(microlearnings.organizationId, auth.organizationId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Microlearning not found.' }, 404);
  }

  await db.delete(microlearnings).where(eq(microlearnings.id, id));

  logger.info({ microlearningId: id, organizationId: auth.organizationId }, 'Microlearning deleted.');

  return c.json({ success: true });
})

// ─── Sequences ────────────────────────────────────────────────────────────────

/**
 * GET /microlearnings/sequences
 * List all sequences with their ordered microlearnings.
 */
microlearningsRouter.get('/sequences', requireRole('admin'), async (c) => {

  const auth = c.get('auth');

  const sequences = await db
    .select()
    .from(microlearningSequences)
    .where(eq(microlearningSequences.organizationId, auth.organizationId))
    .orderBy(asc(microlearningSequences.createdAt));

  const mls = await db
    .select()
    .from(microlearnings)
    .where(eq(microlearnings.organizationId, auth.organizationId))
    .orderBy(asc(microlearnings.position));

  const sequencesWithMls = sequences.map((seq) => ({
    ...seq,
    microlearnings: mls
      .filter((ml) => ml.sequenceId === seq.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  }));

  return c.json({ sequences: sequencesWithMls });
})

/**
 * POST /microlearnings/sequences
 * Create a new microlearning sequence.
 */
microlearningsRouter.post('/sequences', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const body = await c.req.json<{ name: string; description?: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: 'Sequence name is required.' }, 400);
  }

  const [sequence] = await db
    .insert(microlearningSequences)
    .values({
      organizationId: auth.organizationId,
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
    })
    .returning();

  logger.info({ sequenceId: sequence.id, organizationId: auth.organizationId }, 'Microlearning sequence created.');

  return c.json({ sequence: { ...sequence, microlearnings: [] } }, 201);
})

/**
 * PATCH /microlearnings/sequences/:seqId
 * Update a sequence's name and/or description.
 */
microlearningsRouter.patch('/sequences/:seqId', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const seqId = c.req.param('seqId');
  const body = await c.req.json<{ name?: string; description?: string }>();

  const [existing] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, seqId), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  const updates: Partial<typeof existing> = {};
  if (body.name?.trim()) updates.name = body.name.trim();
  if ('description' in body) updates.description = body.description?.trim() ?? null;

  const [updated] = await db
    .update(microlearningSequences)
    .set(updates)
    .where(eq(microlearningSequences.id, seqId))
    .returning();

  logger.info({ sequenceId: seqId, organizationId: auth.organizationId }, 'Microlearning sequence updated.');

  return c.json({ sequence: updated });
})

/**
 * DELETE /microlearnings/sequences/:seqId
 * Delete a sequence. Associated microlearnings have their sequenceId set to null.
 */
microlearningsRouter.delete('/sequences/:seqId', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const seqId = c.req.param('seqId');

  const [existing] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, seqId), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  await db.delete(microlearningSequences).where(eq(microlearningSequences.id, seqId));

  logger.info({ sequenceId: seqId, organizationId: auth.organizationId }, 'Microlearning sequence deleted.');

  return c.json({ success: true });
})

/**
 * PUT /microlearnings/sequences/:seqId/reorder
 * Set the ordered list of microlearning IDs for a sequence.
 * Body: { microlearningIds: string[] }
 */
microlearningsRouter.put('/sequences/:seqId/reorder', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const seqId = c.req.param('seqId');
  const body = await c.req.json<{ microlearningIds: string[] }>();

  if (!Array.isArray(body.microlearningIds)) {
    return c.json({ error: 'microlearningIds must be an array.' }, 400);
  }

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, seqId), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!sequence) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  // Update positions for all provided microlearning IDs
  await db.transaction(async (tx) => {

    for (const [index, mlId] of body.microlearningIds.entries()) {
      await tx
        .update(microlearnings)
        .set({ sequenceId: seqId, position: index })
        .where(and(eq(microlearnings.id, mlId), eq(microlearnings.organizationId, auth.organizationId)));
    }
  });

  logger.info({ sequenceId: seqId, organizationId: auth.organizationId }, 'Microlearning sequence reordered.');

  return c.json({ success: true });
})

// ─── Sequence assignments ─────────────────────────────────────────────────────

/**
 * GET /microlearnings/sequences/:seqId/assignments
 * List groups assigned to a sequence.
 */
microlearningsRouter.get('/sequences/:seqId/assignments', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const seqId = c.req.param('seqId');

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, seqId), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!sequence) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  const assignments = await db
    .select({
      id: microlearningSequenceAssignments.id,
      sequenceId: microlearningSequenceAssignments.sequenceId,
      groupId: microlearningSequenceAssignments.groupId,
      createdAt: microlearningSequenceAssignments.createdAt,
      group: {
        id: userGroups.id,
        name: userGroups.name,
        isAll: userGroups.isAll,
      },
    })
    .from(microlearningSequenceAssignments)
    .innerJoin(userGroups, eq(userGroups.id, microlearningSequenceAssignments.groupId))
    .where(eq(microlearningSequenceAssignments.sequenceId, seqId));

  return c.json({ assignments });
});

/**
 * POST /microlearnings/sequences/:seqId/assignments
 * Assign a group to a sequence. Body: { groupId: string }
 */
microlearningsRouter.post('/sequences/:seqId/assignments', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const seqId = c.req.param('seqId');
  const body = await c.req.json<{ groupId: string }>();

  if (!body.groupId) {
    return c.json({ error: 'groupId is required.' }, 400);
  }

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, seqId), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!sequence) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  // Verify group belongs to this org
  const [group] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, body.groupId), eq(userGroups.organizationId, auth.organizationId)))
    .limit(1);

  if (!group) {
    return c.json({ error: 'Group not found.' }, 404);
  }

  // Upsert: skip if already assigned
  const [existing] = await db
    .select()
    .from(microlearningSequenceAssignments)
    .where(
      and(
        eq(microlearningSequenceAssignments.sequenceId, seqId),
        eq(microlearningSequenceAssignments.groupId, body.groupId)
      )
    )
    .limit(1);

  if (existing) {
    return c.json({ assignment: existing }, 200);
  }

  const [assignment] = await db
    .insert(microlearningSequenceAssignments)
    .values({ sequenceId: seqId, groupId: body.groupId })
    .returning();

  logger.info({ sequenceId: seqId, groupId: body.groupId }, 'Sequence assignment created.');

  return c.json({ assignment }, 201);
});

/**
 * DELETE /microlearnings/sequences/:seqId/assignments/:groupId
 * Unassign a group from a sequence.
 */
microlearningsRouter.delete('/sequences/:seqId/assignments/:groupId', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const seqId = c.req.param('seqId');
  const groupId = c.req.param('groupId');

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, seqId), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!sequence) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  await db
    .delete(microlearningSequenceAssignments)
    .where(
      and(
        eq(microlearningSequenceAssignments.sequenceId, seqId),
        eq(microlearningSequenceAssignments.groupId, groupId)
      )
    );

  logger.info({ sequenceId: seqId, groupId }, 'Sequence assignment deleted.');

  return c.json({ success: true });
});

export default microlearningsRouter;
