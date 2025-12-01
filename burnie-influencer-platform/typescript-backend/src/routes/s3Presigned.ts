/**
 * S3 Presigned URL Routes
 * 
 * Endpoints for generating presigned URLs for secure S3 access
 * Similar to Python backend's s3_health.py
 */

import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { getS3PresignedUrlService } from '../services/S3PresignedUrlService';

const router = Router();

/**
 * @route POST /api/s3/generate-presigned-url
 * @description Generate a presigned URL for an S3 object
 * @access Internal (no auth required - used by other backend services)
 * 
 * Query Parameters:
 * - s3_key: The S3 object key (required)
 * - expiration: URL expiration time in seconds (optional, default: 3600, max: 3600)
 * 
 * Response Format (matches Python backend):
 * {
 *   "status": "success" | "failed",
 *   "presigned_url": "https://...",
 *   "details": {
 *     "s3_key": "dvyb/generated/...",
 *     "bucket": "burnie-mindshare-content-staging",
 *     "expires_in_seconds": 3600,
 *     "expires_at": "2025-11-27T14:00:00.000Z",
 *     "generated_at": "2025-11-27T13:00:00.000Z"
 *   }
 * }
 */
router.post('/generate-presigned-url', async (req: Request, res: Response) => {
  try {
    const s3Key = req.query.s3_key as string;
    const expirationParam = req.query.expiration as string;
    
    if (!s3Key) {
      return res.status(400).json({
        status: 'failed',
        error: 'Missing required parameter: s3_key',
        timestamp: new Date().toISOString(),
      });
    }

    // Parse expiration (default: 3600 seconds = 1 hour, max: 3600)
    let expiration = 3600;
    if (expirationParam) {
      const parsed = parseInt(expirationParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        expiration = Math.min(parsed, 3600); // Max 1 hour for security
      }
    }

    logger.info(`📡 Presigned URL request: s3_key=${s3Key.substring(0, 80)}..., expiration=${expiration}s`);

    const s3Service = getS3PresignedUrlService();
    const presignedUrl = await s3Service.generatePresignedUrl(s3Key, expiration);

    if (!presignedUrl) {
      return res.status(500).json({
        status: 'failed',
        error: 'Failed to generate presigned URL',
        s3_key: s3Key,
        timestamp: new Date().toISOString(),
      });
    }

    // Calculate timestamps
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + expiration * 1000);

    // Response format matching Python backend
    return res.json({
      status: 'success',
      presigned_url: presignedUrl,
      details: {
        s3_key: s3Key,
        bucket: s3Service.getBucketName(),
        expires_in_seconds: expiration,
        expires_at: expiresAt.toISOString(),
        generated_at: generatedAt.toISOString(),
      },
    });
  } catch (error: any) {
    logger.error('❌ Failed to generate presigned URL:', error);
    return res.status(500).json({
      status: 'failed',
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/s3/generate-presigned-urls-batch
 * @description Generate presigned URLs for multiple S3 objects
 * @access Internal (no auth required)
 * 
 * Request Body:
 * {
 *   "s3_keys": ["key1", "key2", ...],
 *   "expiration": 3600 (optional)
 * }
 */
router.post('/generate-presigned-urls-batch', async (req: Request, res: Response) => {
  try {
    const { s3_keys, expiration = 3600 } = req.body;

    if (!s3_keys || !Array.isArray(s3_keys) || s3_keys.length === 0) {
      return res.status(400).json({
        status: 'failed',
        error: 'Missing or invalid s3_keys array',
        timestamp: new Date().toISOString(),
      });
    }

    const validatedExpiration = Math.min(expiration, 3600);

    logger.info(`📡 Batch presigned URL request: ${s3_keys.length} keys, expiration=${validatedExpiration}s`);

    const s3Service = getS3PresignedUrlService();
    const presignedUrls = await s3Service.generatePresignedUrls(s3_keys, validatedExpiration);

    const results = s3_keys.map((key, index) => ({
      s3_key: key,
      presigned_url: presignedUrls[index],
      success: presignedUrls[index] !== null,
    }));

    const successCount = results.filter(r => r.success).length;

    return res.json({
      status: 'success',
      total: s3_keys.length,
      successful: successCount,
      failed: s3_keys.length - successCount,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to generate batch presigned URLs:', error);
    return res.status(500).json({
      status: 'failed',
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/s3/health
 * @description Check S3 service health
 * @access Internal
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const s3Service = getS3PresignedUrlService();
    
    return res.json({
      service: 'S3 Presigned URL Service',
      status: 'healthy',
      bucket: s3Service.getBucketName(),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ S3 health check failed:', error);
    return res.status(500).json({
      service: 'S3 Presigned URL Service',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

