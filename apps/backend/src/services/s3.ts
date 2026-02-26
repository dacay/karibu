import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export const getS3BucketName = (): string => {

  if (!env.S3_BUCKET_NAME) {

    throw new Error('S3_BUCKET_NAME is not configured.');
  }

  return env.S3_BUCKET_NAME;
}

export interface UploadResult {
  s3Key: string;
  s3Bucket: string;
}

/**
 * Upload a file buffer to S3.
 */
export const uploadToS3 = async (
  key: string,
  body: Buffer,
  mimeType: string
): Promise<UploadResult> => {

  const client = getS3Client();
  const bucket = getS3BucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: mimeType,
  });

  await client.send(command);

  logger.info({ key, bucket }, 'File uploaded to S3.');

  return { s3Key: key, s3Bucket: bucket };
}

/**
 * Delete a file from S3.
 */
export const deleteFromS3 = async (key: string): Promise<void> => {

  const client = getS3Client();
  const bucket = getS3BucketName();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);

  logger.info({ key, bucket }, 'File deleted from S3.');
}

/**
 * Download a file from S3 and return it as a Buffer.
 */
export const downloadFromS3 = async (key: string): Promise<Buffer> => {
  const client = getS3Client();
  const bucket = getS3BucketName();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(command);
  if (!response.Body) throw new Error(`S3 object has no body: ${key}`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Generate a presigned URL for temporary read access to an S3 object.
 * Expires in 1 hour by default.
 */
export const getPresignedUrl = async (key: string, expiresInSeconds = 3600): Promise<string> => {

  const client = getS3Client();
  const bucket = getS3BucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Build the S3 key for a document given organization and filename.
 * Optionally prefixed by S3_KEY_PREFIX (e.g. "prod" → "prod/{orgId}/{docId}.pdf").
 */
export const buildDocumentKey = (organizationId: string, documentId: string, filename: string): string => {

  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  const suffix = ext ? `.${ext}` : '';
  const prefix = env.S3_KEY_PREFIX ? `${env.S3_KEY_PREFIX}/` : '';

  return `${prefix}${organizationId}/${documentId}${suffix}`;
}

/**
 * Build the S3 key for an avatar image given organization and avatar ID.
 * Uses the "avatars/" prefix to keep avatar images separate from documents.
 * Optionally prefixed by S3_KEY_PREFIX (e.g. "prod" → "prod/avatars/{orgId}/{avatarId}.jpg").
 */
export const buildAvatarImageKey = (organizationId: string, avatarId: string, filename: string): string => {

  const ext = filename.includes('.') ? filename.split('.').pop() : '';
  const suffix = ext ? `.${ext}` : '';
  const prefix = env.S3_KEY_PREFIX ? `${env.S3_KEY_PREFIX}/` : '';

  return `${prefix}avatars/${organizationId}/${avatarId}${suffix}`;
}
