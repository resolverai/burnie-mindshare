import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { Campaign, CampaignStatus, CampaignType, CampaignCategory } from '../models/Campaign';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { Repository } from 'typeorm';
import { env } from '../config/env';
import multer from 'multer';
import AWS from 'aws-sdk';
import path from 'path';

const router = Router();

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  region: process.env.AWS_REGION || 'us-east-1'
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// POST /api/campaigns/upload-logo - Upload project logo to S3
router.post('/upload-logo', upload.single('logo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { projectName } = req.body;
    const file = req.file;
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${projectName || 'project'}-${timestamp}${fileExtension}`;
    const s3Key = `brand_logos/${fileName}`;

    // Upload to S3
    const uploadParams = {
      Bucket: process.env.S3_BUCKET_NAME || 'burnie-storage',
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentDisposition: `attachment; filename="${fileName}"`, // Force download
      CacheControl: 'max-age=31536000', // 1 year cache
      ServerSideEncryption: 'AES256'
    };

    const uploadResult = await s3.upload(uploadParams).promise();
    
    logger.info(`✅ Logo uploaded successfully: ${uploadResult.Location}`);

    return res.json({
      success: true,
      data: {
        logoUrl: uploadResult.Location,
        fileName: fileName,
        s3Key: s3Key
      },
      message: 'Logo uploaded successfully'
    });

  } catch (error) {
    logger.error('❌ Logo upload failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload logo'
    });
  }
});

// POST /api/campaigns/upload-banner - Upload campaign banner to S3
router.post('/upload-banner', upload.single('banner'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { campaignName } = req.body;
    const file = req.file;
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = path.extname(file.originalname);
    const fileName = `${campaignName || 'campaign'}-banner-${timestamp}${fileExtension}`;
    const s3Key = `campaign_banners/${fileName}`;

    // Upload to S3
    const uploadParams = {
      Bucket: process.env.S3_BUCKET_NAME || 'burnie-storage',
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentDisposition: `attachment; filename="${fileName}"`, // Force download
      CacheControl: 'max-age=31536000', // 1 year cache
      ServerSideEncryption: 'AES256'
    };

    const uploadResult = await s3.upload(uploadParams).promise();
    
    logger.info(`✅ Campaign banner uploaded successfully: ${uploadResult.Location}`);

    return res.json({
      success: true,
      data: {
        bannerUrl: uploadResult.Location,
        fileName: fileName,
        s3Key: s3Key
      },
      message: 'Campaign banner uploaded successfully'
    });

  } catch (error) {
    logger.error('❌ Campaign banner upload failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to upload campaign banner'
    });
  }
});

// GET /api/campaigns/marketplace-ready - Get marketplace-ready campaigns for mining interface
router.get('/marketplace-ready', async (req: Request, res: Response) => {
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
      brandGuidelines: campaign.brandGuidelines || '', // Use actual brandGuidelines column
      topic: campaign.category,
      campaign_type: campaign.campaignType,
      category: campaign.category,
      platform_source: campaign.platformSource,
      keywords: campaign.metadata?.tags || [],
      guidelines: campaign.metadata?.brandGuidelines || campaign.brandGuidelines || '', // Fallback
      min_token_spend: campaign.requirements?.minStake || 100,
      winner_reward: campaign.rewardPool,
      max_submissions: campaign.maxSubmissions,
      current_submissions: campaign.submissions?.length || 0,
      submission_deadline: campaign.endDate.toISOString(),
      time_remaining: Math.max(0, campaign.endDate.getTime() - Date.now()),
      submission_rate: campaign.submissions?.length ? 
        campaign.submissions.length / campaign.maxSubmissions : 0,
      is_full: (campaign.submissions?.length || 0) >= campaign.maxSubmissions,
      // Include project logo, name, and token ticker directly from campaign table
      projectName: campaign.projectName,
      projectLogo: campaign.projectLogo,
      tokenTicker: campaign.tokenTicker,
      project: campaign.project ? {
        id: campaign.project.id,
        name: campaign.project.name,
        logoUrl: campaign.project.logo,
      } : null
    }));

    logger.info(`📢 Retrieved ${formattedCampaigns.length} active campaigns for mining`);

    return res.json({
      success: true,
      data: formattedCampaigns,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch active campaigns:', error);
    return res.status(500).json({
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

    return res.json({
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
    return res.status(500).json({
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
      projectName,
      projectLogo,
      title,
      description,
      category,
      campaignType,
      rewardPool,
      entryFee,
      maxSubmissions = 1500, // Default value
      startDate,
      endDate,
      brandGuidelines,
      requirements,
      metadata,
      projectTwitterHandle, // New field for Twitter integration
      isActive = true
    } = req.body;

    logger.info('📝 Creating new campaign:', { title, projectName, campaignType, rewardPool, category });

    // Validate required fields
    if (!title || !description || !category || !campaignType || !rewardPool || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, description, category, campaignType, rewardPool, startDate, endDate',
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

    // Ensure default user exists for foreign key constraint
    const userRepository = AppDataSource.getRepository(User);
    const defaultUser = await userRepository.findOne({ where: { id: 1 } });
    if (!defaultUser) {
      // Create default user if it doesn't exist
      const newUser = userRepository.create({
        walletAddress: '0x0000000000000000000000000000000000000001',
        username: 'admin',
        email: 'admin@roastpower.com',
        isVerified: true,
        isAdmin: true,
        profile: {
          displayName: 'System Admin',
          bio: 'Default system administrator account',
          website: 'https://roastpower.com'
        }
      });
      await userRepository.save(newUser);
      logger.info('✅ Created default user for campaign creation');
    }

    // Create new campaign
    const campaignData = {
      title,
      description,
      projectName: projectName || undefined,
      projectLogo: projectLogo || undefined,
      category: category as CampaignCategory,
      campaignType: campaignType as CampaignType,
      rewardPool,
      entryFee: entryFee || 0,
      maxSubmissions,
      currentSubmissions: 0,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      brandGuidelines: brandGuidelines || undefined,
      requirements: requirements || {},
      metadata: metadata || {},
      status: isActive ? CampaignStatus.ACTIVE : CampaignStatus.DRAFT,
      projectId: projectId || undefined,
      projectTwitterHandle: projectTwitterHandle || undefined, // Add Twitter handle
      creatorId: 1, // TODO: Get from authentication
    };

    const newCampaign = campaignRepository.create(campaignData);
    const savedCampaign = await campaignRepository.save(newCampaign);

    // Fetch the campaign with relations
    const campaignWithProject = await campaignRepository.findOne({
      where: { id: savedCampaign.id },
      relations: ['project'],
    });

    logger.info(`✅ Campaign created successfully: ${savedCampaign.id} - ${savedCampaign.title || 'Unknown'}`);

    // Return success response immediately (non-blocking)
    const response = res.status(201).json({
      success: true,
      data: campaignWithProject,
      message: 'Campaign created successfully',
      timestamp: new Date().toISOString(),
    });

    // Trigger Twitter data fetching in background (fire-and-forget)
    if (projectTwitterHandle && projectTwitterHandle.trim()) {
      // Use setImmediate to ensure this runs after the response is sent
      setImmediate(async () => {
        try {
          logger.info('🐦 Triggering background Twitter data fetch for new campaign...');
          // Make request to Python AI backend to fetch Twitter data
          const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
          if (!pythonBackendUrl) {
            logger.error('PYTHON_AI_BACKEND_URL environment variable is not set');
            throw new Error('Python AI backend URL not configured');
          }
          
          const twitterFetchResponse = await fetch(`${pythonBackendUrl}/api/ai/fetch-project-twitter`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              project_id: projectId || savedCampaign.id,
              project_name: projectName || savedCampaign.title,
              twitter_handle: projectTwitterHandle,
              fetch_type: 'campaign_creation'
            }),
          });

          if (twitterFetchResponse.ok) {
            const twitterResult = await twitterFetchResponse.json() as any;
            logger.info(`🐦 Background Twitter data fetch completed for campaign ${savedCampaign.id}: ${twitterResult.posts_fetched || 0} posts`);
          } else {
            logger.warn(`⚠️ Background Twitter data fetch failed for campaign ${savedCampaign.id}: ${twitterFetchResponse.status}`);
          }
        } catch (error) {
          logger.warn(`⚠️ Background Twitter data fetch error for campaign ${savedCampaign.id}:`, error);
          // Don't fail campaign creation if Twitter fetch fails
        }
      });
    }

    return response;

  } catch (error) {
    logger.error('❌ Failed to create campaign:', error);
    return res.status(500).json({
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

    return res.json({
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
    return res.status(500).json({
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

    return res.json({
      success: true,
      data: updatedCampaign,
      message: 'Campaign updated successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to update campaign:', error);
    return res.status(500).json({
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

    return res.json({
      success: true,
      message: 'Campaign deleted successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to delete campaign:', error);
    return res.status(500).json({
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

    return res.json({
      success: true,
      data: updatedCampaign,
      message: `Campaign status updated to ${status}`,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to update campaign status:', error);
    return res.status(500).json({
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

    return res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch campaign stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign stats',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================================
// MVP MARKETPLACE SPECIFIC ENDPOINTS
// ============================================================================

/**
 * @route POST /api/campaigns/aggregate
 * @desc Manually aggregate campaigns from external platforms
 */
router.post('/aggregate', async (req: Request, res: Response) => {
  try {
    const { platform_source, campaigns } = req.body;

    if (!platform_source || !campaigns || !Array.isArray(campaigns)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: platform_source, campaigns (array)',
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
    const aggregatedCampaigns = [];

    for (const campaignData of campaigns) {
      try {
        // Check if campaign already exists by external ID
        const existingCampaign = await campaignRepository.findOne({
          where: { externalCampaignId: campaignData.external_id }
        });

        if (existingCampaign) {
          // Update existing campaign
          Object.assign(existingCampaign, {
            title: campaignData.title,
            description: campaignData.description,
            rewardToken: campaignData.reward_token,
            targetAudience: campaignData.target_audience,
            brandGuidelines: campaignData.brand_guidelines,
            predictedMindshare: campaignData.predicted_mindshare,
            isActive: campaignData.is_active !== false,
            endDate: campaignData.end_date ? new Date(campaignData.end_date) : existingCampaign.endDate,
          });

          const updatedCampaign = await campaignRepository.save(existingCampaign);
          aggregatedCampaigns.push(updatedCampaign);
        } else {
          // Create new campaign
          const newCampaign = campaignRepository.create({
            title: campaignData.title,
            description: campaignData.description,
            category: campaignData.category || 'general',
            campaignType: campaignData.campaign_type as CampaignType || CampaignType.SOCIAL,
            rewardPool: campaignData.reward_pool || '10000',
            maxSubmissions: campaignData.max_submissions || 1000,
            startDate: campaignData.start_date ? new Date(campaignData.start_date) : new Date(),
            endDate: campaignData.end_date ? new Date(campaignData.end_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
            status: CampaignStatus.ACTIVE,
            
            // MVP specific fields
            platformSource: platform_source,
            externalCampaignId: campaignData.external_id,
            rewardToken: campaignData.reward_token,
            targetAudience: campaignData.target_audience,
            brandGuidelines: campaignData.brand_guidelines,
            predictedMindshare: campaignData.predicted_mindshare,
            isActive: campaignData.is_active !== false,
            
            // Default values
            creatorId: 1, // System user
            currentSubmissions: 0,
            entryFee: 0,
            requirements: {},
            metadata: {
              source: platform_source,
              originalData: campaignData
            }
          });

          const savedCampaign = await campaignRepository.save(newCampaign);
          aggregatedCampaigns.push(savedCampaign);
        }
      } catch (error) {
        logger.error(`Failed to aggregate campaign ${campaignData.external_id}:`, error);
        // Continue with other campaigns
      }
    }

    logger.info(`✅ Aggregated ${aggregatedCampaigns.length} campaigns from ${platform_source}`);

    return res.status(201).json({
      success: true,
      data: aggregatedCampaigns,
      message: `Successfully aggregated ${aggregatedCampaigns.length} campaigns from ${platform_source}`,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to aggregate campaigns:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to aggregate campaigns',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/campaigns/aggregated
 * @desc Get all aggregated campaigns from external platforms
 */
router.get('/aggregated', async (req: Request, res: Response) => {
  try {
    const { platform_source, page = 1, limit = 20, include_content_count = false } = req.query;

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    let queryBuilder = campaignRepository.createQueryBuilder('campaign')
      .where('campaign.platformSource IS NOT NULL')
      .andWhere('campaign.isActive = :isActive', { isActive: true })
      .orderBy('campaign.predictedMindshare', 'DESC')
      .addOrderBy('campaign.createdAt', 'DESC')
      .skip(offset)
      .take(limitNum);

    if (platform_source) {
      queryBuilder = queryBuilder.andWhere('campaign.platformSource = :platform', { platform: platform_source });
    }

    if (include_content_count === 'true') {
      queryBuilder = queryBuilder.loadRelationCountAndMap('campaign.contentCount', 'campaign.contentMarketplace');
    }

    const [campaigns, total] = await queryBuilder.getManyAndCount();

    // Format for marketplace display
    const formattedCampaigns = campaigns.map(campaign => ({
      id: campaign.id,
      title: campaign.title,
      description: campaign.description,
      platform_source: campaign.platformSource,
      external_campaign_id: campaign.externalCampaignId,
      reward_token: campaign.rewardToken,
      reward_pool: campaign.rewardPool,
      target_audience: campaign.targetAudience,
      brand_guidelines: campaign.brandGuidelines,
      predicted_mindshare: campaign.predictedMindshare,
      campaign_type: campaign.campaignType,
      end_date: campaign.endDate,
      is_active: campaign.isActive,
      content_count: (campaign as any).contentCount || 0,
      created_at: campaign.createdAt,
      updated_at: campaign.updatedAt
    }));

    const totalPages = Math.ceil(total / limitNum);

    logger.info(`📋 Retrieved ${formattedCampaigns.length} aggregated campaigns`);

    return res.json({
      success: true,
      data: formattedCampaigns,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch aggregated campaigns:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch aggregated campaigns',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/campaigns/marketplace-ready
 * @desc Get campaigns formatted for mining interface and marketplace
 */
router.get('/marketplace-ready', async (req: Request, res: Response) => {
  try {
    const { limit = 20, category, platform_source } = req.query;

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    const contentRepository: Repository<ContentMarketplace> = AppDataSource.getRepository(ContentMarketplace);

    let queryBuilder = campaignRepository.createQueryBuilder('campaign')
      .where('campaign.status = :status', { status: 'active' })
      .andWhere('(campaign.endDate > :now OR campaign.endDate IS NULL)', { now: new Date() })
      .orderBy('campaign.predictedMindshare', 'DESC')
      .addOrderBy('campaign.createdAt', 'DESC')
      .take(parseInt((limit as string) || '20'));

    if (category) {
      queryBuilder = queryBuilder.andWhere('campaign.category = :category', { category });
    }

    if (platform_source) {
      queryBuilder = queryBuilder.andWhere('campaign.platformSource = :platform', { platform: platform_source });
    }

    const campaigns = await queryBuilder.getMany();

    // Get content counts for each campaign
    const formattedCampaigns = await Promise.all(campaigns.map(async (campaign) => {
      const contentCount = await contentRepository.count({
        where: { campaignId: campaign.id, isAvailable: true }
      });

      return {
        id: campaign.id.toString(),
        title: campaign.title,
        description: campaign.description,
        platform_source: campaign.platformSource || 'burnie',
        reward_pool: campaign.rewardPool || '0',
        reward_token: campaign.rewardToken || 'ROAST',
        target_audience: campaign.targetAudience || 'General',
        brand_guidelines: campaign.brandGuidelines || '',
        predicted_mindshare: campaign.predictedMindshare || 75,
        campaign_type: campaign.campaignType || 'general',
        is_active: campaign.isActive !== false,
        end_date: campaign.endDate ? campaign.endDate.toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        available_content_count: contentCount,
        time_remaining: campaign.endDate 
          ? Math.max(0, campaign.endDate.getTime() - Date.now()) 
          : 30 * 24 * 60 * 60 * 1000, // 30 days default
        
        // Legacy format compatibility for mining interface
        category: campaign.category || 'general',
        keywords: campaign.metadata?.tags || [],
        guidelines: campaign.brandGuidelines || '',
        min_token_spend: 10, // MVP minimum
        winner_reward: campaign.rewardPool || '0',
        max_submissions: campaign.maxSubmissions || 1000,
        current_submissions: campaign.currentSubmissions || 0,
      };
    }));

    logger.info(`🎯 Retrieved ${formattedCampaigns.length} marketplace-ready campaigns (including admin-created)`);

    return res.json({
      success: true,
      data: formattedCampaigns,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch marketplace-ready campaigns:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch marketplace-ready campaigns',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/campaigns/:id/sync-content
 * @desc Sync AI-generated content to marketplace for a campaign
 */
router.post('/:id/sync-content', async (req: Request, res: Response) => {
  try {
    const campaignId = parseInt(req.params.id || '0');
    const { content_data, creator_id, asking_price } = req.body;

    if (isNaN(campaignId) || !content_data || !creator_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: campaignId, content_data, creator_id',
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
    const contentRepository: Repository<ContentMarketplace> = AppDataSource.getRepository(ContentMarketplace);

    // Verify campaign exists
    const campaign = await campaignRepository.findOne({
      where: { id: campaignId, isActive: true }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found or not active',
        timestamp: new Date().toISOString(),
      });
    }

    // Create marketplace content with pending status (awaiting user approval)
    const marketplaceContent = contentRepository.create({
      creatorId: creator_id,
      campaignId: campaignId,
      contentText: content_data.content_text,
      tweetThread: content_data.tweet_thread || null, // Store tweet thread array
      contentImages: content_data.content_images || null,
      predictedMindshare: content_data.predicted_mindshare || 75,
      qualityScore: content_data.quality_score || 80,
      askingPrice: asking_price || env.platform.minimumBidAmount,
      isAvailable: false, // Not available until approved
      approvalStatus: 'pending', // Awaiting user approval in mining interface
      generationMetadata: content_data.generation_metadata || {},
      postType: content_data.post_type || 'thread' // Store the post type (shitpost, longpost, or thread)
    });

    const savedContent = await contentRepository.save(marketplaceContent);

    logger.info(`✅ Synced AI content to marketplace: Campaign ${campaignId}, Content ${savedContent.id}`);

    return res.status(201).json({
      success: true,
      data: savedContent,
      message: 'Content synced to marketplace successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to sync content to marketplace:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to sync content to marketplace',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/campaigns/logo-presigned-url/:s3Key - Get pre-signed URL for logo display
router.get('/logo-presigned-url/:s3Key(*)', async (req: Request, res: Response) => {
  try {
    const s3Key = req.params.s3Key;
    
    if (!s3Key) {
      return res.status(400).json({
        success: false,
        error: 'S3 key is required'
      });
    }

    // Generate pre-signed URL for GET operation (viewing the image)
    const presignedUrl = s3.getSignedUrl('getObject', {
      Bucket: process.env.S3_BUCKET_NAME || 'burnie-storage',
      Key: s3Key,
      Expires: 3600 // URL expires in 1 hour
    });

    logger.info(`✅ Pre-signed URL generated for: ${s3Key}`);

    return res.json({
      success: true,
      data: {
        presignedUrl,
        s3Key,
        expiresIn: 3600
      },
      message: 'Pre-signed URL generated successfully'
    });

  } catch (error) {
    logger.error('❌ Failed to generate pre-signed URL:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate pre-signed URL'
    });
  }
});

// GET /api/campaigns/download-image/:s3Key - Download image with proper Content-Disposition header
router.get('/download-image/:s3Key(*)', async (req: Request, res: Response): Promise<void> => {
  try {
    const { s3Key } = req.params;
    
    if (!s3Key) {
      res.status(400).json({
        success: false,
        error: 'S3 key is required'
      });
      return;
    }

    // Generate random UUID filename with original extension
    const originalFilename = s3Key.split('/').pop() || 'image.png';
    const fileExtension = originalFilename.split('.').pop() || 'png';
    const { v4: uuidv4 } = require('uuid');
    const randomFilename = `${uuidv4()}.${fileExtension}`;
    
    // Get object from S3
    const getObjectParams = {
      Bucket: process.env.S3_BUCKET_NAME || 'burnie-storage',
      Key: s3Key
    };

    const s3Object = await s3.getObject(getObjectParams).promise();
    
    // Set proper headers for download with random UUID filename
    res.setHeader('Content-Type', s3Object.ContentType || 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${randomFilename}"`);
    res.setHeader('Content-Length', s3Object.ContentLength || 0);
    
    // Send the image data
    res.send(s3Object.Body);

  } catch (error) {
    logger.error('❌ Image download failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download image'
    });
    return;
  }
});

export { router as campaignRoutes }; 