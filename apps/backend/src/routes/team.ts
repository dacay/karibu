import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc } from 'drizzle-orm';
import type { UserAuthContext } from '../types/auth.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { users, authTokens, userGroups, userGroupMembers } from '../db/schema.js';
import { hashPassword, generateLoginToken } from '../utils/crypto.js';
import { sendInvitationEmail, buildOrgUrl } from '../services/email.js';
import { logger } from '../config/logger.js';

const teamRouter = new Hono();

// All team routes require authentication
teamRouter.use('*', authMiddleware({ allowApiKey: true }));

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
      firstName: users.firstName,
      lastName: users.lastName,
      phoneNumber: users.phoneNumber,
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
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    phoneNumber: row.phoneNumber ?? null,
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

// Phone numbers are stored in E.164 format (e.g. +14155552671). An empty string
// is treated as "no phone number" so the field can be cleared from the UI.
const phoneNumberSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{1,14}$/, 'Phone number must be in E.164 format (e.g. +14155552671).')
    .nullable()
);

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

  const invited: { email: string; userId: string; link: string }[] = [];
  const alreadyExists: { email: string; userId: string; link: string }[] = [];
  const failed: string[] = [];

  for (const email of emailList) {

    try {

      // Check if user already exists in this organization
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.email, email),
            eq(users.organizationId, auth.organizationId)
          )
        )
        .limit(1);

      if (existing) {

        // Reuse the most recent auth token to build a sign-in link, or mint
        // one if none exist. Returning a link here unblocks integrations
        // (e.g. Teambridge) that need to reference the link regardless of
        // whether we just created the user or it already existed.
        const [latestToken] = await db
          .select({ token: authTokens.token })
          .from(authTokens)
          .where(eq(authTokens.userId, existing.id))
          .orderBy(desc(authTokens.createdAt))
          .limit(1);

        let token: string;
        if (latestToken) {
          token = latestToken.token;
        } else {
          token = generateLoginToken();
          const expiresAt = new Date();
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
          await db.insert(authTokens).values({ userId: existing.id, token, expiresAt });
        }

        alreadyExists.push({
          email,
          userId: existing.id,
          link: buildOrgUrl(organization.subdomain, '/', { token }),
        });
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

      // Send invitation email with an org-scoped sign-in link.
      // Skipped for service-token callers — integrations get the link in the
      // response and own delivery to the user.
      if (auth.kind !== 'service') {
        await sendInvitationEmail({
          to: email,
          organizationName: organization.name,
          subdomain: organization.subdomain,
          token,
        });
      }

      // Add user to "All Members" group, creating it first if needed
      let [allMembersGroup] = await db
        .select()
        .from(userGroups)
        .where(and(eq(userGroups.organizationId, auth.organizationId), eq(userGroups.isAll, true)))
        .limit(1);

      if (!allMembersGroup) {
        [allMembersGroup] = await db
          .insert(userGroups)
          .values({ organizationId: auth.organizationId, name: 'All Members', isAll: true })
          .returning();
      }

      await db.insert(userGroupMembers).values({ groupId: allMembersGroup.id, userId: newUser.id });

      invited.push({
        email,
        userId: newUser.id,
        link: buildOrgUrl(organization.subdomain, '/', { token }),
      });

      logger.debug({ email, userId: newUser.id, organizationId: auth.organizationId, emailSent: auth.kind !== 'service' }, 'User invited.');

    } catch (err) {

      logger.error({ err, email }, 'Failed to invite user.');

      failed.push(email);
    }
  }

  return c.json({ invited, alreadyExists, failed }, 201);
})

const inviteOneSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format.'),
  firstName: z.string().trim().max(100).nullable().optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  phoneNumber: phoneNumberSchema.optional(),
  sendEmail: z.boolean().optional().default(true),
});

/**
 * POST /team/invite-one
 * Invite a single user, capturing their name and phone number up front.
 * Only the email is required. When `sendEmail` is false, no invitation email is
 * sent — the caller is expected to share the returned sign-in link themselves.
 */
