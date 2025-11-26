import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';

const router = Router();

/**
 * POST /api/dvyb/internal/update-progress
 * Internal endpoint for Python AI backend to update generation progress
 */
router.post('/update-progress', async (req: Request, res: Response) => {
  try {
    const {
      job_id,
      progress_percent,
      progress_message,
      status,
      result,
    } = req.body;

    if (!job_id) {
      return res.status(400).json({
        success: false,
        error: 'job_id is required',
        timestamp: new Date().toISOString(),
      });
    }

    const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const content = await contentRepo.findOne({ where: { jobId: job_id } });

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Content not found for job_id',
        timestamp: new Date().toISOString(),
      });
    }

    // Update progress
    if (progress_percent !== undefined) {
      content.progressPercent = progress_percent;
    }
    if (progress_message !== undefined) {
      content.progressMessage = progress_message;
    }
    if (status !== undefined) {
      content.status = status;
    }

    // Update result if provided
    if (result) {
      // Note: tweetText and tweetTexts are legacy properties, not used in DVYB
      if (result.image_urls) content.generatedImageUrls = result.image_urls;
      if (result.video_urls) content.generatedVideoUrls = result.video_urls;
      // Note: generatedAudioUrl and finalContentUrl are legacy properties, not used in DVYB
    }

    await contentRepo.save(content);

    logger.debug(`✅ Updated progress for job ${job_id}: ${progress_percent}%`);

    return res.json({
      success: true,
      message: 'Progress updated',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Update progress error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update progress',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/internal/progress/:jobId
 * Internal endpoint to get current progress
 */
router.get('/progress/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'jobId is required',
        timestamp: new Date().toISOString(),
      });
    }

    const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    const content = await contentRepo.findOne({ where: { jobId } });

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Content not found',
        timestamp: new Date().toISOString(),
      });
    }

    const response: any = {
      success: true,
      status: content.status,
      progress: content.progressPercent,
      message: content.progressMessage,
      timestamp: new Date().toISOString(),
    };

    // If completed, include result
    if (content.status === 'completed') {
      response.result = {
        // Note: tweetText and tweetTexts are legacy properties, not used in DVYB
        platform_texts: content.platformTexts,
        image_urls: content.generatedImageUrls,
        video_urls: content.generatedVideoUrls,
        // Note: generatedAudioUrl and finalContentUrl are legacy properties, not used in DVYB
      };
    } else if (content.status === 'failed') {
      response.error = content.errorMessage;
    }

    return res.json(response);
  } catch (error) {
    logger.error('❌ Get progress error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get progress',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

