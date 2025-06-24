import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { MiningService } from '../services/MiningService';

const router = Router();

// GET /api/mining/block-status - Get current block mining status
router.get('/block-status', async (req: Request, res: Response) => {
  try {
    const miningService = MiningService.getInstance();
    const status = miningService.getBlockStatus();
    
    res.json({
      success: true,
      data: status,
      blockMiningStarting: status.nextBlockIn <= 30000, // 30 seconds warning
      nextBlockIn: status.nextBlockIn,
      currentBlock: status.currentBlock,
      minersInQueue: status.minersInQueue,
      topMinersRequired: status.topMinersRequired,
    });
  } catch (error: any) {
    logger.error('Failed to get block status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get block status',
      details: error.message,
    });
  }
});

// GET /api/mining/blocks/current - Get current mining block info
router.get('/blocks/current', async (req: Request, res: Response) => {
  try {
    const miningService = MiningService.getInstance();
    const currentBlock = await miningService.getCurrentBlock();
    
    res.json({
      success: true,
      data: currentBlock,
    });
  } catch (error: any) {
    logger.error('Failed to get current block:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get current block',
      details: error.message,
    });
  }
});

// GET /api/mining/schedule - Get mining schedule information
router.get('/schedule', async (req: Request, res: Response) => {
  try {
    const miningService = MiningService.getInstance();
    const schedule = miningService.getMiningSchedule();
    
    res.json({
      success: true,
      data: {
        blockInterval: schedule.blockInterval,
        nextBlockTime: schedule.nextBlockTime,
        minMinersRequired: schedule.minMinersRequired,
        topMinersPerBlock: schedule.topMinersPerBlock,
        timeUntilNextBlock: schedule.timeUntilNextBlock,
      },
    });
  } catch (error: any) {
    logger.error('Failed to get mining schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get mining schedule',
      details: error.message,
    });
  }
});

// POST /api/mining/start - Manually trigger block mining (admin only)
router.post('/start', async (req: Request, res: Response) => {
  try {
    const miningService = MiningService.getInstance();
    const result = await miningService.startBlockMining();
    
    logger.info('Manual block mining triggered');
    res.json({
      success: true,
      data: result,
      message: 'Block mining started successfully',
    });
  } catch (error: any) {
    logger.error('Failed to start block mining:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start block mining',
      details: error.message,
    });
  }
});

// GET /api/mining/stats - Get mining statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const miningService = MiningService.getInstance();
    const stats = await miningService.getMiningStats();
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error('Failed to get mining stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get mining stats',
      details: error.message,
    });
  }
});

export default router; 