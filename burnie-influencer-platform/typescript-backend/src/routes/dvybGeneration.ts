import { Router, Response } from 'express';
import { DvybAuthRequest, dvybAuthMiddleware } from '../middleware/dvybAuthMiddleware';
import { AppDataSource } from '../config/database';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { logger } from '../config/logger';

const router = Router();

// Helper function to generate presigned URLs using local TypeScript S3 service
// This avoids blocking the Python backend during long-running video generation
async function generatePresignedUrl(s3Key: string): Promise<string | null> {
  try {
    // Use the local TypeScript S3 service (non-blocking)
    const { getS3PresignedUrlService } = await import('../services/S3PresignedUrlService');
    const s3Service = getS3PresignedUrlService();
    
    const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600, true); // 1 hour expiration, use cache
    
    if (presignedUrl) {
      logger.debug(`✅ Generated presigned URL for S3 key: ${s3Key.substring(0, 80)}...`);
    } else {
      logger.error(`❌ Failed to generate presigned URL for S3 key: ${s3Key}`);
    }
    
    return presignedUrl;
  } catch (error) {
    logger.error(`Error generating presigned URL for S3 key: ${s3Key}`, error);
    return null;
  }
}

/**
 * @route POST /api/dvyb/create
 * @description Create a new generation record (internal - no auth)
 * @access Internal (Python backend)
 */
