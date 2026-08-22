import { sign, verify } from 'hono/jwt';
import ms, { type StringValue } from 'ms';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { generateSessionId } from './crypto.js';
import type { JWTPayload } from '../types/auth.js';

/**
 * Generate a JWT token for a user.
 *
 * `expiresInHours` overrides the JWT_EXPIRATION default for a single token —
 * used by access-mode logins, which are deliberately short-lived because the
 * organizational ID they are based on is not a secret.
 */
export const generateToken = async (
  userId: string,
  role: 'admin' | 'user',
  organizationId: string,
  expiresInHours?: number
): Promise<{ token: string; jti: string; expiresAt: Date }> => {

  const jti = generateSessionId();
  const expiresInMs = expiresInHours !== undefined
    ? expiresInHours * 60 * 60 * 1000
    : ms(env.JWT_EXPIRATION as StringValue);

  if (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs) || expiresInMs <= 0) {

    throw new Error(`Invalid token expiration: ${expiresInHours ?? env.JWT_EXPIRATION}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(expiresInMs / 1000);

  const payload: JWTPayload = {
    sub: userId,
    jti,
    role,
    organizationId,
    aud: env.JWT_AUDIENCE,
    iat: now,
    exp,
    kind: 'user',
  };

  try {

    const token = await sign(payload, env.JWT_SECRET, env.JWT_ALGORITHM);

    return {
      token,
      jti,
      expiresAt: new Date(exp * 1000),
    };

  } catch (err) {

    logger.error({ err }, 'Failed to generate JWT token.');

    throw new Error('Token generation failed');
  }
}

/**
 * Generate a long-lived JWT for a service account (API key).
 * The JWT carries `kind: 'service'`, `sub: serviceAccountId`, `jti: apiKeyId`.
 * Caller is responsible for inserting the matching api_keys row.
 */
export const generateApiKey = async (
  serviceAccountId: string,
  apiKeyId: string,
  organizationId: string,
  expiresIn: StringValue
): Promise<{ token: string; expiresAt: Date }> => {

  const expiresInMs = ms(expiresIn);

  if (typeof expiresInMs !== 'number') {

    throw new Error(`Invalid expiresIn format: ${expiresIn}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(expiresInMs / 1000);

  const payload: JWTPayload = {
    sub: serviceAccountId,
    jti: apiKeyId,
    role: 'admin',
    organizationId,
    aud: env.JWT_AUDIENCE,
    iat: now,
    exp,
    kind: 'service',
  };

  try {

    const token = await sign(payload, env.JWT_SECRET, env.JWT_ALGORITHM);

    return {
      token,
      expiresAt: new Date(exp * 1000),
    };

  } catch (err) {

    logger.error({ err }, 'Failed to generate API key.');

    throw new Error('API key generation failed');
  }
}

/**
 * Verify a JWT token
 */
export const verifyToken = async (token: string): Promise<JWTPayload> => {

  try {

    const payload = await verify(token, env.JWT_SECRET, env.JWT_ALGORITHM);

    const aud = payload.aud;
    const isValidAud = Array.isArray(aud)
      ? aud.includes(env.JWT_AUDIENCE)
      : aud === env.JWT_AUDIENCE;

    if (!isValidAud) {
      throw new Error('Invalid audience');
    }

    return payload as JWTPayload;

  } catch (err) {

    logger.error({ err }, 'Failed to verify JWT token.');

    throw new Error('Invalid or expired token');
  }
}

