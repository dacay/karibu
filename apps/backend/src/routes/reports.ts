import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/auth.js';
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
 * Descriptions for the known report types, matched against the filename.
 *
 * The first pattern that matches wins, so order is precedence — put the more
 * specific patterns first. `[\s_-]*` between words absorbs whatever separator
 * the filename uses ("Policy Consistency Review", "policy-consistency-review",
 * "policy_consistency_review" all match the same entry).
 *
 * Add an entry here when a new report type starts landing in the bucket; files
 * that match nothing simply show no description. Do not use the `g` flag —
 * `RegExp.test` is stateful with it.
 */
const REPORT_DESCRIPTIONS: { pattern: RegExp; description: string }[] = [
  {
    pattern: /policy[\s_-]*consistency[\s_-]*review/i,
    description: 'This report flags where a procedure contradicts itself, and where the procedures contradict each other.',
  },
];

/**
 * Pick the description for a filename, or null when no report type matches.
 */
const matchDescription = (name: string): string | null =>
  REPORT_DESCRIPTIONS.find(({ pattern }) => pattern.test(name))?.description ?? null

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
    date: obj.date,
    description: matchDescription(obj.name),
    // Downloads keep the raw filename, so the date stays on the saved file.
    viewUrl: await getReportPresignedUrl(obj.key, 'inline', obj.filename),
    downloadUrl: await getReportPresignedUrl(obj.key, 'attachment', obj.filename),
  })));

  return c.json({ reports, configured: true });
})

export default reportsRouter;
