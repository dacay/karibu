import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { LRUCache } from '../utils/cache.js';
import { logger } from '../config/logger.js';
import type { Organization } from '../types/auth.js';

const orgCache = new LRUCache<string, Organization>(1000);

/**
 * Drop a subdomain from the in-memory org cache. Call after mutating
 * fields that affect the cached row (e.g. logo upload bumping logoUpdatedAt).
 */
export const invalidateOrgCache = (subdomain: string): void => {
  orgCache.delete(subdomain);
};

/**
 * Organization middleware
 * Extracts subdomain from Host header and loads organization into context
 * Uses in-memory cache to avoid DB queries on every request
 */
export const organizationMiddleware = (): MiddlewareHandler => {

  return async (c, next) => {

    try {

      // Get Host header
      const host = c.req.header('Host');

      if (!host) {

        logger.warn('Missing Host header.');

        return c.json({ error: 'Missing Host header' }, 400);
      }

      // Extract subdomain from host
      // Examples: "acme.karibu.ai" -> "acme", "demo.localhost:3000" -> "demo"
      const subdomain = host.split('.')[0].split(':')[0];

      // Check if subdomain is valid
      if (!subdomain) {

        logger.warn({ host }, 'Could not extract subdomain from Host header.');

        return c.json({ error: 'Invalid Host header' }, 400);
      }

      // Check cache first
      let organization = orgCache.get(subdomain);

      if (!organization) {

        // Cache miss - query database
        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.subdomain, subdomain))
          .limit(1);

        if (!org) {

          logger.warn({ subdomain }, 'Organization not found for subdomain.');

          return c.json({ error: 'Organization not found' }, 404);
        }

        organization = org as Organization;
        orgCache.set(subdomain, organization);

        logger.debug({ subdomain }, 'Organization cached.');
      }

      // Add organization to context
      c.set('organization', organization);

      await next();

    } catch (err) {

      logger.error({ err }, 'Organization middleware failed.');

      return c.json({ error: 'Internal server error' }, 500);
    }
  }
}
