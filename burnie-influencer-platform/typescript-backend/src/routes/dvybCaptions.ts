import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybCaption } from '../models/DvybCaption';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/dvyb/captions
 * Get all edited captions for a specific content
 * Query params: generatedContentId, postIndex (optional)
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const generatedContentId = req.query.generatedContentId 
      ? parseInt(req.query.generatedContentId as string) 
      : null;
    const postIndex = req.query.postIndex !== undefined
      ? parseInt(req.query.postIndex as string)
      : null;

    if (!generatedContentId) {
      return res.status(400).json({
        success: false,
        error: 'generatedContentId is required',
      });
    }

    const captionRepo = AppDataSource.getRepository(DvybCaption);
    
    const whereClause: any = {
      accountId,
      generatedContentId,
    };
    
    if (postIndex !== null) {
      whereClause.postIndex = postIndex;
    }

    const captions = await captionRepo.find({
      where: whereClause,
    });

    // Transform to a map for easier frontend use: { platform: caption }
    const captionMap: Record<string, string> = {};
    captions.forEach(c => {
      captionMap[c.platform] = c.caption;
    });

    return res.json({
      success: true,
      data: {
        captions: captionMap,
        raw: captions,
      },
    });
  } catch (error: any) {
    logger.error('❌ Get captions error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get captions',
    });
  }
});

/**
 * POST /api/dvyb/captions
 * Save or update a caption for a specific platform
 * Body: { generatedContentId, postIndex, platform, caption }
 */
router.post('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const { generatedContentId, postIndex, platform, caption } = req.body;

    if (!generatedContentId || postIndex === undefined || !platform || caption === undefined) {
      return res.status(400).json({
        success: false,
        error: 'generatedContentId, postIndex, platform, and caption are required',
      });
    }

    const captionRepo = AppDataSource.getRepository(DvybCaption);

    // Try to find existing caption
    let existingCaption = await captionRepo.findOne({
      where: {
        accountId,
        generatedContentId,
        postIndex,
        platform,
      },
    });

    if (existingCaption) {
      // Update existing
      existingCaption.caption = caption;
      await captionRepo.save(existingCaption);
      logger.info(`✅ Updated caption for account ${accountId}, content ${generatedContentId}, post ${postIndex}, platform ${platform}`);
    } else {
      // Create new
      existingCaption = captionRepo.create({
        accountId,
        generatedContentId,
        postIndex,
        platform,
        caption,
      });
      await captionRepo.save(existingCaption);
      logger.info(`✅ Created caption for account ${accountId}, content ${generatedContentId}, post ${postIndex}, platform ${platform}`);
    }

    return res.json({
      success: true,
      data: existingCaption,
    });
  } catch (error: any) {
    logger.error('❌ Save caption error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save caption',
    });
  }
});

/**
 * DELETE /api/dvyb/captions/:id
 * Delete a specific caption
 */
router.delete('/:id', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    const captionId = parseInt(req.params.id || '0');

    const captionRepo = AppDataSource.getRepository(DvybCaption);
    
    const caption = await captionRepo.findOne({
      where: {
        id: captionId,
        accountId,
      },
    });

    if (!caption) {
      return res.status(404).json({
        success: false,
        error: 'Caption not found',
      });
    }

    await captionRepo.remove(caption);

    return res.json({
      success: true,
      message: 'Caption deleted',
    });
  } catch (error: any) {
    logger.error('❌ Delete caption error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete caption',
    });
  }
});

export default router;

