import { Router, Response } from 'express';
import { DvybAuthRequest, dvybAuthMiddleware } from '../middleware/dvybAuthMiddleware';
import { AppDataSource } from '../config/database';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybAccount } from '../models/DvybAccount';
import { DvybAccountPlan } from '../models/DvybAccountPlan';
import { DvybPricingPlan } from '../models/DvybPricingPlan';
import { IsNull } from 'typeorm';
import { logger } from '../config/logger';
import { env } from '../config/env';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const router = Router();

/**
 * Maps technical progress messages to user-friendly, engaging messages
 */
function mapProgressMessageToUserFriendly(technicalMessage: string | null): string {
  if (!technicalMessage) return 'Getting started...';
  
  // Exact matches for setup phases
  if (technicalMessage === 'Starting generation...') return 'Getting started...';
  if (technicalMessage === 'Gathering context...') return 'Understanding your brand...';
  if (technicalMessage === 'Analyzing uploaded images...') return 'Analyzing your images...';
  if (technicalMessage === 'Analyzing inspiration links...') return 'Getting inspiration from your links...';
  if (technicalMessage === 'Generating prompts...') return 'Crafting the perfect content for you...';
  if (technicalMessage === 'Generating images and clips...') return 'Creating your content...';
  if (technicalMessage === 'Saving content...') return 'Almost there, finalizing your content...';
  if (technicalMessage === 'Generation completed!') return 'Your content is ready!';
  
  // Pattern matches for content generation - use engaging rotating messages
  if (technicalMessage.match(/^Generated image \d+$/) || 
      technicalMessage.match(/^Generated video \d+$/)) {
    const numMatch = technicalMessage.match(/\d+/);
    const idx = numMatch ? parseInt(numMatch[0]) : 0;
    const engagingMessages = [
      'Making magic happen...',
      'Bringing your ideas to life...',
      'Almost there, looking great...',
      'Adding the finishing touches...',
      'Creating something amazing...',
      'Your content is taking shape...',
      'Perfecting every detail...',
      'Working on something special...',
    ];
    return engagingMessages[idx % engagingMessages.length] || 'Creating your content...';
  }
  
  // Video generation message
  if (technicalMessage.includes('Generating videos')) {
    return 'Creating your videos (this may take a few minutes)...';
  }
  
  // Fallback: clean up and return
  const cleaned = technicalMessage.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
  if (cleaned.match(/^\d+$/) || cleaned.includes('idx') || cleaned.includes('video_') || cleaned.includes('image_')) {
    return 'Creating your content...';
  }
  return cleaned || 'Creating your content...';
}

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

// Apply authorization middleware to ALL routes
router.use(dvybAuthMiddleware);

// Ensure upload directory exists
const uploadDir = '/tmp/dvyb-uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info(`✅ Created upload directory: ${uploadDir}`);
}

// Configure multer for file uploads
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PNG, JPG, JPEG, and WEBP allowed'));
    }
  },
});

/**
 * @route POST /api/dvyb/adhoc/upload
 * @description Upload user image for ad-hoc generation (proxies to Python backend)
 * @access Private (requires dvybAuthMiddleware)
 */
