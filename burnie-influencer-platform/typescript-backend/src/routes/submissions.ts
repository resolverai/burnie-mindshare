import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { MiningService } from '../services/MiningService';

const router = Router();

// POST /api/submissions - Submit content for mining
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      minerId,
      campaignId,
      content,
      tokensUsed,
      minerWallet,
      transactionHash
    } = req.body;

         logger.info('📝 Content submission request:', {
       minerId,
       campaignId,
       contentLength: content?.length,
       tokensUsed,
       minerWallet: minerWallet ? `${minerWallet.slice(0, 6)}...${minerWallet.slice(-4)}` : 'unknown'
     });

    // Validate required fields
    if (!minerId || !campaignId || !content || !tokensUsed || !minerWallet) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: minerId, campaignId, content, tokensUsed, minerWallet',
        timestamp: new Date().toISOString(),
      });
    }

    // Get mining service instance
    const miningService: MiningService = (global as any).miningService;
    
    if (!miningService) {
      logger.error('❌ Mining service not available');
      return res.status(503).json({
        success: false,
        error: 'Mining service not available',
        timestamp: new Date().toISOString(),
      });
    }

    // Check if campaign is still accepting submissions
    if (!miningService.isCampaignAcceptingSubmissions(campaignId)) {
      return res.status(400).json({
        success: false,
        error: `Campaign ${campaignId} has reached maximum submissions or is no longer active`,
        timestamp: new Date().toISOString(),
      });
    }

    // Submit content to mining service
    const result = await miningService.submitContent({
      minerId,
      campaignId,
      content,
      tokensUsed,
      minerWallet
    });

    if (result.success) {
      logger.info(`✅ Content submitted successfully: ${result.submissionId}`);
      
      res.status(201).json({
        success: true,
        data: {
          submissionId: result.submissionId,
          minerId,
          campaignId,
          tokensUsed,
          timestamp: new Date().toISOString()
        },
        message: result.message,
        timestamp: new Date().toISOString(),
      });
    } else {
      logger.warn(`⚠️ Content submission failed: ${result.message}`);
      
      res.status(400).json({
        success: false,
        error: result.message,
        timestamp: new Date().toISOString(),
      });
    }

  } catch (error) {
    logger.error('❌ Content submission failed:', error);
    res.status(500).json({
      success: false,
      error: 'Content submission failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/submissions/stats - Get mining statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const miningService: MiningService = (global as any).miningService;
    
    if (!miningService) {
      return res.status(503).json({
        success: false,
        error: 'Mining service not available',
        timestamp: new Date().toISOString(),
      });
    }

    const stats = miningService.getMiningStats();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to get mining stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get mining stats',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/submissions/campaign/:campaignId/count - Get submission count for campaign
router.get('/campaign/:campaignId/count', async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(req.params.campaignId || '');
    
    if (isNaN(campaignId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid campaign ID',
        timestamp: new Date().toISOString(),
      });
    }

    const miningService: MiningService = (global as any).miningService;
    
    if (!miningService) {
      return res.status(503).json({
        success: false,
        error: 'Mining service not available',
        timestamp: new Date().toISOString(),
      });
    }

    const stats = miningService.getMiningStats();
    const campaignCount = stats.campaignCounts[campaignId] || 0;
    const isAccepting = miningService.isCampaignAcceptingSubmissions(campaignId);
    
    res.json({
      success: true,
      data: {
        campaignId,
        currentSubmissions: campaignCount,
        maxSubmissions: 1500, // From env.mining.maxSubmissionsPerCampaign
        isAcceptingSubmissions: isAccepting,
        remainingSlots: Math.max(0, 1500 - campaignCount)
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to get campaign submission count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign submission count',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/submissions - List submissions with filtering
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 10;
    const campaignId = req.query.campaignId as string;
    const minerId = req.query.minerId as string;
    const status = req.query.status as string;

    logger.info('📋 Fetching submissions:', { page, size, campaignId, minerId, status });

    // TODO: Fetch from database
    const allMockSubmissions = [
      {
        id: 1234,
        campaignId: 1,
        campaignTitle: 'Roast the Competition 🔥',
        minerId: 42,
        minerName: 'SavageRoaster_007',
        content: 'Their marketing is so bad, even their own customers are bearish on their own token. They call it "utility" but the only utility I see is giving comedians material.',
        status: 'APPROVED',
        tokensSpent: 100,
        transactionHash: '0x1234567890abcdef',
        humorScore: 9.2,
        engagementScore: 8.8,
        originalityScore: 9.0,
        relevanceScore: 8.5,
        personalityScore: 9.5,
        totalScore: 8.98,
        aiAnalysis: {
          sentiment: 'humorous',
          keywords: ['marketing', 'bearish', 'utility', 'comedians'],
          categories: ['roast', 'crypto'],
          confidence: 0.95,
        },
        createdAt: new Date(Date.now() - 300000).toISOString(),
        updatedAt: new Date(Date.now() - 120000).toISOString(),
      },
      {
        id: 1235,
        campaignId: 2,
        campaignTitle: 'Meme Magic Monday 🎭',
        minerId: 17,
        minerName: 'MemeKing_420',
        content: 'When you HODL through the bear market but your portfolio still looks like a rug pull victim support group',
        status: 'APPROVED',
        tokensSpent: 50,
        transactionHash: '0xabcdef1234567890',
        humorScore: 8.1,
        engagementScore: 9.2,
        originalityScore: 8.5,
        relevanceScore: 8.8,
        personalityScore: 8.0,
        totalScore: 8.52,
        aiAnalysis: {
          sentiment: 'humorous',
          keywords: ['HODL', 'bear market', 'portfolio', 'rug pull'],
          categories: ['meme', 'crypto', 'trading'],
          confidence: 0.92,
        },
        createdAt: new Date(Date.now() - 600000).toISOString(),
        updatedAt: new Date(Date.now() - 300000).toISOString(),
      },
      {
        id: 1236,
        campaignId: 1,
        campaignTitle: 'Roast the Competition 🔥',
        minerId: 73,
        minerName: 'WittyWriter_101',
        content: 'Their roadmap has more forks than a spaghetti restaurant, and about as much direction.',
        status: 'PENDING',
        tokensSpent: 100,
        transactionHash: '0x567890abcdef1234',
        humorScore: null,
        engagementScore: null,
        originalityScore: null,
        relevanceScore: null,
        personalityScore: null,
        totalScore: null,
        aiAnalysis: null,
        createdAt: new Date(Date.now() - 60000).toISOString(),
        updatedAt: new Date(Date.now() - 60000).toISOString(),
      },
    ];

    // Apply filtering
    let filteredSubmissions = allMockSubmissions;
    
    if (campaignId) {
      filteredSubmissions = filteredSubmissions.filter(sub => 
        sub.campaignId === parseInt(campaignId)
      );
    }

    if (minerId) {
      filteredSubmissions = filteredSubmissions.filter(sub => 
        sub.minerId === parseInt(minerId)
      );
    }

    if (status) {
      filteredSubmissions = filteredSubmissions.filter(sub => 
        sub.status.toLowerCase() === status.toLowerCase()
      );
    }

    // Apply pagination
    const total = filteredSubmissions.length;
    const totalPages = Math.ceil(total / size);
    const startIndex = (page - 1) * size;
    const endIndex = startIndex + size;
    const paginatedSubmissions = filteredSubmissions.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedSubmissions,
      pagination: {
        page,
        size,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch submissions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch submissions',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/submissions/:id - Get submission details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const submissionId = req.params.id;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📋 Fetching submission details for ID: ${submissionId}`);

    // TODO: Fetch from database
    const mockSubmission = {
      id: parseInt(submissionId),
      campaignId: 1,
      campaignTitle: 'Roast the Competition 🔥',
      campaignDescription: 'Create savage roasts targeting competitor brands.',
      minerId: 42,
      minerName: 'SavageRoaster_007',
      minerPersonality: 'SAVAGE',
      content: 'Their marketing is so bad, even their own customers are bearish on their own token. They call it "utility" but the only utility I see is giving comedians material.',
      status: 'APPROVED',
      tokensSpent: 100,
      transactionHash: '0x1234567890abcdef',
      scores: {
        humor: 9.2,
        engagement: 8.8,
        originality: 9.0,
        relevance: 8.5,
        personality: 9.5,
        total: 8.98,
      },
      aiAnalysis: {
        sentiment: 'humorous',
        keywords: ['marketing', 'bearish', 'utility', 'comedians', 'token'],
        categories: ['roast', 'crypto', 'marketing'],
        confidence: 0.95,
        explanation: 'High-quality roast with excellent humor and crypto relevance. Strong personality match for SAVAGE archetype.',
      },
      engagement: {
        views: 1247,
        likes: 89,
        shares: 23,
        comments: 12,
      },
      metadata: {
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
        generationTime: 1.2, // seconds
        revisionsCount: 0,
      },
      createdAt: new Date(Date.now() - 300000).toISOString(),
      updatedAt: new Date(Date.now() - 120000).toISOString(),
    };

    res.json({
      success: true,
      data: mockSubmission,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch submission details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch submission details',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/submissions/:id/approve - Approve submission
router.put('/:id/approve', async (req: Request, res: Response) => {
  try {
    const submissionId = req.params.id;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`✅ Approving submission ${submissionId}`);

    // TODO: Update database
    // TODO: Trigger reward calculation
    // TODO: Broadcast via WebSocket

    res.json({
      success: true,
      message: 'Submission approved successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to approve submission:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve submission',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/submissions/:id/reject - Reject submission
router.put('/:id/reject', async (req: Request, res: Response) => {
  try {
    const submissionId = req.params.id;
    const { reason } = req.body;

    if (!submissionId) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`❌ Rejecting submission ${submissionId}:`, reason);

    // TODO: Update database
    // TODO: Notify miner via WebSocket

    res.json({
      success: true,
      message: 'Submission rejected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to reject submission:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject submission',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as submissionRoutes }; 