import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let s3Client: S3Client | null = null;
let cloudFrontClient: CloudFrontClient | null = null;

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

const getCloudFrontClient = (): CloudFrontClient => {

  if (cloudFrontClient) return cloudFrontClient;

  if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {

    throw new Error('AWS credentials are not configured.');
  }

  cloudFrontClient = new CloudFrontClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  return cloudFrontClient;
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

const getReportsBucketName = (): string => {

  if (!env.S3_REPORTS_BUCKET_NAME) {

    throw new Error('S3_REPORTS_BUCKET_NAME is not configured.');
  }

  return env.S3_REPORTS_BUCKET_NAME;
}

export const isReportsBucketConfigured = (): boolean =>
  Boolean(env.S3_REPORTS_BUCKET_NAME && env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)

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
  upload(getAssetsBucketName(), key, body, mimeType, { cacheControl: 'public, max-age=31536000, immutable', ...options })

export const deleteFromAssetsBucket = (key: string): Promise<void> =>
  remove(getAssetsBucketName(), key)

/**
 * Download an object from the assets bucket directly via S3 (no CDN).
 * Returns null when the key does not exist.
 */
export const downloadFromAssetsBucket = async (
  key: string,
): Promise<{ body: Buffer; contentType: string } | null> => {

  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: getAssetsBucketName(), Key: key });

  let response;
  try {
    response = await client.send(command);
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }

  if (!response.Body) return null;

  const chunks: Uint8Array[] = [];

  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return {
    body: Buffer.concat(chunks),
    contentType: response.ContentType ?? 'application/octet-stream',
  };
}

// ─── Reports bucket (private, presigned access) ────────────────────────────────

export interface ReportObject {
  key: string;
  /** Display name — the filename with its date prefix/suffix stripped. */
  name: string;
  /** Raw object filename, kept intact for the download disposition. */
  filename: string;
  sizeBytes: number;
  lastModified: string;
  /** Report date (`YYYY-MM-DD`), taken from the filename or falling back to `lastModified`. */
  date: string;
}

/**
 * Date patterns recognised at the start or end of a report filename, e.g.
 * "2026-07-21 Policy Consistency Review.pdf" or "policy-review_20260721.pdf".
 * Separators between the date parts are optional, as is the gap to the rest
 * of the name. The trailing form is matched against the extension-less base.
 */
const REPORT_DATE_LEADING = /^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[\s._-]*/;
const REPORT_DATE_TRAILING = /[\s._-]*(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})$/;

/**
 * Validate a Y/M/D triple and render it as `YYYY-MM-DD`, or null when the date
 * does not exist (so "20261345" is treated as an ordinary part of the name).
 */
const toIsoDate = (year: string, month: string, day: string): string | null => {

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) return null;

  return `${year}-${month}-${day}`;
}

/**
 * Split a report filename into its display name and its embedded date.
 * Reports are uploaded externally, so the filename is the only place the
 * producer can state which date a report covers — S3's `LastModified` is
 * upload time and cannot be set. Returns a null date when no valid date is
 * present, in which case the caller falls back to `LastModified`.
 */
export const parseReportFilename = (filename: string): { name: string; date: string | null } => {

  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';

  for (const pattern of [REPORT_DATE_LEADING, REPORT_DATE_TRAILING]) {

    const match = base.match(pattern);

    if (!match) continue;

    const date = toIsoDate(match[1], match[2], match[3]);

    if (!date) continue;

    const stripped = base.replace(pattern, '').trim();

    // A filename that is nothing but a date keeps its original name.
    return { name: stripped ? `${stripped}${ext}` : filename, date };
  }

  return { name: filename, date: null };
}

/**
 * Build the S3 key prefix under which an organization's report files live.
 * Pattern: {S3_REPORTS_KEY_PREFIX}/{organizationId}/
 * Uses organizationId (immutable UUID) as the folder, matching the documents bucket rationale.
 */
export const buildReportsKeyPrefix = (organizationId: string): string => {

  const prefix = env.S3_REPORTS_KEY_PREFIX ? `${env.S3_REPORTS_KEY_PREFIX}/` : '';

  return `${prefix}${organizationId}/`;
}

