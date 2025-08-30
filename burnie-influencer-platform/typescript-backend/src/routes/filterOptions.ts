import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Campaign } from '../models/Campaign';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { Repository } from 'typeorm';
import { logger } from '../config/logger';

const router = Router();

// Get all unique platform sources and project names for filters
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);

    // Get all unique platform sources
    const platformResults = await campaignRepository
      .createQueryBuilder('campaign')
      .select('DISTINCT campaign.platformSource', 'platformSource')
      .where('campaign.isActive = :isActive', { isActive: true })
      .andWhere('campaign.platformSource IS NOT NULL')
      .getRawMany();

    // Get all unique project names
    const projectResults = await campaignRepository
      .createQueryBuilder('campaign')
      .select('DISTINCT campaign.projectName', 'projectName')
      .where('campaign.isActive = :isActive', { isActive: true })
      .andWhere('campaign.projectName IS NOT NULL')
      .getRawMany();

    // Get all unique post types from content marketplace
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const postTypeResults = await contentRepository
      .createQueryBuilder('content')
      .select('DISTINCT content.postType', 'postType')
      .where('content.approvalStatus = :status', { status: 'approved' })
      .andWhere('content.isAvailable = true')
      .andWhere('content.postType IS NOT NULL')
      .getRawMany();

    const platforms = platformResults.map(result => result.platformSource).filter(Boolean);
    const projects = projectResults.map(result => result.projectName).filter(Boolean);
    const postTypes = postTypeResults.map(result => result.postType).filter(Boolean);

    logger.info(`📊 Found ${platforms.length} unique platforms, ${projects.length} unique projects, and ${postTypes.length} unique post types`);
    logger.info(`📊 Platforms: ${platforms.join(', ')}`);
    logger.info(`📊 Projects: ${projects.join(', ')}`);
    logger.info(`📊 Post Types: ${postTypes.join(', ')}`);

    res.json({
      success: true,
      data: {
        platforms: platforms.sort(),
        projects: projects.sort(),
        postTypes: postTypes.sort()
      }
    });

  } catch (error) {
    logger.error('Error fetching filter options:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch filter options',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
