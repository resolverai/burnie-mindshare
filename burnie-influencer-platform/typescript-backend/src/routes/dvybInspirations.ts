/**
 * DVYB Inspirations Routes for Frontend
 * Provides inspiration matching based on detected industry
 */

import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybInspirationLink } from '../models/DvybInspirationLink';
import { logger } from '../config/logger';

const router = Router();

interface InspirationLink {
  id: number;
  platform: string;
  category: string;
  url: string;
  title: string | null;
  mediaType: string;
  mediaUrl?: string | null;
}

interface MatchedInspiration {
  id: number;
  platform: string;
  category: string;
  url: string;
  title: string | null;
}

/**
 * POST /api/dvyb/inspirations/match
 * Match industry to inspiration categories and return videos
 * 
 * Request body:
 * - industry: string (detected from website analysis)
 * - count: number (optional, default 6)
 */
router.post('/match', async (req: Request, res: Response) => {
  try {
    const { industry, count = 6 } = req.body;

    if (!industry) {
      return res.status(400).json({
        success: false,
        error: 'industry is required',
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🎯 Matching inspirations for industry: ${industry}`);

    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);

    // Get all unique categories (only from image inspirations)
    const categoriesResult = await inspirationRepo
      .createQueryBuilder('inspiration')
      .select('DISTINCT inspiration.category', 'category')
      .where('inspiration.isActive = :isActive', { isActive: true })
      .andWhere('inspiration.mediaType = :mediaType', { mediaType: 'image' })
      .orderBy('inspiration.category', 'ASC')
      .getRawMany();

    const categories = categoriesResult.map(c => c.category).filter(Boolean);

    if (categories.length === 0) {
      logger.warn('No inspiration categories found in database for image type');
      return res.json({
        success: true,
        data: {
          matched_categories: [],
          inspiration_videos: [],
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Get all active image inspiration links only
    const inspirationLinks = await inspirationRepo.find({
      where: { isActive: true, mediaType: 'image' },
    });

    if (inspirationLinks.length === 0) {
      logger.warn('No image inspiration links found in database');
      return res.json({
        success: true,
        data: {
          matched_categories: [],
          inspiration_videos: [],
        },
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`📷 Found ${inspirationLinks.length} image inspirations across ${categories.length} categories`);

    // Format links for the API
    const formattedLinks: InspirationLink[] = inspirationLinks.map(link => ({
      id: link.id,
      platform: link.platform,
      category: link.category,
      url: link.url,
      title: link.title || null,
      mediaType: link.mediaType || 'image',
      mediaUrl: link.mediaUrl || null,
    }));

    // Call Python AI backend for matching
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${pythonBackendUrl}/api/dvyb/inspirations/match-inspirations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        industry,
        categories,
        inspiration_links: formattedLinks,
        count: count,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Python backend error: ${errorText}`);
      throw new Error('Inspiration matching failed');
    }

    const result: any = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Inspiration matching failed');
    }

    let matchedVideos = result.data?.inspiration_videos || [];
    let matchedCategories = result.data?.matched_categories || [];

    // Fallback: If no matching inspirations found, return at least 2 random image inspirations
    if (matchedVideos.length === 0 && formattedLinks.length > 0) {
      logger.info(`⚠️ No matching inspirations found for industry: ${industry}. Falling back to random image inspirations.`);
      
      // Shuffle and pick at least 2 (or up to 'count') random image inspirations
      const shuffled = [...formattedLinks].sort(() => Math.random() - 0.5);
      const minCount = Math.max(2, count); // At least 2 inspirations
      matchedVideos = shuffled.slice(0, Math.min(minCount, shuffled.length));
      matchedCategories = [...new Set(matchedVideos.map((v: InspirationLink) => v.category))];
      
      logger.info(`✅ Fallback: Selected ${matchedVideos.length} random image inspirations`);
    } else {
      logger.info(`✅ Matched ${matchedVideos.length} inspirations for industry: ${industry}`);
    }

    return res.json({
      success: true,
      data: {
        matched_categories: matchedCategories,
        inspiration_videos: matchedVideos,
        reasoning: result.data?.reasoning || (matchedVideos.length > 0 && result.data?.inspiration_videos?.length === 0 ? 'Fallback: Random inspirations selected' : ''),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Inspiration matching error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to match inspirations',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/dvyb/inspirations/categories
 * Get all available inspiration categories (public endpoint)
 */
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const inspirationRepo = AppDataSource.getRepository(DvybInspirationLink);

    const categories = await inspirationRepo
      .createQueryBuilder('inspiration')
      .select('DISTINCT inspiration.category', 'category')
      .where('inspiration.isActive = :isActive', { isActive: true })
      .orderBy('inspiration.category', 'ASC')
      .getRawMany();

    return res.json({
      success: true,
      data: categories.map(c => c.category).filter(Boolean),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Error fetching categories:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

