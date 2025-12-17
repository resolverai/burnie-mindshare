import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybAccount } from '../models/DvybAccount';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybAdminContentApproval } from '../models/DvybAdminContentApproval';
import { DvybCaption } from '../models/DvybCaption';
import { DvybImageEdit } from '../models/DvybImageEdit';
import { DvybImageRegeneration } from '../models/DvybImageRegeneration';
import { DvybContext } from '../models/DvybContext';
import { logger } from '../config/logger';
import { S3PresignedUrlService } from '../services/S3PresignedUrlService';
import axios from 'axios';

// Environment variables
const PYTHON_AI_BACKEND_URL = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
const TYPESCRIPT_BACKEND_URL = process.env.TYPESCRIPT_BACKEND_URL || 'http://localhost:3001';

const router = Router();
const s3Service = new S3PresignedUrlService();

/**
 * GET /api/admin/dvyb-automated-content/accounts
 * Get all accounts that have auto-generated content
 */
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const contextRepo = AppDataSource.getRepository(DvybContext);
    const generatedContentRepo = AppDataSource.getRepository(DvybGeneratedContent);

    // Get all accounts with auto-generated content
    const accountsWithAutoContent = await generatedContentRepo
      .createQueryBuilder('gc')
      .select('DISTINCT gc.accountId', 'accountId')
      .where('gc.generationType = :type', { type: 'auto' })
      .getRawMany();

    const accountIds = accountsWithAutoContent.map(a => a.accountId);

    if (accountIds.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    // Get account details
    const accounts = await accountRepo
      .createQueryBuilder('account')
      .where('account.id IN (:...ids)', { ids: accountIds })
      .orderBy('account.accountName', 'ASC')
      .getMany();

    // Get context details for account names
    const contexts = await contextRepo
      .createQueryBuilder('context')
      .where('context.accountId IN (:...ids)', { ids: accountIds })
      .getMany();

    const contextMap = new Map(contexts.map(c => [c.accountId, c]));

    // Get pending approval counts per account
    const approvalRepo = AppDataSource.getRepository(DvybAdminContentApproval);
    const pendingCounts = await approvalRepo
      .createQueryBuilder('approval')
      .select('approval.accountId', 'accountId')
      .addSelect('COUNT(*)', 'pendingCount')
      .where('approval.status = :status', { status: 'pending' })
      .groupBy('approval.accountId')
      .getRawMany();

    const pendingCountMap = new Map(pendingCounts.map(p => [p.accountId, parseInt(p.pendingCount)]));

    const accountsWithStats = accounts.map(account => {
      const context = contextMap.get(account.id);
      return {
        id: account.id,
        // Prefer accountName from context, fallback to account.accountName
        accountName: context?.accountName || account.accountName,
        primaryEmail: account.primaryEmail,
        pendingApprovals: pendingCountMap.get(account.id) || 0,
      };
    });

    return res.json({
      success: true,
      data: accountsWithStats,
    });
  } catch (error: any) {
    logger.error('Error fetching accounts with auto content:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch accounts',
    });
  }
});

/**
 * GET /api/admin/dvyb-automated-content/:accountId
 * Get all auto-generated content for a specific account with approval status
 */
