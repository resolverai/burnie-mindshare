import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../config/database';
import { Admin } from '../models/Admin';
import { Campaign, CampaignStatus, CampaignType } from '../models/Campaign';
import { User } from '../models/User';
import { logger } from '../config/logger';
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
      title,
      description,
      topic,
      guidelines,
      budget,
      reward_per_roast,
      max_submissions,
      start_date,
      end_date
    } = req.body;

    logger.info('📝 Admin creating new campaign:', { title, budget, admin: req.admin.username });

    // Validate required fields
    if (!title || !description || !topic || !budget || !reward_per_roast || !max_submissions || !end_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: title, description, topic, budget, reward_per_roast, max_submissions, end_date',
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

    // Create new campaign
    const campaignData = {
      title,
      description,
      category: topic, // topic maps to category
      brandGuidelines: guidelines || '', // guidelines maps to brandGuidelines  
      rewardPool: budget, // budget maps to rewardPool
      entryFee: 0, // Default entry fee
      maxSubmissions: max_submissions,
      startDate: start_date ? new Date(start_date) : new Date(),
      endDate: new Date(end_date),
      status: CampaignStatus.ACTIVE, // Use proper enum value
      campaignType: CampaignType.ROAST, // Use proper enum value
      projectId: projectId || null,
      creatorId: defaultUser.id, // Use the default user ID
      isActive: true,
      platformSource: 'burnie', // Mark as admin-created
      rewardToken: 'ROAST',
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
 * @route GET /api/admin/campaigns
 * @desc Get all campaigns (admin view)
 */
router.get('/campaigns', verifyAdminToken, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
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

export { router as adminRoutes }; 