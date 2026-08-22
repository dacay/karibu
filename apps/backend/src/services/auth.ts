import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, authSessions, authTokens, apiKeys, serviceAccounts } from '../db/schema.js';
import { verifyPassword } from '../utils/crypto.js';
import { generateToken } from '../utils/jwt.js';
import { LRUCache } from '../utils/cache.js';
import { logger } from '../config/logger.js';
import type { Organization } from '../types/auth.js';

const sessionValidityCache = new LRUCache<string, boolean>(10_000);

interface LoadedApiKey {
  apiKeyId: string;
  serviceAccountId: string;
  organizationId: string;
}

const apiKeyCache = new LRUCache<string, LoadedApiKey | null>(10_000);

export interface LoginResult {

  success: boolean;
  token?: string;
  user?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: 'admin' | 'user';
    organizationId: string;
    organizationName: string;
  };
  error?: string;
}

/**
 * Authenticate user with email and password
 */
export const loginWithPassword = async (
  email: string,
  password: string,
  organization: Organization,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> => {

  try {

    // Find user by email and organization
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.organizationId, organization.id)
        )
      )
      .limit(1);

    if (!user) {

      logger.debug({ email, organizationId: organization.id }, 'Login attempt with invalid email or wrong organization.');

      return { success: false, error: 'Invalid email or password' };
    }

    // Only admin users can log in with email/password
    if (user.role !== 'admin') {

      logger.debug({ userId: user.id, email }, 'Login attempt by non-admin user via email/password.');

      return { success: false, error: 'Invalid email or password' };
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {

      logger.debug({ userId: user.id, email }, 'Login attempt with invalid password.');

      return { success: false, error: 'Invalid email or password' };
    }

    // Generate JWT token
    const { token, jti, expiresAt } = await generateToken(
      user.id,
      user.role,
      organization.id
    );

    // Create session record
    await db.insert(authSessions).values({
      id: jti,
      userId: user.id,
      expiresAt,
      ipAddress,
      userAgent,
    });

    logger.debug({ userId: user.id, email }, 'User logged in successfully.');

    return {

      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: organization.id,
        organizationName: organization.name,
      },
    };

  } catch (err) {

    logger.debug({ err, email }, 'Login with password failed.');

    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * Authenticate user with login token
 */
export const loginWithToken = async (
  token: string,
  organization: Organization,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> => {

  try {

    // Find valid login token belonging to a user in this organization
    const [loginToken] = await db
      .select({ authTokens })
      .from(authTokens)
      .innerJoin(users, eq(authTokens.userId, users.id))
      .where(
        and(
          eq(authTokens.token, token),
          eq(users.organizationId, organization.id)
        )
      )
      .limit(1)
      .then((rows) => rows.map((r) => r.authTokens));

    if (!loginToken) {

      logger.debug({ token: token.substring(0, 8) + '...' }, 'Login attempt with invalid or cross-organization token.');

      return { success: false, error: 'Invalid or expired token' };
    }

    // Check if token is expired
    if (loginToken.expiresAt < new Date()) {

      logger.debug({ tokenId: loginToken.id }, 'Login attempt with expired token.');

      return { success: false, error: 'Invalid or expired token' };
    }

    // Track last use
    await db
      .update(authTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(authTokens.id, loginToken.id));

    // Find user by ID and organization
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, loginToken.userId),
          eq(users.organizationId, organization.id)
        )
      )
      .limit(1);

    if (!user) {

      logger.debug({ userId: loginToken.userId, organizationId: organization.id }, 'User not found for valid login token.');

      return { success: false, error: 'Authentication failed' };
    }

    // Generate JWT token
    const { token: jwtToken, jti, expiresAt } = await generateToken(
      user.id,
      user.role,
      organization.id
    );

    // Create session record
    await db.insert(authSessions).values({
      id: jti,
      userId: user.id,
      expiresAt,
      ipAddress,
      userAgent,
    });

    logger.debug({ userId: user.id, email: user.email }, 'User logged in with token successfully.');

    return {

      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: organization.id,
        organizationName: organization.name,
      },
    };

  } catch (err) {

    logger.error({ err }, 'Login with token failed.');

    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * Canonical form of an organization-issued ID: trimmed and upper-cased.
 * Applied on write (admin entry) and on lookup (access login) so the unique
 * constraint and the login comparison agree, and so case never blocks a learner.
 */
export const normalizeExternalId = (externalId: string): string => {

  return externalId.trim().toUpperCase();
}

/**
 * Authenticate a learner with nothing but their organization-issued ID.
 *
 * Only available to organizations running access mode. The ID is not a secret,
 * so this is intentionally narrow: the org must have the flag on, the ID must
 * already belong to a provisioned learner (no accounts are created here), and
 * admins are excluded — an admin console is never reachable without a password.
 * The resulting session is short-lived (organizations.access_session_hours).
 */
export const loginWithExternalId = async (
  externalId: string,
  organization: Organization,
  ipAddress?: string,
  userAgent?: string
): Promise<LoginResult> => {

  try {

    if (!organization.accessModeEnabled) {

      logger.debug({ organizationId: organization.id }, 'Access login attempted on an organization without access mode.');

      return { success: false, error: 'Not available' };
    }

    // IDs are stored normalized (trimmed, upper-cased) so a learner typing
    // theirs in either case still matches — see normalizeExternalId.
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.externalId, normalizeExternalId(externalId)),
          eq(users.organizationId, organization.id)
        )
      )
      .limit(1);

    if (!user) {

      logger.debug({ organizationId: organization.id }, 'Access login attempt with an unknown ID.');

      return { success: false, error: 'ID not recognized' };
    }

    // Admins keep their password login — an ID alone must never open the admin console.
    if (user.role !== 'user') {

      logger.debug({ userId: user.id }, 'Access login attempt by a non-learner account.');

      return { success: false, error: 'ID not recognized' };
    }

    const { token, jti, expiresAt } = await generateToken(
      user.id,
      user.role,
      organization.id,
      organization.accessSessionHours
    );

    await db.insert(authSessions).values({
      id: jti,
      userId: user.id,
      expiresAt,
      ipAddress,
      userAgent,
    });

    logger.debug({ userId: user.id, organizationId: organization.id, expiresAt }, 'Learner logged in with an organizational ID.');

    return {

      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: organization.id,
        organizationName: organization.name,
      },
    };

  } catch (err) {

    logger.error({ err }, 'Login with external ID failed.');

    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * Check if a JWT session is valid (not revoked).
 * Caches the result (valid or invalid) by jti; on cache miss we hit the DB.
 */
export const isSessionValid = async (jti: string): Promise<boolean> => {

  const cached = sessionValidityCache.get(jti);

  if (cached !== undefined) {

    return cached;
  }

  try {

    const [session] = await db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.id, jti),
          isNull(authSessions.revokedAt)
        )
      )
      .limit(1);

    const valid = !!session && session.expiresAt > new Date();

    sessionValidityCache.set(jti, valid);

    return valid;

  } catch (err) {

    logger.error({ err, jti }, 'Failed to validate session.');

    return false;
  }
}

