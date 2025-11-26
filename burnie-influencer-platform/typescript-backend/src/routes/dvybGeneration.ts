import { Router, Response } from 'express';
import { DvybAuthRequest, dvybAuthMiddleware } from '../middleware/dvybAuthMiddleware';
import { AppDataSource } from '../config/database';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { logger } from '../config/logger';

const router = Router();

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
      progressPercent,
      progressMessage,
      metadata,
    } = req.body;

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    // Find the latest generation for this account
    const generation = await generationRepo.findOne({
      where: { accountId, status: 'generating' },
      order: { createdAt: 'DESC' },
    });

    if (!generation) {
      return res.status(404).json({
        success: false,
        error: 'No active generation found',
        timestamp: new Date().toISOString(),
      });
    }

    // Update progress
    generation.progressPercent = progressPercent;
    generation.progressMessage = progressMessage;

    if (metadata) {
      generation.metadata = {
        ...generation.metadata,
        ...metadata,
      };
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

    return res.json({
      success: true,
      data: generation,
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
