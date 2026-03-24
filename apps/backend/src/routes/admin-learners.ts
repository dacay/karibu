import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db, sql as rawSql } from '../db/index.js';
import { users, chats, chatMessages } from '../db/schema.js';

const adminLearnersRouter = new Hono();

adminLearnersRouter.use('*', authMiddleware());
adminLearnersRouter.use('*', requireRole('admin'));

/**
 * GET /admin/learners
 * List all non-admin users with aggregated stats.
 */
adminLearnersRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const orgId = auth.organizationId;

  const rows = await rawSql<Array<{
    id: string;
    email: string;
    created_at: string;
    completed_count: string;
    active_count: string;
    chat_count: string;
    last_active: string | null;
  }>>`
    SELECT
      u.id,
      u.email,
      u.created_at,
      COALESCE(p.completed_count, 0)::text AS completed_count,
      COALESCE(p.active_count, 0)::text AS active_count,
      COALESCE(ch.chat_count, 0)::text AS chat_count,
      ch.last_active
    FROM users u
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
        COUNT(*) FILTER (WHERE status = 'active') AS active_count
      FROM microlearning_progress
      GROUP BY user_id
    ) p ON p.user_id = u.id
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*) AS chat_count,
        MAX(updated_at) AS last_active
      FROM chats
      WHERE organization_id = ${orgId}
      GROUP BY user_id
    ) ch ON ch.user_id = u.id
    WHERE u.organization_id = ${orgId}
      AND u.role = 'user'
    ORDER BY u.email ASC
  `;

  const learners = rows.map((r) => ({
    id: r.id,
    email: r.email,
    createdAt: r.created_at,
    completedCount: parseInt(r.completed_count, 10),
    activeCount: parseInt(r.active_count, 10),
    chatCount: parseInt(r.chat_count, 10),
    lastActive: r.last_active,
  }));

  return c.json({ learners });
});

/**
 * GET /admin/learners/:userId/history
 * Microlearning progress records for a specific user.
 */
adminLearnersRouter.get('/:userId/history', async (c) => {
  const auth = c.get('auth');
  const userId = c.req.param('userId');

  // Verify user belongs to this org
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, auth.organizationId)))
    .limit(1);

  if (!user) {
    return c.json({ error: 'User not found.' }, 404);
  }

  const rows = await rawSql<Array<{
    id: string;
    microlearning_id: string;
    title: string;
    status: string;
    opened_at: string;
    completed_at: string | null;
    expired_at: string | null;
  }>>`
    SELECT
      mp.id,
      mp.microlearning_id,
      m.title,
      mp.status,
      mp.opened_at,
      mp.completed_at,
      mp.expired_at
    FROM microlearning_progress mp
    JOIN microlearnings m ON m.id = mp.microlearning_id
    WHERE mp.user_id = ${userId}
    ORDER BY mp.opened_at DESC
  `;

  const history = rows.map((r) => ({
    id: r.id,
    microlearningId: r.microlearning_id,
    title: r.title,
    status: r.status,
    openedAt: r.opened_at,
    completedAt: r.completed_at,
    expiredAt: r.expired_at,
  }));

  return c.json({ history });
});

/**
 * GET /admin/learners/:userId/chats
 * List all chat sessions for a user (both ML and discussion).
 */
adminLearnersRouter.get('/:userId/chats', async (c) => {
  const auth = c.get('auth');
  const userId = c.req.param('userId');

  // Verify user belongs to this org
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, auth.organizationId)))
    .limit(1);

  if (!user) {
    return c.json({ error: 'User not found.' }, 404);
  }

  const rows = await rawSql<Array<{
    id: string;
    type: string;
    microlearning_id: string | null;
    ml_title: string | null;
    message_count: string;
    created_at: string;
    updated_at: string;
  }>>`
    SELECT
      c.id,
      c.type,
      c.microlearning_id,
      m.title AS ml_title,
      COUNT(cm.id)::text AS message_count,
      c.created_at,
      c.updated_at
    FROM chats c
    LEFT JOIN microlearnings m ON m.id = c.microlearning_id
    LEFT JOIN chat_messages cm ON cm.chat_id = c.id
    WHERE c.user_id = ${userId}
      AND c.organization_id = ${auth.organizationId}
    GROUP BY c.id, c.type, c.microlearning_id, m.title, c.created_at, c.updated_at
    ORDER BY c.updated_at DESC
  `;

  const chatSessions = rows.map((r) => ({
    id: r.id,
    type: r.type,
    microlearningId: r.microlearning_id,
    microlearningTitle: r.ml_title,
    messageCount: parseInt(r.message_count, 10),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return c.json({ chats: chatSessions });
});

/**
 * GET /admin/learners/:userId/chats/:chatId
 * Full transcript of a specific chat session.
 */
adminLearnersRouter.get('/:userId/chats/:chatId', async (c) => {
  const auth = c.get('auth');
  const userId = c.req.param('userId');
  const chatId = c.req.param('chatId');

  // Verify chat belongs to this user and org
  const [chat] = await db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.id, chatId),
        eq(chats.userId, userId),
        eq(chats.organizationId, auth.organizationId)
      )
    )
    .limit(1);

  if (!chat) {
    return c.json({ error: 'Chat not found.' }, 404);
  }

  const messages = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      parts: chatMessages.parts,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(chatMessages.createdAt);

  return c.json({
    chat: {
      id: chat.id,
      type: chat.type,
      microlearningId: chat.microlearningId,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
    messages,
  });
});

export default adminLearnersRouter;
