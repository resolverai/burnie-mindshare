import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import { Project } from '../models/Project';
import { Repository } from 'typeorm';

const router = Router();

// GET /api/projects - List all projects with pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    if (!AppDataSource.isInitialized) {
      logger.warn('Database not initialized, returning empty projects list');
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

    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
    
    const [projects, total] = await projectRepository.findAndCount({
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
      relations: ['campaigns'],
    });

    const totalPages = Math.ceil(total / limit);

    logger.info(`📋 Retrieved ${projects.length} projects (page ${page}/${totalPages})`);

    res.json({
      success: true,
      data: projects.map(project => ({
        ...project,
        campaignCount: project.campaigns?.length || 0,
        activeCampaigns: project.campaigns?.filter(c => c.status === 'ACTIVE').length || 0,
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
    logger.error('❌ Failed to fetch projects:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/projects/:id - Get project details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.id || '');

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID',
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

    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
    
    const project = await projectRepository.findOne({
      where: { id: projectId },
      relations: ['campaigns'],
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📖 Retrieved project details: ${project.name}`);

    res.json({
      success: true,
      data: {
        ...project,
        campaignCount: project.campaigns?.length || 0,
        activeCampaigns: project.campaigns?.filter(c => c.status === 'ACTIVE').length || 0,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project',
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/projects - Create new project
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      website,
      twitterHandle,
      discordInvite,
      telegramChannel,
      brandGuidelines,
      logoUrl,
      primaryColor,
      secondaryColor,
      targetAudience,
      industry,
      isActive = true
    } = req.body;

    logger.info('🏗️ Creating new project:', { name, website, industry });

    // Validate required fields
    if (!name || !description) {
      return res.status(400).json({
        success: false,
        error: 'Project name and description are required',
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

    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);

    // Check if project name already exists
    const existingProject = await projectRepository.findOne({
      where: { name }
    });

    if (existingProject) {
      return res.status(400).json({
        success: false,
        error: 'Project with this name already exists',
        timestamp: new Date().toISOString(),
      });
    }

    // Create new project
    const projectData: any = {
      name,
      description,
      isActive,
      ownerId: 1, // TODO: Get from authentication
    };

    if (logoUrl) projectData.logo = logoUrl;
    if (website) projectData.website = website;
    
    if (twitterHandle || discordInvite || telegramChannel) {
      projectData.socialLinks = {};
      if (twitterHandle) projectData.socialLinks.twitter = twitterHandle;
      if (discordInvite) projectData.socialLinks.discord = discordInvite;
      if (telegramChannel) projectData.socialLinks.telegram = telegramChannel;
    }

    if (brandGuidelines || primaryColor || targetAudience) {
      projectData.brandGuidelines = {};
      if (brandGuidelines) projectData.brandGuidelines.tone = brandGuidelines;
      if (primaryColor) {
        projectData.brandGuidelines.colors = [primaryColor];
        if (secondaryColor) projectData.brandGuidelines.colors.push(secondaryColor);
      }
      if (targetAudience) projectData.brandGuidelines.keywords = [targetAudience];
    }

    const newProject = projectRepository.create(projectData);
    const savedProject = await projectRepository.save(newProject);

    logger.info(`✅ Project created successfully: ${(savedProject as any).id} - ${(savedProject as any).name}`);

    res.status(201).json({
      success: true,
      data: savedProject,
      message: 'Project created successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to create project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create project',
      timestamp: new Date().toISOString(),
    });
  }
});

// PUT /api/projects/:id - Update project
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.id || '');
    const updates = req.body;

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID',
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

    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
    
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

    // Update project fields
    Object.assign(project, updates);
    const updatedProject = await projectRepository.save(project);

    logger.info(`✅ Project updated successfully: ${updatedProject.name}`);

    res.json({
      success: true,
      data: updatedProject,
      message: 'Project updated successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to update project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update project',
      timestamp: new Date().toISOString(),
    });
  }
});

// DELETE /api/projects/:id - Delete project
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.id || '');

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID',
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

    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
    
    const project = await projectRepository.findOne({
      where: { id: projectId },
      relations: ['campaigns'],
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
        timestamp: new Date().toISOString(),
      });
    }

    // Check if project has active campaigns
    const activeCampaigns = project.campaigns?.filter(c => c.status === 'ACTIVE') || [];
    if (activeCampaigns.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete project with active campaigns',
        timestamp: new Date().toISOString(),
      });
    }

    await projectRepository.remove(project);

    logger.info(`✅ Project deleted successfully: ${project.name}`);

    res.json({
      success: true,
      message: 'Project deleted successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to delete project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project',
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/projects/:id/stats - Get project statistics
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.id || '');

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID',
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

    const projectRepository: Repository<Project> = AppDataSource.getRepository(Project);
    
    const project = await projectRepository.findOne({
      where: { id: projectId },
      relations: ['campaigns', 'campaigns.submissions'],
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
        timestamp: new Date().toISOString(),
      });
    }

    const campaigns = project.campaigns || [];
    const totalSubmissions = campaigns.reduce((sum, campaign) => 
      sum + (campaign.submissions?.length || 0), 0
    );
    
    const activeCampaigns = campaigns.filter(c => c.status === 'ACTIVE');
    const completedCampaigns = campaigns.filter(c => c.status === 'COMPLETED');
    
    const totalBudget = campaigns.reduce((sum, campaign) => 
      sum + (campaign.rewardPool || 0), 0
    );

    const stats = {
      totalCampaigns: campaigns.length,
      activeCampaigns: activeCampaigns.length,
      completedCampaigns: completedCampaigns.length,
      totalSubmissions,
      totalBudget,
      avgSubmissionsPerCampaign: campaigns.length > 0 ? Math.round(totalSubmissions / campaigns.length) : 0,
    };

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('❌ Failed to fetch project stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project stats',
      timestamp: new Date().toISOString(),
    });
  }
});

export { router as projectRoutes }; 