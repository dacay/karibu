import { Hono } from 'hono';
import { eq, and, asc } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import {
  microlearnings,
  microlearningSequences,
  microlearningSequenceAssignments,
  userGroups,
} from '../db/schema.js';
import { logger } from '../config/logger.js';
import { broadcastFeedUpdate } from './learner-sse.js';

const sequencesRouter = new Hono();

sequencesRouter.use('*', authMiddleware());

/**
 * GET /sequences
 * List all sequences with their ordered microlearnings.
 */
sequencesRouter.get('/', requireRole('admin'), async (c) => {

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
 * POST /sequences
 * Create a new sequence.
 */
sequencesRouter.post('/', requireRole('admin'), async (c) => {

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

  logger.info({ sequenceId: sequence.id, organizationId: auth.organizationId }, 'Sequence created.');

  return c.json({ sequence: { ...sequence, microlearnings: [] } }, 201);
})

/**
 * PATCH /sequences/:id
 * Update a sequence's name and/or description.
 */
sequencesRouter.patch('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string }>();

  const [existing] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, id), eq(microlearningSequences.organizationId, auth.organizationId)))
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
    .where(eq(microlearningSequences.id, id))
    .returning();

  logger.info({ sequenceId: id, organizationId: auth.organizationId }, 'Sequence updated.');

  return c.json({ sequence: updated });
})

/**
 * DELETE /sequences/:id
 * Delete a sequence. Associated microlearnings have their sequenceId set to null.
 */
sequencesRouter.delete('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, id), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  await db.delete(microlearningSequences).where(eq(microlearningSequences.id, id));

  logger.info({ sequenceId: id, organizationId: auth.organizationId }, 'Sequence deleted.');

  return c.json({ success: true });
})

/**
 * PATCH /sequences/:id/reorder
 * Set the ordered list of microlearning IDs for a sequence.
 * Body: { microlearningIds: string[] }
 */
sequencesRouter.patch('/:id/reorder', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ microlearningIds: string[] }>();

  if (!Array.isArray(body.microlearningIds)) {
    return c.json({ error: 'microlearningIds must be an array.' }, 400);
  }

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, id), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!sequence) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  await db.transaction(async (tx) => {
    for (const [index, mlId] of body.microlearningIds.entries()) {
      await tx
        .update(microlearnings)
        .set({ sequenceId: id, position: index })
        .where(and(eq(microlearnings.id, mlId), eq(microlearnings.organizationId, auth.organizationId)));
    }
  });

  logger.info({ sequenceId: id, organizationId: auth.organizationId }, 'Sequence reordered.');

  return c.json({ success: true });
})

// ─── Assignments ──────────────────────────────────────────────────────────────

/**
 * GET /sequences/:id/assignments
 * List groups assigned to a sequence.
 */
sequencesRouter.get('/:id/assignments', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, id), eq(microlearningSequences.organizationId, auth.organizationId)))
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
    .where(eq(microlearningSequenceAssignments.sequenceId, id));

  return c.json({ assignments });
});

/**
 * POST /sequences/:id/assignments
 * Assign a group to a sequence. Body: { groupId: string }
 */
sequencesRouter.post('/:id/assignments', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ groupId: string }>();

  if (!body.groupId) {
    return c.json({ error: 'groupId is required.' }, 400);
  }

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, id), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!sequence) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  const [group] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, body.groupId), eq(userGroups.organizationId, auth.organizationId)))
    .limit(1);

  if (!group) {
    return c.json({ error: 'Group not found.' }, 404);
  }

  const [existing] = await db
    .select()
    .from(microlearningSequenceAssignments)
    .where(and(
      eq(microlearningSequenceAssignments.sequenceId, id),
      eq(microlearningSequenceAssignments.groupId, body.groupId),
    ))
    .limit(1);

  if (existing) {
    return c.json({ assignment: existing }, 200);
  }

  const [assignment] = await db
    .insert(microlearningSequenceAssignments)
    .values({ sequenceId: id, groupId: body.groupId })
    .returning();

  logger.info({ sequenceId: id, groupId: body.groupId }, 'Sequence assignment created.');

  // Notify learners in the newly assigned group that their feed may have new content
  broadcastFeedUpdate(auth.organizationId);

  return c.json({ assignment }, 201);
});

/**
 * DELETE /sequences/:id/assignments/:groupId
 * Unassign a group from a sequence.
 */
sequencesRouter.delete('/:id/assignments/:groupId', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const groupId = c.req.param('groupId');

  const [sequence] = await db
    .select()
    .from(microlearningSequences)
    .where(and(eq(microlearningSequences.id, id), eq(microlearningSequences.organizationId, auth.organizationId)))
    .limit(1);

  if (!sequence) {
    return c.json({ error: 'Sequence not found.' }, 404);
  }

  await db
    .delete(microlearningSequenceAssignments)
    .where(and(
      eq(microlearningSequenceAssignments.sequenceId, id),
      eq(microlearningSequenceAssignments.groupId, groupId),
    ));

  logger.info({ sequenceId: id, groupId }, 'Sequence assignment deleted.');

  return c.json({ success: true });
});

export default sequencesRouter;
