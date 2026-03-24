import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { verifyToken } from '../utils/jwt.js';
import { isSessionValid } from '../services/auth.js';
import { logger } from '../config/logger.js';
import type { AuthContext } from '../types/auth.js';

// In-memory registry: orgId → Set of send-event functions
const connections = new Map<string, Set<() => void>>();

/**
 * Broadcast a feed:updated event to all connected learners in an organization.
 * Called from other routes when MLs are published or sequences are assigned.
 */
export function broadcastFeedUpdate(orgId: string): void {
  const senders = connections.get(orgId);
  if (!senders || senders.size === 0) return;
  logger.debug({ orgId, count: senders.size }, 'Broadcasting feed:updated to SSE connections.');
  senders.forEach((send) => send());
}

const learnerSSERouter = new Hono();

/**
 * GET /learner/stream
 * Server-Sent Events endpoint for real-time learner feed updates.
 * Authenticates via ?token= query param since EventSource doesn't support custom headers.
 */
learnerSSERouter.get('/stream', async (c) => {

  // EventSource can't send headers, so we accept the JWT as a query param
  const token = c.req.query('token');
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let auth: AuthContext;
  try {
    const payload = await verifyToken(token);
    if (!payload.jti) throw new Error('Missing jti');
    const isValid = await isSessionValid(payload.jti);
    if (!isValid) throw new Error('Session invalid or revoked');
    auth = {
      userId: payload.sub,
      organizationId: payload.organizationId,
      sessionId: payload.jti,
      role: payload.role,
    } satisfies AuthContext;
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { userId, organizationId: orgId } = auth;

  return streamSSE(c, async (stream) => {

    // Fire-and-forget sender registered with the org's connection set
    const sendFeedUpdate = () => {
      stream.writeSSE({ event: 'feed:updated', data: '' }).catch(() => {});
    };

    if (!connections.has(orgId)) connections.set(orgId, new Set());
    connections.get(orgId)!.add(sendFeedUpdate);
    logger.debug({ userId, orgId }, 'SSE connection opened.');

    try {
      await stream.writeSSE({ event: 'connected', data: '' });
      // Heartbeats keep the TCP connection alive and detect client disconnects
      while (true) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: 'heartbeat', data: '' });
      }
    } finally {
      connections.get(orgId)?.delete(sendFeedUpdate);
      if (connections.get(orgId)?.size === 0) connections.delete(orgId);
      logger.debug({ userId, orgId }, 'SSE connection closed.');
    }
  });
});

export default learnerSSERouter;
