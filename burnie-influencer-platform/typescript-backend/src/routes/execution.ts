import { Router } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { ExecutionTracking } from '../models/ExecutionTracking';

const router = Router();

// Get execution status for yapper interface polling
router.get('/status/:executionId', async (req, res) => {
  try {
    const { executionId } = req.params;
    
    logger.info(`🔍 Checking execution status for: ${executionId}`);
    
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
      content_id: execution.contentId, // Add content_id to response
      created_at: execution.createdAt,
      updated_at: execution.updatedAt,
      completed_at: execution.completedAt,
      message: `Execution ${executionId} is ${execution.status}`
    });
    
  } catch (error) {
    logger.error(`❌ Error getting execution status for ${req.params.executionId}:`, error);
    return res.status(500).json({
      error: 'Failed to get execution status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update execution with content ID after content generation
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
    
    logger.info(`📝 Updating execution ${executionId} with content ID: ${contentId}`);
    
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
    
    logger.info(`✅ Execution ${executionId} updated with content ID: ${contentId}`);
    
    return res.json({
      execution_id: executionId,
      content_id: contentId,
      status: 'content_generated',
      message: 'Execution updated with content ID successfully'
    });
    
  } catch (error) {
    logger.error(`❌ Error updating execution ${req.params.executionId}:`, error);
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
    const { status, progress, message } = req.body;
    
    if (!status) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'Status is required'
      });
    }
    
    logger.info(`📝 Updating execution ${executionId} status to: ${status}`);
    
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
    if (progress !== undefined) execution.progress = progress;
    if (message) execution.resultData = { message };
    
    if (status === 'completed') {
      execution.completedAt = new Date();
    }
    
    await executionRepository.save(execution);
    
    logger.info(`✅ Execution ${executionId} status updated to: ${status}`);
    
    return res.json({
      execution_id: executionId,
      status: status,
      progress: execution.progress,
      message: message || `Execution status updated to ${status}`,
      completed_at: execution.completedAt
    });
    
  } catch (error) {
    logger.error(`❌ Error updating execution status for ${req.params.executionId}:`, error);
    return res.status(500).json({
      error: 'Failed to update execution status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get all executions for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    logger.info(`🔍 Getting executions for user: ${userId}`);
    
    const executionRepository = AppDataSource.getRepository(ExecutionTracking);
    const executions = await executionRepository.find({
      where: { userId: parseInt(userId) },
      relations: ['campaign'],
      order: { createdAt: 'DESC' }
    });
    
    return res.json({
      user_id: userId,
      executions: executions.map(exec => ({
        execution_id: exec.executionId,
        status: exec.status,
        progress: exec.progress,
        campaign_id: exec.campaignId,
        post_type: exec.postType,
        created_at: exec.createdAt,
        updated_at: exec.updatedAt
      }))
    });
    
  } catch (error) {
    logger.error(`❌ Error getting executions for user ${req.params.userId}:`, error);
    return res.status(500).json({
      error: 'Failed to get user executions',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