router.get('/:accountId', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
    const { status } = req.query; // Optional filter: 'pending', 'approved', 'rejected', or 'all'

    const generatedContentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const approvalRepo = AppDataSource.getRepository(DvybAdminContentApproval);
    const captionRepo = AppDataSource.getRepository(DvybCaption);

    // Get all auto-generated content for this account
    const generations = await generatedContentRepo.find({
      where: {
        accountId,
        generationType: 'auto',
      },
      order: { createdAt: 'DESC' },
    });

    if (generations.length === 0) {
      return res.json({
        success: true,
        data: [],
        stats: { total: 0, pending: 0, approved: 0, rejected: 0 },
      });
    }

    // Get all approval records for these generations
    const generationIds = generations.map(g => g.id);
    const approvals = await approvalRepo
      .createQueryBuilder('approval')
      .where('approval.generatedContentId IN (:...ids)', { ids: generationIds })
      .getMany();

    const approvalMap = new Map<string, DvybAdminContentApproval>();
    approvals.forEach(approval => {
      const key = `${approval.generatedContentId}-${approval.postIndex}`;
      approvalMap.set(key, approval);
    });

    // Get all captions for these generations
    const allCaptions = await captionRepo
      .createQueryBuilder('caption')
      .where('caption.generatedContentId IN (:...ids)', { ids: generationIds })
      .andWhere('caption.accountId = :accountId', { accountId })
      .getMany();

    // Create caption lookup map: "contentId-postIndex-platform" -> caption
    const captionMap = new Map<string, string>();
    allCaptions.forEach(caption => {
      const key = `${caption.generatedContentId}-${caption.postIndex}-${caption.platform}`;
      captionMap.set(key, caption.caption);
    });

    // Get all completed image edits for this account
    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
    const allImageEdits = await imageEditRepo.find({
      where: { accountId },
    });

    // Create image edit lookup map: "contentId-postIndex" -> { editedImageUrl, status }
    const imageEditMap = new Map<string, { editedImageUrl: string | null; status: string }>();
    for (const edit of allImageEdits) {
      imageEditMap.set(`${edit.generatedContentId}-${edit.postIndex}`, {
        editedImageUrl: edit.editedImageUrl,
        status: edit.status,
      });
    }
    logger.info(`🎨 Found ${allImageEdits.length} image edits for account ${accountId}`);

    // Transform generations into content items
    // IMPORTANT: Use platformTexts structure to get correct post_index
    const contentItems: any[] = [];

    for (const generation of generations) {
      const platformTextsArray = generation.platformTexts || [];
      const imageUrls = generation.generatedImageUrls || [];
      const videoUrls = generation.generatedVideoUrls || [];

      let imageCounter = 0;
      let videoCounter = 0;

      for (let i = 0; i < platformTextsArray.length; i++) {
        const platformText = platformTextsArray[i];
        if (!platformText) continue;

        const postIndex = platformText.post_index ?? i;
        const contentType = platformText.content_type === 'video' ? 'video' : 'image';

        // Get the media URL
        let mediaUrl: string | null = null;
        let originalMediaUrl: string | null = null;

        if (contentType === 'image') {
          originalMediaUrl = imageUrls[imageCounter] || null;
          imageCounter++;
        } else {
          originalMediaUrl = videoUrls[videoCounter] || null;
          videoCounter++;
        }

        if (!originalMediaUrl) continue;

        const approvalKey = `${generation.id}-${postIndex}`;
        const approval = approvalMap.get(approvalKey);
        const approvalStatus = approval?.status || 'pending';

        // Apply status filter if provided
        if (status && status !== 'all' && approvalStatus !== status) {
          continue;
        }

        // Check for edited image (text overlays applied)
        const imageEditKey = `${generation.id}-${postIndex}`;
        const imageEdit = imageEditMap.get(imageEditKey);
        const hasEditedImage = imageEdit?.status === 'completed' && !!imageEdit?.editedImageUrl;
        const imageEditStatus = imageEdit?.status || null;

        // Use edited image if available and completed, otherwise use original
        let mediaS3Key = originalMediaUrl;
        if (hasEditedImage && contentType === 'image') {
          mediaS3Key = imageEdit!.editedImageUrl!;
          logger.info(`🎨 Using edited image for content ${generation.id}, post ${postIndex}`);
        }

        // Generate presigned URL for display
        let presignedUrl = mediaS3Key;
        if (mediaS3Key && !mediaS3Key.startsWith('http')) {
          try {
            presignedUrl = await s3Service.generatePresignedUrl(mediaS3Key, 3600, true) || mediaS3Key;
          } catch (e) {
            logger.error(`Failed to generate presigned URL for ${mediaS3Key}:`, e);
          }
        }

        // Generate presigned URL for original image too
        let originalPresignedUrl = originalMediaUrl;
        if (originalMediaUrl && !originalMediaUrl.startsWith('http')) {
          try {
            originalPresignedUrl = await s3Service.generatePresignedUrl(originalMediaUrl, 3600, true) || originalMediaUrl;
          } catch (e) {
            logger.error(`Failed to generate presigned URL for original ${originalMediaUrl}:`, e);
          }
        }

        // Get platform texts (the nested platforms object with twitter, instagram, linkedin)
        const platforms = platformText.platforms || {};

        // Build custom captions object (from dvyb_captions table)
        const customCaptions: Record<string, string> = {};
        ['twitter', 'instagram', 'linkedin', 'tiktok'].forEach(platform => {
          const captionKey = `${generation.id}-${postIndex}-${platform}`;
          const editedCaption = captionMap.get(captionKey);
          if (editedCaption) {
            customCaptions[platform] = editedCaption;
          }
        });

        // Merge: prefer custom captions over generated platformTexts
        const mergedPlatformTexts: Record<string, string> = { ...platforms };
        Object.keys(customCaptions).forEach(platform => {
          mergedPlatformTexts[platform] = customCaptions[platform]!;
        });

        contentItems.push({
          id: approval?.id || `${generation.id}-${postIndex}`,
          generatedContentId: generation.id,
          postIndex,
          contentType,
          mediaUrl: presignedUrl,
          originalMediaUrl: originalPresignedUrl, // Presigned URL for absolute original from dvyb_generated_content
          hasEditedImage, // Flag to indicate this is an edited image
          imageEditStatus, // 'pending', 'processing', 'completed', 'failed', or null
          topic: platformText.topic || generation.topic,
          platformTexts: mergedPlatformTexts, // Merged captions (custom takes priority)
          originalPlatformTexts: platforms, // Original generated captions
          customCaptions, // Just the custom edits
          approvalStatus,
          approvalId: approval?.id,
          approvedById: approval?.approvedById,
          notes: approval?.notes,
          approvedAt: approval?.approvedAt,
          rejectedAt: approval?.rejectedAt,
          createdAt: generation.createdAt,
          uuid: generation.uuid,
          requestedPlatforms: generation.requestedPlatforms || [],
        });
      }
    }

    // Get stats
    const stats = {
      total: contentItems.length,
      pending: contentItems.filter(c => c.approvalStatus === 'pending').length,
      approved: contentItems.filter(c => c.approvalStatus === 'approved').length,
      rejected: contentItems.filter(c => c.approvalStatus === 'rejected').length,
    };

    return res.json({
      success: true,
      data: contentItems,
      stats,
    });
  } catch (error: any) {
    logger.error('Error fetching auto content for account:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch content',
    });
  }
});

