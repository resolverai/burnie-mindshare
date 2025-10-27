import { redisClient } from '../config/redis';
import { logger } from '../config/logger';

export interface CachedUrl {
  presigned_url: string;
  expires_at: string;
  generated_at: string;
}

export class UrlCacheService {
  private static readonly CACHE_PREFIX = 'presigned_url:';
  private static readonly DEFAULT_TTL = 3300; // 55 minutes (5 minutes less than 1 hour to avoid edge cases)

  /**
   * Generate cache key for S3 key
   */
  private static getCacheKey(s3Key: string): string {
    return `${this.CACHE_PREFIX}${s3Key}`;
  }

  /**
   * Check if a presigned URL exists in cache and is not expired
   */
  static async getCachedUrl(s3Key: string): Promise<string | null> {
    try {
      const cacheKey = this.getCacheKey(s3Key);
      const cachedData = await redisClient.get(cacheKey);
      
      if (!cachedData) {
        logger.debug(`🔍 No cached URL found for S3 key: ${s3Key}`);
        return null;
      }

      const cachedUrl: CachedUrl = JSON.parse(cachedData);
      
      // Check if URL is expired
      const expiresAt = new Date(cachedUrl.expires_at);
      const now = new Date();
      
      if (now >= expiresAt) {
        logger.debug(`⏰ Cached URL expired for S3 key: ${s3Key}`);
        // Remove expired entry
        await redisClient.del(cacheKey);
        return null;
      }

      logger.info(`✅ Using cached presigned URL for S3 key: ${s3Key}`);
      return cachedUrl.presigned_url;
      
    } catch (error) {
      logger.error(`❌ Error retrieving cached URL for S3 key: ${s3Key}`, error);
      return null;
    }
  }

  /**
   * Cache a presigned URL with TTL
   */
  static async cacheUrl(s3Key: string, presignedUrl: string, ttlSeconds: number = this.DEFAULT_TTL): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(s3Key);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (ttlSeconds * 1000));
      
      const cachedUrl: CachedUrl = {
        presigned_url: presignedUrl,
        expires_at: expiresAt.toISOString(),
        generated_at: now.toISOString()
      };

      // Cache with TTL
      await redisClient.setEx(cacheKey, ttlSeconds, JSON.stringify(cachedUrl));
      
      logger.info(`💾 Cached presigned URL for S3 key: ${s3Key} (TTL: ${ttlSeconds}s)`);
      
    } catch (error) {
      logger.error(`❌ Error caching URL for S3 key: ${s3Key}`, error);
    }
  }

  /**
   * Remove cached URL (useful for cleanup)
   */
  static async removeCachedUrl(s3Key: string): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(s3Key);
      await redisClient.del(cacheKey);
      logger.debug(`🗑️ Removed cached URL for S3 key: ${s3Key}`);
    } catch (error) {
      logger.error(`❌ Error removing cached URL for S3 key: ${s3Key}`, error);
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<{ totalKeys: number; cacheKeys: number }> {
    try {
      const totalKeys = await redisClient.dbSize();
      const pattern = `${this.CACHE_PREFIX}*`;
      const cacheKeys = await redisClient.keys(pattern);
      
      return {
        totalKeys,
        cacheKeys: cacheKeys.length
      };
    } catch (error) {
      logger.error('❌ Error getting cache stats', error);
      return { totalKeys: 0, cacheKeys: 0 };
    }
  }

  /**
   * Clear all cached URLs (useful for maintenance)
   */
  static async clearAllCachedUrls(): Promise<void> {
    try {
      const pattern = `${this.CACHE_PREFIX}*`;
      const keys = await redisClient.keys(pattern);
      
      if (keys.length > 0) {
        await redisClient.del(keys);
        logger.info(`🗑️ Cleared ${keys.length} cached URLs`);
      } else {
        logger.info('ℹ️ No cached URLs to clear');
      }
    } catch (error) {
      logger.error('❌ Error clearing cached URLs', error);
    }
  }

  /**
   * Check if Redis is available
   */
  static async isRedisAvailable(): Promise<boolean> {
    try {
      await redisClient.ping();
      return true;
    } catch (error) {
      logger.error('❌ Redis is not available', error);
      return false;
    }
  }
}
