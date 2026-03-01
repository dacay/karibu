import { Hono } from 'hono';
import { eq, and, or, isNull } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { avatars } from '../db/schema.js';
import { uploadToAvatarBucket, deleteFromAvatarBucket, buildAvatarImageKey } from '../services/s3.js';
import { logger } from '../config/logger.js';

const avatarsRouter = new Hono();

avatarsRouter.use('*', authMiddleware());

// Allowed image MIME types for avatar photos
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * GET /avatars
 * List all built-in avatars and org-specific avatars.
 */
avatarsRouter.get('/', requireRole('admin'), async (c) => {

  const auth = c.get('auth');

  const rows = await db
    .select()
    .from(avatars)
    .where(
      or(
        isNull(avatars.organizationId),
        eq(avatars.organizationId, auth.organizationId),
      )
    );

  return c.json({ avatars: rows });
});

/**
 * POST /avatars
 * Create a new org-specific avatar. Accepts multipart form data.
 * Fields: name (string), personality (string), voiceId (string), image (file, optional).
 */
avatarsRouter.post('/', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const organization = c.get('organization');

  let formData: FormData;

  try {

    formData = await c.req.formData();

  } catch {

    return c.json({ error: 'Invalid multipart form data.' }, 400);
  }

  const name = (formData.get('name') as string | null)?.trim();
  const personality = (formData.get('personality') as string | null)?.trim();
  const voiceId = (formData.get('voiceId') as string | null)?.trim();
  const imageFile = formData.get('image');

  if (!name) {

    return c.json({ error: 'Avatar name is required.' }, 400);
  }

  if (!personality) {

    return c.json({ error: 'Avatar personality is required.' }, 400);
  }

  if (!voiceId) {

    return c.json({ error: 'Avatar voice is required.' }, 400);
  }

  // Insert record first to get the ID for S3 key generation
  const [avatar] = await db
    .insert(avatars)
    .values({
      organizationId: auth.organizationId,
      name,
      personality,
      voiceId,
      isBuiltIn: false,
    })
    .returning();

  // Handle optional image upload
  if (imageFile && imageFile instanceof File && imageFile.size > 0) {

    if (!ALLOWED_IMAGE_TYPES.has(imageFile.type)) {

      await db.delete(avatars).where(eq(avatars.id, avatar.id));
      return c.json({ error: 'Unsupported image type. Allowed: JPEG, PNG, WebP, GIF.' }, 400);
    }

    if (imageFile.size > MAX_IMAGE_SIZE_BYTES) {

      await db.delete(avatars).where(eq(avatars.id, avatar.id));
      return c.json({ error: 'Image too large. Maximum size is 5 MB.' }, 400);
    }

    const s3Key = buildAvatarImageKey(organization.subdomain, avatar.id, imageFile.name);

    try {

      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const { s3Bucket } = await uploadToAvatarBucket(s3Key, buffer, imageFile.type);

      const [updated] = await db
        .update(avatars)
        .set({ imageS3Key: s3Key, imageS3Bucket: s3Bucket })
        .where(eq(avatars.id, avatar.id))
        .returning();

      logger.info({ avatarId: updated.id, organizationId: auth.organizationId }, 'Avatar created with image.');

      return c.json({ avatar: updated }, 201);

    } catch (err) {

      await db.delete(avatars).where(eq(avatars.id, avatar.id));
      logger.error({ err, avatarId: avatar.id }, 'S3 avatar image upload failed.');
      return c.json({ error: 'Failed to upload image. Please try again.' }, 500);
    }
  }

  logger.info({ avatarId: avatar.id, organizationId: auth.organizationId }, 'Avatar created.');

  return c.json({ avatar }, 201);
});

/**
 * PATCH /avatars/:id
 * Update an org-specific avatar. Built-in avatars cannot be modified.
 * Accepts multipart form data. All fields are optional.
 */
avatarsRouter.patch('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const organization = c.get('organization');
  const id = c.req.param('id');

  const [avatar] = await db
    .select()
    .from(avatars)
    .where(and(eq(avatars.id, id), eq(avatars.organizationId, auth.organizationId)))
    .limit(1);

  if (!avatar) {

    return c.json({ error: 'Avatar not found.' }, 404);
  }

  if (avatar.isBuiltIn) {

    return c.json({ error: 'Built-in avatars cannot be modified.' }, 403);
  }

  let formData: FormData;

  try {

    formData = await c.req.formData();

  } catch {

    return c.json({ error: 'Invalid multipart form data.' }, 400);
  }

  const name = (formData.get('name') as string | null)?.trim();
  const personality = (formData.get('personality') as string | null)?.trim();
  const voiceId = (formData.get('voiceId') as string | null)?.trim();
  const imageFile = formData.get('image');

  const updates: Partial<typeof avatar> = {};

  if (name) updates.name = name;
  if (personality) updates.personality = personality;
  if (voiceId) updates.voiceId = voiceId;

  // Handle new image upload
  if (imageFile && imageFile instanceof File && imageFile.size > 0) {

    if (!ALLOWED_IMAGE_TYPES.has(imageFile.type)) {

      return c.json({ error: 'Unsupported image type. Allowed: JPEG, PNG, WebP, GIF.' }, 400);
    }

    if (imageFile.size > MAX_IMAGE_SIZE_BYTES) {

      return c.json({ error: 'Image too large. Maximum size is 5 MB.' }, 400);
    }

    const s3Key = buildAvatarImageKey(organization.subdomain, id, imageFile.name);

    try {

      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const { s3Bucket } = await uploadToAvatarBucket(s3Key, buffer, imageFile.type);

      // Delete the old image if it was different
      if (avatar.imageS3Key && avatar.imageS3Key !== s3Key) {

        await deleteFromAvatarBucket(avatar.imageS3Key).catch((err) => {
          logger.warn({ err, avatarId: id }, 'Failed to delete old avatar image from S3.');
        });
      }

      updates.imageS3Key = s3Key;
      updates.imageS3Bucket = s3Bucket;

    } catch (err) {

      logger.error({ err, avatarId: id }, 'S3 avatar image upload failed.');
      return c.json({ error: 'Failed to upload image. Please try again.' }, 500);
    }
  }

  const [updated] = await db
    .update(avatars)
    .set(updates)
    .where(eq(avatars.id, id))
    .returning();

  logger.info({ avatarId: id, organizationId: auth.organizationId }, 'Avatar updated.');

  return c.json({ avatar: updated });
});

/**
 * DELETE /avatars/:id
 * Delete an org-specific avatar. Built-in avatars cannot be deleted.
 */
avatarsRouter.delete('/:id', requireRole('admin'), async (c) => {

  const auth = c.get('auth');
  const id = c.req.param('id');

  const [avatar] = await db
    .select()
    .from(avatars)
    .where(and(eq(avatars.id, id), eq(avatars.organizationId, auth.organizationId)))
    .limit(1);

  if (!avatar) {

    return c.json({ error: 'Avatar not found.' }, 404);
  }

  if (avatar.isBuiltIn) {

    return c.json({ error: 'Built-in avatars cannot be deleted.' }, 403);
  }

  if (avatar.imageS3Key) {

    await deleteFromAvatarBucket(avatar.imageS3Key).catch((err) => {
      logger.warn({ err, avatarId: id }, 'Failed to delete avatar image from S3.');
    });
  }

  await db.delete(avatars).where(eq(avatars.id, id));

  logger.info({ avatarId: id, organizationId: auth.organizationId }, 'Avatar deleted.');

  return c.json({ success: true });
});

export default avatarsRouter;
