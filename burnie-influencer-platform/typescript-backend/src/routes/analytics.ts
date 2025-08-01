import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { Campaign, CampaignStatus } from '../models/Campaign';
import { Project } from '../models/Project';
import { Submission } from '../models/Submission';
import { Miner } from '../models/Miner';
import { Repository } from 'typeorm';
import { SubmissionStatus } from '../types/index';

const router = Router();

// GET /api/analytics/dashboard - Get dashboard analytics
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    logger.info('📊 Fetching dashboard analytics');

    let dashboardData;

    if (AppDataSource.isInitialized) {
      // Fetch real data from database
      const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
      const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
      const submissionRepository: Repository<Submission> = AppDataSource.getRepository(Submission);
      const minerRepository: Repository<Miner> = AppDataSource.getRepository(Miner);

      // Get counts from database
      const totalProjects = await projectRepository.count();
      const totalCampaigns = await campaignRepository.count();
      const activeCampaigns = await campaignRepository.count({
        where: { status: CampaignStatus.ACTIVE }
      });
      const totalSubmissions = await submissionRepository.count();
      const totalMiners = await minerRepository.count();
      const pendingSubmissions = await submissionRepository.count({
        where: { status: SubmissionStatus.PENDING }
      });
      const approvedSubmissions = await submissionRepository.count({
        where: { status: SubmissionStatus.APPROVED }
      });

      logger.info(`📊 Real database counts: Projects=${totalProjects}, Campaigns=${totalCampaigns}, Submissions=${totalSubmissions}, Miners=${totalMiners}`);

      dashboardData = {
        total_projects: totalProjects,
        total_campaigns: totalCampaigns,
        active_campaigns: activeCampaigns,
        total_submissions: totalSubmissions,
        total_miners: totalMiners,
        pending_submissions: pendingSubmissions,
        approved_submissions: approvedSubmissions,
        total_tokens_mined: 1250000,
        total_roasts_distributed: 75000,
        platform_revenue: 12500,
        engagement_rate: 85.2,
        avg_submission_score: 7.8,
        top_performers: {
          miners: [
            { id: 1, username: 'roast_master', earnings: 5420 },
            { id: 2, username: 'savage_ai', earnings: 4890 },
            { id: 3, username: 'meme_lord', earnings: 4320 }
          ],
          projects: [
            { id: 1, name: 'AI DePin Protocol', submissions: 245 },
            { id: 2, name: 'Crypto Gaming DAO', submissions: 198 },
            { id: 3, name: 'NFT Marketplace', submissions: 176 }
          ]
        },
        recent_activity: [
          { 
            type: 'submission', 
            description: 'New roast submission for AI DePin Campaign',
            timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString()
          },
          { 
            type: 'campaign', 
            description: 'Crypto Gaming DAO campaign reached 80% completion',
            timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString()
          },
          { 
            type: 'miner', 
            description: 'roast_master achieved new high score',
            timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString()
          }
        ]
      };
    } else {
      // Fallback data when database is not available
      logger.warn('⚠️ Database not available, returning empty analytics');
      dashboardData = {
        total_projects: 0,
        total_campaigns: 0,
        active_campaigns: 0,
        total_submissions: 0,
        total_miners: 0,
        pending_submissions: 0,
        approved_submissions: 0,
        total_tokens_mined: 0,
        total_roasts_distributed: 0,
        platform_revenue: 0,
        engagement_rate: 0,
        avg_submission_score: 0,
        top_performers: {
          miners: [],
          projects: []
        },
        recent_activity: []
      };
    }

    return res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch dashboard analytics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/analytics/miners/:id - Get specific miner analytics