/**
 * Revoke a session (logout)
 */
export const revokeSession = async (jti: string): Promise<boolean> => {

  try {

    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, jti));

    sessionValidityCache.set(jti, false);

    logger.debug({ jti }, 'Session revoked.');

    return true;

  } catch (err) {

    logger.error({ err, jti }, 'Failed to revoke session.');

    return false;
  }
}

/**
 * Load a valid (non-revoked, non-expired) api_key joined to its service_account.
 * Returns null if missing, revoked, or expired. Cached by api key id.
 */
export const loadApiKey = async (apiKeyId: string): Promise<LoadedApiKey | null> => {

  const cached = apiKeyCache.get(apiKeyId);

  if (cached !== undefined) {

    return cached;
  }

  try {

    const [row] = await db
      .select({
        apiKeyId: apiKeys.id,
        serviceAccountId: serviceAccounts.id,
        organizationId: serviceAccounts.organizationId,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .innerJoin(serviceAccounts, eq(apiKeys.serviceAccountId, serviceAccounts.id))
      .where(
        and(
          eq(apiKeys.id, apiKeyId),
          isNull(apiKeys.revokedAt)
        )
      )
      .limit(1);

    const result: LoadedApiKey | null =
      row && row.expiresAt > new Date()
        ? {
            apiKeyId: row.apiKeyId,
            serviceAccountId: row.serviceAccountId,
            organizationId: row.organizationId,
          }
        : null;

    apiKeyCache.set(apiKeyId, result);

    return result;

  } catch (err) {

    logger.error({ err, apiKeyId }, 'Failed to load api key.');

    return null;
  }
}

/**
 * Revoke an API key.
 */
export const revokeApiKey = async (apiKeyId: string): Promise<boolean> => {

  try {

    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, apiKeyId));

    apiKeyCache.set(apiKeyId, null);

    logger.debug({ apiKeyId }, 'API key revoked.');

    return true;

  } catch (err) {

    logger.error({ err, apiKeyId }, 'Failed to revoke API key.');

    return false;
  }
}

/**
 * Best-effort update of api_keys.last_used_at. Fire-and-forget — do not block requests on this.
 */
export const touchApiKeyLastUsed = (apiKeyId: string): void => {

  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKeyId))
    .catch((err) => {

      logger.debug({ err, apiKeyId }, 'Failed to touch api_key.last_used_at.');
    });
}
