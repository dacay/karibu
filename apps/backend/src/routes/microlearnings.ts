import { Hono } from 'hono';
import { eq, and, asc, inArray, or, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import {
  microlearnings,
  microlearningSequenceAssignments,
  microlearningProgress,
  userGroups,
  userGroupMembers,
  avatars,
  dnaTopics,
} from '../db/schema.js';
import { logger } from '../config/logger.js';

const microlearningsRouter = new Hono();

microlearningsRouter.use('*', authMiddleware());

// ─── Static routes (must come before /:id) ────────────────────────────────────

/**
 * GET /microlearnings/my
 * List microlearnings assigned to the current learner (via group membership).
 * Includes progress data for each ML.
 * Accessible to all authenticated users.
 */
microlearningsRouter.get('/my', async (c) => {

  const auth = c.get('auth');

  // Find groups the user belongs to
  const groupMemberships = await db
    .select({ groupId: userGroupMembers.groupId })
    .from(userGroupMembers)
    .where(eq(userGroupMembers.userId, auth.userId));

  // Also include "isAll" groups in the org (implicitly include all org members)
  const isAllGroups = await db
    .select({ id: userGroups.id })
    .from(userGroups)
    .where(and(
      eq(userGroups.organizationId, auth.organizationId),
      eq(userGroups.isAll, true),
    ));

  const relevantGroupIds = [
    ...new Set([
      ...groupMemberships.map((m) => m.groupId),
      ...isAllGroups.map((g) => g.id),
    ]),
  ];

  if (relevantGroupIds.length === 0) {
    return c.json({ microlearnings: [] });
  }

  // Find sequences assigned to those groups
  const assignments = await db
    .select({ sequenceId: microlearningSequenceAssignments.sequenceId })
    .from(microlearningSequenceAssignments)
    .where(inArray(microlearningSequenceAssignments.groupId, relevantGroupIds));

  const sequenceIds = [...new Set(assignments.map((a) => a.sequenceId))];

  if (sequenceIds.length === 0) {
    return c.json({ microlearnings: [] });
  }

  // Fetch published MLs in those sequences
  const mls = await db
    .select()
    .from(microlearnings)
    .where(and(
      inArray(microlearnings.sequenceId, sequenceIds),
      eq(microlearnings.status, 'published'),
      eq(microlearnings.organizationId, auth.organizationId),
    ))
    .orderBy(asc(microlearnings.sequenceId), asc(microlearnings.position));

  if (mls.length === 0) {
    return c.json({ microlearnings: [] });
  }

  // Fetch progress for each ML
  const mlIds = mls.map((ml) => ml.id);
  const progressRows = await db
    .select()
    .from(microlearningProgress)
    .where(and(
      eq(microlearningProgress.userId, auth.userId),
      inArray(microlearningProgress.microlearningId, mlIds),
    ));

  // Fetch avatars for the MLs
  const avatarIds = [...new Set(mls.map((ml) => ml.avatarId).filter(Boolean))] as string[];
  const avatarRows = avatarIds.length > 0
    ? await db.select().from(avatars).where(inArray(avatars.id, avatarIds))
    : [];

  const result = mls.map((ml) => ({
    ...ml,
    avatar: avatarRows.find((a) => a.id === ml.avatarId) ?? null,
    progress: progressRows.find((p) => p.microlearningId === ml.id) ?? null,
  }));

  return c.json({ microlearnings: result });
});

// ─── Dynamic routes ────────────────────────────────────────────────────────────

/**
 * GET /microlearnings/:id
 * Get a single microlearning with avatar and progress data.
 * Admin: can access any ML in their org.
 * User: can only access MLs assigned to their groups.
 */
microlearningsRouter.get('/:id', async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [ml] = await db
    .select()
    .from(microlearnings)
    .where(and(
      eq(microlearnings.id, id),
      eq(microlearnings.organizationId, auth.organizationId),
    ))
    .limit(1);

  if (!ml) {
    return c.json({ error: 'Microlearning not found.' }, 404);
  }

  // Non-admin users can only access published MLs assigned to their groups
  if (auth.role !== 'admin') {

    if (ml.status !== 'published') {
      return c.json({ error: 'Microlearning not found.' }, 404);
    }

    if (ml.sequenceId) {

      const groupMemberships = await db
        .select({ groupId: userGroupMembers.groupId })
        .from(userGroupMembers)
        .where(eq(userGroupMembers.userId, auth.userId));

      const isAllGroups = await db
        .select({ id: userGroups.id })
        .from(userGroups)
        .where(and(
          eq(userGroups.organizationId, auth.organizationId),
          eq(userGroups.isAll, true),
        ));

      const relevantGroupIds = [
        ...new Set([
          ...groupMemberships.map((m) => m.groupId),
          ...isAllGroups.map((g) => g.id),
        ]),
      ];

      const [assignment] = relevantGroupIds.length > 0
        ? await db
          .select()
          .from(microlearningSequenceAssignments)
          .where(and(
            eq(microlearningSequenceAssignments.sequenceId, ml.sequenceId),
            inArray(microlearningSequenceAssignments.groupId, relevantGroupIds),
          ))
          .limit(1)
        : [null];

      if (!assignment) {
        return c.json({ error: 'Microlearning not found.' }, 404);
      }
    }
  }

  // Fetch associated avatar
  const [avatar] = ml.avatarId
    ? await db
      .select()
      .from(avatars)
      .where(and(
        eq(avatars.id, ml.avatarId),
        or(isNull(avatars.organizationId), eq(avatars.organizationId, auth.organizationId)),
      ))
      .limit(1)
    : [null];

  // Fetch topic name
  const [topic] = ml.topicId
    ? await db
      .select({ id: dnaTopics.id, name: dnaTopics.name })
      .from(dnaTopics)
      .where(eq(dnaTopics.id, ml.topicId))
      .limit(1)
    : [null];

  // Fetch current user's progress
  const [progress] = await db
    .select()
    .from(microlearningProgress)
    .where(and(
      eq(microlearningProgress.userId, auth.userId),
      eq(microlearningProgress.microlearningId, id),
    ))
    .limit(1);

  return c.json({
    microlearning: {
      ...ml,
      avatar: avatar ?? null,
      topic: topic ?? null,
    },
    progress: progress ?? null,
  });
});

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
    topicId: string;
    subtopicIds?: string[];
    patternId: string;
    avatarId: string;
    sequenceId?: string | null;
    position?: number | null;
  }>();

  if (!body.title?.trim()) {
    return c.json({ error: 'Title is required.' }, 400);
  }
  if (!body.topicId) {
    return c.json({ error: 'Topic is required.' }, 400);
  }
  if (!body.patternId) {
    return c.json({ error: 'Pattern is required.' }, 400);
  }
  if (!body.avatarId) {
    return c.json({ error: 'Avatar is required.' }, 400);
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

export default microlearningsRouter;
