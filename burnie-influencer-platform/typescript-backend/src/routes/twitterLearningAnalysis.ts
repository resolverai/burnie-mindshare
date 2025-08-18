import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { TwitterLearningData } from '../models/TwitterLearningData';
import { logger } from '../config/logger';

const router = Router();

// Update TwitterLearningData with LLM analysis results
router.patch('/twitter-learning-data/:learningDataId/llm-analysis', async (req: Request, res: Response) => {
  try {
    const learningDataIdParam = req.params.learningDataId;
    if (!learningDataIdParam) {
      return res.status(400).json({
        success: false,
        message: 'Learning data ID is required'
      });
    }

    const learningDataId = parseInt(learningDataIdParam);
    const { provider_used, anthropic_analysis, openai_analysis } = req.body;

    if (isNaN(learningDataId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid learning data ID'
      });
    }

    if (!provider_used) {
      return res.status(400).json({
        success: false,
        message: 'Provider used is required'
      });
    }

    const learningDataRepo = AppDataSource.getRepository(TwitterLearningData);

    // Find the TwitterLearningData record
    const learningData = await learningDataRepo.findOne({
      where: { id: learningDataId }
    });

    if (!learningData) {
      return res.status(404).json({
        success: false,
        message: `TwitterLearningData record ${learningDataId} not found`
      });
    }

    // Update with LLM analysis based on provider used
    if (provider_used === 'anthropic') {
      learningData.anthropic_analysis = anthropic_analysis;
      learningData.openai_analysis = null;
    } else if (provider_used === 'openai') {
      learningData.anthropic_analysis = null;
      learningData.openai_analysis = openai_analysis;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider. Must be "anthropic" or "openai"'
      });
    }

    await learningDataRepo.save(learningData);

    logger.info(`✅ Updated TwitterLearningData ${learningDataId} with ${provider_used} analysis`);

    return res.json({
      success: true,
      message: `LLM analysis updated successfully using ${provider_used}`,
      learning_data_id: learningDataId,
      provider_used: provider_used
    });

  } catch (error) {
    logger.error(`❌ Error updating TwitterLearningData ${req.params.learningDataId} with LLM analysis:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update LLM analysis',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get LLM analysis for a TwitterLearningData record
router.get('/twitter-learning-data/:learningDataId/llm-analysis', async (req: Request, res: Response) => {
  try {
    const learningDataIdParam = req.params.learningDataId;
    if (!learningDataIdParam) {
      return res.status(400).json({
        success: false,
        message: 'Learning data ID is required'
      });
    }

    const learningDataId = parseInt(learningDataIdParam);

    if (isNaN(learningDataId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid learning data ID'
      });
    }

    const learningDataRepo = AppDataSource.getRepository(TwitterLearningData);

    const learningData = await learningDataRepo.findOne({
      where: { id: learningDataId },
      select: ['id', 'tweetId', 'userId', 'anthropic_analysis', 'openai_analysis', 'processedAt']
    });

    if (!learningData) {
      return res.status(404).json({
        success: false,
        message: `TwitterLearningData record ${learningDataId} not found`
      });
    }

    // Determine which analysis is available
    let provider_used = null;
    let analysis_data = null;

    if (learningData.anthropic_analysis) {
      provider_used = 'anthropic';
      analysis_data = learningData.anthropic_analysis;
    } else if (learningData.openai_analysis) {
      provider_used = 'openai';
      analysis_data = learningData.openai_analysis;
    }

    return res.json({
      success: true,
      learning_data_id: learningDataId,
      tweet_id: learningData.tweetId,
      user_id: learningData.userId,
      provider_used: provider_used,
      analysis_available: !!analysis_data,
      analysis_data: analysis_data,
      processed_at: learningData.processedAt
    });

  } catch (error) {
    logger.error(`❌ Error getting LLM analysis for TwitterLearningData ${req.params.learningDataId}:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get LLM analysis',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
