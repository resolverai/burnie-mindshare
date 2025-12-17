/**
 * DVYB Image Regeneration Route
 * 
 * Handles regenerating images using AI (nano-banana edit).
 * Each regeneration creates a new entry in dvyb_image_regeneration table.
 */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybImageRegeneration } from '../models/DvybImageRegeneration';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import axios from 'axios';

const router = Router();
const s3Service = new S3PresignedUrlService();

// Environment variables
const PYTHON_AI_BACKEND_URL = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
const TYPESCRIPT_BACKEND_URL = process.env.TYPESCRIPT_BACKEND_URL || 'http://localhost:3001';

interface RegenerateRequest {
  generatedContentId: number;
  postIndex: number;
  prompt: string;
  sourceImageS3Key: string;
}

/**
 * POST /api/dvyb/image-regeneration/regenerate
 * Trigger image regeneration using AI
 */
router.post('/regenerate', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const body: RegenerateRequest = req.body;
    
    logger.info(`🎨 Image regeneration request for account ${accountId}, content ${body.generatedContentId}, post ${body.postIndex}`);
    logger.info(`📝 Prompt: ${body.prompt.substring(0, 50)}...`);
    
    const regenerationRepo = AppDataSource.getRepository(DvybImageRegeneration);
    
    // Create pending regeneration record
    const regeneration = regenerationRepo.create({
      accountId,
      generatedContentId: body.generatedContentId,
      postIndex: body.postIndex,
      prompt: body.prompt,
      sourceImageS3Key: body.sourceImageS3Key,
      status: 'pending',
      regeneratedBy: 'user', // User-initiated regeneration
      metadata: {
        model: 'fal-ai/nano-banana/edit',
        aspectRatio: '1:1',
      },
    });
    
    await regenerationRepo.save(regeneration);
    logger.info(`✅ Created regeneration record ID: ${regeneration.id}`);
    
    // Trigger Python AI backend
    const callbackUrl = `${TYPESCRIPT_BACKEND_URL}/api/dvyb/image-regeneration/callback`;
    
    try {
      await axios.post(
        `${PYTHON_AI_BACKEND_URL}/api/dvyb/image-regeneration/regenerate`,
        {
          accountId,
          generatedContentId: body.generatedContentId,
          postIndex: body.postIndex,
          prompt: body.prompt,
          sourceImageS3Key: body.sourceImageS3Key,
          callbackUrl,
          regenerationId: regeneration.id,
        },
        {
          timeout: 10000, // 10 second timeout for initial request
        }
      );
      
      regeneration.status = 'processing';
      await regenerationRepo.save(regeneration);
      
    } catch (pythonError: any) {
      logger.error(`❌ Failed to trigger Python backend: ${pythonError.message}`);
      regeneration.status = 'failed';
      regeneration.errorMessage = `Failed to trigger processing: ${pythonError.message}`;
      await regenerationRepo.save(regeneration);
    }
    
    return res.json({
      success: true,
      data: {
        id: regeneration.id,
        status: regeneration.status,
        message: 'Regeneration started. Processing in background.',
      },
    });
    
  } catch (error: any) {
    logger.error('Error starting image regeneration:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to start regeneration',
    });
  }
});

