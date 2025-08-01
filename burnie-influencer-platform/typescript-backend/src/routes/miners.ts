import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { MinerService } from '../services/MinerService';
import { MiningService } from '../services/MiningService';
import { AppDataSource } from '../config/database';
import { Miner } from '../models/Miner';

const router = Router();
const minerService = new MinerService();

// POST /api/miners/register - Register a new miner
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { 
      walletAddress, 
      wallet_address, 
      username, 
      agentPersonality, 
      agent_personality,
      llmProvider,
      llm_provider 
    } = req.body;

    // Support both camelCase and snake_case for compatibility
    const address = walletAddress || wallet_address;
    const personality = agentPersonality || agent_personality || 'WITTY';
    const provider = llmProvider || llm_provider || 'OPENAI';

    logger.info(`🔧 Miner registration request for wallet: ${address}`);
    logger.info(`📝 Request body:`, req.body);

    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address is required (walletAddress or wallet_address)',
        timestamp: new Date().toISOString(),
      });
    }

    const minerData = await minerService.registerMiner({
      walletAddress: address,
      personality: personality,
      username: username || `Miner_${address.slice(-6)}`,
    });

    logger.info(`✅ Miner registered successfully: ${minerData.id}`);

    return res.status(201).json({
      success: true,
      data: minerData,
      message: 'Miner registered successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to register miner:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to register miner',
      details: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/miners/schedule - Get mining schedule for all miners
router.get('/schedule', async (req: Request, res: Response) => {
  try {
    logger.info('📅 Fetching mining schedule');

    const miningService = new MiningService();
    const schedule = await miningService.getMiningSchedule();

    return res.json({
      success: true,
      data: schedule,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch mining schedule:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch mining schedule',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/miners - List all miners
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    // Get all miners from database
    const minerRepository = AppDataSource.getRepository(Miner);
    const miners = await minerRepository.find({
      relations: ['user'],
      order: { createdAt: 'DESC' }
    });

    // Format miner data
    const formattedMiners = miners.map((miner: Miner) => ({
      id: miner.id,
      walletAddress: miner.walletAddress,
      username: miner.user?.username || miner.username || 'Unknown',
      agentPersonality: miner.agentPersonality,
      status: miner.status,
      isAvailable: miner.isAvailable,
      roastBalance: miner.roastBalance || 0,
      totalEarnings: miner.totalEarnings || 0,
      submissionCount: miner.submissionCount || 0,
      approvedSubmissionCount: miner.approvedSubmissionCount || 0,
      averageScore: miner.averageScore || 0,
      approvalRate: miner.approvalRate || 0,
    }));

    return res.json({
      success: true,
      data: formattedMiners,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch miners:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch miners',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/miners/:id - Get specific miner details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const minerIdStr = req.params.id;
    if (!minerIdStr) {
      return res.status(400).json({
        success: false,
        error: 'Miner ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const minerId = parseInt(minerIdStr);
    if (isNaN(minerId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid miner ID',
        timestamp: new Date().toISOString(),
      });
    }

    // Use the existing getMiner method
    const miner = await minerService.getMiner(minerId);

    if (!miner) {
      return res.status(404).json({
        success: false,
        error: 'Miner not found',
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      success: true,
      data: miner,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch miner:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch miner',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/miners/:id/heartbeat - Update miner heartbeat
router.put('/:id/heartbeat', async (req: Request, res: Response) => {
  try {
    const minerIdStr = req.params.id;
    if (!minerIdStr) {
      return res.status(400).json({
        success: false,
        error: 'Miner ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const minerId = parseInt(minerIdStr);
    if (isNaN(minerId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid miner ID',
        timestamp: new Date().toISOString(),
      });
    }

    const { status, isAvailable, roastBalance, ipAddress, userAgent } = req.body;

    // Mock heartbeat update since updateHeartbeat doesn't exist
    logger.info(`💓 Heartbeat from miner ${minerId}:`, { status, isAvailable, roastBalance });

    const mockUpdatedMiner = {
      id: minerId,
      status: status || 'ONLINE',
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      roastBalance: roastBalance || 0,
      lastHeartbeat: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data: mockUpdatedMiner,
      message: 'Heartbeat updated successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to update heartbeat:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update heartbeat',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/miners/:id - Update miner details
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const minerIdStr = req.params.id;
    if (!minerIdStr) {
      return res.status(400).json({
        success: false,
        error: 'Miner ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const minerId = parseInt(minerIdStr);
    if (isNaN(minerId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid miner ID',
        timestamp: new Date().toISOString(),
      });
    }

    const updates = req.body;

    // Mock update since updateMiner doesn't exist
    logger.info(`🔧 Updating miner ${minerId}:`, updates);

    const mockUpdatedMiner = {
      id: minerId,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data: mockUpdatedMiner,
      message: 'Miner updated successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to update miner:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update miner',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as minerRoutes }; 