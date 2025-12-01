/**
 * S3 Presigned URL Service
 * 
 * Generates presigned URLs for secure access to S3 objects
 * Similar implementation to Python backend's s3_storage_service.py
 */

import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../config/logger';
import { UrlCacheService } from './UrlCacheService';

export class S3PresignedUrlService {
  private s3Client: S3Client;
  private bucketName: string;
  private defaultExpiration: number = 3600; // 1 hour (same as Python backend)
  private maxExpiration: number = 3600; // Max 1 hour for security

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Missing required AWS credentials. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in environment variables.');
    }

    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.bucketName = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';
    
    logger.info(`✅ S3PresignedUrlService initialized: bucket=${this.bucketName}, region=${region}`);
  }

  /**
   * Generate a presigned URL for an S3 object with Redis caching
   * 
   * @param s3Key - The S3 object key (path within bucket)
   * @param expiration - URL expiration time in seconds (default: 3600, max: 3600)
   * @param useCache - Whether to use Redis caching (default: true)
   * @returns Presigned URL or null if generation fails
   */
  async generatePresignedUrl(
    s3Key: string,
    expiration: number = this.defaultExpiration,
    useCache: boolean = true
  ): Promise<string | null> {
    try {
      // Clean the S3 key
      let cleanKey = s3Key;
      
      // Step 1: Handle URL-encoded URLs (e.g., https%3A//...)
      if (cleanKey.includes('%3A//') || cleanKey.includes('%3a//')) {
        try {
          cleanKey = decodeURIComponent(cleanKey);
          logger.debug(`Decoded URL-encoded key: ${cleanKey}`);
        } catch (e) {
          logger.warn('Failed to decode URL-encoded key, continuing with original');
        }
      }
      
      // Step 2: Handle full S3 URLs (including nested/double-encoded URLs)
      // Check for .amazonaws.com (works with all regions: s3.amazonaws.com, s3.us-east-1.amazonaws.com, etc.)
      if (cleanKey.includes('.amazonaws.com')) {
        // Use lastIndexOf to handle nested URLs like:
        // https://.../https://.../actual-key.mp4
        const lastComIndex = cleanKey.lastIndexOf('.com/');
        if (lastComIndex !== -1) {
          cleanKey = cleanKey.substring(lastComIndex + 5); // +5 for '.com/'
          logger.debug(`Extracted key from S3 URL: ${cleanKey}`);
        }
      }
      // Handle s3://bucket/key format
      else if (cleanKey.startsWith('s3://')) {
        const parts = cleanKey.replace('s3://', '').split('/');
        cleanKey = parts.slice(1).join('/'); // Remove bucket name
      }
      
      // Step 3: Remove query parameters (e.g., ?X-Amz-Algorithm=...)
      if (cleanKey.includes('?')) {
        cleanKey = cleanKey.split('?')[0] || '';
        logger.debug(`Removed query params: ${cleanKey}`);
      }
      
      // Step 4: Remove leading slash if present
      cleanKey = cleanKey.startsWith('/') ? cleanKey.slice(1) : cleanKey;

      // Validate expiration (max 1 hour for security, same as Python backend)
      const validatedExpiration = Math.min(expiration, this.maxExpiration);

      // Check Redis cache first (TTL: 55 minutes)
      if (useCache) {
        const isRedisAvailable = await UrlCacheService.isRedisAvailable();
        if (isRedisAvailable) {
          const cachedUrl = await UrlCacheService.getCachedUrl(cleanKey);
          if (cachedUrl) {
            logger.debug(`✅ Using cached presigned URL for S3 key: ${cleanKey}`);
            return cachedUrl;
          }
        }
      }

      logger.info(`🔗 Generating presigned URL for: ${cleanKey} (expires in ${validatedExpiration}s)`);

      // Generate presigned URL using AWS SDK v3
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: cleanKey,
      });

      const presignedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: validatedExpiration,
      });

      // Calculate expiration timestamp
      const expiresAt = new Date(Date.now() + validatedExpiration * 1000);
      
      logger.info(`✅ Presigned URL generated, expires at: ${expiresAt.toISOString()}`);

      // Cache the URL with 55-minute TTL (3300 seconds) if Redis is available
      if (useCache) {
        const isRedisAvailable = await UrlCacheService.isRedisAvailable();
        if (isRedisAvailable) {
          await UrlCacheService.cacheUrl(cleanKey, presignedUrl, 3300); // 55 minutes
          logger.debug(`💾 Cached presigned URL for S3 key: ${cleanKey}`);
        }
      }

      return presignedUrl;
    } catch (error: any) {
      logger.error(`❌ Failed to generate presigned URL for S3 key: ${s3Key}`, error);
      return null;
    }
  }

  /**
   * Generate presigned URLs for multiple S3 keys
   * 
   * @param s3Keys - Array of S3 object keys
   * @param expiration - URL expiration time in seconds
   * @param useCache - Whether to use Redis caching
   * @returns Array of presigned URLs (null for failed generations)
   */
  async generatePresignedUrls(
    s3Keys: string[],
    expiration: number = this.defaultExpiration,
    useCache: boolean = true
  ): Promise<(string | null)[]> {
    logger.info(`🔗 Generating presigned URLs for ${s3Keys.length} S3 keys`);
    
    const results = await Promise.all(
      s3Keys.map(key => this.generatePresignedUrl(key, expiration, useCache))
    );

    const successCount = results.filter(url => url !== null).length;
    logger.info(`✅ Generated ${successCount}/${s3Keys.length} presigned URLs`);

    return results;
  }

  /**
   * Check if an S3 object exists
   * 
   * @param s3Key - The S3 object key
   * @returns True if object exists, false otherwise
   */
  async objectExists(s3Key: string): Promise<boolean> {
    try {
      // Clean the S3 key
      let cleanKey = s3Key;
      if (s3Key.startsWith('s3://')) {
        const parts = s3Key.replace('s3://', '').split('/');
        cleanKey = parts.slice(1).join('/');
      }
      cleanKey = cleanKey.startsWith('/') ? cleanKey.slice(1) : cleanKey;

      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: cleanKey,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      logger.error(`❌ Error checking S3 object existence: ${s3Key}`, error);
      return false;
    }
  }

  /**
   * Get S3 bucket name
   */
  getBucketName(): string {
    return this.bucketName;
  }
}

// Singleton instance
let s3PresignedUrlServiceInstance: S3PresignedUrlService | null = null;

/**
 * Get singleton instance of S3PresignedUrlService
 */
export function getS3PresignedUrlService(): S3PresignedUrlService {
  if (!s3PresignedUrlServiceInstance) {
    s3PresignedUrlServiceInstance = new S3PresignedUrlService();
  }
  return s3PresignedUrlServiceInstance;
}

