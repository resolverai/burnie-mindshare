/**
 * DVYB Image Edits Route
 * 
 * Handles saving and processing image edits (text overlays, emojis, stickers)
 */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybImageEdit } from '../models/DvybImageEdit';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import axios from 'axios';

const router = Router();
const s3Service = new S3PresignedUrlService();

// Environment variables
const PYTHON_AI_BACKEND_URL = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';

interface SaveImageEditRequest {
  generatedContentId: number;
  postIndex: number;
  originalImageUrl: string;
  regeneratedImageUrl?: string | null;
  overlays: Array<{
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    fontSize: number;
    fontFamily: string;
    color: string;
    isBold: boolean;
    isItalic: boolean;
    isUnderline: boolean;
    isEmoji?: boolean;
    isSticker?: boolean;
  }>;
  referenceWidth?: number;
}

/**
 * POST /api/dvyb/image-edits
 * Save image edit and trigger background processing
 */
router.post('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const body: SaveImageEditRequest = req.body;
    
    logger.info(`📝 Saving image edit for account ${accountId}, content ${body.generatedContentId}, post ${body.postIndex}`);
    
    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
    
    // Check if edit already exists (upsert)
    let imageEdit = await imageEditRepo.findOne({
      where: {
        accountId,
        generatedContentId: body.generatedContentId,
        postIndex: body.postIndex,
      },
    });
    
    if (imageEdit) {
      // Update existing
      imageEdit.originalImageUrl = body.originalImageUrl;
      imageEdit.regeneratedImageUrl = body.regeneratedImageUrl || null;
      imageEdit.overlays = body.overlays;
      imageEdit.referenceWidth = body.referenceWidth || 450;
      imageEdit.status = 'pending';
      imageEdit.errorMessage = null;
      imageEdit.editedImageUrl = null; // Reset since we're reprocessing
    } else {
      // Create new
      imageEdit = imageEditRepo.create({
        accountId,
        generatedContentId: body.generatedContentId,
        postIndex: body.postIndex,
        originalImageUrl: body.originalImageUrl,
        regeneratedImageUrl: body.regeneratedImageUrl || null,
        overlays: body.overlays,
        referenceWidth: body.referenceWidth || 450,
        status: 'pending',
      });
    }
    
    await imageEditRepo.save(imageEdit);
    logger.info(`✅ Image edit saved with ID ${imageEdit.id}`);
    
    // Trigger background processing
    const sourceImageUrl = body.regeneratedImageUrl || body.originalImageUrl;
    
    // Call Python AI backend asynchronously
    triggerImageProcessing(imageEdit.id, accountId, body.generatedContentId, body.postIndex, sourceImageUrl, body.overlays, body.referenceWidth || 450);
    
    return res.json({
      success: true,
      data: {
        id: imageEdit.id,
        status: 'pending',
        message: 'Image edit saved. Processing in background.',
      },
    });
    
  } catch (error) {
    logger.error('Error saving image edit:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save image edit',
    });
  }
});

/**
 * GET /api/dvyb/image-edits/:generatedContentId/:postIndex
 * Get image edit status and result
 */
router.get('/:generatedContentId/:postIndex', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);
    
    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
    
    const imageEdit = await imageEditRepo.findOne({
      where: {
        accountId,
        generatedContentId,
        postIndex,
      },
    });
    
    if (!imageEdit) {
      return res.json({
        success: true,
        data: null,
      });
    }
    
    // Generate presigned URLs for all image fields
    let originalImageUrl: string | null = null;
    let regeneratedImageUrl: string | null = null;
    let editedImageUrl: string | null = null;
    
    if (imageEdit.originalImageUrl) {
      originalImageUrl = await s3Service.generatePresignedUrl(imageEdit.originalImageUrl, 3600, true);
    }
    
    if (imageEdit.regeneratedImageUrl) {
      regeneratedImageUrl = await s3Service.generatePresignedUrl(imageEdit.regeneratedImageUrl, 3600, true);
    }
    
    if (imageEdit.editedImageUrl) {
      editedImageUrl = await s3Service.generatePresignedUrl(imageEdit.editedImageUrl, 3600, true);
    }
    
    return res.json({
      success: true,
      data: {
        id: imageEdit.id,
        status: imageEdit.status,
        editedImageUrl,
        originalImageUrl,
        regeneratedImageUrl,
        overlays: imageEdit.overlays,
        referenceWidth: imageEdit.referenceWidth,
        errorMessage: imageEdit.errorMessage,
        createdAt: imageEdit.createdAt,
        updatedAt: imageEdit.updatedAt,
      },
    });
    
  } catch (error) {
    logger.error('Error fetching image edit:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch image edit',
    });
  }
});

