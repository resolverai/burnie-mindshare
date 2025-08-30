import { Router } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { ExecutionTracking } from '../models/ExecutionTracking';
import { env } from '../config/env';

const router = Router();

// Check if text-only mode is enabled
router.get('/mode-status', async (req, res) => {
  try {
    logger.info(`🔍 Checking text-only mode status`);
    
    const isEnabled = env.yapperInterface.textOnlyMode === 'true';
    
    logger.info(`✅ Text-only mode status: ${isEnabled}`);
    
    return res.json({
      textOnlyModeEnabled: isEnabled,
      message: isEnabled ? 'Text-only mode is enabled' : 'Text-only mode is disabled'
    });
    
  } catch (error) {
    logger.error('❌ Error checking text-only mode status:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Text-only regeneration endpoint
router.post('/regenerate-text', async (req, res) => {
  try {
    const {
      content_id,
      wallet_address,
      selected_yapper_handle,
      post_type
    } = req.body;

    if (!content_id || !wallet_address || !selected_yapper_handle) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'content_id, wallet_address, and selected_yapper_handle are required'
      });
    }

    logger.info(`🎯 Starting text-only regeneration for content: ${content_id}, yapper: ${selected_yapper_handle}`);

    // Get the existing content from marketplace
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const existingContent = await contentRepository.findOne({
      where: { id: content_id }
    });

    if (!existingContent) {
      return res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found in marketplace'
      });
    }

    // Check if text-only mode is enabled
    logger.info(`🔍 Environment check - YAPPER_TEXT_ONLY_MODE: ${env.yapperInterface.textOnlyMode}, type: ${typeof env.yapperInterface.textOnlyMode}`);
    
    if (env.yapperInterface.textOnlyMode !== 'true') {
      logger.info(`🔄 Text-only mode disabled, falling back to full regeneration for content: ${content_id}`);
      // Redirect to full regeneration endpoint
      return res.status(307).json({
        redirect: 'full_regeneration',
        message: 'Text-only mode disabled, redirecting to full regeneration'
      });
    }
    
    logger.info(`✅ Text-only mode enabled, proceeding with text-only regeneration for content: ${content_id}`);

    // Create execution tracking record for text-only regeneration
    const executionRepository = AppDataSource.getRepository(ExecutionTracking);
    const executionId = `text_only_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const execution = executionRepository.create({
      executionId,
      userId: existingContent.creatorId, // Use the original creator's ID
      campaignId: existingContent.campaignId,
      source: 'yapper_interface_text_only',
      status: 'pending',
      progress: 0,
      postType: post_type || existingContent.postType,
      selectedYapperHandle: selected_yapper_handle,
      price: env.yapperInterface.textOnlyRegenerationCost
    });

    await executionRepository.save(execution);
    logger.info(`✅ Created text-only execution tracking record: ${executionId}`);

    // Call Python backend for text-only generation
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    const response = await fetch(`${pythonBackendUrl}/api/mining/text-only-regeneration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        execution_id: executionId,
        content_id: content_id,
        wallet_address,
        selected_yapper_handle,
        post_type: post_type || existingContent.postType,
        image_prompt: existingContent.imagePrompt || '', // Pass stored image prompt
        content_text: existingContent.contentText, // Pass original content for alignment
        tweet_thread: existingContent.tweetThread || [], // Pass original thread for context
        source: 'yapper_interface_text_only'
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      logger.error(`❌ Python backend error for text-only regeneration: ${errorData?.detail || 'Unknown error'}`);
      
      // Update execution status to failed
      execution.status = 'failed';
      execution.errorMessage = errorData?.detail || 'Python backend error';
      await executionRepository.save(execution);
      
      return res.status(response.status).json({
        error: 'Text-only regeneration failed',
        message: errorData?.detail || 'Failed to start text-only regeneration'
      });
    }

    const result = await response.json() as any;
    logger.info(`✅ Python backend started text-only regeneration: ${result?.execution_id}`);

    // Update execution status
    execution.status = 'processing';
    execution.progress = 10;
    await executionRepository.save(execution);

    return res.json({
      execution_id: executionId,
      python_execution_id: result?.execution_id,
      status: 'started',
      message: 'Text-only regeneration started successfully. Use execution_id to track progress.',
      mode: 'text_only',
      content_id: content_id,
      source: 'yapper_interface_text_only'
    });

  } catch (error) {
    logger.error('❌ Error starting text-only regeneration:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get text-only regeneration status
router.get('/status/:executionId', async (req, res) => {
  try {
    const { executionId } = req.params;
    
    logger.info(`🔍 Checking text-only regeneration status for: ${executionId}`);
    
    const executionRepository = AppDataSource.getRepository(ExecutionTracking);
    const execution = await executionRepository.findOne({
      where: { executionId },
      relations: ['user', 'campaign']
    });
    
    if (!execution) {
      return res.status(404).json({
        execution_id: executionId,
        status: 'not_found',
        message: 'Execution not found or completed'
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
      content_id: execution.contentId,
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      completed_at: execution.completedAt,
      message: `Text-only regeneration ${executionId} is ${execution.status}`
    });
    
  } catch (error) {
    logger.error(`❌ Error getting text-only regeneration status for ${req.params.executionId}:`, error);
    return res.status(500).json({
      error: 'Failed to get execution status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update execution with content ID after text-only generation
router.put('/:executionId/content-id', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { contentId } = req.body;
    
    if (!contentId || isNaN(parseInt(contentId))) {
      return res.status(400).json({
        error: 'Invalid content ID',
        message: 'Valid content ID is required'
      });
    }
    
    logger.info(`📝 Updating text-only execution ${executionId} with content ID: ${contentId}`);
    
    const executionRepository = AppDataSource.getRepository(ExecutionTracking);
    const execution = await executionRepository.findOne({
      where: { executionId }
    });
    
    if (!execution) {
      return res.status(404).json({
        error: 'Execution not found',
        message: 'Execution with this ID not found'
      });
    }
    
    // Update execution with content ID
    execution.contentId = parseInt(contentId);
    execution.status = 'content_generated';
    await executionRepository.save(execution);
    
    logger.info(`✅ Text-only execution ${executionId} updated with content ID: ${contentId}`);
    
    return res.json({
      execution_id: executionId,
      content_id: contentId,
      status: 'content_generated',
      message: 'Text-only execution updated with content ID successfully'
    });
    
  } catch (error) {
    logger.error(`❌ Error updating text-only execution ${req.params.executionId}:`, error);
    return res.status(500).json({
      error: 'Failed to update execution',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update execution status (for Python backend to mark completion)
router.put('/:executionId/status', async (req, res) => {
  try {
    const { executionId } = req.params;
    const { status, progress, message, error, resultData } = req.body;
    
    logger.info(`📝 Updating text-only execution ${executionId} status to: ${status}`);
    
    const executionRepository = AppDataSource.getRepository(ExecutionTracking);
    const execution = await executionRepository.findOne({
      where: { executionId }
    });
    
    if (!execution) {
      return res.status(404).json({
        error: 'Execution not found',
        message: 'Execution with this ID not found'
      });
    }
    
    // Update execution status
    execution.status = status;
    execution.progress = progress || execution.progress;
    execution.errorMessage = error || execution.errorMessage;
    execution.resultData = resultData || execution.resultData;
    
    if (status === 'completed') {
      execution.completedAt = new Date();
    }
    
    await executionRepository.save(execution);
    
    logger.info(`✅ Text-only execution ${executionId} status updated to: ${status}`);
    
    return res.json({
      execution_id: executionId,
      status: status,
      message: `Text-only execution status updated to ${status}`
    });
    
  } catch (error) {
    logger.error(`❌ Error updating text-only execution ${req.params.executionId} status:`, error);
    return res.status(500).json({
      error: 'Failed to update execution status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
