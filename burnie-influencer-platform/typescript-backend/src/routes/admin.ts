import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { Admin } from '../models/Admin';
import { Campaign, CampaignStatus, CampaignType, CampaignCategory, PlatformSource } from '../models/Campaign';
import { User, UserRoleType } from '../models/User';
import { Project } from '../models/Project';
import { ContentPurchase } from '../models/ContentPurchase';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { logger } from '../config/logger';
import { convertROASTToUSD } from '../services/priceService';
import { Repository } from 'typeorm';

const router = Router();

// JWT Secret - in production this should be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'admin-secret-key-burnie-2025';

// Extend Request type to include admin
declare global {
  namespace Express {
    interface Request {
      admin?: Admin;
    }
  }
}

// Middleware to verify admin token
const verifyAdminToken = async (req: Request, res: Response, next: any): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      res.status(401).json({
        success: false,
        error: 'No token provided',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const adminRepository = AppDataSource.getRepository(Admin);
    const admin = await adminRepository.findOne({
      where: { id: decoded.adminId, is_active: true }
    });

    if (!admin) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid token',
      timestamp: new Date().toISOString(),
    });
    return;
  }
};

/**
 * @route POST /api/admin/login
 * @desc Admin login with username and password
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required',
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

    const adminRepository: Repository<Admin> = AppDataSource.getRepository(Admin);
    
    // Find admin by username
    const admin = await adminRepository.findOne({
      where: { username: username.toLowerCase() }
    });

    if (!admin || !admin.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        timestamp: new Date().toISOString(),
      });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, admin.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        timestamp: new Date().toISOString(),
      });
    }

    // Update last login
    admin.last_login = new Date();
    await adminRepository.save(admin);

    // Generate JWT token
    const token = jwt.sign(
      { adminId: admin.id, username: admin.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`✅ Admin login successful: ${admin.username}`);

    return res.json({
      success: true,
      data: {
        token,
        admin: {
          id: admin.id,
          username: admin.username,
          last_login: admin.last_login
        }
      },
      message: 'Login successful',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Admin login failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Login failed',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/admin/logout
 * @desc Admin logout (client-side token removal)
 */
