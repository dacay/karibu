import { Hono } from 'hono';
import { eq, and, asc, inArray, or, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import {
  microlearnings,
  microlearningSequences,
  microlearningSequenceAssignments,
  microlearningProgress,
  userGroups,
  userGroupMembers,
  avatars,
  dnaTopics,
} from '../db/schema.js';
import { logger } from '../config/logger.js';
import { broadcastFeedUpdate } from './learner-sse.js';

// Inactivity window after which an active ML is considered expired.
// Adjust as needed; future work could make this per-org configurable.
const INACTIVITY_WINDOW_MS = 120 * 1000; // 8 hours

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

/**
 * GET /microlearnings/feed
 * Structured learner feed: active (next per sequence + standalones) and archive
 * (completed/expired). Applies lazy expiry to stale active progress records.
 */
microlearningsRouter.get('/feed', async (c) => {

  const auth = c.get('auth');

  // ── 1. Resolve the user's group memberships ────────────────────────────────

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

  if (relevantGroupIds.length === 0) {
    return c.json({ active: [], archive: [] });
  }

  // ── 2. Find assigned sequences ─────────────────────────────────────────────

  const assignments = await db
    .select({ sequenceId: microlearningSequenceAssignments.sequenceId })
    .from(microlearningSequenceAssignments)
    .where(inArray(microlearningSequenceAssignments.groupId, relevantGroupIds));

  const sequenceIds = [...new Set(assignments.map((a) => a.sequenceId))];

  // ── 3. Fetch published MLs in assigned sequences + standalones ─────────────

  const [seqMLs, standaloneMLs] = await Promise.all([
    sequenceIds.length > 0
      ? db.select()
          .from(microlearnings)
          .where(and(
            inArray(microlearnings.sequenceId, sequenceIds),
            eq(microlearnings.status, 'published'),
            eq(microlearnings.organizationId, auth.organizationId),
          ))
          .orderBy(asc(microlearnings.sequenceId), asc(microlearnings.position))
      : Promise.resolve([]),
    db.select()
      .from(microlearnings)
      .where(and(
        eq(microlearnings.organizationId, auth.organizationId),
        eq(microlearnings.status, 'published'),
        isNull(microlearnings.sequenceId),
      ))
      .orderBy(asc(microlearnings.createdAt)),
  ]);

  const allMLs = [...seqMLs, ...standaloneMLs];
  if (allMLs.length === 0) {
    return c.json({ active: [], archive: [] });
  }

  // ── 4. Load progress for all MLs ──────────────────────────────────────────

  const allMlIds = allMLs.map((m) => m.id);
  const progressRows = await db
    .select()
    .from(microlearningProgress)
    .where(and(
      eq(microlearningProgress.userId, auth.userId),
      inArray(microlearningProgress.microlearningId, allMlIds),
    ));

  const progressMap = new Map(progressRows.map((p) => [p.microlearningId, p]));

  // ── 5. Lazy expiry: update stale active records ────────────────────────────

  const now = Date.now();
  const toExpire = progressRows.filter(
    (p) => p.status === 'active' && now - new Date(p.openedAt).getTime() > INACTIVITY_WINDOW_MS,
  );

  if (toExpire.length > 0) {
    const expiredAt = new Date();
    await db
      .update(microlearningProgress)
      .set({ status: 'expired', expiredAt })
      .where(inArray(microlearningProgress.id, toExpire.map((p) => p.id)));

    for (const p of toExpire) {
      progressMap.set(p.microlearningId, { ...p, status: 'expired', expiredAt });
    }
  }

  // ── 6. Fetch supporting data (avatars, topics, sequence names) ─────────────

  const avatarIds = [...new Set(allMLs.map((m) => m.avatarId).filter(Boolean))] as string[];
  const topicIds = [...new Set(allMLs.map((m) => m.topicId).filter(Boolean))] as string[];

  const [avatarRows, topicRows, seqNameRows] = await Promise.all([
    avatarIds.length > 0
      ? db.select().from(avatars).where(inArray(avatars.id, avatarIds))
      : Promise.resolve([]),
    topicIds.length > 0
      ? db.select({ id: dnaTopics.id, name: dnaTopics.name })
          .from(dnaTopics)
          .where(inArray(dnaTopics.id, topicIds))
      : Promise.resolve([]),
    sequenceIds.length > 0
      ? db.select({ id: microlearningSequences.id, name: microlearningSequences.name })
          .from(microlearningSequences)
          .where(inArray(microlearningSequences.id, sequenceIds))
      : Promise.resolve([]),
  ]);

  const seqNameMap = new Map(seqNameRows.map((s) => [s.id, s.name]));

  // Helper to assemble a full ML detail object
  const buildItem = (ml: typeof allMLs[0], sequenceName: string | null) => ({
    ...ml,
    avatar: avatarRows.find((a) => a.id === ml.avatarId) ?? null,
    topic: topicRows.find((t) => t.id === ml.topicId) ?? null,
    progress: progressMap.get(ml.id) ?? null,
    sequenceName,
  });

  // ── 7. Classify MLs: active vs archive ────────────────────────────────────

  const active: ReturnType<typeof buildItem>[] = [];
  const archive: ReturnType<typeof buildItem>[] = [];

  // Group sequence MLs by sequenceId (order of sequenceIds preserves assignment order)
  const mlsBySequence = new Map<string, typeof seqMLs>();
  for (const ml of seqMLs) {
    if (!mlsBySequence.has(ml.sequenceId!)) mlsBySequence.set(ml.sequenceId!, []);
    mlsBySequence.get(ml.sequenceId!)!.push(ml);
  }

  for (const seqId of sequenceIds) {
    const mls = mlsBySequence.get(seqId) ?? [];
    const seqName = seqNameMap.get(seqId) ?? null;

    for (const ml of mls) {
      const progress = progressMap.get(ml.id) ?? null;

      if (progress === null || progress.status === 'active') {
        // First uncompleted/unexpired ML in this sequence → the current active one
        active.push(buildItem(ml, seqName));
        break; // strictly sequential: hide all subsequent MLs in this sequence
      } else {
        // completed or expired → goes to archive
        archive.push(buildItem(ml, seqName));
      }
    }
  }

  // Standalone (on-demand) MLs: always active, never archived
  for (const ml of standaloneMLs) {
    active.push(buildItem(ml, null));
  }

  return c.json({ active, archive });
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

  // Notify connected learners when an ML is published
  if (body.status === 'published') {
    broadcastFeedUpdate(auth.organizationId);
  }

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