/**
 * GET /api/admin/dvyb-automated-content/:accountId/content/:generatedContentId/:postIndex
 * Get detailed content for PostDetailsDialog
 */
router.get('/:accountId/content/:generatedContentId/:postIndex', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);

    const generatedContentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const approvalRepo = AppDataSource.getRepository(DvybAdminContentApproval);
    const captionRepo = AppDataSource.getRepository(DvybCaption);
    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);

    // Get generated content
    const generation = await generatedContentRepo.findOne({
      where: { id: generatedContentId, accountId },
    });

    if (!generation) {
      return res.status(404).json({
        success: false,
        error: 'Content not found',
      });
    }

    // Get approval status
    const approval = await approvalRepo.findOne({
      where: { generatedContentId, postIndex, accountId },
    });

    // Get custom captions
    const captions = await captionRepo.find({
      where: { generatedContentId, postIndex, accountId },
    });

    // Get image edits
    const imageEdit = await imageEditRepo.findOne({
      where: { generatedContentId, postIndex, accountId },
    });

    // Determine content type and get media URL
    const imageCount = generation.generatedImageUrls?.length || 0;
    const isVideo = postIndex >= imageCount;
    let mediaUrl: string | null = null;
    let originalMediaUrl: string | null = null; // Absolute original from dvyb_generated_content
    let displayMediaS3Key: string | null = null; // What to show (may be edited)

    if (isVideo) {
      const videoIndex = postIndex - imageCount;
      originalMediaUrl = generation.generatedVideoUrls?.[videoIndex] || null;
      displayMediaS3Key = originalMediaUrl;
    } else {
      // originalMediaUrl is ALWAYS the absolute original from dvyb_generated_content
      originalMediaUrl = generation.generatedImageUrls?.[postIndex] || null;
      
      // displayMediaS3Key is what we should display (may be edited/regenerated)
      if (imageEdit?.editedImageUrl && imageEdit?.status === 'completed') {
        displayMediaS3Key = imageEdit.editedImageUrl;
      } else {
        displayMediaS3Key = originalMediaUrl;
      }
    }

    // Generate presigned URL for display
    if (displayMediaS3Key && !displayMediaS3Key.startsWith('http')) {
      try {
        mediaUrl = await s3Service.generatePresignedUrl(displayMediaS3Key, 3600, true);
      } catch (e) {
        logger.error(`Failed to generate presigned URL:`, e);
        mediaUrl = displayMediaS3Key;
      }
    } else {
      mediaUrl = displayMediaS3Key;
    }

    // Generate presigned URL for originalMediaUrl too
    let originalMediaPresignedUrl = originalMediaUrl;
    if (originalMediaUrl && !originalMediaUrl.startsWith('http')) {
      try {
        originalMediaPresignedUrl = await s3Service.generatePresignedUrl(originalMediaUrl, 3600, true);
      } catch (e) {
        logger.error(`Failed to generate presigned URL for original:`, e);
      }
    }

    // Get platform texts
    const platformTexts = generation.platformTexts?.[postIndex] || {};

    // Build custom captions object
    const customCaptions: Record<string, string> = {};
    captions.forEach(caption => {
      customCaptions[caption.platform] = caption.caption;
    });

    return res.json({
      success: true,
      data: {
        generatedContentId,
        postIndex,
        contentType: isVideo ? 'video' : 'image',
        mediaUrl,
        originalMediaUrl: originalMediaPresignedUrl, // Absolute original from dvyb_generated_content
        topic: generation.topic,
        platformTexts,
        customCaptions,
        approvalStatus: approval?.status || 'pending',
        approvalId: approval?.id,
        approvedById: approval?.approvedById,
        notes: approval?.notes,
        approvedAt: approval?.approvedAt,
        rejectedAt: approval?.rejectedAt,
        createdAt: generation.createdAt,
        uuid: generation.uuid,
        imageEdit: imageEdit ? {
          id: imageEdit.id,
          overlays: imageEdit.overlays,
          referenceWidth: imageEdit.referenceWidth,
          status: imageEdit.status,
        } : null,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching content details:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch content details',
    });
  }
});

