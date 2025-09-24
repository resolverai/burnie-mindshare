import { Router } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { ExecutionTracking } from '../models/ExecutionTracking';
import { env } from '../config/env';

const router = Router();

// Start content generation from yapper interface
router.post('/generate-content', async (req, res) => {
  try {
    const {
      wallet_address,
      campaigns,
      user_preferences,
      user_api_keys,
      source = 'yapper_interface',
      include_video = false,
      video_duration = 10
    } = req.body;

    if (!wallet_address || !campaigns || !Array.isArray(campaigns) || campaigns.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'wallet_address and campaigns array are required'
      });
    }

    if (!user_api_keys) {
      return res.status(400).json({
        error: 'Missing API keys',
        message: 'API keys are required for content generation'
      });
    }

    logger.info(`🎯 Starting yapper interface content generation for wallet: ${wallet_address}`);

    // Get user ID from wallet address
    const userRepository = AppDataSource.getRepository('User');
    let user = await userRepository.findOne({ where: { walletAddress: wallet_address } });
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User with this wallet address not found'
      });
    }

    // Create execution tracking record
    const executionRepository = AppDataSource.getRepository(ExecutionTracking);
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const execution = executionRepository.create({
      executionId,
      userId: user.id,
      campaignId: campaigns[0].campaign_id, // Use first campaign for tracking
      source,
      status: 'pending',
      progress: 0,
      postType: campaigns[0].post_type,
      includeBrandLogo: campaigns[0].include_brand_logo || true,
      selectedYapperHandle: campaigns[0].selected_yapper_handle,
      price: campaigns[0].price
      // contentId will be set when content is generated
    });

    await executionRepository.save(execution);
    logger.info(`✅ Created execution tracking record: ${executionId}`);

    // Call Python backend for content generation
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    const response = await fetch(`${pythonBackendUrl}/api/mining/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        execution_id: executionId, // Pass the execution_id to Python backend
        wallet_address,
        campaigns,
        user_preferences,
        user_api_keys,
        source,
        include_video,
        video_duration
      })
    });

          if (!response.ok) {
        const errorData = await response.json() as any;
        logger.error(`❌ Python backend error: ${errorData?.detail || 'Unknown error'}`);
        
        // Update execution status to failed
        execution.status = 'failed';
        execution.errorMessage = errorData?.detail || 'Python backend error';
        await executionRepository.save(execution);
        
        return res.status(response.status).json({
          error: 'Content generation failed',
          message: errorData?.detail || 'Failed to start content generation'
        });
      }

      const result = await response.json() as any;
      logger.info(`✅ Python backend started content generation: ${result?.execution_id}`);

      // Update execution with Python backend execution ID
      execution.status = 'processing';
      execution.progress = 10;
      await executionRepository.save(execution);

      return res.json({
        execution_id: executionId,
        python_execution_id: result?.execution_id,
        status: 'started',
        message: 'Content generation started successfully. Use execution_id to track progress.',
        campaigns_count: campaigns.length,
        source: 'yapper_interface'
      });

  } catch (error) {
    logger.error('❌ Error starting yapper interface content generation:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get execution status for polling
router.get('/status/:executionId', async (req, res) => {
  try {
    const { executionId } = req.params;
    
    logger.info(`🔍 Checking yapper interface execution status: ${executionId}`);
    
    const executionRepository = AppDataSource.getRepository(ExecutionTracking);
    const execution = await executionRepository.findOne({
      where: { executionId },
      relations: ['user', 'campaign']
    });
    
    if (!execution) {
      return res.status(404).json({
        execution_id: executionId,
        status: 'not_found',
        message: 'Execution not found'
      });
    }
    
    return res.json({
      execution_id: execution.executionId,
      status: execution.status,
      progress: execution.progress,
      result: execution.resultData,
      error: execution.errorMessage,
      post_type: execution.postType,
      selected_yapper_handle: execution.selectedYapperHandle,
      price: execution.price,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      completed_at: execution.completedAt
    });
    
  } catch (error) {
    logger.error(`❌ Error getting yapper interface execution status: ${error}`);
    return res.status(500).json({
      error: 'Failed to get execution status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