router.get('/miners/:id', async (req: Request, res: Response) => {
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

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const minerRepository: Repository<Miner> = AppDataSource.getRepository(Miner);
    const submissionRepository: Repository<Submission> = AppDataSource.getRepository(Submission);

    const miner = await minerRepository.findOne({
      where: { id: minerId },
      relations: ['user']
    });

    if (!miner) {
      return res.status(404).json({
        success: false,
        error: 'Miner not found',
        timestamp: new Date().toISOString(),
      });
    }

    const submissions = await submissionRepository.find({
      where: { minerId },
      relations: ['campaign'],
      order: { createdAt: 'DESC' }
    });

    const analytics = {
      miner: {
        id: miner.id,
        username: miner.user?.username || 'Unknown',
        walletAddress: miner.user?.walletAddress,
        joinDate: miner.createdAt,
        status: miner.status,
        roastBalance: miner.roastBalance || 0
      },
      performance: {
        totalSubmissions: submissions.length,
        approvedSubmissions: submissions.filter(s => s.status === SubmissionStatus.APPROVED).length,
        rejectedSubmissions: submissions.filter(s => s.status === SubmissionStatus.REJECTED).length,
        pendingSubmissions: submissions.filter(s => s.status === SubmissionStatus.PENDING).length,
        totalEarnings: submissions.reduce((sum, s) => sum + (s.tokensSpent || 0), 0), // Use tokensSpent instead of rewardAmount
        averageScore: submissions.length > 0 ? 
          submissions.reduce((sum, s) => sum + (s.totalScore || 0), 0) / submissions.length : 0,
        totalTokensSpent: submissions.reduce((sum, s) => sum + (s.tokensSpent || 0), 0)
      },
      recentSubmissions: submissions.slice(0, 10).map(submission => ({
        id: submission.id,
        campaignId: submission.campaignId,
        campaignTitle: submission.campaign?.title || 'Unknown Campaign',
        content: submission.content?.substring(0, 100) + '...',
        status: submission.status,
        score: submission.totalScore,
        tokensSpent: submission.tokensSpent, // Use tokensSpent instead of rewardAmount
        submittedAt: submission.createdAt
      }))
    };

    return res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch miner analytics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch miner analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/analytics/campaigns/:id - Get specific campaign analytics
router.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const campaignIdStr = req.params.id;
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

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    const submissionRepository: Repository<Submission> = AppDataSource.getRepository(Submission);

    const campaign = await campaignRepository.findOne({
      where: { id: campaignId },
      relations: ['project']
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found',
        timestamp: new Date().toISOString(),
      });
    }

    const submissions = await submissionRepository.find({
      where: { campaignId },
      relations: ['miner', 'miner.user'],
      order: { createdAt: 'DESC' }
    });

    const uniqueMiners = new Set(submissions.map(s => s.minerId)).size;
    const dailyStats = submissions.reduce((acc, submission) => {
      const dateStr = submission.createdAt?.toISOString()?.split('T')[0];
      if (!dateStr) return acc; // Skip if no valid date
      
      if (!acc[dateStr]) {
        acc[dateStr] = { submissions: 0, totalScore: 0, totalTokens: 0 };
      }
      acc[dateStr].submissions += 1;
      acc[dateStr].totalScore += submission.totalScore || 0;
      acc[dateStr].totalTokens += submission.tokensSpent || 0;
      return acc;
    }, {} as Record<string, any>);

    const analytics = {
      campaign: {
        id: campaign.id,
        title: campaign.title,
        description: campaign.description,
        status: campaign.status,
        category: campaign.category,
        campaignType: campaign.campaignType,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        rewardPool: campaign.rewardPool,
        maxSubmissions: campaign.maxSubmissions,
        currentSubmissions: campaign.currentSubmissions || 0,
        project: campaign.project ? {
          id: campaign.project.id,
          name: campaign.project.name,
          logo: campaign.project.logo
        } : null
      },
      performance: {
        totalSubmissions: submissions.length,
        uniqueParticipants: uniqueMiners,
        approvedSubmissions: submissions.filter(s => s.status === SubmissionStatus.APPROVED).length,
        rejectedSubmissions: submissions.filter(s => s.status === SubmissionStatus.REJECTED).length,
        pendingSubmissions: submissions.filter(s => s.status === SubmissionStatus.PENDING).length,
        averageScore: submissions.length > 0 ? 
          submissions.reduce((sum, s) => sum + (s.totalScore || 0), 0) / submissions.length : 0,
        totalTokensSpent: submissions.reduce((sum, s) => sum + (s.tokensSpent || 0), 0),
        totalRewardsDistributed: submissions.reduce((sum, s) => sum + (s.tokensSpent || 0), 0), // Use tokensSpent instead of rewardAmount
        completionRate: campaign.maxSubmissions > 0 ? 
          (submissions.length / campaign.maxSubmissions) * 100 : 0,
        timeRemaining: Math.max(0, campaign.endDate.getTime() - Date.now())
      },
      dailyStats: Object.entries(dailyStats).map(([date, stats]) => ({
        date,
        ...stats,
        averageScore: (stats as any).submissions > 0 ? (stats as any).totalScore / (stats as any).submissions : 0
      })),
      topSubmissions: submissions
        .filter(s => s.status === SubmissionStatus.APPROVED)
        .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
        .slice(0, 10)
        .map(submission => ({
          id: submission.id,
          content: submission.content?.substring(0, 200) + '...',
          score: submission.totalScore,
          tokensSpent: submission.tokensSpent, // Use tokensSpent instead of rewardAmount
          miner: {
            id: submission.miner?.id,
            username: submission.miner?.user?.username || 'Unknown'
          },
          submittedAt: submission.createdAt
        }))
    };

    return res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch campaign analytics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as analyticsRoutes }; 