/**
 * POST /api/admin/dvyb-automated-content/:approvalId/approve
 * Approve a piece of auto-generated content
 */
router.post('/:approvalId/approve', async (req: Request, res: Response) => {
  try {
    const approvalId = parseInt(req.params.approvalId!);
    const { approvedById, notes } = req.body;

    const approvalRepo = AppDataSource.getRepository(DvybAdminContentApproval);

    const approval = await approvalRepo.findOne({
      where: { id: approvalId },
    });

    if (!approval) {
      return res.status(404).json({
        success: false,
        error: 'Approval record not found',
      });
    }

    approval.status = 'approved';
    approval.approvedById = approvedById || 'admin';
    approval.approvedAt = new Date();
    approval.rejectedAt = null;
    if (notes) approval.notes = notes;

    await approvalRepo.save(approval);

    logger.info(`✅ Content approved: approval ${approvalId} by ${approvedById || 'admin'}`);

    return res.json({
      success: true,
      message: 'Content approved successfully',
      data: approval,
    });
  } catch (error: any) {
    logger.error('Error approving content:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to approve content',
    });
  }
});

/**
 * POST /api/admin/dvyb-automated-content/:approvalId/reject
 * Reject a piece of auto-generated content
 */
router.post('/:approvalId/reject', async (req: Request, res: Response) => {
  try {
    const approvalId = parseInt(req.params.approvalId!);
    const { approvedById, notes } = req.body;

    const approvalRepo = AppDataSource.getRepository(DvybAdminContentApproval);

    const approval = await approvalRepo.findOne({
      where: { id: approvalId },
    });

    if (!approval) {
      return res.status(404).json({
        success: false,
        error: 'Approval record not found',
      });
    }

    approval.status = 'rejected';
    approval.approvedById = approvedById || 'admin';
    approval.rejectedAt = new Date();
    approval.approvedAt = null;
    if (notes) approval.notes = notes;

    await approvalRepo.save(approval);

    logger.info(`❌ Content rejected: approval ${approvalId} by ${approvedById || 'admin'}`);

    return res.json({
      success: true,
      message: 'Content rejected',
      data: approval,
    });
  } catch (error: any) {
    logger.error('Error rejecting content:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to reject content',
    });
  }
});

/**
 * POST /api/admin/dvyb-automated-content/:accountId/image-edit/:generatedContentId/:postIndex
 * Save image edit with text overlays (admin version for editing on behalf of users)
 */
