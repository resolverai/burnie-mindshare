import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { Campaign } from '../models/Campaign';
import { Project } from '../models/Project';
import { Repository } from 'typeorm';
import { CampaignStatus, CampaignType } from '../types/index';

const router = Router();

// GET /api/campaigns/active - Get active campaigns for mining interface
router.get('/active', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string;
    const campaign_type = req.query.campaign_type as string;
    const limit = parseInt(req.query.limit as string) || 50;

    if (!AppDataSource.isInitialized) {
      logger.warn('Database not initialized, returning empty campaigns list');
      return res.json({
        success: true,
        data: [],
        timestamp: new Date().toISOString(),
      });
    }

    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    
    let queryBuilder = campaignRepository.createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.project', 'project')
      .leftJoinAndSelect('campaign.submissions', 'submissions')
      .where('campaign.status = :status', { status: CampaignStatus.ACTIVE })
      .andWhere('campaign.endDate > :now', { now: new Date() })
      .orderBy('campaign.createdAt', 'DESC')
      .take(limit);

    if (category) {
      queryBuilder = queryBuilder.andWhere('campaign.category = :category', { category });
    }

    if (campaign_type) {
      queryBuilder = queryBuilder.andWhere('campaign.campaignType = :type', { type: campaign_type });
    }

    const campaigns = await queryBuilder.getMany();

    // Format for mining interface
    const formattedCampaigns = campaigns.map(campaign => ({
      id: campaign.id,
      title: campaign.title,
      slug: campaign.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-'),
      description: campaign.description,
      topic: campaign.category,
      campaign_type: campaign.campaignType,
      category: campaign.category,
      keywords: campaign.metadata?.tags || [],
      guidelines: campaign.metadata?.brandGuidelines || '',
      min_token_spend: campaign.requirements?.minStake || 100,
      winner_reward: campaign.rewardPool,
      max_submissions: campaign.maxSubmissions,
      current_submissions: campaign.submissions?.length || 0,
      submission_deadline: campaign.endDate.toISOString(),
      time_remaining: Math.max(0, campaign.endDate.getTime() - Date.now()),
      submission_rate: campaign.submissions?.length ? 
        campaign.submissions.length / campaign.maxSubmissions : 0,
      is_full: (campaign.submissions?.length || 0) >= campaign.maxSubmissions,
      project: campaign.project ? {
        id: campaign.project.id,
        name: campaign.project.name,
        logoUrl: campaign.project.logo,
      } : null
    }));

    logger.info(`📢 Retrieved ${formattedCampaigns.length} active campaigns for mining`);

    res.json({
      success: true,
      data: formattedCampaigns,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch active campaigns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active campaigns',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/campaigns - List all campaigns with pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;
    const projectId = req.query.projectId ? parseInt(req.query.projectId as string) : undefined;

    if (!AppDataSource.isInitialized) {
      logger.warn('Database not initialized, returning empty campaigns list');
      return res.json({
        success: true,
        data: [],
        pagination: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    
    let queryBuilder = campaignRepository.createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.project', 'project')
      .leftJoinAndSelect('campaign.submissions', 'submissions')
      .orderBy('campaign.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (status) {
      queryBuilder = queryBuilder.where('campaign.status = :status', { status });
    }

    if (projectId) {
      queryBuilder = queryBuilder.andWhere('campaign.projectId = :projectId', { projectId });
    }

    const [campaigns, total] = await queryBuilder.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

    logger.info(`📋 Retrieved ${campaigns.length} campaigns (page ${page}/${totalPages})`);

    res.json({
      success: true,
      data: campaigns.map(campaign => ({
        ...campaign,
        submissionCount: campaign.submissions?.length || 0,
        isActive: campaign.status === CampaignStatus.ACTIVE,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch campaigns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaigns',
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/campaigns - Create new campaign
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      projectId,
      title,
      description,
      category,
      campaignType,
      rewardPool,
      entryFee,
      maxSubmissions,
      startDate,
      endDate,
      requirements,
      metadata,
      isActive = true
    } = req.body;

    logger.info('📝 Creating new campaign:', { title, projectId, campaignType, rewardPool });

    // Validate required fields
    if (!title || !description || !category || !campaignType || !rewardPool || !maxSubmissions || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, description, category, campaignType, rewardPool, maxSubmissions, startDate, endDate',
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
    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);

    // Verify project exists if projectId is provided
    if (projectId) {
      const project = await projectRepository.findOne({
        where: { id: projectId }
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Create new campaign
    const newCampaign = campaignRepository.create({
      title,
      description,
      category,
      campaignType: campaignType as CampaignType,
      rewardPool,
      entryFee: entryFee || 0,
      maxSubmissions,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      requirements: requirements || {},
      metadata: metadata || {},
      status: isActive ? CampaignStatus.ACTIVE : CampaignStatus.DRAFT,
      projectId: projectId || undefined,
      creatorId: 1, // TODO: Get from authentication
    });

    const savedCampaign = await campaignRepository.save(newCampaign);

    // Fetch the campaign with relations
    const campaignWithProject = await campaignRepository.findOne({
      where: { id: savedCampaign.id },
      relations: ['project'],
    });

    logger.info(`✅ Campaign created successfully: ${savedCampaign.id} - ${savedCampaign.title || 'Unknown'}`);

    res.status(201).json({
      success: true,
      data: campaignWithProject,
      message: 'Campaign created successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to create campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create campaign',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/campaigns/:id - Get campaign details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(req.params.id || '');

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
    
    const campaign = await campaignRepository.findOne({
      where: { id: campaignId },
      relations: ['project', 'submissions', 'submissions.miner'],
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📖 Retrieved campaign details: ${campaign.title || 'Unknown'}`);

    res.json({
      success: true,
      data: {
        ...campaign,
        submissionCount: campaign.submissions?.length || 0,
        isActive: campaign.status === CampaignStatus.ACTIVE,
        timeRemaining: Math.max(0, campaign.endDate.getTime() - Date.now()),
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/campaigns/:id - Update campaign
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(req.params.id || '');
    const updates = req.body;

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
    
    const campaign = await campaignRepository.findOne({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Update campaign fields
    Object.assign(campaign, updates);
    
    const updatedCampaign = await campaignRepository.save(campaign);

    logger.info(`✅ Campaign updated successfully: ${updatedCampaign.title || 'Unknown'}`);

    res.json({
      success: true,
      data: updatedCampaign,
      message: 'Campaign updated successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to update campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update campaign',
      timestamp: new Date().toISOString(),
    });
  }
});

// DELETE /api/campaigns/:id - Delete campaign
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(req.params.id || '');

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
    
    const campaign = await campaignRepository.findOne({
      where: { id: campaignId },
      relations: ['submissions'],
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Check if campaign has submissions
    if (campaign.submissions && campaign.submissions.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete campaign with existing submissions',
        timestamp: new Date().toISOString(),
      });
    }

    await campaignRepository.remove(campaign);

    logger.info(`✅ Campaign deleted successfully: ${campaign.title || 'Unknown'}`);

    res.json({
      success: true,
      message: 'Campaign deleted successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to delete campaign:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete campaign',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/campaigns/:id/status - Update campaign status
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(req.params.id || '');
    const { status } = req.body;

    if (isNaN(campaignId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid campaign ID',
        timestamp: new Date().toISOString(),
      });
    }

    if (!status || !Object.values(CampaignStatus).includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Valid status is required',
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
    
    const campaign = await campaignRepository.findOne({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found',
        timestamp: new Date().toISOString(),
      });
    }

    campaign.status = status;
    const updatedCampaign = await campaignRepository.save(campaign);

    logger.info(`✅ Campaign status updated: ${campaign.title || 'Unknown'} -> ${status}`);

    res.json({
      success: true,
      data: updatedCampaign,
      message: `Campaign status updated to ${status}`,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to update campaign status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update campaign status',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/campaigns/:id/stats - Get campaign statistics
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(req.params.id || '');

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
    
    const campaign = await campaignRepository.findOne({
      where: { id: campaignId },
      relations: ['submissions', 'submissions.miner'],
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found',
        timestamp: new Date().toISOString(),
      });
    }

    const submissions = campaign.submissions || [];
    const uniqueMiners = new Set(submissions.map(s => s.minerId)).size;
    const approvedSubmissions = submissions.filter(s => s.status === 'APPROVED');
    const avgScore = submissions.length > 0 ? 
      submissions.reduce((sum, s) => sum + (s.totalScore || 0), 0) / submissions.length : 0;

    const stats = {
      totalSubmissions: submissions.length,
      approvedSubmissions: approvedSubmissions.length,
      rejectedSubmissions: submissions.filter(s => s.status === 'REJECTED').length,
      pendingSubmissions: submissions.filter(s => s.status === 'PENDING').length,
      uniqueMiners,
      averageScore: Math.round(avgScore * 100) / 100,
      completionRate: campaign.maxSubmissions > 0 ? 
        Math.round((submissions.length / campaign.maxSubmissions) * 100) : 0,
      timeRemaining: Math.max(0, campaign.endDate.getTime() - Date.now()),
      totalTokensSpent: submissions.reduce((sum, s) => sum + (s.tokensSpent || 0), 0),
    };

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch campaign stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign stats',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as campaignRoutes }; 