teamRouter.post('/invite-one', zValidator('json', inviteOneSchema), async (c) => {

  const auth = c.get('auth');
  const organization = c.get('organization');
  const { email, firstName, lastName, phoneNumber, sendEmail } = c.req.valid('json');

  // The caller can opt out of sending an email; service-token callers never
  // trigger emails (they own delivery via the returned link).
  const shouldSendEmail = sendEmail && auth.kind !== 'service';

  // Check if the user already exists in this organization
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.email, email),
        eq(users.organizationId, auth.organizationId)
      )
    )
    .limit(1);

  if (existing) {

    // Reuse the most recent token (or mint one) so we can always return a link
    const [latestToken] = await db
      .select({ token: authTokens.token })
      .from(authTokens)
      .where(eq(authTokens.userId, existing.id))
      .orderBy(desc(authTokens.createdAt))
      .limit(1);

    let token: string;
    if (latestToken) {
      token = latestToken.token;
    } else {
      token = generateLoginToken();
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      await db.insert(authTokens).values({ userId: existing.id, token, expiresAt });
    }

    if (shouldSendEmail) {
      await sendInvitationEmail({
        to: email,
        organizationName: organization.name,
        subdomain: organization.subdomain,
        token,
      });
    }

    return c.json({
      userId: existing.id,
      email,
      link: buildOrgUrl(organization.subdomain, '/', { token }),
      alreadyExisted: true,
      emailSent: shouldSendEmail,
    });
  }

  // Create user with a random unusable password and the provided profile fields
  const randomPassword = await hashPassword(generateLoginToken());

  const [newUser] = await db
    .insert(users)
    .values({
      email,
      password: randomPassword,
      role: 'user',
      organizationId: auth.organizationId,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      phoneNumber: phoneNumber ?? null,
    })
    .returning();

  // Create auth token (1-year expiry)
  const token = generateLoginToken();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await db.insert(authTokens).values({ userId: newUser.id, token, expiresAt });

  if (shouldSendEmail) {
    await sendInvitationEmail({
      to: email,
      organizationName: organization.name,
      subdomain: organization.subdomain,
      token,
    });
  }

  // Add user to "All Members" group, creating it first if needed
  let [allMembersGroup] = await db
    .select()
    .from(userGroups)
    .where(and(eq(userGroups.organizationId, auth.organizationId), eq(userGroups.isAll, true)))
    .limit(1);

  if (!allMembersGroup) {
    [allMembersGroup] = await db
      .insert(userGroups)
      .values({ organizationId: auth.organizationId, name: 'All Members', isAll: true })
      .returning();
  }

  await db.insert(userGroupMembers).values({ groupId: allMembersGroup.id, userId: newUser.id });

  logger.debug({ email, userId: newUser.id, organizationId: auth.organizationId, emailSent: shouldSendEmail }, 'User invited.');

  return c.json({
    userId: newUser.id,
    email,
    link: buildOrgUrl(organization.subdomain, '/', { token }),
    alreadyExisted: false,
    emailSent: shouldSendEmail,
  }, 201);
})

/**
 * GET /team/:userId/link
 * Return the sign-in link for a user so the admin can share it via another channel.
 */
teamRouter.get('/:userId/link', async (c) => {

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

  const link = buildOrgUrl(organization.subdomain, '/', { token: latestToken.token });

  return c.json({ link });
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

  logger.debug({ userId, email: user.email }, 'Invitation email resent.');

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

  logger.debug({ userId, email: user.email }, 'Auth token regenerated and invitation email sent.');

  return c.json({ success: true });
})

const updateUserSchema = z.object({
  firstName: z.string().trim().max(100).nullable(),
  lastName: z.string().trim().max(100).nullable(),
  phoneNumber: phoneNumberSchema.optional(),
});

/**
 * PATCH /team/:userId
 * Update a user's first name, last name, and phone number.
 * Admins can edit any non-admin user's profile.
 * An admin can only edit their own profile, not another admin's.
 */
teamRouter.patch('/:userId', zValidator('json', updateUserSchema), async (c) => {

  const auth = c.get('auth') as UserAuthContext;
  const userId = c.req.param('userId');
  const { firstName, lastName, phoneNumber } = c.req.valid('json');

  // Verify user belongs to this organization
  const [user] = await db
    .select({ id: users.id, role: users.role })
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

  // Admins can edit non-admin users, or their own profile.
  // They cannot edit another admin's profile.
  if (user.role === 'admin' && userId !== auth.userId) {

    return c.json({ error: 'Cannot edit another admin\'s profile.' }, 403);
  }

  // Only update phoneNumber when the key is provided, so callers that omit it
  // (e.g. older clients) leave the existing value untouched.
  const updates: { firstName: string | null; lastName: string | null; phoneNumber?: string | null } = {
    firstName: firstName ?? null,
    lastName: lastName ?? null,
  };

  if (phoneNumber !== undefined) {

    updates.phoneNumber = phoneNumber;
  }

  await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId));

  logger.debug({ userId, firstName, lastName, phoneNumber }, 'User profile updated.');

  return c.json({ success: true });
})

/**
 * DELETE /team/:userId
 * Remove a user from the organization. Cannot remove admin users.
 */
teamRouter.delete('/:userId', async (c) => {

  const auth = c.get('auth');
  const userId = c.req.param('userId');

  // Cannot remove yourself (service callers don't correspond to a user, so this only applies to humans)
  if (auth.kind === 'user' && userId === auth.userId) {

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

  logger.debug({ userId, email: user.email, organizationId: auth.organizationId }, 'User removed from organization.');

  return c.json({ success: true });
})

export default teamRouter;
