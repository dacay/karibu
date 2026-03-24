import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc, count } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { flaggedMessages, chatMessages, chats, users, microlearnings } from '../db/schema.js';
import { logger } from '../config/logger.js';

const flagsRouter = new Hono();

// All flag routes require authentication
flagsRouter.use('*', authMiddleware());

/**
 * POST /flags
 * Flag a message as potentially incorrect. Authenticated users only.
 */
flagsRouter.post(
  '/',
  zValidator('json', z.object({
    messageId: z.string().min(1),
    chatId: z.string().min(1),
    reason: z.string().max(500).optional(),
  })),
  async (c) => {
    const auth = c.get('auth');
    const { messageId, chatId, reason } = c.req.valid('json');

    // Verify the message belongs to this org
    const [message] = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .innerJoin(chats, eq(chats.id, chatMessages.chatId))
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chats.organizationId, auth.organizationId),
        )
      )
      .limit(1);

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    const [flag] = await db
      .insert(flaggedMessages)
      .values({
        messageId,
        chatId,
        flaggedBy: auth.userId,
        organizationId: auth.organizationId,
        reason: reason ?? null,
      })
      .returning();

    logger.info({ flagId: flag.id, messageId, orgId: auth.organizationId }, 'Message flagged.');

    return c.json({ flag }, 201);
  }
);

/**
 * GET /flags/count
 * Returns count of open flags for this organization (admin only).
 */
flagsRouter.get('/count', requireRole('admin'), async (c) => {
  const auth = c.get('auth');

  const [row] = await db
    .select({ count: count() })
    .from(flaggedMessages)
    .where(
      and(
        eq(flaggedMessages.organizationId, auth.organizationId),
        eq(flaggedMessages.status, 'open'),
      )
    );

  return c.json({ count: row?.count ?? 0 });
});

/**
 * GET /flags
 * List all flagged messages for this organization with context (admin only).
 */
flagsRouter.get('/', requireRole('admin'), async (c) => {
  const auth = c.get('auth');

  const rows = await db
    .select({
      id: flaggedMessages.id,
      messageId: flaggedMessages.messageId,
      chatId: flaggedMessages.chatId,
      reason: flaggedMessages.reason,
      status: flaggedMessages.status,
      createdAt: flaggedMessages.createdAt,
      updatedAt: flaggedMessages.updatedAt,
      // flagged by user
      flaggedByEmail: users.email,
      // the message itself
      messageRole: chatMessages.role,
      messageParts: chatMessages.parts,
      messageCreatedAt: chatMessages.createdAt,
      // chat details
      chatType: chats.type,
      microlearningId: chats.microlearningId,
    })
    .from(flaggedMessages)
    .innerJoin(chatMessages, eq(chatMessages.id, flaggedMessages.messageId))
    .innerJoin(chats, eq(chats.id, flaggedMessages.chatId))
    .innerJoin(users, eq(users.id, flaggedMessages.flaggedBy))
    .where(eq(flaggedMessages.organizationId, auth.organizationId))
    .orderBy(desc(flaggedMessages.createdAt));

  // Fetch microlearning titles for ML chats
  const mlIds = [...new Set(rows.filter((r) => r.microlearningId).map((r) => r.microlearningId as string))];
  const mlMap: Record<string, string> = {};

  if (mlIds.length > 0) {
    const mls = await db
      .select({ id: microlearnings.id, title: microlearnings.title })
      .from(microlearnings)
      .where(eq(microlearnings.organizationId, auth.organizationId));
    for (const ml of mls) {
      mlMap[ml.id] = ml.title;
    }
  }

  const result = rows.map((r) => ({
    id: r.id,
    messageId: r.messageId,
    chatId: r.chatId,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    flaggedByEmail: r.flaggedByEmail,
    message: {
      role: r.messageRole,
      parts: r.messageParts,
      createdAt: r.messageCreatedAt,
    },
    chat: {
      type: r.chatType,
      microlearningId: r.microlearningId,
      microlearningTitle: r.microlearningId ? (mlMap[r.microlearningId] ?? null) : null,
    },
  }));

  return c.json({ flags: result });
});

/**
 * PATCH /flags/:id/status
 * Update flag status: reviewed or dismissed (admin only).
 */
flagsRouter.patch(
  '/:id/status',
  requireRole('admin'),
  zValidator('json', z.object({
    status: z.enum(['reviewed', 'dismissed']),
  })),
  async (c) => {
    const auth = c.get('auth');
    const { id } = c.req.param();
    const { status } = c.req.valid('json');

    const [updated] = await db
      .update(flaggedMessages)
      .set({ status })
      .where(
        and(
          eq(flaggedMessages.id, id),
          eq(flaggedMessages.organizationId, auth.organizationId),
        )
      )
      .returning();

    if (!updated) {
      return c.json({ error: 'Flag not found' }, 404);
    }

    logger.info({ flagId: id, status, orgId: auth.organizationId }, 'Flag status updated.');

    return c.json({ flag: updated });
  }
);

export default flagsRouter;
