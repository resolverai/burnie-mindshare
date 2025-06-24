import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { Campaign } from '../models/Campaign';
import { Project } from '../models/Project';
import { Submission } from '../models/Submission';
import { Miner } from '../models/Miner';
import { Repository } from 'typeorm';
import { CampaignStatus, SubmissionStatus } from '../types/index';

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
        rejected_submissions: totalSubmissions - approvedSubmissions - pendingSubmissions,
        total_rewards_distributed: 0, // TODO: Calculate from rewards table
        avg_submission_score: 0, // TODO: Calculate average score
        growth_metrics: {
          projects_growth: 0,
          campaigns_growth: 0,
          submissions_growth: 0,
          current_period: {
            projects: totalProjects,
            campaigns: totalCampaigns,
            submissions: totalSubmissions,
          },
          previous_period: {
            projects: 0,
            campaigns: 0,
            submissions: 0,
          }
        },
        performance_metrics: {
          avg_submissions_per_campaign: totalCampaigns > 0 ? Math.round(totalSubmissions / totalCampaigns) : 0,
          approval_rate: totalSubmissions > 0 ? Math.round((approvedSubmissions / totalSubmissions) * 100) : 0,
          avg_reward_per_submission: 0,
          active_campaign_percentage: totalCampaigns > 0 ? Math.round((activeCampaigns / totalCampaigns) * 100) : 0,
        },
        top_performing_campaigns: [], // TODO: Implement
        recent_activity: [], // TODO: Implement
      };
    } else {
      // Fallback to empty data if database not available
      logger.warn('⚠️ Database not available, returning empty analytics');
      dashboardData = {
        total_projects: 0,
        total_campaigns: 0,
        active_campaigns: 0,
        total_submissions: 0,
        total_miners: 0,
        pending_submissions: 0,
        approved_submissions: 0,
        rejected_submissions: 0,
        total_rewards_distributed: 0,
        avg_submission_score: 0,
        growth_metrics: {
          projects_growth: 0,
          campaigns_growth: 0,
          submissions_growth: 0,
          current_period: { projects: 0, campaigns: 0, submissions: 0 },
          previous_period: { projects: 0, campaigns: 0, submissions: 0 }
        },
        performance_metrics: {
          avg_submissions_per_campaign: 0,
          approval_rate: 0,
          avg_reward_per_submission: 0,
          active_campaign_percentage: 0,
        },
        top_performing_campaigns: [],
        recent_activity: [],
      };
    }

    res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch dashboard analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/analytics/miners/:id - Get miner analytics
router.get('/miners/:id', async (req: Request, res: Response) => {
  try {
    const minerId = req.params.id;

    if (!minerId) {
      return res.status(400).json({
        success: false,
        error: 'Miner ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📊 Fetching analytics for miner ${minerId}`);

    const minerAnalytics = {
      minerId: parseInt(minerId),
      overview: {
        totalSubmissions: 234,
        approvedSubmissions: 198,
        rejectedSubmissions: 36,
        averageScore: 8.7,
        totalEarnings: 12500,
        rank: 3,
        streakDays: 7,
      },
      performance: {
        dailySubmissions: [
          { date: '2024-01-15', count: 8, avgScore: 8.9 },
          { date: '2024-01-16', count: 12, avgScore: 8.2 },
          { date: '2024-01-17', count: 6, avgScore: 9.1 },
          { date: '2024-01-18', count: 15, avgScore: 8.5 },
          { date: '2024-01-19', count: 9, avgScore: 8.8 },
          { date: '2024-01-20', count: 11, avgScore: 8.3 },
          { date: '2024-01-21', count: 7, avgScore: 9.0 },
        ],
        categoryBreakdown: [
          { category: 'roast', count: 145, avgScore: 9.1 },
          { category: 'meme', count: 67, avgScore: 8.2 },
          { category: 'creative', count: 22, avgScore: 8.9 },
        ],
        qualityTrend: [
          { period: 'Week 1', score: 7.8 },
          { period: 'Week 2', score: 8.1 },
          { period: 'Week 3', score: 8.4 },
          { period: 'Week 4', score: 8.7 },
        ],
      },
      recentSubmissions: [
        {
          id: 1234,
          campaignId: 1,
          campaignTitle: 'Roast the Competition',
          content: 'Their marketing is so bad...',
          score: 9.2,
          status: 'APPROVED',
          submittedAt: new Date(Date.now() - 300000).toISOString(),
        },
        {
          id: 1233,
          campaignId: 2,
          campaignTitle: 'Meme Magic Monday',
          content: 'When you HODL through...',
          score: 8.1,
          status: 'APPROVED',
          submittedAt: new Date(Date.now() - 1800000).toISOString(),
        },
      ],
    };

    res.json({
      success: true,
      data: minerAnalytics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch miner analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch miner analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/analytics/campaigns/:id - Get campaign analytics
router.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: 'Campaign ID is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📊 Fetching analytics for campaign ${campaignId}`);

    const campaignAnalytics = {
      campaignId: parseInt(campaignId),
      overview: {
        totalSubmissions: 342,
        uniqueParticipants: 89,
        averageScore: 8.4,
        totalRewards: 50000,
        topScore: 9.8,
        completionRate: 78.5,
      },
      timeline: {
        submissions: [
          { date: '2024-01-15', count: 23 },
          { date: '2024-01-16', count: 45 },
          { date: '2024-01-17', count: 67 },
          { date: '2024-01-18', count: 89 },
          { date: '2024-01-19', count: 78 },
          { date: '2024-01-20', count: 40 },
        ],
        qualityScores: [
          { date: '2024-01-15', avgScore: 7.8 },
          { date: '2024-01-16', avgScore: 8.1 },
          { date: '2024-01-17', avgScore: 8.3 },
          { date: '2024-01-18', avgScore: 8.4 },
          { date: '2024-01-19', avgScore: 8.6 },
          { date: '2024-01-20', avgScore: 8.9 },
        ],
      },
      topSubmissions: [
        {
          id: 1234,
          minerId: 42,
          minerName: 'SavageRoaster_007',
          content: 'Their marketing is so bad, even their own customers are bearish',
          score: 9.8,
          engagement: 234,
        },
        {
          id: 1235,
          minerId: 17,
          minerName: 'MemeKing_420',
          content: 'Calling them innovative is like calling a rug pull a strategic pivot',
          score: 9.5,
          engagement: 189,
        },
      ],
    };

    res.json({
      success: true,
      data: campaignAnalytics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch campaign analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/analytics/system - Get system analytics
router.get('/system', async (req: Request, res: Response) => {
  try {
    logger.info('📊 Fetching system analytics');

    const systemAnalytics = {
      performance: {
        apiRequests24h: 25678,
        avgResponseTime: 145,
        errorRate: 0.02,
        uptime: process.uptime(),
      },
      infrastructure: {
        websocketConnections: 89,
        activeMiners: 89,
        databaseConnections: 5,
        redisMemoryUsage: '256MB',
      },
      blockchain: {
        totalTransactions: 1247,
        pendingTransactions: 3,
        gasUsed24h: '0.0234 ETH',
        contractBalance: '125000 ROAST',
      },
    };

    res.json({
      success: true,
      data: systemAnalytics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('❌ Failed to fetch system analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch system analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as analyticsRoutes }; 