router.post('/create', async (req, res) => {
  try {
    const {
      accountId,
      uuid,
      jobId,
      generationType,
      topic,
      userPrompt,
      userImages,
      numberOfPosts,
      requestedPlatforms,  // NEW: Platforms selected by user
      status,
      progressPercent,
      progressMessage,
    } = req.body;

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    const generation = generationRepo.create({
      accountId,
      uuid,
      jobId,
      generationType: generationType || 'on_demand',
      topic,
      userPrompt,
      userImages,
      numberOfPosts,
      requestedPlatforms: requestedPlatforms || null,  // NEW: Save selected platforms
      status: status || 'generating',
      progressPercent: progressPercent || 0,
      progressMessage: progressMessage || 'Starting generation...',
    });

    await generationRepo.save(generation);

    logger.info(`✅ Created generation record: ${uuid} for account ${accountId}`);

    return res.json({
      success: true,
      data: generation,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to create generation record:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/dvyb/update-progress
 * @description Update generation progress (internal - no auth)
 * @access Internal (Python backend)
 */
router.post('/update-progress', async (req, res) => {
  try {
    const {
      accountId,
      uuid,
      progressPercent,
      progressMessage,
      metadata,
    } = req.body;

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    // Find generation by UUID (more reliable than accountId + status)
    const generation = await generationRepo.findOne({
      where: { uuid },
    });

    if (!generation) {
      logger.warn(`❌ Generation not found for UUID: ${uuid} (accountId: ${accountId})`);
      return res.status(404).json({
        success: false,
        error: 'Generation not found',
        details: `No generation record found for UUID: ${uuid}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Update progress
    generation.progressPercent = progressPercent;
    generation.progressMessage = progressMessage;

    // Merge metadata (don't overwrite existing keys)
    if (metadata) {
      generation.metadata = generation.metadata || {};
      
      // Deep merge for nested objects
      Object.keys(metadata).forEach(key => {
        if (typeof metadata[key] === 'object' && !Array.isArray(metadata[key])) {
          generation.metadata![key] = {
            ...(generation.metadata![key] || {}),
            ...metadata[key]
          };
        } else {
          generation.metadata![key] = metadata[key];
        }
      });
    }

    await generationRepo.save(generation);

    logger.info(`✅ Updated progress for generation ${generation.uuid}: ${progressPercent}%`);

    return res.json({
      success: true,
      data: generation,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to update progress:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/dvyb/save-content
 * @description Save generated content (internal - no auth)
 * @access Internal (Python backend)
 */
router.post('/save-content', async (req, res) => {
  try {
    const {
      uuid,
      platformTexts,
      framePrompts,
      clipPrompts,
      generatedImageUrls,
      generatedVideoUrls,
      status,
      progressPercent,
      progressMessage,
    } = req.body;

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    const generation = await generationRepo.findOne({
      where: { uuid },
    });

    if (!generation) {
      return res.status(404).json({
        success: false,
        error: 'Generation not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Update content
    generation.platformTexts = platformTexts;
    generation.framePrompts = framePrompts;
    generation.clipPrompts = clipPrompts;
    generation.generatedImageUrls = generatedImageUrls;
    generation.generatedVideoUrls = generatedVideoUrls;
    generation.status = status || 'completed';
    generation.progressPercent = progressPercent || 100;
    generation.progressMessage = progressMessage || 'Completed!';

    await generationRepo.save(generation);

    logger.info(`✅ Saved generated content for ${uuid}`);

    return res.json({
      success: true,
      data: generation,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to save content:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/dvyb/update-progressive-content
 * @description Update a single piece of content progressively (internal - no auth)
 * @access Internal (Python backend)
 */
router.post('/update-progressive-content', async (req, res) => {
  try {
    const {
      accountId,
      uuid,
      postIndex,
      contentType,
      contentUrl,
      platformText,
    } = req.body;

    logger.debug(`📥 Received progressive update request:`, {
      accountId,
      uuid,
      postIndex,
      contentType,
      contentUrl: contentUrl?.substring(0, 80) + '...',
      platforms: platformText?.platforms ? Object.keys(platformText.platforms) : [],
    });

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    logger.debug(`🔍 Looking up generation with UUID: ${uuid}`);
    
    const generation = await generationRepo.findOne({
      where: { uuid },
    });

    if (!generation) {
      logger.warn(`❌ Generation not found for UUID: ${uuid} (accountId: ${accountId})`);
      logger.warn(`💡 Make sure /api/dvyb/create was called first to create the generation record`);
      return res.status(404).json({
        success: false,
        error: 'Generation not found',
        details: `No generation record found for UUID: ${uuid}`,
        timestamp: new Date().toISOString(),
      });
    }
    
    logger.debug(`✅ Found generation: accountId=${generation.accountId}, status=${generation.status}`);

    // Initialize arrays if they don't exist
    if (!generation.metadata) {
      generation.metadata = {};
    }
    if (!generation.metadata.progressiveContent) {
      generation.metadata.progressiveContent = [];
      logger.debug(`📂 Initialized progressiveContent array for ${uuid}`);
    }

    // Update or add the content for this post index
    const existingIndex = generation.metadata.progressiveContent.findIndex(
      (item: any) => item.postIndex === postIndex
    );

    const contentItem = {
      postIndex,
      contentType,
      contentUrl,
      platformText,
      generatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      // Update existing
      generation.metadata.progressiveContent[existingIndex] = contentItem;
      logger.debug(`🔄 Updated existing content at index ${existingIndex} for post ${postIndex}`);
    } else {
      // Add new
      generation.metadata.progressiveContent.push(contentItem);
      logger.debug(`➕ Added new content for post ${postIndex} (total: ${generation.metadata.progressiveContent.length})`);
    }

    // ALSO update main columns (generatedImageUrls, generatedVideoUrls, platformTexts)
    // This allows frontend to display content progressively
    
    // Initialize arrays if they don't exist
    if (!generation.generatedImageUrls) generation.generatedImageUrls = [];
    if (!generation.generatedVideoUrls) generation.generatedVideoUrls = [];
    if (!generation.platformTexts) generation.platformTexts = [];

    // Ensure arrays are large enough to hold this postIndex
    while (generation.generatedImageUrls.length <= postIndex) {
      (generation.generatedImageUrls as any).push(null);
    }
    while (generation.generatedVideoUrls.length <= postIndex) {
      (generation.generatedVideoUrls as any).push(null);
    }
    while (generation.platformTexts.length <= postIndex) {
      (generation.platformTexts as any).push(null);
    }

    // Update the appropriate array based on content type
    if (contentType === 'image') {
      generation.generatedImageUrls[postIndex] = contentUrl;
      logger.debug(`📸 Updated generatedImageUrls[${postIndex}] = ${contentUrl.substring(0, 50)}...`);
    } else if (contentType === 'video') {
      generation.generatedVideoUrls[postIndex] = contentUrl;
      logger.debug(`🎥 Updated generatedVideoUrls[${postIndex}] = ${contentUrl.substring(0, 50)}...`);
    }

    // Update platformTexts
    if (platformText) {
      generation.platformTexts[postIndex] = platformText;
      logger.debug(`📝 Updated platformTexts[${postIndex}]`);
    }

    await generationRepo.save(generation);

    logger.info(`✅ Progressive update saved for ${uuid}, post ${postIndex} (${contentType})`);
    logger.debug(`📊 Total progressive content items: ${generation.metadata.progressiveContent.length}`);

    return res.json({
      success: true,
      data: generation,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to save progressive update:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/dvyb/latest
 * @description Get the latest generation for an account (internal - no auth)
 * @access Internal (Python backend)
 */
router.get('/latest', async (req, res) => {
  try {
    const accountId = parseInt(req.query.accountId as string);

    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'Account ID required',
        timestamp: new Date().toISOString(),
      });
    }

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    const generation = await generationRepo.findOne({
      where: { accountId },
      order: { createdAt: 'DESC' },
    });

    if (!generation) {
      return res.json({
        success: true,
        data: null,
        timestamp: new Date().toISOString(),
      });
    }

    // Generate presigned URLs for all S3 assets before sending to frontend
    const generationWithPresignedUrls = { ...generation };

    // Generate presigned URLs for final images
    if (generation.generatedImageUrls && generation.generatedImageUrls.length > 0) {
      const presignedImageUrls = await Promise.all(
        generation.generatedImageUrls.map(async (s3Key: string | null) => {
          if (!s3Key) return null; // Keep nulls for index alignment
          const presignedUrl = await generatePresignedUrl(s3Key);
          return presignedUrl || s3Key; // Fallback to original if generation fails
        })
      );
      generationWithPresignedUrls.generatedImageUrls = presignedImageUrls as any; // Keep nulls for index alignment
    }

    // Generate presigned URLs for final videos
    if (generation.generatedVideoUrls && generation.generatedVideoUrls.length > 0) {
      const presignedVideoUrls = await Promise.all(
        generation.generatedVideoUrls.map(async (s3Key: string | null) => {
          if (!s3Key) return null; // Keep nulls for index alignment
          const presignedUrl = await generatePresignedUrl(s3Key);
          return presignedUrl || s3Key;
        })
      );
      generationWithPresignedUrls.generatedVideoUrls = presignedVideoUrls as any; // Keep nulls for index alignment
    }

    // Generate presigned URLs for progressive content
    if (generation.metadata?.progressiveContent) {
      const progressiveWithPresigned = await Promise.all(
        generation.metadata.progressiveContent.map(async (item: any) => {
          const presignedUrl = await generatePresignedUrl(item.contentUrl);
          return {
            ...item,
            contentUrl: presignedUrl || item.contentUrl
          };
        })
      );
      generationWithPresignedUrls.metadata = {
        ...generation.metadata,
        progressiveContent: progressiveWithPresigned
      };
    }

    // Remove IP-sensitive fields (framePrompts, clipPrompts) before sending to frontend
    delete (generationWithPresignedUrls as any).framePrompts;
    delete (generationWithPresignedUrls as any).clipPrompts;

    return res.json({
      success: true,
      data: generationWithPresignedUrls,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to get latest generation:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/dvyb/generation/:uuid
 * @description Get a specific generation by UUID
 * @access Private
 */
router.get('/:uuid', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: 'UUID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    const generation = await generationRepo.findOne({
      where: { uuid },
    });

    if (!generation) {
      return res.status(404).json({
        success: false,
        error: 'Generation not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Verify the user owns this generation
    if (generation.accountId !== req.dvybAccountId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: generation,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to get generation:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
