import { Hono } from 'hono';
import { eq, and, or, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth.js';
import type { UserAuthContext } from '../types/auth.js';
import { db } from '../db/index.js';
import { users, avatars, organizations, LANGUAGE_CODES, FONT_SIZES } from '../db/schema.js';
import { logger } from '../config/logger.js';

const userRouter = new Hono();

userRouter.use('*', authMiddleware());

/**
 * GET /user/me
 * Returns the current authenticated user's profile including avatar preference.
 */
userRouter.get('/me', async (c) => {

  const auth = c.get('auth') as UserAuthContext;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      phoneNumber: users.phoneNumber,
      role: users.role,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      preferredAvatarId: users.preferredAvatarId,
      language: users.language,
      fontSize: users.fontSize,
      onboardingCompletedAt: users.onboardingCompletedAt,
      defaultAvatarId: organizations.defaultAvatarId,
    })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!row) {
    return c.json({ error: 'User not found.' }, 404);
  }

  return c.json({ user: row });
});

const updatePreferencesSchema = z.object({
  preferredAvatarId: z.string().uuid().nullable().optional(),
  language: z.enum(LANGUAGE_CODES).optional(),
  fontSize: z.enum(FONT_SIZES).optional(),
}).refine(
  (body) =>
    body.preferredAvatarId !== undefined ||
    body.language !== undefined ||
    body.fontSize !== undefined,
  { message: 'At least one preference must be provided.' },
);

/**
 * PATCH /user/preferences
 * Update the current user's preferences (preferred avatar, language, and/or font size).
 * Body: { preferredAvatarId?: string | null, language?: 'en' | 'es', fontSize?: 'sm' | 'base' | 'lg' | 'xl' }
 */
userRouter.patch('/preferences', zValidator('json', updatePreferencesSchema), async (c) => {

  const auth = c.get('auth') as UserAuthContext;
  const { preferredAvatarId, language, fontSize } = c.req.valid('json');

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

  // Only update the fields that were provided.
  const updates: { preferredAvatarId?: string | null; language?: typeof language; fontSize?: typeof fontSize } = {};
  if (preferredAvatarId !== undefined) updates.preferredAvatarId = preferredAvatarId ?? null;
  if (language !== undefined) updates.language = language;
  if (fontSize !== undefined) updates.fontSize = fontSize;

  await db
    .update(users)
    .set(updates)
    .where(eq(users.id, auth.userId));

  // Re-query with org join so response includes defaultAvatarId
  const [updated] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      phoneNumber: users.phoneNumber,
      role: users.role,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      preferredAvatarId: users.preferredAvatarId,
      language: users.language,
      fontSize: users.fontSize,
      onboardingCompletedAt: users.onboardingCompletedAt,
      defaultAvatarId: organizations.defaultAvatarId,
    })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(eq(users.id, auth.userId))
    .limit(1);

  logger.debug({ userId: auth.userId, preferredAvatarId, language, fontSize }, 'User preferences updated.');

  return c.json({ user: updated });
});

/**
 * POST /user/onboarding/complete
 * Marks first-time onboarding as completed (or dismissed) for the current user.
 * Idempotent: only sets the timestamp the first time.
 */
userRouter.post('/onboarding/complete', async (c) => {

  const auth = c.get('auth') as UserAuthContext;

  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date() })
    .where(and(eq(users.id, auth.userId), isNull(users.onboardingCompletedAt)));

  return c.json({ success: true });
});

export default userRouter;
