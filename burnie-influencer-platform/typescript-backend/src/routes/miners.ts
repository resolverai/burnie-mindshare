import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { MinerService } from '../services/MinerService';
import { MiningService } from '../services/MiningService';

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

    res.status(201).json({
      success: true,
      data: minerData,
      message: 'Miner registered successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Miner registration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Miner registration failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/miners - List all miners
router.get('/', async (req: Request, res: Response) => {
  try {
    // TODO: Fetch from database
    const mockMiners = [
      {
        id: 1,
        walletAddress: '0x1234567890123456789012345678901234567890',
        username: 'TestMiner',
        agentPersonality: 'SAVAGE',
        status: 'ONLINE',
        isAvailable: true,
        roastBalance: 1500,
        totalEarnings: 5000,
        submissionCount: 25,
        approvedSubmissionCount: 20,
        averageScore: 8.5,
        approvalRate: 80,
      },
    ];

    res.json({
      success: true,
      data: mockMiners,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch miners:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch miners',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/miners/:id - Get miner details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const minerId = req.params.id;
    
    if (!minerId || minerId === 'undefined') {
      return res.status(400).json({
        success: false,
        error: 'Valid miner ID is required',
        timestamp: new Date().toISOString(),
      });
    }
    
    // TODO: Fetch from database
    const mockMiner = {
      id: parseInt(minerId),
      walletAddress: '0x1234567890123456789012345678901234567890',
      username: 'TestMiner',
      agentPersonality: 'SAVAGE',
      llmProvider: 'OPENAI',
      status: 'ONLINE',
      isAvailable: true,
      roastBalance: 1500,
      totalEarnings: 5000,
      submissionCount: 25,
      approvedSubmissionCount: 20,
      averageScore: 8.5,
      approvalRate: 80,
      configuration: {
        maxDailySubmissions: 10,
        preferredCampaignTypes: ['roast', 'meme'],
        autoMode: false,
      },
      statistics: {
        bestScore: 9.8,
        streakDays: 7,
        favoriteCategory: 'roast',
        totalBlocksParticipated: 12,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    res.json({
      success: true,
      data: mockMiner,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch miner:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch miner',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/miners/:id/heartbeat - Send miner heartbeat
router.put('/:id/heartbeat', async (req: Request, res: Response) => {
  try {
    const minerId = req.params.id;
    const heartbeatData = req.body;

    if (!minerId || minerId === 'undefined') {
      return res.status(400).json({
        success: false,
        error: 'Valid miner ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`💓 Heartbeat from miner ${minerId}:`, heartbeatData);

    // Add miner to active mining list if they're mining
    const miningService: MiningService = (global as any).miningService;
    if (miningService) {
      if (heartbeatData.status === 'MINING' || heartbeatData.status === 'ONLINE') {
        miningService.addActiveMiner(parseInt(minerId));
      } else {
        miningService.removeActiveMiner(parseInt(minerId));
      }
    }

    // TODO: Update miner status in database
    res.json({
      success: true,
      message: 'Heartbeat received successfully',
      data: {
        minerId: parseInt(minerId),
        status: heartbeatData.status || 'ONLINE',
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to process heartbeat:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process heartbeat',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/miners/:id - Update miner settings
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const minerId = req.params.id;
    const updates = req.body;

    if (!minerId || minerId === 'undefined') {
      return res.status(400).json({
        success: false,
        error: 'Valid miner ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🔧 Updating miner ${minerId}:`, updates);

    // TODO: Update in database
    res.json({
      success: true,
      message: 'Miner updated successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to update miner:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update miner',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as minerRoutes }; 