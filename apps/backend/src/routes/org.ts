import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations } from '../db/schema.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { uploadToAssetsBucket, deleteFromAssetsBucket, buildOrgLogoKey, type LogoVariant } from '../services/s3.js';
import { logger } from '../config/logger.js';

const org = new Hono();

// All org config routes require authentication and admin role
org.use('*', authMiddleware());
org.use('*', requireRole('admin'));

const ALLOWED_LOGO_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

const updateConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pronunciation: z.string().max(200).optional().nullable(),
  learnerTerm: z.string().min(1).max(50).optional(),
  learnerTermPlural: z.string().min(1).max(50).optional(),
  expirationIntervalHours: z.number().int().min(1).max(720).optional(),
});

/**
 * GET /org/config
 * Returns the current organization's configurable fields.
 */
org.get('/config', async (c) => {

  try {

    const organization = c.get('organization');

    const [row] = await db
      .select({
        name: organizations.name,
        subdomain: organizations.subdomain,
        pronunciation: organizations.pronunciation,
        learnerTerm: organizations.learnerTerm,
        learnerTermPlural: organizations.learnerTermPlural,
        expirationIntervalHours: organizations.expirationIntervalHours,
      })
      .from(organizations)
      .where(eq(organizations.id, organization.id))
      .limit(1);

    if (!row) {
      return c.json({ error: 'Organization not found.' }, 404);
    }

    return c.json(row);

  } catch (error) {

    logger.error({ error }, 'Failed to fetch org config.');

    return c.json({ error: 'Internal server error.' }, 500);
  }
})

/**
 * PATCH /org/config
 * Updates the organization's name and/or pronunciation.
 */
org.patch('/config', zValidator('json', updateConfigSchema), async (c) => {

  try {

    const organization = c.get('organization');
    const body = c.req.valid('json');

    const updates: Record<string, string | number | null> = {};

    if (body.name !== undefined) {
      updates.name = body.name;
    }

    if (body.pronunciation !== undefined) {
      updates.pronunciation = body.pronunciation;
    }

    if (body.learnerTerm !== undefined) {
      updates.learnerTerm = body.learnerTerm;
    }

    if (body.learnerTermPlural !== undefined) {
      updates.learnerTermPlural = body.learnerTermPlural;
    }

    if (body.expirationIntervalHours !== undefined) {
      updates.expirationIntervalHours = body.expirationIntervalHours;
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update.' }, 400);
    }

    const [updated] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, organization.id))
      .returning({
        name: organizations.name,
        subdomain: organizations.subdomain,
        pronunciation: organizations.pronunciation,
        learnerTerm: organizations.learnerTerm,
        learnerTermPlural: organizations.learnerTermPlural,
        expirationIntervalHours: organizations.expirationIntervalHours,
      });

    logger.info({ organizationId: organization.id }, 'Org config updated.');

    return c.json(updated);

  } catch (error) {

    logger.error({ error }, 'Failed to update org config.');

    return c.json({ error: 'Internal server error.' }, 500);
  }
})

/**
 * POST /org/logo
 * Upload or replace a logo variant. Accepts multipart form data.
 * Fields: variant ("light" | "dark"), file (image file).
 */
org.post('/logo', async (c) => {

  const organization = c.get('organization');

  let formData: FormData;

  try {

    formData = await c.req.formData();

  } catch {

    return c.json({ error: 'Invalid multipart form data.' }, 400);
  }

  const variant = (formData.get('variant') as string | null)?.trim() as LogoVariant | null;
  const file = formData.get('file');

  if (!variant || !['light', 'dark'].includes(variant)) {

    return c.json({ error: 'Logo variant is required ("light" or "dark").' }, 400);
  }

  if (!file || !(file instanceof File) || file.size === 0) {

    return c.json({ error: 'Logo file is required.' }, 400);
  }

  if (!ALLOWED_LOGO_TYPES.has(file.type)) {

    return c.json({ error: 'Unsupported image type. Allowed: PNG, JPEG, WebP, SVG.' }, 400);
  }

  if (file.size > MAX_LOGO_SIZE_BYTES) {

    return c.json({ error: 'Logo too large. Maximum size is 2 MB.' }, 400);
  }

  const s3Key = buildOrgLogoKey(organization.subdomain, variant);

  try {

    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadToAssetsBucket(s3Key, buffer, file.type, { cacheControl: 'no-cache' });

    logger.info({ organizationId: organization.id, variant, s3Key }, 'Org logo uploaded.');

    return c.json({ success: true, key: s3Key });

  } catch (err) {

    logger.error({ err, organizationId: organization.id, variant }, 'Org logo upload failed.');

    return c.json({ error: 'Failed to upload logo. Please try again.' }, 500);
  }
})

/**
 * DELETE /org/logo/:variant
 * Delete a specific logo variant.
 */
org.delete('/logo/:variant', async (c) => {

  const organization = c.get('organization');
  const variant = c.req.param('variant') as LogoVariant;

  if (!['light', 'dark'].includes(variant)) {

    return c.json({ error: 'Invalid logo variant.' }, 400);
  }

  const s3Key = buildOrgLogoKey(organization.subdomain, variant);

  try {

    await deleteFromAssetsBucket(s3Key);

    logger.info({ organizationId: organization.id, variant }, 'Org logo deleted.');

    return c.json({ success: true });

  } catch (err) {

    logger.error({ err, organizationId: organization.id, variant }, 'Org logo delete failed.');

    return c.json({ error: 'Failed to delete logo.' }, 500);
  }
})

export default org;
