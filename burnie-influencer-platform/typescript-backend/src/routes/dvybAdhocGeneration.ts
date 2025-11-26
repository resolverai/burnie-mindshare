import { Router, Response } from 'express';
import { DvybAuthRequest, dvybAuthMiddleware } from '../middleware/dvybAuthMiddleware';
import { AppDataSource } from '../config/database';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { logger } from '../config/logger';
import { env } from '../config/env';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Apply authorization middleware to ALL routes
router.use(dvybAuthMiddleware);

// Configure multer for file uploads
const upload = multer({
  dest: '/tmp/dvyb-uploads',
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
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const accountId = req.dvybAccountId;
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Forward file to Python backend
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      return res.status(500).json({ success: false, error: 'Python AI backend URL not configured' });
    }

    const FormData = require('form-data');
    const formData = new FormData();
    
    // Read file and append to form data
    const fileStream = fs.createReadStream(req.file.path);
    formData.append('file', fileStream, req.file.originalname);
    formData.append('accountId', accountId.toString());

    const response = await fetch(`${pythonBackendUrl}/api/dvyb/adhoc/upload`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
    });

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ success: false, error: errorText });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error: any) {
    logger.error('❌ Failed to upload image:', error);
    // Clean up temp file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ success: false, error: error.message });
  }
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

    // Call Python backend
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      return res.status(500).json({ success: false, error: 'Python AI backend URL not configured' });
    }

    logger.info(`🚀 Starting ad-hoc generation for account ${accountId}`);

    const response = await fetch(`${pythonBackendUrl}/api/dvyb/adhoc/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: accountId,
        topic,
        platforms,
        number_of_posts,
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

    return res.json({
      success: true,
      status: generation.status,
      progress_percent: generation.progressPercent,
      progress_message: generation.progressMessage,
      data: {
        uuid: generation.uuid,
        jobId: generation.jobId,
        topic: generation.topic,
        numberOfPosts: generation.numberOfPosts,
        platformTexts: generation.platformTexts,
        framePrompts: generation.framePrompts,
        clipPrompts: generation.clipPrompts,
        generatedImageUrls: generation.generatedImageUrls,
        generatedVideoUrls: generation.generatedVideoUrls,
        status: generation.status,
        progressPercent: generation.progressPercent,
        progressMessage: generation.progressMessage,
        createdAt: generation.createdAt,
        updatedAt: generation.updatedAt,
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