router.post('/logout', verifyAdminToken, async (req: Request, res: Response) => {
  return res.json({
    success: true,
    message: 'Logout successful',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route GET /api/admin/profile
 * @desc Get admin profile information
 */
router.get('/profile', verifyAdminToken, async (req: Request, res: Response) => {
  const admin = req.admin;
  
  if (!admin) {
    return res.status(401).json({
      success: false,
      error: 'Admin not found',
      timestamp: new Date().toISOString(),
    });
  }
  
  return res.json({
    success: true,
    data: {
      id: admin.id,
      username: admin.username,
      last_login: admin.last_login,
      created_at: admin.created_at
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * @route GET /api/admin/projects/search
 * @desc Search projects by name for dropdown (admin only)
 */
router.get('/projects/search', verifyAdminToken, async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
    
    let projects;
    if (q && typeof q === 'string' && q.trim()) {
      // Search for projects matching the query
      projects = await projectRepository
        .createQueryBuilder('project')
        .where('LOWER(project.name) LIKE LOWER(:query)', { query: `%${q.trim()}%` })
        .select(['project.id', 'project.name', 'project.logo'])
        .orderBy('project.name', 'ASC')
        .limit(20)
        .getMany();
    } else {
      // Return all projects if no query
      projects = await projectRepository
        .createQueryBuilder('project')
        .select(['project.id', 'project.name', 'project.logo'])
        .orderBy('project.name', 'ASC')
        .limit(50)
        .getMany();
    }

    return res.json({
      success: true,
      data: projects,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to search projects:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to search projects',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route POST /api/admin/campaigns
 * @desc Create a new campaign (admin only)
 */
router.post('/campaigns', verifyAdminToken, async (req: Request, res: Response) => {
  try {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required',
        timestamp: new Date().toISOString(),
      });
    }

    const {
      projectId,
      projectName,
      projectLogo,
      campaignBanner,
      title,
      description,
      tokenTicker,
      category,
      campaignType,
      rewardPool,
      maxYappers,
      platformSource,
      startDate,
      endDate,
      guidelines,
      somniaWhitelisted // Add Somnia whitelist flag
    } = req.body;

    logger.info('📝 Admin creating new campaign:', { title, rewardPool, category, projectLogo, campaignBanner, admin: req.admin.username });
    logger.info('🖼️ Project logo URL received:', projectLogo);
    logger.info('🎨 Campaign banner URL received:', campaignBanner);

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

    // Ensure default user exists for foreign key constraint
    const userRepository = AppDataSource.getRepository(User);
    let defaultUser = await userRepository.findOne({ where: { id: 1 } });
    if (!defaultUser) {
      // Create default admin user if it doesn't exist
      const newUser = userRepository.create({
        walletAddress: '0x0000000000000000000000000000000000000001',
        username: 'admin',
        email: 'admin@burnie.co',
        isVerified: true,
        isAdmin: true,
        profile: {
          displayName: 'Admin User',
          bio: 'System administrator account for campaign creation',
          website: 'https://burnie.co'
        }
      });
      defaultUser = await userRepository.save(newUser);
      logger.info('✅ Created default admin user for campaign creation');
    }

    // Ensure project exists in projects table
    let finalProjectId = projectId;
    if (projectName && projectName.trim()) {
      // Check if project already exists by name
      let existingProject = await projectRepository.findOne({
        where: { name: projectName.trim() }
      });

      if (!existingProject) {
        // Create new project
        logger.info(`🏗️ Creating new project: ${projectName}`);
        const projectData: any = {
          name: projectName.trim(),
          description: description || `Campaign: ${title}`,
          isActive: true,
          ownerId: defaultUser.id,
          somniaWhitelisted: somniaWhitelisted || false // Set Somnia whitelist status
        };

        if (projectLogo) {
          projectData.logo = projectLogo;
        }

        if (guidelines) {
          projectData.socialLinks = { twitter: guidelines };
        }

        const newProject = projectRepository.create(projectData);
        const savedProject = await projectRepository.save(newProject) as any;
        logger.info(`✅ Project created: ${savedProject.id} - ${savedProject.name}`);
        finalProjectId = savedProject.id;
      } else {
        logger.info(`✅ Using existing project: ${existingProject.id} - ${existingProject.name}`);
        finalProjectId = existingProject.id;
        
        // Update somnia_whitelisted status if provided
        if (somniaWhitelisted !== undefined && existingProject.somniaWhitelisted !== somniaWhitelisted) {
          logger.info(`🔄 Updating Somnia whitelist status for project: ${existingProject.name} to ${somniaWhitelisted}`);
          existingProject.somniaWhitelisted = somniaWhitelisted;
          await projectRepository.save(existingProject);
        }
      }
    }

    // Create new campaign
    const campaignData = {
      title,
      description,
      projectName: projectName || undefined,
      projectLogo: projectLogo || undefined,
      campaignBanner: campaignBanner || undefined,
      tokenTicker: tokenTicker || '',
      category: category as CampaignCategory,
      campaignType: campaignType as CampaignType,
      brandGuidelines: guidelines || undefined,
      rewardPool: rewardPool, // Now stored as text
      maxYappers: parseInt(maxYappers) || 100,
      entryFee: 0, // Default entry fee
      maxSubmissions: 1500, // Default max submissions
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      status: CampaignStatus.ACTIVE, // Use proper enum value
      projectId: finalProjectId || undefined, // Use the ensured project ID
      creatorId: defaultUser.id, // Use the default user ID
      isActive: true,
      platformSource: (platformSource as PlatformSource) || PlatformSource.BURNIE,
      rewardToken: tokenTicker || '',
      targetAudience: 'General',
      predictedMindshare: 80, // Default mindshare score
      currentSubmissions: 0
    };

    const newCampaign = campaignRepository.create(campaignData);
    const savedCampaign = await campaignRepository.save(newCampaign);

    logger.info(`✅ Campaign created by admin: ${savedCampaign.id} - ${savedCampaign.title}`);

    return res.status(201).json({
      success: true,
      data: savedCampaign,
      message: 'Campaign created successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to create campaign:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create campaign',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route PUT /api/admin/campaigns/:id
 * @desc Update a campaign (admin only)
 */
router.put('/campaigns/:id', verifyAdminToken, async (req: Request, res: Response) => {
  try {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required',
        timestamp: new Date().toISOString(),
      });
    }

    const campaignId = parseInt(req.params.id || '0');
    const {
      projectId,
      projectName,
      projectLogo,
      campaignBanner,
      projectTwitterHandle,
      title,
      description,
      tokenTicker,
      category,
      campaignType,
      rewardPool,
      maxYappers,
      platformSource,
      startDate,
      endDate,
      guidelines,
      somniaWhitelisted // Add Somnia whitelist flag for updates
    } = req.body;

    logger.info('📝 Admin updating campaign:', { campaignId, title, projectLogo, campaignBanner, admin: req.admin.username });
    logger.info('🖼️ Project logo URL received for update:', projectLogo);
    logger.info('🎨 Campaign banner URL received for update:', campaignBanner);

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

    // Find existing campaign
    const existingCampaign = await campaignRepository.findOne({
      where: { id: campaignId },
      relations: ['project'] // Load project relation to update somniaWhitelisted
    });

    if (!existingCampaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Update project's somnia_whitelisted status if provided and campaign has a project
    if (somniaWhitelisted !== undefined && existingCampaign.project) {
      const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
      if (existingCampaign.project.somniaWhitelisted !== somniaWhitelisted) {
        logger.info(`🔄 Updating Somnia whitelist status for project: ${existingCampaign.project.name} to ${somniaWhitelisted}`);
        existingCampaign.project.somniaWhitelisted = somniaWhitelisted;
        await projectRepository.save(existingCampaign.project);
      }
    } else if (somniaWhitelisted !== undefined && projectName) {
      // If campaign doesn't have a project yet but projectName is provided, create/update project
      const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
      const userRepository = AppDataSource.getRepository(User);
      
      let project: Project | null = await projectRepository.findOne({
        where: { name: projectName.trim() }
      });

      if (project) {
        // Update existing project
        if (project.somniaWhitelisted !== somniaWhitelisted) {
          logger.info(`🔄 Updating Somnia whitelist status for project: ${project.name} to ${somniaWhitelisted}`);
          project.somniaWhitelisted = somniaWhitelisted;
          await projectRepository.save(project);
        }
      } else {
        // Create new project with somnia status
        let defaultUser = await userRepository.findOne({ where: { id: 1 } });
        if (!defaultUser) {
          const newUser = userRepository.create({
            walletAddress: '0x0000000000000000000000000000000000000001',
            username: 'admin',
            email: 'admin@burnie.co',
            isVerified: true,
            isAdmin: true,
            profile: {
              displayName: 'Admin User',
              bio: 'System administrator account',
              website: 'https://burnie.co'
            }
          });
          defaultUser = await userRepository.save(newUser);
        }

        logger.info(`🏗️ Creating new project during update: ${projectName}`);
        const projectData: any = {
          name: projectName.trim(),
          description: description || `Campaign: ${title}`,
          isActive: true,
          ownerId: defaultUser.id,
          somniaWhitelisted: somniaWhitelisted || false,
          logo: projectLogo || undefined
        };

        const newProject = projectRepository.create(projectData);
        const savedProjects = await projectRepository.save(newProject);
        // TypeORM save can return array or single entity, ensure we get single entity
        project = Array.isArray(savedProjects) ? (savedProjects[0] || null) : savedProjects;
        
        // Update campaign with new project ID
        if (project) {
          existingCampaign.projectId = project.id;
        }
      }
    }

    // Update campaign data
    const updateData = {
      title,
      description,
      projectName: projectName || undefined,
      projectLogo: projectLogo || undefined,
      campaignBanner: campaignBanner || undefined,
      projectTwitterHandle: projectTwitterHandle || undefined,
      tokenTicker: tokenTicker || '',
      category: category as CampaignCategory,
      campaignType: campaignType as CampaignType,
      brandGuidelines: guidelines || undefined,
      rewardPool: rewardPool, // Now stored as text
      maxYappers: parseInt(maxYappers) || 100,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      projectId: projectId || undefined,
      platformSource: (platformSource as PlatformSource) || PlatformSource.BURNIE,
      rewardToken: tokenTicker || '',
    };

    // Update the campaign
    await campaignRepository.update(campaignId, updateData);

    // Fetch updated campaign
    const updatedCampaign = await campaignRepository.findOne({
      where: { id: campaignId }
    });

    logger.info(`✅ Campaign updated by admin: ${campaignId} - ${title}`);

    // Return success response immediately (non-blocking)
    const response = res.status(200).json({
      success: true,
      data: updatedCampaign,
      message: 'Campaign updated successfully',
      timestamp: new Date().toISOString(),
    });

    // Trigger Twitter data fetching in background (fire-and-forget)
    if (projectTwitterHandle && projectTwitterHandle.trim()) {
      // Use setImmediate to ensure this runs after the response is sent
      setImmediate(async () => {
        try {
          logger.info('🐦 Triggering background Twitter data fetch for edited campaign...');
          const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
          if (!pythonBackendUrl) {
            logger.error('PYTHON_AI_BACKEND_URL environment variable is not set');
            throw new Error('Python AI backend URL not configured');
          }
          
          const twitterResponse = await fetch(`${pythonBackendUrl}/api/ai/fetch-project-twitter`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              project_id: updatedCampaign?.projectId || campaignId,
              project_name: projectName,
              twitter_handle: projectTwitterHandle,
              source: 'campaign_edit_admin'
            }),
          });

          if (twitterResponse.ok) {
            const data = await twitterResponse.json();
            logger.info('✅ Background Twitter data fetch completed for edited campaign:', data);
          } else {
            logger.warn('⚠️ Background Twitter data fetch failed for edited campaign:', await twitterResponse.text());
          }
        } catch (error) {
          logger.error('❌ Error in background Twitter fetch for edited campaign:', error);
        }
      });
    }

    return response;

  } catch (error) {
    logger.error('❌ Failed to update campaign:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update campaign',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/admin/analytics
 * @desc Get admin dashboard analytics (admin only)
 */
router.get('/analytics', verifyAdminToken, async (req: Request, res: Response) => {
  try {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('📊 Admin fetching analytics:', { admin: req.admin.username });

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const userRepository = AppDataSource.getRepository(User);
    const campaignRepository = AppDataSource.getRepository(Campaign);
    const contentPurchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Get total campaigns
    const totalCampaigns = await campaignRepository.count();

    // Get active campaigns
    const activeCampaigns = await campaignRepository.count({
      where: { status: CampaignStatus.ACTIVE }
    });

    // Get total yappers (role = 'yapper' or 'both')
    const totalYappers = await userRepository.count({
      where: [
        { roleType: UserRoleType.YAPPER },
        { roleType: UserRoleType.BOTH }
      ]
    });

    // Get all content purchases to calculate total value
    const contentPurchases = await contentPurchaseRepository.find({
      where: { paymentStatus: 'completed' }
    });

    // Calculate total purchase value in USDC
    let totalPurchaseValueUSDC = 0;
    
    for (const purchase of contentPurchases) {
      const purchasePrice = parseFloat((purchase.purchasePrice || 0).toString());
      const currency = purchase.currency || 'ROAST';

      try {
        // Convert to USDC based on currency type
      let usdcValue = 0;
      if (currency === 'USDC') {
        usdcValue = purchasePrice;
      } else if (currency === 'ROAST') {
        usdcValue = await convertROASTToUSD(purchasePrice);
      } else {
        // For other currencies, assume they're already in USD equivalent
        usdcValue = purchasePrice;
      }
        totalPurchaseValueUSDC += usdcValue;
      } catch (error) {
        logger.error(`Failed to convert ${purchasePrice} ${currency} to USDC:`, error);
        // Use fallback conversion
        const fallbackRate = currency === 'USDC' ? 1 : 0.01;
        totalPurchaseValueUSDC += purchasePrice * fallbackRate;
      }
    }

    const analytics = {
      totalCampaigns,
      activeCampaigns,
      totalYappers,
      totalPurchaseValue: Math.round(totalPurchaseValueUSDC * 100) / 100, // Round to 2 decimal places
      totalTransactions: contentPurchases.length,
      averageTransactionSize: contentPurchases.length > 0 
        ? Math.round((totalPurchaseValueUSDC / contentPurchases.length) * 100) / 100 
        : 0
    };

    logger.info('✅ Analytics fetched successfully:', analytics);

    return res.status(200).json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch analytics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/admin/campaigns
 * @desc Get all campaigns (admin view)
 */
router.get('/campaigns', verifyAdminToken, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 1000; // Increased from 20 to 1000 to show all campaigns
    const skip = (page - 1) * limit;

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    
    const [campaigns, total] = await campaignRepository.findAndCount({
      relations: ['project'], // Load project relation to get somniaWhitelisted status
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    logger.info(`📋 Admin retrieved ${campaigns.length} campaigns (page ${page}/${totalPages})`);

    return res.json({
      success: true,
      data: {
        items: campaigns,
        total,
        page,
        size: limit,
        pages: totalPages
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

/**
 * @route POST /api/admin/seed-admin
 * @desc Create the default admin user (for development)
 */
router.post('/seed-admin', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const adminRepository: Repository<Admin> = AppDataSource.getRepository(Admin);
    
    // Check if admin already exists
    const existingAdmin = await adminRepository.findOne({
      where: { username: 'admin' }
    });

    if (existingAdmin) {
      return res.json({
        success: true,
        message: 'Admin user already exists',
        data: {
          username: 'admin',
          password: 'admin123'
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Create default admin
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = adminRepository.create({
      username: 'admin',
      password_hash: hashedPassword,
      is_active: true
    });

    await adminRepository.save(newAdmin);

    logger.info('✅ Default admin user created');

    return res.status(201).json({
      success: true,
      message: 'Default admin user created',
      data: {
        username: 'admin',
        password: 'admin123'
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to create admin user:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create admin user',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * @route GET /api/admin/content-meter
 * @desc Get content meter data showing campaign content availability by post type
 */
router.get('/content-meter', verifyAdminToken, async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString(),
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const campaignRepository = AppDataSource.getRepository(Campaign);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Get all campaigns
    const campaigns = await campaignRepository.find({
      select: ['id', 'title', 'projectName'],
      order: { title: 'ASC' }
    });

    // Get content counts for each campaign by post type
    const campaignContentSummaries = await Promise.all(
      campaigns.map(async (campaign) => {
        // Count available content by post type for this campaign
        const [availableShitpostCount, availableThreadCount, availableLongpostCount] = await Promise.all([
          contentRepository.count({
            where: {
              campaignId: campaign.id,
              isAvailable: true,
              isBiddable: true,
              approvalStatus: 'approved',
              postType: 'shitpost'
            }
          }),
          contentRepository.count({
            where: {
              campaignId: campaign.id,
              isAvailable: true,
              isBiddable: true,
              approvalStatus: 'approved',
              postType: 'thread'
            }
          }),
          contentRepository.count({
            where: {
              campaignId: campaign.id,
              isAvailable: true,
              isBiddable: true,
              approvalStatus: 'approved',
              postType: 'longpost'
            }
          })
        ]);

        // Count purchased content by post type for this campaign
        const [purchasedShitpostCount, purchasedThreadCount, purchasedLongpostCount] = await Promise.all([
          purchaseRepository
            .createQueryBuilder('purchase')
            .innerJoin('purchase.content', 'content')
            .where('content.campaignId = :campaignId', { campaignId: campaign.id })
            .andWhere('content.postType = :postType', { postType: 'shitpost' })
            .getCount(),
          purchaseRepository
            .createQueryBuilder('purchase')
            .innerJoin('purchase.content', 'content')
            .where('content.campaignId = :campaignId', { campaignId: campaign.id })
            .andWhere('content.postType = :postType', { postType: 'thread' })
            .getCount(),
          purchaseRepository
            .createQueryBuilder('purchase')
            .innerJoin('purchase.content', 'content')
            .where('content.campaignId = :campaignId', { campaignId: campaign.id })
            .andWhere('content.postType = :postType', { postType: 'longpost' })
            .getCount()
        ]);

        const totalAvailable = availableShitpostCount + availableThreadCount + availableLongpostCount;
        const totalPurchased = purchasedShitpostCount + purchasedThreadCount + purchasedLongpostCount;

        return {
          campaignId: campaign.id,
          campaignTitle: campaign.title,
          projectName: campaign.projectName || campaign.title,
          availableCounts: {
            shitpost: availableShitpostCount,
            thread: availableThreadCount,
            longpost: availableLongpostCount
          },
          purchasedCounts: {
            shitpost: purchasedShitpostCount,
            thread: purchasedThreadCount,
            longpost: purchasedLongpostCount
          },
          totalAvailable,
          totalPurchased
        };
      })
    );

    // Filter out campaigns with no content (available or purchased)
    const campaignsWithContent = campaignContentSummaries.filter(
      campaign => campaign.totalAvailable > 0 || campaign.totalPurchased > 0
    );

    logger.info(`📊 Content meter data retrieved for ${campaignsWithContent.length} campaigns with content`);

    return res.json({
      success: true,
      data: {
        campaigns: campaignsWithContent,
        totalCampaigns: campaigns.length,
        campaignsWithContent: campaignsWithContent.length
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch content meter data:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch content meter data',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as adminRoutes }; 