/**
 * POST /api/dvyb/image-edits/callback
 * Callback from Python AI backend when processing is complete
 */
router.post('/callback', async (req: Request, res: Response) => {
  try {
    const { accountId, generatedContentId, postIndex, success, editedImageUrl, error } = req.body;
    
    logger.info(`📥 Image edit callback: account=${accountId}, content=${generatedContentId}, post=${postIndex}, success=${success}`);
    
    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
    
    const imageEdit = await imageEditRepo.findOne({
      where: {
        accountId,
        generatedContentId,
        postIndex,
      },
    });
    
    if (!imageEdit) {
      logger.warn(`Image edit not found for callback: ${accountId}/${generatedContentId}/${postIndex}`);
      return res.status(404).json({ success: false, error: 'Image edit not found' });
    }
    
    if (success) {
      imageEdit.status = 'completed';
      imageEdit.editedImageUrl = editedImageUrl;
      imageEdit.errorMessage = null;
      logger.info(`✅ Image edit completed: ${editedImageUrl}`);
    } else {
      imageEdit.status = 'failed';
      imageEdit.errorMessage = error || 'Unknown error';
      logger.error(`❌ Image edit failed: ${error}`);
    }
    
    await imageEditRepo.save(imageEdit);
    
    return res.json({ success: true });
    
  } catch (error) {
    logger.error('Error processing image edit callback:', error);
    return res.status(500).json({ success: false, error: 'Callback processing failed' });
  }
});

/**
 * POST /api/dvyb/image-edits/refresh-url
 * Get a fresh presigned URL for an S3 key (to handle expired URLs)
 */
router.post('/refresh-url', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    
    const { s3Key } = req.body;
    
    if (!s3Key) {
      return res.status(400).json({ success: false, error: 's3Key is required' });
    }
    
    logger.info(`🔄 Refreshing presigned URL for account ${accountId}, key: ${s3Key.substring(0, 50)}...`);
    
    // Generate fresh presigned URL
    const presignedUrl = await s3Service.generatePresignedUrl(s3Key, 3600, true);
    
    if (!presignedUrl) {
      return res.status(500).json({ success: false, error: 'Failed to generate presigned URL' });
    }
    
    return res.json({
      success: true,
      data: {
        presignedUrl,
      },
    });
    
  } catch (error: any) {
    logger.error('Error refreshing presigned URL:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to refresh URL',
    });
  }
});

/**
 * Trigger image processing in Python AI backend
 */
async function triggerImageProcessing(
  editId: number,
  accountId: number,
  generatedContentId: number,
  postIndex: number,
  sourceImageUrl: string,
  overlays: any[],
  referenceWidth: number
) {
  try {
    const callbackUrl = `${process.env.TYPESCRIPT_BACKEND_URL || 'http://localhost:3001'}/api/dvyb/image-edits/callback`;
    
    logger.info(`🚀 Triggering image processing at ${PYTHON_AI_BACKEND_URL}/api/dvyb/image-overlay/process`);
    
    const response = await axios.post(
      `${PYTHON_AI_BACKEND_URL}/api/dvyb/image-overlay/process`,
      {
        accountId,
        generatedContentId,
        postIndex,
        sourceImageUrl,
        overlays,
        referenceWidth,
        callbackUrl,
      },
      {
        timeout: 120000, // 2 minute timeout
      }
    );
    
    logger.info(`✅ Image processing triggered: ${JSON.stringify(response.data)}`);
    
  } catch (error: any) {
    logger.error(`❌ Failed to trigger image processing: ${error.message}`);
    
    // Update status to failed
    try {
      const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
      await imageEditRepo.update(
        { id: editId },
        { status: 'failed', errorMessage: `Failed to trigger processing: ${error.message}` }
      );
    } catch (updateError) {
      logger.error('Failed to update image edit status:', updateError);
    }
  }
}

export default router;

