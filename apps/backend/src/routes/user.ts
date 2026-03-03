import { Hono } from 'hono';
import { eq, and, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users, avatars } from '../db/schema.js';
import { logger } from '../config/logger.js';

const userRouter = new Hono();

userRouter.use('*', authMiddleware());

/**
 * GET /user/me
 * Returns the current authenticated user's profile including avatar preference.
 */
userRouter.get('/me', async (c) => {

  const auth = c.get('auth');

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      organizationId: users.organizationId,
      preferredAvatarId: users.preferredAvatarId,
    })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: 'User not found.' }, 404);
  }

  return c.json({ user });
});

const updatePreferencesSchema = z.object({
  preferredAvatarId: z.string().uuid().nullable(),
});

/**
 * PATCH /user/preferences
 * Update the current user's preferences (e.g. preferred avatar).
 * Body: { preferredAvatarId: string | null }
 */
userRouter.patch('/preferences', zValidator('json', updatePreferencesSchema), async (c) => {

  const auth = c.get('auth');
  const { preferredAvatarId } = c.req.valid('json');

  // Validate the avatar belongs to this org (or is a built-in avatar)
  if (preferredAvatarId) {

    const [avatar] = await db
      .select({ id: avatars.id })
      .from(avatars)
      .where(
        and(
          eq(avatars.id, preferredAvatarId),
          or(
            isNull(avatars.organizationId),
            eq(avatars.organizationId, auth.organizationId),
          )
        )
      )
      .limit(1);

    if (!avatar) {
      return c.json({ error: 'Avatar not found.' }, 404);
    }
  }

  const [updated] = await db
    .update(users)
    .set({ preferredAvatarId: preferredAvatarId ?? null })
    .where(eq(users.id, auth.userId))
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
      organizationId: users.organizationId,
      preferredAvatarId: users.preferredAvatarId,
    });

  logger.info({ userId: auth.userId, preferredAvatarId }, 'User avatar preference updated.');

  return c.json({ user: updated });
});

export default userRouter;
