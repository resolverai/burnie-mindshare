/**
 * S3 Presigned URL Service
 * 
 * Generates presigned URLs for secure access to storage objects.
 * Supports both AWS S3 and GCS (via S3-interop) based on CLOUD_PROVIDER env.
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client } from '@aws-sdk/client-s3';
import { logger } from '../config/logger';
import { UrlCacheService } from './UrlCacheService';
import { createS3ClientV3, getDefaultBucket, extractStorageKey } from './StorageConfig';

export class S3PresignedUrlService {
  private s3Client: S3Client;
  private bucketName: string;
  private defaultExpiration: number = 3600;
  private maxExpiration: number = 3600;

  constructor() {
    this.s3Client = createS3ClientV3();
    this.bucketName = getDefaultBucket();
    
    logger.info(`S3PresignedUrlService initialized: bucket=${this.bucketName}`);
  }

  async generatePresignedUrl(
    s3Key: string,
    expiration: number = this.defaultExpiration,
    useCache: boolean = true
  ): Promise<string | null> {
    try {
      let cleanKey = extractStorageKey(s3Key, this.bucketName);

      const validatedExpiration = Math.min(expiration, this.maxExpiration);

      if (useCache) {
        const isRedisAvailable = await UrlCacheService.isRedisAvailable();
        if (isRedisAvailable) {
          const cachedUrl = await UrlCacheService.getCachedUrl(cleanKey);
          if (cachedUrl) {
            logger.debug(`Using cached presigned URL for key: ${cleanKey}`);
            return cachedUrl;
          }
        }
      }

      logger.info(`Generating presigned URL for: ${cleanKey} (expires in ${validatedExpiration}s)`);

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: cleanKey,
      });

      const presignedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: validatedExpiration,
      });

      const expiresAt = new Date(Date.now() + validatedExpiration * 1000);
      
      logger.info(`Presigned URL generated, expires at: ${expiresAt.toISOString()}`);

      if (useCache) {
        const isRedisAvailable = await UrlCacheService.isRedisAvailable();
        if (isRedisAvailable) {
          await UrlCacheService.cacheUrl(cleanKey, presignedUrl, 3300);
          logger.debug(`Cached presigned URL for key: ${cleanKey}`);
        }
      }

      return presignedUrl;
    } catch (error: any) {
      logger.error(`Failed to generate presigned URL for key: ${s3Key}`, error);
      return null;
    }
  }

  async generatePresignedUrls(
    s3Keys: string[],
    expiration: number = this.defaultExpiration,
    useCache: boolean = true
  ): Promise<(string | null)[]> {
    logger.info(`Generating presigned URLs for ${s3Keys.length} keys`);
    
    const results = await Promise.all(
      s3Keys.map(key => this.generatePresignedUrl(key, expiration, useCache))
    );

    const successCount = results.filter(url => url !== null).length;
    logger.info(`Generated ${successCount}/${s3Keys.length} presigned URLs`);

    return results;
  }

  async objectExists(s3Key: string): Promise<boolean> {
    try {
      let cleanKey = extractStorageKey(s3Key, this.bucketName);

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
      logger.error(`Error checking object existence: ${s3Key}`, error);
      return false;
    }
  }

  async generatePresignedUploadUrl(
    s3Key: string,
    method: 'PUT' | 'POST' = 'PUT',
    expiration: number = 3600
  ): Promise<string> {
    try {
      let cleanKey = extractStorageKey(s3Key, this.bucketName);

      logger.info(`Generating presigned upload URL for: ${cleanKey} (expires in ${expiration}s)`);

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: cleanKey,
      });

      const presignedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiration,
      });

      logger.info(`Presigned upload URL generated`);
      return presignedUrl;
    } catch (error: any) {
      logger.error(`Failed to generate presigned upload URL for key: ${s3Key}`, error);
      throw error;
    }
  }

  getBucketName(): string {
    return this.bucketName;
  }
}

let s3PresignedUrlServiceInstance: S3PresignedUrlService | null = null;

export function getS3PresignedUrlService(): S3PresignedUrlService {
  if (!s3PresignedUrlServiceInstance) {
    s3PresignedUrlServiceInstance = new S3PresignedUrlService();
  }
  return s3PresignedUrlServiceInstance;
}