/**
 * List all report files stored for an organization.
 * Returns objects sorted newest-first by report date. Folder placeholder keys
 * (those ending in "/") are skipped. Handles pagination transparently.
 */
export const listReportObjects = async (organizationId: string): Promise<ReportObject[]> => {

  const client = getS3Client();
  const bucket = getReportsBucketName();
  const prefix = buildReportsKeyPrefix(organizationId);

  const objects: ReportObject[] = [];
  let continuationToken: string | undefined;

  do {

    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const item of response.Contents ?? []) {

      if (!item.Key || item.Key.endsWith('/')) continue;

      const filename = item.Key.slice(prefix.length);
      const { name, date } = parseReportFilename(filename);
      const lastModified = (item.LastModified ?? new Date()).toISOString();

      objects.push({
        key: item.Key,
        name,
        filename,
        sizeBytes: item.Size ?? 0,
        lastModified,
        date: date ?? lastModified.slice(0, 10),
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;

  } while (continuationToken);

  objects.sort((a, b) => b.date.localeCompare(a.date) || b.lastModified.localeCompare(a.lastModified));

  return objects;
}

/**
 * Generate a presigned GET URL for a report object.
 * `disposition` controls whether the browser renders the file inline (view)
 * or forces a download (attachment). `filename` sets the download filename.
 * The key is validated against the organization's prefix by the caller.
 */
export const getReportPresignedUrl = async (
  key: string,
  disposition: 'inline' | 'attachment',
  filename: string,
): Promise<string> => {

  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: getReportsBucketName(),
    Key: key,
    ResponseContentDisposition: `${disposition}; filename="${filename.replace(/"/g, '')}"`,
  });

  return getSignedUrl(client, command, { expiresIn: env.S3_REPORTS_URL_EXPIRY_SECONDS });
}

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
 * Build the S3 key for a built-in (global) avatar image.
 * Built-in avatars are not scoped to an organization, so they live under a
 * shared "builtin" namespace: {prefix}/builtin/avatars/{slug}.{ext}
 */
export const buildBuiltInAvatarImageKey = (slug: string, ext: string): string => {

  const suffix = ext.startsWith('.') ? ext : `.${ext}`;
  const prefix = env.S3_ASSETS_KEY_PREFIX ? `${env.S3_ASSETS_KEY_PREFIX}/` : '';

  return `${prefix}builtin/avatars/${slug}${suffix}`;
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

/**
 * Build the S3 key for a microlearning cover image.
 * Pattern: {prefix}/{subdomain}/ml-images/{mlId}.png
 */
export const buildMlImageKey = (subdomain: string, mlId: string): string => {

  const prefix = env.S3_ASSETS_KEY_PREFIX ? `${env.S3_ASSETS_KEY_PREFIX}/` : '';

  return `${prefix}${subdomain}/ml-images/${mlId}.png`;
}

/**
 * Invalidate one or more CloudFront paths so updated assets are served immediately.
 * S3 keys are converted to CloudFront paths by prepending a leading slash.
 * No-ops silently when CLOUDFRONT_DISTRIBUTION_ID is not configured.
 */
export const invalidateCloudFrontPaths = async (s3Keys: string[]): Promise<void> => {

  if (!env.CLOUDFRONT_DISTRIBUTION_ID) return;

  const paths = s3Keys.map((key) => `/${key}`);

  const command = new CreateInvalidationCommand({
    DistributionId: env.CLOUDFRONT_DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: `${Date.now()}`,
      Paths: {
        Quantity: paths.length,
        Items: paths,
      },
    },
  });

  try {

    const client = getCloudFrontClient();
    await client.send(command);
    logger.info({ paths, distributionId: env.CLOUDFRONT_DISTRIBUTION_ID }, 'CloudFront invalidation created.');

  } catch (err) {

    logger.warn({ err, paths }, 'CloudFront invalidation failed. The CDN may serve stale content until TTL expiry.');
  }
}
