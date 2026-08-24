import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { loginWithPassword, loginWithToken, loginWithExternalId } from '../services/auth.js';
import { logger } from '../config/logger.js';
import { capture, EVENTS } from '../utils/analytics.js';

const auth = new Hono();

const loginSchema = z.union([
  z.object({ email: z.string().email(), password: z.string().min(8) }),
  z.object({ token: z.string().min(1) }),
  z.object({ externalId: z.string().trim().min(1).max(64) }),
]);

/**
 * POST /auth/login
 * Login mechanisms: email+password (admins), invite token, or organizational
 * ID (learners, access-mode organizations only).
 */
auth.post('/login', zValidator('json', loginSchema), async (c) => {

  try {

    const body = c.req.valid('json');
    const organization = c.get('organization');
    const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip');
    const userAgent = c.req.header('user-agent');

    if ('token' in body) {

      logger.debug('Processing token login...');

      const result = await loginWithToken(body.token, organization, ipAddress, userAgent);

      if (!result.success) {
        return c.json({ error: result.error }, 401);
      }

      if (result.user) {
        capture({
          distinctId: result.user.id,
          event: EVENTS.userLoggedIn,
          role: result.user.role,
          organizationId: result.user.organizationId,
          props: { login_method: 'token' },
        });
      }

      return c.json({ token: result.token, user: result.user });
    }

    if ('externalId' in body) {

      logger.debug('Processing access-mode ID login...');

      const result = await loginWithExternalId(body.externalId, organization, ipAddress, userAgent);

      if (!result.success) {
        return c.json({ error: result.error }, 401);
      }

      if (result.user) {
        capture({
          distinctId: result.user.id,
          event: EVENTS.userLoggedIn,
          role: result.user.role,
          organizationId: result.user.organizationId,
          props: { login_method: 'external_id' },
        });
      }

      return c.json({ token: result.token, user: result.user });
    }

    logger.debug({ email: body.email }, 'Processing email/password login...');

    const result = await loginWithPassword(body.email, body.password, organization, ipAddress, userAgent);

    if (!result.success) {
      return c.json({ error: result.error }, 401);
    }

    if (result.user) {
      capture({
        distinctId: result.user.id,
        event: EVENTS.userLoggedIn,
        role: result.user.role,
        organizationId: result.user.organizationId,
        props: { login_method: 'password' },
      });
    }

    return c.json({ token: result.token, user: result.user });

  } catch (err) {

    logger.error({ err }, 'Login endpoint error.');

    return c.json({ error: 'Internal server error' }, 500);
  }
})

export default auth;
