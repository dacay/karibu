import { Hono } from 'hono';
import { eq, and, count } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { userGroups, userGroupMembers, users } from '../db/schema.js';
import { logger } from '../config/logger.js';

const userGroupsRouter = new Hono();

userGroupsRouter.use('*', authMiddleware());
userGroupsRouter.use('*', requireRole('admin'));

/**
 * GET /user-groups
 * List all groups for the org, including member count.
 */
userGroupsRouter.get('/', async (c) => {

  const auth = c.get('auth');

  const groups = await db
    .select({
      id: userGroups.id,
      organizationId: userGroups.organizationId,
      name: userGroups.name,
      isAll: userGroups.isAll,
      createdAt: userGroups.createdAt,
      memberCount: count(userGroupMembers.id),
    })
    .from(userGroups)
    .leftJoin(userGroupMembers, eq(userGroupMembers.groupId, userGroups.id))
    .where(eq(userGroups.organizationId, auth.organizationId))
    .groupBy(userGroups.id);

  return c.json({ groups });
});

/**
 * POST /user-groups
 * Create a new group.
 */
userGroupsRouter.post('/', async (c) => {

  const auth = c.get('auth');
  const body = await c.req.json<{ name: string }>();

  if (!body.name?.trim()) {
    return c.json({ error: 'Name is required.' }, 400);
  }

  const [group] = await db
    .insert(userGroups)
    .values({
      organizationId: auth.organizationId,
      name: body.name.trim(),
      isAll: false,
    })
    .returning();

  logger.info({ groupId: group.id, organizationId: auth.organizationId }, 'User group created.');

  return c.json({ group: { ...group, memberCount: 0 } }, 201);
});

/**
 * PATCH /user-groups/:id
 * Rename a group (cannot rename the "All Members" group).
 */
userGroupsRouter.patch('/:id', async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ name: string }>();

  const [existing] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, id), eq(userGroups.organizationId, auth.organizationId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Group not found.' }, 404);
  }

  if (existing.isAll) {
    return c.json({ error: 'Cannot rename the All Members group.' }, 400);
  }

  if (!body.name?.trim()) {
    return c.json({ error: 'Name is required.' }, 400);
  }

  const [updated] = await db
    .update(userGroups)
    .set({ name: body.name.trim() })
    .where(eq(userGroups.id, id))
    .returning();

  return c.json({ group: updated });
});

/**
 * DELETE /user-groups/:id
 * Delete a group (cannot delete "All Members").
 */
userGroupsRouter.delete('/:id', async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [existing] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, id), eq(userGroups.organizationId, auth.organizationId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Group not found.' }, 404);
  }

  if (existing.isAll) {
    return c.json({ error: 'Cannot delete the All Members group.' }, 400);
  }

  await db.delete(userGroups).where(eq(userGroups.id, id));

  logger.info({ groupId: id, organizationId: auth.organizationId }, 'User group deleted.');

  return c.json({ success: true });
});

/**
 * GET /user-groups/:id/members
 * List members of a group.
 */
userGroupsRouter.get('/:id/members', async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [group] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, id), eq(userGroups.organizationId, auth.organizationId)))
    .limit(1);

  if (!group) {
    return c.json({ error: 'Group not found.' }, 404);
  }

  const members = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      membershipId: userGroupMembers.id,
    })
    .from(userGroupMembers)
    .innerJoin(users, eq(users.id, userGroupMembers.userId))
    .where(eq(userGroupMembers.groupId, id));

  return c.json({ members });
});

/**
 * POST /user-groups/:id/members
 * Add user(s) to a group. Body: { userIds: string[] }
 */
userGroupsRouter.post('/:id/members', async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const body = await c.req.json<{ userIds: string[] }>();

  if (!Array.isArray(body.userIds) || body.userIds.length === 0) {
    return c.json({ error: 'userIds must be a non-empty array.' }, 400);
  }

  const [group] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, id), eq(userGroups.organizationId, auth.organizationId)))
    .limit(1);

  if (!group) {
    return c.json({ error: 'Group not found.' }, 404);
  }

  // Insert members, ignoring duplicates by checking first
  const added: string[] = [];
  for (const userId of body.userIds) {
    const [existing] = await db
      .select({ id: userGroupMembers.id })
      .from(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, id), eq(userGroupMembers.userId, userId)))
      .limit(1);

    if (!existing) {
      await db.insert(userGroupMembers).values({ groupId: id, userId });
      added.push(userId);
    }
  }

  return c.json({ added }, 201);
});

/**
 * DELETE /user-groups/:id/members/:userId
 * Remove a user from a group.
 */
userGroupsRouter.delete('/:id/members/:userId', async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');
  const userId = c.req.param('userId');

  const [group] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.id, id), eq(userGroups.organizationId, auth.organizationId)))
    .limit(1);

  if (!group) {
    return c.json({ error: 'Group not found.' }, 404);
  }

  await db
    .delete(userGroupMembers)
    .where(and(eq(userGroupMembers.groupId, id), eq(userGroupMembers.userId, userId)));

  return c.json({ success: true });
});

export default userGroupsRouter;