router.post('/upload', upload.single('file'), async (req: DvybAuthRequest, res: Response) => {
  try {
    logger.info('📤 Received file upload request');
    logger.info(`  File: ${req.file ? req.file.originalname : 'NO FILE'}`);
    logger.info(`  Size: ${req.file ? req.file.size : 'N/A'} bytes`);
    logger.info(`  Type: ${req.file ? req.file.mimetype : 'N/A'}`);
    
    if (!req.file) {
      logger.error('❌ No file uploaded in request');
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const accountId = req.dvybAccountId;
    logger.info(`  Account ID from session: ${accountId || 'NOT FOUND'}`);
    
    if (!accountId) {
      logger.error('❌ No accountId in session - user not authenticated');
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Forward file to Python backend using axios (better FormData support)
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      return res.status(500).json({ success: false, error: 'Python AI backend URL not configured' });
    }

    const FormData = require('form-data');
    const formData = new FormData();
    
    // Use file stream for axios
    const fileStream = fs.createReadStream(req.file.path);
    formData.append('file', fileStream, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    formData.append('accountId', accountId.toString());

    logger.info(`📤 Forwarding to Python backend: ${pythonBackendUrl}/api/dvyb/adhoc/upload`);
    logger.info(`  File: ${req.file.originalname}, Size: ${req.file.size} bytes`);

    try {
      const response = await axios.post(
        `${pythonBackendUrl}/api/dvyb/adhoc/upload`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );

      // Clean up temp file
      fs.unlinkSync(req.file.path);

      logger.info(`✅ Upload successful, S3 key: ${response.data.s3_key}`);
      return res.json(response.data);
    } catch (error: any) {
      // Clean up temp file on error
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      if (error.response) {
        // Python backend returned an error
        logger.error(`❌ Python backend error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
        return res.status(error.response.status).json({
          success: false,
          error: error.response.data.detail || error.response.data.error || 'Upload failed',
        });
      } else {
        // Network or other error
        logger.error(`❌ Failed to reach Python backend: ${error.message}`);
        throw error;
      }
    }
  } catch (error: any) {
    logger.error('❌ Failed to upload image:', error);
    logger.error(`  Error details: ${error.message}`);
    logger.error(`  Stack: ${error.stack}`);
    
    // Clean up temp file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      logger.info(`  ✅ Cleaned up temp file: ${req.file.path}`);
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Add error handling middleware for multer errors
router.use((err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    logger.error(`❌ Multer error: ${err.message}`, err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File size too large. Maximum 10MB allowed.' });
    }
    return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
  } else if (err) {
    logger.error(`❌ Upload error: ${err.message}`, err);
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

/**
 * @route POST /api/dvyb/adhoc/generate
 * @description Start ad-hoc content generation (proxies to Python backend)
 * @access Private (requires dvybAuthMiddleware)
 */
router.post('/generate', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const {
      topic,
      platforms,
      number_of_posts,
      number_of_images,
      number_of_videos,
      user_prompt,
      user_images,
      inspiration_links,
    } = req.body;

    // Validate required fields
    if (!topic || !platforms || !number_of_posts) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: topic, platforms, number_of_posts',
      });
    }

    // ========== SECURITY CHECK: Validate account status and usage limits ==========
    // This prevents hackers from bypassing frontend checks
    
    const accountRepo = AppDataSource.getRepository(DvybAccount);
    const account = await accountRepo.findOne({ where: { id: accountId } });
    
    if (!account) {
      logger.warn(`🚫 Generation blocked: Account ${accountId} not found`);
      return res.status(404).json({
        success: false,
        error: 'Account not found',
        code: 'ACCOUNT_NOT_FOUND',
      });
    }

    // Check if account is active
    if (!account.isActive) {
      logger.warn(`🚫 Generation blocked: Account ${accountId} is not active`);
      return res.status(403).json({
        success: false,
        error: 'Account is not active. Please contact support to reactivate your account.',
        code: 'ACCOUNT_INACTIVE',
      });
    }

    // Check usage limits
    const accountPlanRepo = AppDataSource.getRepository(DvybAccountPlan);
    const planRepo = AppDataSource.getRepository(DvybPricingPlan);
    const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    
    // Get current plan
    const currentPlan = await accountPlanRepo.findOne({
      where: { 
        accountId, 
        status: 'active',
        endDate: IsNull(),
      },
      relations: ['plan'],
      order: { startDate: 'DESC' },
    });
    
    // Calculate limits
    let imageLimit = 0;
    let videoLimit = 0;
    
    if (currentPlan) {
      imageLimit = currentPlan.selectedFrequency === 'monthly' 
        ? currentPlan.plan.monthlyImageLimit 
        : currentPlan.plan.annualImageLimit;
      
      videoLimit = currentPlan.selectedFrequency === 'monthly'
        ? currentPlan.plan.monthlyVideoLimit
        : currentPlan.plan.annualVideoLimit;
    } else {
      // No active plan - use Free Trial plan limits (monthly frequency)
      const freeTrialPlan = await planRepo.findOne({
        where: { isFreeTrialPlan: true, isActive: true },
      });

      if (freeTrialPlan) {
        imageLimit = freeTrialPlan.monthlyImageLimit;
        videoLimit = freeTrialPlan.monthlyVideoLimit;
        logger.info(`✅ Using Free Trial plan limits for account ${accountId}: ${imageLimit} images, ${videoLimit} videos`);
      } else {
        logger.warn(`⚠️ No Free Trial plan found for account ${accountId} - using 0 limits`);
      }
    }

    // Calculate current usage from completed generations
    const generatedContent = await contentRepo.find({
      where: { 
        accountId,
        status: 'completed',
      },
    });

    let imageUsage = 0;
    let videoUsage = 0;
    generatedContent.forEach(content => {
      imageUsage += (content.generatedImageUrls || []).filter((url: string | null) => url !== null).length;
      videoUsage += (content.generatedVideoUrls || []).filter((url: string | null) => url !== null).length;
    });

    const remainingImages = Math.max(0, imageLimit - imageUsage);
    const remainingVideos = Math.max(0, videoLimit - videoUsage);

    // Check if limits are exhausted
    if (remainingImages === 0 && remainingVideos === 0) {
      logger.warn(`🚫 Generation blocked: Account ${accountId} has exhausted all limits (images: ${imageUsage}/${imageLimit}, videos: ${videoUsage}/${videoLimit})`);
      return res.status(403).json({
        success: false,
        error: 'Content generation limits exhausted. Please upgrade your plan to continue.',
        code: 'LIMITS_EXHAUSTED',
        data: {
          imageLimit,
          videoLimit,
          imageUsage,
          videoUsage,
          remainingImages,
          remainingVideos,
        },
      });
    }

    // Validate requested content doesn't exceed remaining limits
    const requestedImages = number_of_images || 0;
    const requestedVideos = number_of_videos || 0;
    
    if (requestedImages > remainingImages || requestedVideos > remainingVideos) {
      logger.warn(`🚫 Generation blocked: Account ${accountId} requested ${requestedImages} images and ${requestedVideos} videos, but only ${remainingImages} images and ${remainingVideos} videos remaining`);
      return res.status(403).json({
        success: false,
        error: `Insufficient limits. You can generate up to ${remainingImages} more images and ${remainingVideos} more videos.`,
        code: 'INSUFFICIENT_LIMITS',
        data: {
          requestedImages,
          requestedVideos,
          remainingImages,
          remainingVideos,
        },
      });
    }

    logger.info(`✅ Account ${accountId} passed security checks (active: true, remaining: ${remainingImages} images, ${remainingVideos} videos)`);
    // ========== END SECURITY CHECK ==========

    // Call Python backend
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      return res.status(500).json({ success: false, error: 'Python AI backend URL not configured' });
    }

    logger.info(`🚀 Starting ad-hoc generation for account ${accountId}`);
    logger.info(`   Mix: ${number_of_images || 'auto'} images, ${number_of_videos || 'auto'} videos`);

    const response = await fetch(`${pythonBackendUrl}/api/dvyb/adhoc/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: accountId,
        topic,
        platforms,
        number_of_posts,
        number_of_images,
        number_of_videos,
        user_prompt,
        user_images,
        inspiration_links,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`❌ Python backend error: ${response.status} - ${errorText}`);
      return res.status(response.status).json({ success: false, error: errorText });
    }

    const data = await response.json() as { job_id?: string; uuid?: string };
    logger.info(`✅ Generation started: ${data.job_id || data.uuid}`);
    
    return res.json(data);
  } catch (error: any) {
    logger.error('❌ Failed to start generation:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route GET /api/dvyb/adhoc/status
 * @description Get ad-hoc generation status (reads from database)
 * @access Private (requires dvybAuthMiddleware)
 */
router.get('/status', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    // Get latest on_demand generation for this account
    const generation = await generationRepo.findOne({
      where: {
        accountId,
        generationType: 'on_demand',
      },
      order: { createdAt: 'DESC' },
    });

    if (!generation) {
      return res.json({
        success: true,
        status: 'not_found',
        progress_percent: 0,
        progress_message: 'No generation found',
        data: null,
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

    // Remove IP-sensitive fields before sending to frontend
    delete (generationWithPresignedUrls as any).framePrompts;
    delete (generationWithPresignedUrls as any).clipPrompts;

    // Map progress message to user-friendly text
    const userFriendlyMessage = mapProgressMessageToUserFriendly(generationWithPresignedUrls.progressMessage);
    
    return res.json({
      success: true,
      status: generationWithPresignedUrls.status,
      progress_percent: generationWithPresignedUrls.progressPercent,
      progress_message: userFriendlyMessage,
      data: {
        uuid: generationWithPresignedUrls.uuid,
        jobId: generationWithPresignedUrls.jobId,
        topic: generationWithPresignedUrls.topic,
        numberOfPosts: generationWithPresignedUrls.numberOfPosts,
        platformTexts: generationWithPresignedUrls.platformTexts,
        framePrompts: null, // IP-protected
        clipPrompts: null, // IP-protected
        generatedImageUrls: generationWithPresignedUrls.generatedImageUrls,
        generatedVideoUrls: generationWithPresignedUrls.generatedVideoUrls,
        status: generationWithPresignedUrls.status,
        progressPercent: generationWithPresignedUrls.progressPercent,
        progressMessage: userFriendlyMessage,
        createdAt: generationWithPresignedUrls.createdAt,
        updatedAt: generationWithPresignedUrls.updatedAt,
        metadata: generationWithPresignedUrls.metadata,
      },
    });
  } catch (error: any) {
    logger.error('❌ Failed to get generation status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route GET /api/dvyb/adhoc/history
 * @description Get ad-hoc generation history for authenticated account
 * @access Private (requires dvybAuthMiddleware)
 */
router.get('/history', async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const generationRepo = AppDataSource.getRepository(DvybGeneratedContent);

    const generations = await generationRepo.find({
      where: {
        accountId,
        generationType: 'on_demand',
      },
      order: { createdAt: 'DESC' },
      take: 50, // Limit to last 50 generations
    });

    return res.json({
      success: true,
      data: generations.map(gen => ({
        uuid: gen.uuid,
        topic: gen.topic,
        numberOfPosts: gen.numberOfPosts,
        status: gen.status,
        progressPercent: gen.progressPercent,
        progressMessage: gen.progressMessage,
        createdAt: gen.createdAt,
        updatedAt: gen.updatedAt,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Failed to get generation history:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

