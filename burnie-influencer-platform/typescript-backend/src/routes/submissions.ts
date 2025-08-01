import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { ContentSubmissionData } from '../types/index';
import { MiningService } from '../services/MiningService';

const router = Router();

// POST /api/submissions - Submit content for a campaign
router.post('/', async (req: Request, res: Response) => {
  try {
    const { 
      minerId, 
      miner_id,
      campaignId, 
      campaign_id,
      content, 
      tokensSpent,
      tokens_spent,
      tokensUsed,
      transactionHash,
      transaction_hash,
      metadata 
    } = req.body;

    // Support both camelCase and snake_case for compatibility
    const minerIdValue = minerId || miner_id;
    const campaignIdValue = campaignId || campaign_id;
    const tokensUsedValue = tokensSpent || tokens_spent || tokensUsed || 100;
    const txHash = transactionHash || transaction_hash;

    if (!minerIdValue || !campaignIdValue || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: minerId, campaignId, content',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📝 Content submission from miner ${minerIdValue} for campaign ${campaignIdValue}`);

    const miningService: MiningService = (global as any).miningService;
    
    if (!miningService) {
      return res.status(503).json({
        success: false,
        error: 'Mining service not available',
        timestamp: new Date().toISOString(),
      });
    }

    if (!content || content.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Content must be at least 10 characters long',
        timestamp: new Date().toISOString(),
      });
    }

    const submissionData = {
      minerId: parseInt(minerIdValue),
      campaignId: parseInt(campaignIdValue),
      content: content.trim(),
      tokensUsed: parseInt(tokensUsedValue),
      minerWallet: '0x1234567890123456789012345678901234567890', // TODO: Get from authenticated user
      transactionHash: txHash || `mock_tx_${Date.now()}`,
      metadata: metadata || {}
    };

    // Use service interface that expects specific parameters
    const result = await miningService.submitContent(submissionData);

    if (result.success) {
      logger.info(`✅ Content submitted successfully: ${result.submissionId}`);
      
      return res.status(201).json({
        success: true,
        data: {
          submissionId: result.submissionId,
          minerId: minerIdValue,
          campaignId: campaignIdValue,
          tokensUsed: tokensUsedValue,
          timestamp: new Date().toISOString()
        },
        message: result.message,
        timestamp: new Date().toISOString(),
      });
    } else {
      logger.warn(`⚠️ Content submission failed: ${result.message}`);
      
      return res.status(400).json({
        success: false,
        error: result.message,
        timestamp: new Date().toISOString(),
      });
    }

  } catch (error) {
    logger.error('❌ Content submission failed:', error);
    return res.status(500).json({
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
    
    return res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch mining stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch mining stats',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/submissions/campaign/:campaignId/count - Get submission count for campaign
router.get('/campaign/:campaignId/count', async (req: Request, res: Response) => {
  try {
    const campaignIdStr = req.params.campaignId;
    if (!campaignIdStr) {
      return res.status(400).json({
        success: false,
        error: 'Campaign ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const campaignId = parseInt(campaignIdStr);
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

    // Mock submission count since getCampaignSubmissionCount doesn't exist
    const stats = miningService.getMiningStats();
    const count = stats.campaignCounts[campaignId] || 0;
    const maxSubmissions = 1500; // Default max submissions
    const isFull = count >= maxSubmissions;

    return res.json({
      success: true,
      data: { count, maxSubmissions, isFull, remainingSlots: Math.max(0, maxSubmissions - count) },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch submission count:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch submission count',
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

    return res.json({
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
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch submissions',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/submissions/:id - Get submission details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const submissionIdStr = req.params.id;
    if (!submissionIdStr) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const submissionId = parseInt(submissionIdStr);
    if (isNaN(submissionId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid submission ID',
        timestamp: new Date().toISOString(),
      });
    }

    // Mock submission data for now
    const submission = {
      id: submissionId,
      minerId: 1,
      campaignId: 1,
      content: 'Sample submission content',
      status: 'PENDING',
      tokensSpent: 100,
      totalScore: 8.5,
      createdAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data: submission,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch submission:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch submission',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/submissions/:id/approve - Approve submission
router.put('/:id/approve', async (req: Request, res: Response) => {
  try {
    const submissionIdStr = req.params.id;
    if (!submissionIdStr) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const submissionId = parseInt(submissionIdStr);
    if (isNaN(submissionId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid submission ID',
        timestamp: new Date().toISOString(),
      });
    }

    // Mock approval logic
    const updatedSubmission = {
      id: submissionId,
      status: 'APPROVED',
      approvedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data: updatedSubmission,
      message: 'Submission approved successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to approve submission:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to approve submission',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/submissions/:id/reject - Reject submission
router.put('/:id/reject', async (req: Request, res: Response) => {
  try {
    const submissionIdStr = req.params.id;
    if (!submissionIdStr) {
      return res.status(400).json({
        success: false,
        error: 'Submission ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    const submissionId = parseInt(submissionIdStr);
    if (isNaN(submissionId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid submission ID',
        timestamp: new Date().toISOString(),
      });
    }

    // Mock rejection logic
    const updatedSubmission = {
      id: submissionId,
      status: 'REJECTED',
      rejectedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      data: updatedSubmission,
      message: 'Submission rejected successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to reject submission:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reject submission',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as submissionRoutes }; 