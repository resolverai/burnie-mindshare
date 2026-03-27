/**
 * Cloud Storage Configuration Factory
 *
 * Provides S3-compatible clients for both AWS S3 and Google Cloud Storage.
 * GCS is accessed via its S3-interoperability API (HMAC keys), so all existing
 * aws-sdk v2 and @aws-sdk v3 code works unchanged — only the endpoint differs.
 *
 * Switch providers by setting CLOUD_PROVIDER=aws|gcp in .env
 */

import AWS from 'aws-sdk';
import { S3Client } from '@aws-sdk/client-s3';
import { logger } from '../config/logger';

const CLOUD_PROVIDER = (process.env.CLOUD_PROVIDER || 'aws').toLowerCase();
const STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT || '';
const IS_GCP = CLOUD_PROVIDER === 'gcp';

const GCS_DEFAULT_ENDPOINT = 'https://storage.googleapis.com';

function resolveEndpoint(): string | undefined {
  if (STORAGE_ENDPOINT) return STORAGE_ENDPOINT;
  if (IS_GCP) return GCS_DEFAULT_ENDPOINT;
  return undefined;
}

/**
 * Create a pre-configured AWS SDK v2 S3 instance.
 * Works with both AWS S3 and GCS (via S3-interop when CLOUD_PROVIDER=gcp).
 */
export function createS3ClientV2(): AWS.S3 {
  const endpoint = resolveEndpoint();

  const config: AWS.S3.ClientConfiguration = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: IS_GCP ? 'auto' : (process.env.AWS_REGION || 'us-east-1'),
    signatureVersion: 'v4',
  };

  if (endpoint) {
    config.endpoint = endpoint;
    config.s3ForcePathStyle = true;
  }

  logger.info(`☁️  Storage (v2): provider=${CLOUD_PROVIDER}${endpoint ? `, endpoint=${endpoint}` : ''}`);
  return new AWS.S3(config);
}

/**
 * Create a pre-configured AWS SDK v3 S3Client instance.
 * Works with both AWS S3 and GCS (via S3-interop when CLOUD_PROVIDER=gcp).
 */
export function createS3ClientV3(): S3Client {
  const endpoint = resolveEndpoint();
  const region = IS_GCP ? 'auto' : (process.env.AWS_REGION || 'us-east-1');
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';

  const config: any = {
    region,
    credentials: { accessKeyId, secretAccessKey },
  };

  if (endpoint) {
    config.endpoint = endpoint;
    config.forcePathStyle = true;
  }

  logger.info(`☁️  Storage (v3): provider=${CLOUD_PROVIDER}${endpoint ? `, endpoint=${endpoint}` : ''}`);
  return new S3Client(config);
}

/**
 * Return the default bucket name from env.
 */
export function getDefaultBucket(): string {
  return process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';
}

/**
 * Return the videos bucket name from env.
 */
export function getVideosBucket(): string {
  return process.env.STORAGE_VIDEOS_BUCKET || 'burnie-videos';
}

/**
 * Build S3-compatible upload params, stripping options not supported by GCS.
 * GCS Uniform bucket-level access rejects ACL headers; GCS encrypts by default
 * so ServerSideEncryption is unnecessary.
 */
export function sanitizeUploadParams<T extends Record<string, any>>(params: T): T {
  if (!IS_GCP) return params;
  const cleaned = { ...params };
  delete cleaned.ACL;
  delete cleaned.ServerSideEncryption;
  return cleaned;
}

/**
 * Extract the object key from a storage URL (AWS S3 or GCS).
 *
 * Handles:
 *   s3://bucket/key
 *   https://bucket.s3.region.amazonaws.com/key?query
 *   https://s3.region.amazonaws.com/bucket/key?query
 *   https://storage.googleapis.com/bucket/key?query
 *   Already-a-key strings (returned as-is)
 */
export function extractStorageKey(url: string, bucket?: string): string {
  if (!url) return '';

  let clean = url;

  // Decode URL-encoded URLs
  if (clean.includes('%3A//') || clean.includes('%3a//')) {
    try { clean = decodeURIComponent(clean); } catch { /* keep original */ }
  }

  // s3://bucket/key
  if (clean.startsWith('s3://')) {
    const parts = clean.replace('s3://', '').split('/');
    return parts.slice(1).join('/');
  }

  // GCS S3-interop: https://storage.googleapis.com/bucket/key?...
  if (clean.includes('storage.googleapis.com/')) {
    const idx = clean.indexOf('storage.googleapis.com/') + 'storage.googleapis.com/'.length;
    let remainder = clean.substring(idx).split('?')[0] || '';
    // Remove bucket prefix if present
    if (bucket && remainder.startsWith(bucket + '/')) {
      remainder = remainder.substring(bucket.length + 1);
    } else {
      // First path segment is bucket name
      const slashIdx = remainder.indexOf('/');
      if (slashIdx !== -1) {
        remainder = remainder.substring(slashIdx + 1);
      }
    }
    return remainder.startsWith('/') ? remainder.slice(1) : remainder;
  }

  // AWS virtual-hosted: https://bucket.s3.region.amazonaws.com/key
  if (clean.includes('.amazonaws.com')) {
    const comIdx = clean.lastIndexOf('.com/');
    if (comIdx !== -1) {
      const key = clean.substring(comIdx + 5).split('?')[0] || '';
      return key.startsWith('/') ? key.slice(1) : key;
    }
  }

  // AWS path-style: https://s3.amazonaws.com/bucket/key
  if (clean.includes('s3.amazonaws.com/')) {
    const idx = clean.indexOf('s3.amazonaws.com/') + 's3.amazonaws.com/'.length;
    let remainder = clean.substring(idx).split('?')[0] || '';
    const slashIdx = remainder.indexOf('/');
    if (slashIdx !== -1) {
      remainder = remainder.substring(slashIdx + 1);
    }
    return remainder.startsWith('/') ? remainder.slice(1) : remainder;
  }

  // Strip query params if present (probably already a key with leftover presign params)
  if (clean.includes('?')) {
    clean = clean.split('?')[0] || '';
  }

  return clean.startsWith('/') ? clean.slice(1) : clean;
}

/**
 * Generate a public (non-signed) URL for a given bucket and key.
 */
export function getPublicUrl(bucket: string, key: string): string {
  if (IS_GCP) {
    return `https://storage.googleapis.com/${bucket}/${key}`;
  }
  const region = process.env.AWS_REGION || 'us-east-1';
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * Check whether the current provider is GCP.
 */
export function isGCP(): boolean {
  return IS_GCP;
}

export { CLOUD_PROVIDER };
