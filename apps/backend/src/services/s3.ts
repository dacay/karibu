import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let s3Client: S3Client | null = null;

const getS3Client = (): S3Client => {

  if (s3Client) return s3Client;

  if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {

    throw new Error('AWS S3 credentials are not configured.');
  }

  s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  return s3Client;
}

const getDocsBucketName = (): string => {

  if (!env.S3_DOCS_BUCKET_NAME) {

    throw new Error('S3_DOCS_BUCKET_NAME is not configured.');
  }

  return env.S3_DOCS_BUCKET_NAME;
}

const getAssetsBucketName = (): string => {

  if (!env.S3_ASSETS_BUCKET_NAME) {

    throw new Error('S3_ASSETS_BUCKET_NAME is not configured.');
  }

  return env.S3_ASSETS_BUCKET_NAME;
}

export interface UploadResult {
  s3Key: string;
  s3Bucket: string;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

interface UploadOptions {
  cacheControl?: string;
}

const upload = async (bucket: string, key: string, body: Buffer, mimeType: string, options?: UploadOptions): Promise<UploadResult> => {

  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
    ...(options?.cacheControl ? { CacheControl: options.cacheControl } : {}),
  });

  await client.send(command);

  logger.info({ key, bucket }, 'File uploaded to S3.');

  return { s3Key: key, s3Bucket: bucket };
}

const remove = async (bucket: string, key: string): Promise<void> => {

  const client = getS3Client();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);

  logger.info({ key, bucket }, 'File deleted from S3.');
}

// ─── Documents bucket (private) ────────────────────────────────────────────────

export const uploadToDocsBucket = (key: string, body: Buffer, mimeType: string): Promise<UploadResult> =>
  upload(getDocsBucketName(), key, body, mimeType)

export const deleteFromDocsBucket = (key: string): Promise<void> =>
  remove(getDocsBucketName(), key)

export const downloadFromDocsBucket = async (key: string): Promise<Buffer> => {

  const client = getS3Client();
  const bucket = getDocsBucketName();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(command);

  if (!response.Body) throw new Error(`S3 object has no body: ${key}`);

  const chunks: Uint8Array[] = [];

  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

// ─── Assets bucket (CDN-fronted, public read) ──────────────────────────────────

export const uploadToAssetsBucket = (key: string, body: Buffer, mimeType: string, options?: UploadOptions): Promise<UploadResult> =>
  upload(getAssetsBucketName(), key, body, mimeType, options)

export const deleteFromAssetsBucket = (key: string): Promise<void> =>
  remove(getAssetsBucketName(), key)

/**
 * Build the S3 key for a document given organization and filename.
 * Optionally prefixed by S3_DOCS_KEY_PREFIX (e.g. "prod" → "prod/{orgId}/{docId}.pdf").
 */
export const buildDocumentKey = (organizationId: string, documentId: string, filename: string): string => {

  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  const suffix = ext ? `.${ext}` : '';
  const prefix = env.S3_DOCS_KEY_PREFIX ? `${env.S3_DOCS_KEY_PREFIX}/` : '';

  return `${prefix}${organizationId}/${documentId}${suffix}`;
}

/**
 * Build the S3 key for an avatar image.
 * Uses subdomain for org scoping (e.g. "prod/acme/avatars/{avatarId}.jpg").
 */
export const buildAvatarImageKey = (subdomain: string, avatarId: string, filename: string): string => {

  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  const suffix = ext ? `.${ext}` : '';
  const prefix = env.S3_ASSETS_KEY_PREFIX ? `${env.S3_ASSETS_KEY_PREFIX}/` : '';

  return `${prefix}${subdomain}/avatars/${avatarId}${suffix}`;
}

/**
 * Build the S3 key for an org logo.
 * Pattern: {prefix}/{subdomain}/logo-{variant}.png
 */
export type LogoVariant = 'light' | 'dark';

export const buildOrgLogoKey = (subdomain: string, variant: LogoVariant): string => {

  const prefix = env.S3_ASSETS_KEY_PREFIX ? `${env.S3_ASSETS_KEY_PREFIX}/` : '';

  return `${prefix}${subdomain}/logo-${variant}.png`;
}
