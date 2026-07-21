import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { reportDescriptions } from '../db/schema.js';
import {
  isReportsBucketConfigured,
  listReportObjects,
  getReportPresignedUrl,
  type ReportObject,
} from '../services/s3.js';
import { logger } from '../config/logger.js';

const reportsRouter = new Hono();

// All report routes require authentication and admin role
reportsRouter.use('*', authMiddleware());
reportsRouter.use('*', requireRole('admin'));

/**
 * Pick the best description for a filename from the org's description rules.
 * Matching is case-insensitive substring ("name contains"). When several rules
 * match, the one with the longest matchText wins (most specific).
 */
const matchDescription = (
  name: string,
  rules: { matchText: string; description: string }[],
): string | null => {

  const lowerName = name.toLowerCase();

  let best: { matchText: string; description: string } | null = null;

  for (const rule of rules) {

    if (!lowerName.includes(rule.matchText.toLowerCase())) continue;

    if (!best || rule.matchText.length > best.matchText.length) {

      best = rule;
    }
  }

  return best?.description ?? null;
}

/**
 * GET /reports
 * List report files for the organization, each with a matched description and
 * presigned view/download URLs. Files are read from the reports S3 bucket under
 * the org's prefix. Returns an empty list when the reports bucket is unconfigured.
 */
reportsRouter.get('/', async (c) => {

  const auth = c.get('auth');

  if (!isReportsBucketConfigured()) {

    logger.debug({ orgId: auth.organizationId }, 'Reports bucket not configured; returning empty list.');

    return c.json({ reports: [], configured: false });
  }

  const rules = await db
    .select({ matchText: reportDescriptions.matchText, description: reportDescriptions.description })
    .from(reportDescriptions)
    .where(eq(reportDescriptions.organizationId, auth.organizationId));

  let objects: ReportObject[];

  try {

    objects = await listReportObjects(auth.organizationId);

  } catch (err) {

    logger.error({ err, orgId: auth.organizationId }, 'Failed to list report objects.');

    return c.json({ error: 'Failed to load reports.' }, 500);
  }

  const reports = await Promise.all(objects.map(async (obj) => ({
    key: obj.key,
    name: obj.name,
    sizeBytes: obj.sizeBytes,
    lastModified: obj.lastModified,
    description: matchDescription(obj.name, rules),
    viewUrl: await getReportPresignedUrl(obj.key, 'inline', obj.name),
    downloadUrl: await getReportPresignedUrl(obj.key, 'attachment', obj.name),
  })));

  return c.json({ reports, configured: true });
})

// ─── Description rules ──────────────────────────────────────────────────────────

/**
 * GET /reports/descriptions
 * List the org's report description rules.
 */
reportsRouter.get('/descriptions', async (c) => {

  const auth = c.get('auth');

  const rows = await db
    .select()
    .from(reportDescriptions)
    .where(eq(reportDescriptions.organizationId, auth.organizationId))
    .orderBy(desc(reportDescriptions.createdAt));

  return c.json({ descriptions: rows });
})

/**
 * POST /reports/descriptions
 * Create a description rule ("filename contains matchText" -> description).
 */
reportsRouter.post(
  '/descriptions',
  zValidator('json', z.object({
    matchText: z.string().min(1).max(200),
    description: z.string().min(1).max(500),
  })),
  async (c) => {

    const auth = c.get('auth');
    const { matchText, description } = c.req.valid('json');

    const [rule] = await db
      .insert(reportDescriptions)
      .values({
        organizationId: auth.organizationId,
        matchText: matchText.trim(),
        description: description.trim(),
      })
      .returning();

    logger.debug({ ruleId: rule.id, orgId: auth.organizationId }, 'Report description created.');

    return c.json({ description: rule }, 201);
  }
)

/**
 * PATCH /reports/descriptions/:id
 * Update a description rule.
 */
reportsRouter.patch(
  '/descriptions/:id',
  zValidator('json', z.object({
    matchText: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(500).optional(),
  })),
  async (c) => {

    const auth = c.get('auth');
    const { id } = c.req.param();
    const body = c.req.valid('json');

    const updates: { matchText?: string; description?: string } = {};

    if (body.matchText !== undefined) updates.matchText = body.matchText.trim();
    if (body.description !== undefined) updates.description = body.description.trim();

    if (Object.keys(updates).length === 0) {

      return c.json({ error: 'No fields to update.' }, 400);
    }

    const [updated] = await db
      .update(reportDescriptions)
      .set(updates)
      .where(
        and(
          eq(reportDescriptions.id, id),
          eq(reportDescriptions.organizationId, auth.organizationId),
        )
      )
      .returning();

    if (!updated) {

      return c.json({ error: 'Description not found.' }, 404);
    }

    logger.debug({ ruleId: id, orgId: auth.organizationId }, 'Report description updated.');

    return c.json({ description: updated });
  }
)

/**
 * DELETE /reports/descriptions/:id
 * Delete a description rule.
 */
reportsRouter.delete('/descriptions/:id', async (c) => {

  const auth = c.get('auth');
  const { id } = c.req.param();

  const [deleted] = await db
    .delete(reportDescriptions)
    .where(
      and(
        eq(reportDescriptions.id, id),
        eq(reportDescriptions.organizationId, auth.organizationId),
      )
    )
    .returning();

  if (!deleted) {

    return c.json({ error: 'Description not found.' }, 404);
  }

  logger.debug({ ruleId: id, orgId: auth.organizationId }, 'Report description deleted.');

  return c.json({ success: true });
})

export default reportsRouter;
