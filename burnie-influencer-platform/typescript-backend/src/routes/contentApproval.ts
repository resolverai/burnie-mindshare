import { Router } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { ExecutionTracking } from '../models/ExecutionTracking';
import { WatermarkService } from '../services/WatermarkService';
import { VideoWatermarkService } from '../services/VideoWatermarkService';
import { contentIntegrationService } from '../services/contentIntegrationService';

const router = Router();

// Approve content automatically (for yapper interface)
router.post('/approve/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    
    logger.info(`✅ Approving content: ${contentId}`);
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(contentId) }
    });
    
    if (!content) {
      return res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found'
      });
    }
    
    // Verify this is yapper interface content by checking source and creator wallet
    const { env } = require('../config/env');
    const creatorWallet = env.yapperInterface.creatorWallet;
    
    // Get creator user from the wallet address
    const userRepository = AppDataSource.getRepository('User');
    const creatorUser = await userRepository.findOne({
      where: { walletAddress: creatorWallet }
    });
    
    if (!creatorUser || content.creatorId !== creatorUser.id) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only yapper interface creator can approve this content'
      });
    }
    
    // Update approval status
    content.approvalStatus = 'approved';
    content.approvedAt = new Date();
    
    // Generate watermarks for images and videos
    const s3Bucket = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';
    
    try {
      // Handle image watermarking
      if (content.contentImages && content.contentImages.length > 0) {
        logger.info(`🖼️ Creating watermark for images in content ${contentId}`);
        const watermarkImageUrl = await WatermarkService.createWatermarkForContent(content.contentImages, s3Bucket);
        if (watermarkImageUrl) {
          content.watermarkImage = watermarkImageUrl;
          logger.info(`✅ Image watermark created: ${watermarkImageUrl}`);
        } else {
          logger.warn(`⚠️ Failed to create image watermark for content ${contentId}`);
        }
      }
      
      // Handle video watermarking - start background task
      if (content.isVideo && content.videoUrl) {
        logger.info(`🎬 Starting background video watermarking for content ${contentId}`);
        await VideoWatermarkService.createWatermarkForVideo(content.videoUrl, s3Bucket, parseInt(contentId));
        logger.info(`✅ Video watermarking task queued in background for content ${contentId}`);
      }
      
    } catch (error) {
      logger.error(`❌ Error creating watermarks for content ${contentId}:`, error);
      // Continue with approval even if watermarking fails
    }
    
    logger.info(`✅ Content ${contentId} approved successfully by creator wallet: ${creatorWallet}`);
    
    await contentRepository.save(content);

    // Approve content on blockchain if applicable (async, non-blocking)
    const priceInROAST = content.biddingAskPrice || content.askingPrice || 0;
    contentIntegrationService.approveContentOnChain(
      parseInt(contentId),
      priceInROAST
    ).catch((error) => {
      logger.error(`❌ Background blockchain approval failed for content ${contentId}:`, error);
    });
    
    return res.json({
      content_id: parseInt(contentId),
      approval_status: 'approved',
      message: 'Content approved successfully'
    });
    
  } catch (error) {
    logger.error(`❌ Error approving content ${req.params.contentId}:`, error);
    return res.status(500).json({
      error: 'Failed to approve content',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Mark content as biddable and set price
router.post('/make-biddable/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    const { price } = req.body;
    
    if (!price || isNaN(parseFloat(price))) {
      return res.status(400).json({
        error: 'Invalid price',
        message: 'Valid price is required'
      });
    }
    
    logger.info(`💰 Making content ${contentId} biddable with price: ${price}`);
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(contentId) }
    });
    
    if (!content) {
      return res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found'
      });
    }
    
    if (content.approvalStatus !== 'approved') {
      return res.status(400).json({
        error: 'Content not approved',
        message: 'Content must be approved before making it biddable'
      });
    }
    
    // Verify this is yapper interface content by checking source and creator wallet
    const { env } = require('../config/env');
    const creatorWallet = env.yapperInterface.creatorWallet;
    
    // Get creator user from the wallet address
    const userRepository = AppDataSource.getRepository('User');
    const creatorUser = await userRepository.findOne({
      where: { walletAddress: creatorWallet }
    });
    
    if (!creatorUser || content.creatorId !== creatorUser.id) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only yapper interface creator can make this content biddable'
      });
    }
    
    // Update content to be biddable
    content.isBiddable = true;
    content.biddingAskPrice = parseFloat(price);
    content.biddingEnabledAt = new Date();
    
    await contentRepository.save(content);

    // Update price on blockchain (async, non-blocking)
    contentIntegrationService.updateContentPriceOnChain(
      parseInt(contentId),
      parseFloat(price)
    ).catch((error) => {
      logger.error(`❌ Background blockchain price update failed for content ${contentId}:`, error);
    });
    
    logger.info(`✅ Content ${contentId} is now biddable with price: ${price}`);
    
    return res.json({
      content_id: parseInt(contentId),
      is_biddable: true,
      bidding_ask_price: parseFloat(price),
      bidding_enabled_at: content.biddingEnabledAt,
      message: 'Content is now available for bidding'
    });
    
  } catch (error) {
    logger.error(`❌ Error making content ${req.params.contentId} biddable:`, error);
    return res.status(500).json({
      error: 'Failed to make content biddable',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Mark content as unavailable (after purchase)
router.post('/mark-unavailable/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    
    logger.info(`🚫 Marking content as unavailable: ${contentId}`);
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(contentId) }
    });
    
    if (!content) {
      return res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found'
      });
    }
    
    // Mark content as unavailable
    content.isAvailable = false;
    content.isBiddable = false;
    
    await contentRepository.save(content);
    
    logger.info(`✅ Content ${contentId} marked as unavailable`);
    
    return res.json({
      content_id: parseInt(contentId),
      is_available: false,
      is_biddable: false,
      message: 'Content marked as unavailable'
    });
    
  } catch (error) {
    logger.error(`❌ Error marking content ${req.params.contentId} unavailable:`, error);
    return res.status(500).json({
      error: 'Failed to mark content unavailable',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Restore content availability (restore original content to marketplace)
router.post('/restore-availability/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    
    logger.info(`🔄 Restoring content availability: ${contentId}`);
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(contentId) }
    });
    
    if (!content) {
      return res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found'
      });
    }
    
    // Restore content availability
    content.isAvailable = true;
    content.isBiddable = true;
    
    await contentRepository.save(content);
    
    logger.info(`✅ Content ${contentId} availability restored`);
    
    return res.json({
      content_id: parseInt(contentId),
      is_available: true,
      is_biddable: true,
      message: 'Content availability restored'
    });
    
  } catch (error) {
    logger.error(`❌ Error restoring content ${req.params.contentId} availability:`, error);
    return res.status(500).json({
      error: 'Failed to restore content availability',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