/**
 * POST /api/dvyb/image-regeneration/callback
 * Callback from Python AI backend when regeneration completes
 */
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const { success, regenerationId, regeneratedImageS3Key, error, processingTimeMs } = req.body;
    
    if (!regenerationId) {
      return res.status(400).json({ success: false, error: 'regenerationId required' });
    }
    
    logger.info(`📞 Regeneration callback for ID ${regenerationId}: success=${success}`);
    
    const regenerationRepo = AppDataSource.getRepository(DvybImageRegeneration);
    
    const regeneration = await regenerationRepo.findOne({
      where: { id: regenerationId },
    });
    
    if (!regeneration) {
      logger.error(`Regeneration not found: ${regenerationId}`);
      return res.status(404).json({ success: false, error: 'Regeneration not found' });
    }
    
    if (success) {
      regeneration.status = 'completed';
      regeneration.regeneratedImageS3Key = regeneratedImageS3Key;
      regeneration.metadata = {
        ...regeneration.metadata,
        processingTimeMs,
      };
      logger.info(`✅ Regeneration ${regenerationId} completed: ${regeneratedImageS3Key}`);
    } else {
      regeneration.status = 'failed';
      regeneration.errorMessage = error || 'Unknown error';
      logger.error(`❌ Regeneration ${regenerationId} failed: ${error}`);
    }
    
    await regenerationRepo.save(regeneration);
    
    return res.json({ success: true });
    
  } catch (error: any) {
    logger.error('Error processing regeneration callback:', error);
    return res.status(500).json({ success: false, error: 'Callback processing failed' });
  }
});

/**
 * GET /api/dvyb/image-regeneration/:generatedContentId/:postIndex
 * Get all regenerations for a specific post (for showing history)
 */
router.get('/:generatedContentId/:postIndex', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);
    
    const regenerationRepo = AppDataSource.getRepository(DvybImageRegeneration);
    
    // Only show user-created regenerations for DVYB frontend users
    // Admin regenerations are hidden from account users
    const regenerations = await regenerationRepo.find({
      where: {
        accountId,
        generatedContentId,
        postIndex,
        regeneratedBy: 'user', // Only show user-created regenerations
      },
      order: { createdAt: 'DESC' },
    });
    
    // Generate presigned URLs for completed regenerations
    const regenerationsWithUrls = await Promise.all(
      regenerations.map(async (regen) => {
        let regeneratedImageUrl: string | null = null;
        let sourceImageUrl: string | null = null;
        
        if (regen.regeneratedImageS3Key) {
          regeneratedImageUrl = await s3Service.generatePresignedUrl(regen.regeneratedImageS3Key, 3600, true);
        }
        
        if (regen.sourceImageS3Key) {
          sourceImageUrl = await s3Service.generatePresignedUrl(regen.sourceImageS3Key, 3600, true);
        }
        
        return {
          id: regen.id,
          prompt: regen.prompt,
          sourceImageS3Key: regen.sourceImageS3Key,
          sourceImageUrl,
          regeneratedImageS3Key: regen.regeneratedImageS3Key,
          regeneratedImageUrl,
          status: regen.status,
          errorMessage: regen.errorMessage,
          metadata: regen.metadata,
          createdAt: regen.createdAt,
        };
      })
    );
    
    return res.json({
      success: true,
      data: regenerationsWithUrls,
    });
    
  } catch (error: any) {
    logger.error('Error fetching regenerations:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch regenerations',
    });
  }
});

/**
 * GET /api/dvyb/image-regeneration/status/:regenerationId
 * Get status of a specific regeneration (for polling)
 */
router.get('/status/:regenerationId', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const regenerationId = parseInt(req.params.regenerationId!);
    
    const regenerationRepo = AppDataSource.getRepository(DvybImageRegeneration);
    
    const regeneration = await regenerationRepo.findOne({
      where: {
        id: regenerationId,
        accountId,
      },
    });
    
    if (!regeneration) {
      return res.status(404).json({
        success: false,
        error: 'Regeneration not found',
      });
    }
    
    let regeneratedImageUrl: string | null = null;
    if (regeneration.regeneratedImageS3Key) {
      regeneratedImageUrl = await s3Service.generatePresignedUrl(regeneration.regeneratedImageS3Key, 3600, true);
    }
    
    return res.json({
      success: true,
      data: {
        id: regeneration.id,
        status: regeneration.status,
        regeneratedImageS3Key: regeneration.regeneratedImageS3Key,
        regeneratedImageUrl,
        errorMessage: regeneration.errorMessage,
        metadata: regeneration.metadata,
      },
    });
    
  } catch (error: any) {
    logger.error('Error fetching regeneration status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch status',
    });
  }
});

export default router;