router.post('/:accountId/image-edit/:generatedContentId/:postIndex', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);
    const { originalImageUrl, regeneratedImageUrl, overlays, referenceWidth } = req.body;

    logger.info(`📝 Admin saving image edit for account ${accountId}, content ${generatedContentId}, post ${postIndex}`);

    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);

    // Check if edit already exists (upsert)
    let imageEdit = await imageEditRepo.findOne({
      where: {
        accountId,
        generatedContentId,
        postIndex,
      },
    });

    if (imageEdit) {
      // Update existing
      imageEdit.originalImageUrl = originalImageUrl;
      imageEdit.regeneratedImageUrl = regeneratedImageUrl || null;
      imageEdit.overlays = overlays;
      imageEdit.referenceWidth = referenceWidth || 450;
      imageEdit.status = 'pending';
      imageEdit.errorMessage = null;
      imageEdit.editedImageUrl = null; // Reset since we're reprocessing
    } else {
      // Create new
      imageEdit = imageEditRepo.create({
        accountId,
        generatedContentId,
        postIndex,
        originalImageUrl,
        regeneratedImageUrl: regeneratedImageUrl || null,
        overlays,
        referenceWidth: referenceWidth || 450,
        status: 'pending',
      });
    }

    await imageEditRepo.save(imageEdit);
    logger.info(`✅ Admin image edit saved with ID ${imageEdit.id}`);

    // Trigger background processing (call Python AI backend)
    const sourceImageUrl = regeneratedImageUrl || originalImageUrl;
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    const callbackUrl = `${process.env.TYPESCRIPT_BACKEND_URL || 'http://localhost:3001'}/api/dvyb/image-edits/callback`;

    // Send to Python backend asynchronously (same endpoint as dvybImageEdits.ts)
    try {
      const response = await fetch(`${pythonBackendUrl}/api/dvyb/image-overlay/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          generatedContentId,
          postIndex,
          sourceImageUrl: sourceImageUrl,
          overlays,
          referenceWidth: referenceWidth || 450,
          callbackUrl,
        }),
      });
      const result = await response.json();
      logger.info(`✅ Image processing triggered: ${JSON.stringify(result)}`);
    } catch (pythonError) {
      logger.error('Error calling Python backend for image processing:', pythonError);
      // Update status to failed
      imageEdit.status = 'failed';
      imageEdit.errorMessage = `Failed to trigger processing: ${pythonError}`;
      await imageEditRepo.save(imageEdit);
    }

    return res.json({
      success: true,
      data: {
        id: imageEdit.id,
        status: 'pending',
        message: 'Image edit saved. Processing in background.',
      },
    });
  } catch (error: any) {
    logger.error('Error saving admin image edit:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save image edit',
    });
  }
});

/**
 * GET /api/admin/dvyb-automated-content/:accountId/image-edit/:generatedContentId/:postIndex
 * Get image edit status for admin
 */
router.get('/:accountId/image-edit/:generatedContentId/:postIndex', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
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

    // Generate presigned URLs for all images
    let editedImageUrl = imageEdit.editedImageUrl;
    let originalImageUrl = imageEdit.originalImageUrl;
    let regeneratedImageUrl = imageEdit.regeneratedImageUrl;

    if (editedImageUrl && !editedImageUrl.startsWith('http')) {
      try {
        editedImageUrl = await s3Service.generatePresignedUrl(editedImageUrl, 3600, true);
      } catch (e) {
        logger.error('Error generating presigned URL for edited image:', e);
      }
    }

    if (originalImageUrl && !originalImageUrl.startsWith('http')) {
      try {
        originalImageUrl = await s3Service.generatePresignedUrl(originalImageUrl, 3600, true);
      } catch (e) {
        logger.error('Error generating presigned URL for original image:', e);
      }
    }

    if (regeneratedImageUrl && !regeneratedImageUrl.startsWith('http')) {
      try {
        regeneratedImageUrl = await s3Service.generatePresignedUrl(regeneratedImageUrl, 3600, true);
      } catch (e) {
        logger.error('Error generating presigned URL for regenerated image:', e);
      }
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
      },
    });
  } catch (error: any) {
    logger.error('Error getting image edit status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to get image edit status',
    });
  }
});

/**
 * PUT /api/admin/dvyb-automated-content/:accountId/captions/:generatedContentId/:postIndex
 * Save custom captions (same as DVYB frontend)
 */
router.put('/:accountId/captions/:generatedContentId/:postIndex', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);
    const { captions } = req.body; // { twitter: "...", instagram: "...", linkedin: "..." }

    const captionRepo = AppDataSource.getRepository(DvybCaption);

    // Delete existing captions for this post
    await captionRepo.delete({
      accountId,
      generatedContentId,
      postIndex,
    });

    // Save new captions
    const savedCaptions: DvybCaption[] = [];
    for (const [platform, caption] of Object.entries(captions)) {
      if (caption && typeof caption === 'string' && caption.trim()) {
        const newCaption = captionRepo.create({
          accountId,
          generatedContentId,
          postIndex,
          platform,
          caption: caption.trim(),
        });
        savedCaptions.push(await captionRepo.save(newCaption));
      }
    }

    logger.info(`✅ Saved ${savedCaptions.length} captions for content ${generatedContentId}, post ${postIndex}`);

    return res.json({
      success: true,
      message: 'Captions saved successfully',
      data: savedCaptions,
    });
  } catch (error: any) {
    logger.error('Error saving captions:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to save captions',
    });
  }
});

/**
 * GET /api/admin/dvyb-automated-content/:accountId/content/:generatedContentId/:postIndex
 * Get content details including saved overlays for Edit Design mode
 */
router.get('/:accountId/content/:generatedContentId/:postIndex', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);

    logger.info(`📋 Fetching content details for account ${accountId}, content ${generatedContentId}, post ${postIndex}`);

    const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);

    // Fetch existing image edit (overlays) for this post
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
        data: {
          overlays: [],
          originalImageUrl: null,
          regeneratedImageUrl: null,
          editedImageUrl: null,
          status: null,
        },
      });
    }

    // Generate presigned URLs if available
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
        overlays: imageEdit.overlays || [],
        originalImageUrl,
        regeneratedImageUrl,
        editedImageUrl,
        status: imageEdit.status,
        referenceWidth: imageEdit.referenceWidth,
      },
    });

  } catch (error: any) {
    logger.error('Error fetching content details:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch content details',
    });
  }
});

/**
 * POST /api/admin/dvyb-automated-content/:accountId/image-regenerate/:generatedContentId/:postIndex
 * Trigger image regeneration using AI (nano-banana edit)
 */
router.post('/:accountId/image-regenerate/:generatedContentId/:postIndex', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);
    const { prompt, sourceImageS3Key } = req.body;

    logger.info(`🎨 Admin image regeneration for account ${accountId}, content ${generatedContentId}, post ${postIndex}`);
    logger.info(`📝 Prompt: ${prompt.substring(0, 50)}...`);

    if (!prompt || !sourceImageS3Key) {
      return res.status(400).json({
        success: false,
        error: 'prompt and sourceImageS3Key are required',
      });
    }

    const regenerationRepo = AppDataSource.getRepository(DvybImageRegeneration);

    // Create pending regeneration record
    const regeneration = regenerationRepo.create({
      accountId,
      generatedContentId,
      postIndex,
      prompt,
      sourceImageS3Key,
      status: 'pending',
      regeneratedBy: 'admin', // Admin-initiated regeneration
      metadata: {
        model: 'fal-ai/nano-banana/edit',
        aspectRatio: '1:1',
      },
    });

    await regenerationRepo.save(regeneration);
    logger.info(`✅ Created regeneration record ID: ${regeneration.id}`);

    // Trigger Python AI backend
    const callbackUrl = `${TYPESCRIPT_BACKEND_URL}/api/admin/dvyb-automated-content/regeneration-callback`;

    try {
      await axios.post(
        `${PYTHON_AI_BACKEND_URL}/api/dvyb/image-regeneration/regenerate`,
        {
          accountId,
          generatedContentId,
          postIndex,
          prompt,
          sourceImageS3Key,
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
 * POST /api/admin/dvyb-automated-content/regeneration-callback
 * Callback from Python AI backend when regeneration completes
 */
router.post('/regeneration-callback', async (req: Request, res: Response) => {
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
 * GET /api/admin/dvyb-automated-content/:accountId/regenerations/:generatedContentId/:postIndex
 * Get all regenerations for a specific post
 */
router.get('/:accountId/regenerations/:generatedContentId/:postIndex', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
    const generatedContentId = parseInt(req.params.generatedContentId!);
    const postIndex = parseInt(req.params.postIndex!);

    const regenerationRepo = AppDataSource.getRepository(DvybImageRegeneration);

    const regenerations = await regenerationRepo.find({
      where: {
        accountId,
        generatedContentId,
        postIndex,
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
          regeneratedBy: regen.regeneratedBy, // 'user' or 'admin'
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
 * GET /api/admin/dvyb-automated-content/:accountId/regeneration-status/:regenerationId
 * Get status of a specific regeneration (for polling)
 */
router.get('/:accountId/regeneration-status/:regenerationId', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.accountId!);
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

