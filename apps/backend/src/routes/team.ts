import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users, authTokens } from '../db/schema.js';
import { hashPassword, generateLoginToken } from '../utils/crypto.js';
import { sendInvitationEmail } from '../services/email.js';
import { logger } from '../config/logger.js';

const teamRouter = new Hono();

// All team routes require authentication
teamRouter.use('*', authMiddleware());

// All team routes are admin-only
teamRouter.use('*', requireRole('admin'));

/**
 * GET /team
 * List all users in the current organization.
 * Returns admins (labeled) and regular users with their invitation status.
 */
teamRouter.get('/', async (c) => {

  const auth = c.get('auth');

  const members = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      tokenId: authTokens.id,
      tokenCreatedAt: authTokens.createdAt,
      tokenLastUsedAt: authTokens.lastUsedAt,
      tokenExpiresAt: authTokens.expiresAt,
    })
    .from(users)
    .leftJoin(authTokens, eq(authTokens.userId, users.id))
    .where(eq(users.organizationId, auth.organizationId))
    .orderBy(desc(users.createdAt));

  // De-duplicate: a user may have multiple tokens; keep the most recently created one
  const seen = new Set<string>();
  const deduplicated = members.filter((row) => {

    if (seen.has(row.id)) return false;

    seen.add(row.id);

    return true;
  });

  const result = deduplicated.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    hasToken: !!row.tokenId,
    tokenCreatedAt: row.tokenCreatedAt ?? null,
    tokenLastUsedAt: row.tokenLastUsedAt ?? null,
    tokenExpired: row.tokenExpiresAt ? row.tokenExpiresAt < new Date() : null,
  }));

  return c.json({ users: result });
})

const inviteSchema = z.object({
  emails: z.string().min(1),
});

/**
 * POST /team/invite
 * Invite users by providing a comma-separated list of emails.
 * Creates user accounts with random passwords and auth tokens, then sends invitation emails.
 * If a user already exists in this organization, they are skipped.
 */
teamRouter.post('/invite', zValidator('json', inviteSchema), async (c) => {

  const auth = c.get('auth');
  const organization = c.get('organization');
  const { emails: rawEmails } = c.req.valid('json');

  const emailList = rawEmails
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  if (emailList.length === 0) {

    return c.json({ error: 'No valid emails provided.' }, 400);
  }

  // Validate each email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = emailList.filter((e) => !emailRegex.test(e));

  if (invalidEmails.length > 0) {

    return c.json({ error: `Invalid email format: ${invalidEmails.join(', ')}` }, 400);
  }

  const invited: string[] = [];
  const alreadyExists: string[] = [];
  const failed: string[] = [];

  for (const email of emailList) {

    try {

      // Check if user already exists (globally unique email)
      const [existing] = await db
        .select({ id: users.id, organizationId: users.organizationId })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {

        if (existing.organizationId === auth.organizationId) {

          alreadyExists.push(email);

        } else {

          // Email belongs to a different organization
          failed.push(email);
          logger.warn({ email, requestingOrgId: auth.organizationId }, 'Invite failed: email exists in another organization.');
        }

        continue;
      }

      // Create user with a random unusable password
      const randomPassword = await hashPassword(generateLoginToken());

      const [newUser] = await db
        .insert(users)
        .values({
          email,
          password: randomPassword,
          role: 'user',
          organizationId: auth.organizationId,
        })
        .returning();

      // Create auth token (1-year expiry)
      const token = generateLoginToken();
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      await db.insert(authTokens).values({
        userId: newUser.id,
        token,
        expiresAt,
      });

      // Send invitation email with an org-scoped sign-in link
      await sendInvitationEmail({
        to: email,
        organizationName: organization.name,
        subdomain: organization.subdomain,
        token,
      });

      invited.push(email);

      logger.info({ email, userId: newUser.id, organizationId: auth.organizationId }, 'User invited.');

    } catch (err) {

      logger.error({ err, email }, 'Failed to invite user.');

      failed.push(email);
    }
  }

  return c.json({ invited, alreadyExists, failed }, 201);
})

/**
 * POST /team/:userId/resend-invite
 * Resend the existing invitation email without regenerating the token.
 */
teamRouter.post('/:userId/resend-invite', async (c) => {

  const auth = c.get('auth');
  const organization = c.get('organization');
  const userId = c.req.param('userId');

  // Verify user belongs to this organization
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, auth.organizationId)
      )
    )
    .limit(1);

  if (!user) {

    return c.json({ error: 'User not found.' }, 404);
  }

  if (user.role === 'admin') {

    return c.json({ error: 'Cannot resend invite to admin users.' }, 400);
  }

  // Find the most recent auth token for this user
  const [latestToken] = await db
    .select()
    .from(authTokens)
    .where(eq(authTokens.userId, userId))
    .orderBy(desc(authTokens.createdAt))
    .limit(1);

  if (!latestToken) {

    return c.json({ error: 'No invitation token found for this user.' }, 404);
  }

  await sendInvitationEmail({
    to: user.email,
    organizationName: organization.name,
    subdomain: organization.subdomain,
    token: latestToken.token,
  });

  logger.info({ userId, email: user.email }, 'Invitation email resent.');

  return c.json({ success: true });
})

/**
 * POST /team/:userId/regenerate-token
 * Delete the existing auth token, create a new one, and send a fresh invitation email.
 */
teamRouter.post('/:userId/regenerate-token', async (c) => {

  const auth = c.get('auth');
  const organization = c.get('organization');
  const userId = c.req.param('userId');

  // Verify user belongs to this organization
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, auth.organizationId)
      )
    )
    .limit(1);

  if (!user) {

    return c.json({ error: 'User not found.' }, 404);
  }

  if (user.role === 'admin') {

    return c.json({ error: 'Cannot regenerate token for admin users.' }, 400);
  }

  // Delete all existing tokens for this user
  await db.delete(authTokens).where(eq(authTokens.userId, userId));

  // Create a new token
  const token = generateLoginToken();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await db.insert(authTokens).values({
    userId,
    token,
    expiresAt,
  });

  // Send fresh invitation email
  await sendInvitationEmail({
    to: user.email,
    organizationName: organization.name,
    subdomain: organization.subdomain,
    token,
  });

  logger.info({ userId, email: user.email }, 'Auth token regenerated and invitation email sent.');

  return c.json({ success: true });
})

/**
 * DELETE /team/:userId
 * Remove a user from the organization. Cannot remove admin users.
 */
teamRouter.delete('/:userId', async (c) => {

  const auth = c.get('auth');
  const userId = c.req.param('userId');

  // Cannot remove yourself
  if (userId === auth.userId) {

    return c.json({ error: 'Cannot remove yourself.' }, 400);
  }

  // Verify user belongs to this organization
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, auth.organizationId)
      )
    )
    .limit(1);

  if (!user) {

    return c.json({ error: 'User not found.' }, 404);
  }

  if (user.role === 'admin') {

    return c.json({ error: 'Cannot remove admin users.' }, 400);
  }

  await db.delete(users).where(eq(users.id, userId));

  logger.info({ userId, email: user.email, organizationId: auth.organizationId }, 'User removed from organization.');

  return c.json({ success: true });
})

export default teamRouter;
