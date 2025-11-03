import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { ProjectGeneratedContent } from '../models/ProjectGeneratedContent';
import { Web3ProjectTwitterPost } from '../models/Web3ProjectTwitterPost';
import { Web3PostsSchedule } from '../models/Web3PostsSchedule';
import { logger } from '../config/logger';
import { UrlCacheService } from '../services/UrlCacheService';
import { env } from '../config/env';
import { MoreThan } from 'typeorm';

const router = Router();

// Helper function to convert S3 key to presigned URL with Redis caching
// Returns URL as-is if it's a fal.media URL (no presigning needed)
async function getPresignedUrl(s3Key: string): Promise<string | null> {
  try {
    // Check if URL is from fal.media - return as-is without presigning
    if (s3Key && typeof s3Key === 'string' && s3Key.includes('fal.media')) {
      logger.debug(`✅ URL is from fal.media, returning as-is: ${s3Key}`);
      return s3Key;
    }
    
    // Handle both s3://bucket/key and just key formats
    let cleanKey = s3Key;
    if (s3Key.startsWith('s3://')) {
      // Extract key from s3://bucket/key format
      const parts = s3Key.replace('s3://', '').split('/');
      cleanKey = parts.slice(1).join('/'); // Remove bucket name
    }
    // Remove leading slash if present
    cleanKey = cleanKey.startsWith('/') ? cleanKey.slice(1) : cleanKey;

    // First, check Redis cache (TTL: 55 minutes)
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();
    if (isRedisAvailable) {
      const cachedUrl = await UrlCacheService.getCachedUrl(cleanKey);
      if (cachedUrl) {
        logger.debug(`✅ Using cached presigned URL for S3 key: ${cleanKey}`);
        return cachedUrl;
      }
    }

    // If not cached or Redis unavailable, generate new presigned URL
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      logger.error('PYTHON_AI_BACKEND_URL not configured, cannot generate presigned URL');
      return null;
    }

    logger.info(`🔗 Requesting presigned URL for S3 key: ${cleanKey}`);
    
    const queryParams = `s3_key=${encodeURIComponent(cleanKey)}&expiration=3600`;
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      logger.error(`Failed to generate presigned URL for ${cleanKey}: ${response.status}`);
      return null;
    }

    const data = await response.json() as { status?: string; presigned_url?: string };
    if (data.status === 'success' && data.presigned_url) {
      logger.info(`✅ Generated presigned URL for S3 key: ${cleanKey}`);
      
      // Cache the new URL with 55-minute TTL (3300 seconds) if Redis is available
      if (isRedisAvailable && data.presigned_url) {
        await UrlCacheService.cacheUrl(cleanKey, data.presigned_url, 3300); // 55 minutes
      }
      
      return data.presigned_url;
    }
    return null;
  } catch (error) {
    logger.error(`Error generating presigned URL for ${s3Key}:`, error);
    return null;
  }
}

// Helper function to convert S3 key array to presigned URLs
// Returns fal.media URLs as-is, only presigns S3 URLs
async function convertS3KeysToPresignedUrls(s3Keys: string[]): Promise<string[]> {
  if (!Array.isArray(s3Keys) || s3Keys.length === 0) return [];
  
  const presignedUrls = await Promise.all(
    s3Keys.map(key => {
      // If it's a fal.media URL, return as-is
      if (key && typeof key === 'string' && key.includes('fal.media')) {
        return key;
      }
      // Otherwise, get presigned URL for S3
      return getPresignedUrl(key);
    })
  );
  
  // Filter out null values and return only valid URLs (presigned or fal.media)
  return presignedUrls.filter((url): url is string => url !== null);
}

// POST /api/projects/:id/generate/daily - initiate daily posts generation
router.post('/:id/generate/daily', async (req: Request, res: Response) => {
  try {
    const idParam = req.params.id;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    
    // Call Python backend unified generation endpoint
    const pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!pythonBackendUrl) {
      return res.status(500).json({ success: false, error: 'Python AI backend URL not configured' });
    }
    
    const response = await fetch(`${pythonBackendUrl}/api/projects/${projectId}/unified-generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ success: false, error: errorText });
    }
    
    const data = await response.json();
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({ success: false, error: `Failed to initiate generation: ${e.message}` });
  }
});

// GET /api/projects/:id/generate/progress/:jobId - get generation progress (reads from database)
router.get('/:id/generate/progress/:jobId', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    
    const idParam = req.params.id;
    const jobId = req.params.jobId;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    if (!jobId) return res.status(400).json({ success: false, error: 'Job id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    
    // Read directly from database (Python backend updates it)
    const repo = AppDataSource.getRepository(ProjectGeneratedContent);
    const content = await repo.findOne({
      where: { project_id: projectId, job_id: jobId }
    });
    
    if (!content) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    // Convert S3 keys to presigned URLs for generated_image_urls
    const generatedImageUrls = content.generated_image_urls || [];
    const presignedImageUrls = await convertS3KeysToPresignedUrls(generatedImageUrls);
    
    // Convert S3 keys in per_image_metadata to presigned URLs
    const perImageMetadata = content.per_image_metadata || {};
    const presignedPerImageMetadata: Record<string, any> = {};
    
    for (const [key, metadata] of Object.entries(perImageMetadata)) {
      if (metadata && typeof metadata === 'object' && metadata.image_url) {
        const presignedImageUrl = await getPresignedUrl(metadata.image_url);
        presignedPerImageMetadata[key] = {
          ...metadata,
          image_url: presignedImageUrl || metadata.image_url // Fallback to original if presigned URL generation fails
        };
      } else {
        presignedPerImageMetadata[key] = metadata;
      }
    }
    
    // Convert S3 keys to presigned URLs for generated_video_urls
    const generatedVideoUrls = content.generated_video_urls || [];
    const presignedVideoUrls = await convertS3KeysToPresignedUrls(generatedVideoUrls);
    
    // Convert S3 keys in per_video_metadata to presigned URLs (if any video URLs exist in metadata)
    const perVideoMetadata = content.per_video_metadata || {};
    const presignedPerVideoMetadata: Record<string, any> = {};
    
    for (const [key, metadata] of Object.entries(perVideoMetadata)) {
      if (metadata && typeof metadata === 'object') {
        const updatedMetadata = { ...metadata };
        
        // Check for common video URL fields
        if (metadata.video_url) {
          const presignedVideoUrl = await getPresignedUrl(metadata.video_url);
          updatedMetadata.video_url = presignedVideoUrl || metadata.video_url;
        }
        if (metadata.watermark_video_url) {
          const presignedWatermarkUrl = await getPresignedUrl(metadata.watermark_video_url);
          updatedMetadata.watermark_video_url = presignedWatermarkUrl || metadata.watermark_video_url;
        }
        
        presignedPerVideoMetadata[key] = updatedMetadata;
      } else {
        presignedPerVideoMetadata[key] = metadata;
      }
    }
    
    return res.json({ 
      success: true, 
      data: {
        job_id: content.job_id,
        status: content.status,
        progress_percent: content.progress_percent,
        progress_message: content.progress_message,
        generated_image_urls: presignedImageUrls,
        generated_video_urls: presignedVideoUrls,
        per_image_metadata: presignedPerImageMetadata,
        per_video_metadata: presignedPerVideoMetadata,
        workflow_metadata: content.workflow_metadata || {}, // Include workflow_metadata (contains video_image_index)
        created_at: content.created_at,
        updated_at: content.updated_at
      }
    });
  } catch (e: any) {
    logger.error(`Error in progress endpoint: ${e.message}`, e);
    return res.status(500).json({ success: false, error: `Failed to get progress: ${e.message}` });
  }
});

// POST /api/projects/:id/generated-content - Create initial generation record
router.post('/:id/generated-content', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    
    const idParam = req.params.id;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    
    const repo = AppDataSource.getRepository(ProjectGeneratedContent);
    
    const content = repo.create({
      project_id: projectId,
      uuid: req.body.uuid || require('crypto').randomUUID(),
      job_id: req.body.job_id,
      workflow_type: req.body.workflow_type || 'daily_posts',
      content_type: req.body.content_type || 'mixed',
      status: req.body.status || 'generating',
      progress_percent: req.body.progress_percent || 0,
      progress_message: req.body.progress_message || 'Starting generation...',
      image_model: req.body.image_model,
      video_model: req.body.video_model,
      clip_duration: req.body.clip_duration,
      generated_image_urls: req.body.generated_image_urls || [],
      generated_video_urls: req.body.generated_video_urls || [],
      per_image_metadata: req.body.per_image_metadata || {},
      per_video_metadata: req.body.per_video_metadata || {},
      workflow_metadata: req.body.workflow_metadata || {}
    });
    
    const saved = await repo.save(content);
    
    return res.status(201).json({ success: true, data: saved });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: `Failed to create record: ${e.message}` });
  }
});

// GET /api/projects/:id/generated-content/job/:jobId - Get record by job_id
router.get('/:id/generated-content/job/:jobId', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    
    const idParam = req.params.id;
    const jobId = req.params.jobId;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    if (!jobId) return res.status(400).json({ success: false, error: 'Job id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    
    const repo = AppDataSource.getRepository(ProjectGeneratedContent);
    const content = await repo.findOne({
      where: { project_id: projectId, job_id: jobId }
    });
    
    if (!content) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    return res.json({ success: true, data: content });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: `Failed to fetch record: ${e.message}` });
  }
});

// PUT /api/projects/:id/generated-content/:jobId/progress - Update progress
router.put('/:id/generated-content/:jobId/progress', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    
    const idParam = req.params.id;
    const jobId = req.params.jobId;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    if (!jobId) return res.status(400).json({ success: false, error: 'Job id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    
    const repo = AppDataSource.getRepository(ProjectGeneratedContent);
    const content = await repo.findOne({
      where: { project_id: projectId, job_id: jobId }
    });
    
    if (!content) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    content.progress_percent = req.body.progress_percent ?? content.progress_percent;
    content.progress_message = req.body.progress_message ?? content.progress_message;
    if (req.body.status) content.status = req.body.status;
    
    await repo.save(content);
    
    return res.json({ success: true, data: content });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: `Failed to update progress: ${e.message}` });
  }
});

// PUT /api/projects/:id/generated-content/:jobId/images - Update images progressively
router.put('/:id/generated-content/:jobId/images', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    
    const idParam = req.params.id;
    const jobId = req.params.jobId;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    if (!jobId) return res.status(400).json({ success: false, error: 'Job id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    
    const repo = AppDataSource.getRepository(ProjectGeneratedContent);
    const content = await repo.findOne({
      where: { project_id: projectId, job_id: jobId }
    });
    
    if (!content) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    if (req.body.generated_image_urls) {
      content.generated_image_urls = req.body.generated_image_urls;
    }
    if (req.body.per_image_metadata) {
      content.per_image_metadata = { ...(content.per_image_metadata || {}), ...req.body.per_image_metadata };
    }
    if (req.body.tweet_texts) {
      content.tweet_texts = req.body.tweet_texts;
    }
    
    await repo.save(content);
    
    return res.json({ success: true, data: content });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: `Failed to update images: ${e.message}` });
  }
});

// PUT /api/projects/:id/generated-content/:jobId/video - Update video
router.put('/:id/generated-content/:jobId/video', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    
    const idParam = req.params.id;
    const jobId = req.params.jobId;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    if (!jobId) return res.status(400).json({ success: false, error: 'Job id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    
    const repo = AppDataSource.getRepository(ProjectGeneratedContent);
    const content = await repo.findOne({
      where: { project_id: projectId, job_id: jobId }
    });
    
    if (!content) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    
    if (req.body.video_url) {
      // Add to generated_video_urls if provided
      if (req.body.generated_video_urls) {
        content.generated_video_urls = req.body.generated_video_urls;
      } else if (content.generated_video_urls && req.body.video_url) {
        // Add single video URL to array if not already present
        if (!content.generated_video_urls.includes(req.body.video_url)) {
          content.generated_video_urls = [...(content.generated_video_urls || []), req.body.video_url];
        }
      } else {
        content.generated_video_urls = [req.body.video_url];
      }
    }
    
    if (req.body.per_video_metadata) {
      content.per_video_metadata = { ...(content.per_video_metadata || {}), ...req.body.per_video_metadata };
    }
    
    await repo.save(content);
    
    return res.json({ success: true, data: content });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: `Failed to update video: ${e.message}` });
  }
});

// GET /api/projects/:id/content?dateKey=yyyy-mm-dd or grouped by date with pagination and search
router.get('/:id/content', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'DB not ready' });
    const idParam = req.params.id;
    if (!idParam) return res.status(400).json({ success: false, error: 'Project id is required' });
    const projectId = parseInt(idParam);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });

    const page = parseInt((req.query.page as string) || '1');
    const limitDates = parseInt((req.query.limitDates as string) || '3');
    // No limit per date - show all posts for each date
    const searchTerm = (req.query.search as string)?.trim() || '';
    const postTypeFilter = (req.query.postType as string)?.trim() || '';

    const repo = AppDataSource.getRepository(ProjectGeneratedContent);
    
    // Build query with search and post type filter support
    let queryBuilder = repo.createQueryBuilder('c')
      .where('c.project_id = :projectId', { projectId });

    // Apply search filter if provided
    if (searchTerm) {
      queryBuilder = queryBuilder.andWhere(
        '(CAST(c.user_prompt AS TEXT) ILIKE :search OR ' +
        'CAST(c.tweet_texts AS TEXT) ILIKE :search OR ' +
        'CAST(c.per_image_metadata AS TEXT) ILIKE :search OR ' +
        'CAST(c.content_type AS TEXT) ILIKE :search)',
        { search: `%${searchTerm}%` }
      );
    }

    // Note: Post type filtering is done on the frontend after flattening posts from jobs
    // This is because each job contains multiple posts with different types, and we want to
    // filter individual posts, not entire jobs. So we don't filter at the database level here.
    if (postTypeFilter && postTypeFilter !== 'all') {
      logger.info(`🔍 Post type filter requested: ${postTypeFilter} (will be applied on frontend)`);
    } else {
      logger.info('🔍 No post type filter applied (all types)');
    }

    // Get all items matching search and filters
    logger.info(`🔍 Executing query with filters: search="${searchTerm}", postType="${postTypeFilter}"`);
    const allItems = await queryBuilder
      .orderBy('c.created_at', 'DESC')
      .getMany();
    
    logger.info(`📊 Query returned ${allItems.length} items after filtering`);

    // Group by date (YYYY-MM-DD format from created_at)
    const groupedByDate: Record<string, ProjectGeneratedContent[]> = {};
    for (const item of allItems) {
      const dateKey = item.created_at.toISOString().split('T')[0]; // YYYY-MM-DD
      if (dateKey) {
        if (!groupedByDate[dateKey]) {
          groupedByDate[dateKey] = [];
        }
        groupedByDate[dateKey].push(item);
      }
    }

    // Get sorted dates
    const dates = Object.keys(groupedByDate).sort().reverse(); // Most recent first
    const totalDates = dates.length;
    const pagedDates = dates.slice((page-1)*limitDates, page*limitDates);

    // Build final grouped result - show ALL items for each date (no per-date limit)
    // Convert S3 URLs to presigned URLs
    const grouped: Record<string, any[]> = {};
    for (const date of pagedDates) {
      const items = groupedByDate[date]; // Show all items, no slice
      if (!items) continue;
      
      // Convert each item's S3 URLs to presigned URLs
      const processedItems = await Promise.all(items.map(async (item) => {
        const processedItem: any = { ...item };
        
        // Convert generated_image_urls
        if (item.generated_image_urls && Array.isArray(item.generated_image_urls)) {
          processedItem.generated_image_urls = await convertS3KeysToPresignedUrls(item.generated_image_urls);
        }
        
        // Convert generated_video_urls (handle fal.media URLs)
        if (item.generated_video_urls && Array.isArray(item.generated_video_urls)) {
          processedItem.generated_video_urls = await convertS3KeysToPresignedUrls(item.generated_video_urls);
        }
        
        // Convert per_image_metadata image_urls
        if (item.per_image_metadata && typeof item.per_image_metadata === 'object') {
          const processedMetadata: Record<string, any> = {};
          for (const [key, metadata] of Object.entries(item.per_image_metadata)) {
            if (metadata && typeof metadata === 'object' && (metadata as any).image_url) {
              const presignedUrl = await getPresignedUrl((metadata as any).image_url);
              processedMetadata[key] = {
                ...metadata,
                image_url: presignedUrl || (metadata as any).image_url
              };
            } else {
              processedMetadata[key] = metadata;
            }
          }
          processedItem.per_image_metadata = processedMetadata;
        }
        
        // Convert per_video_metadata video_urls (handle fal.media URLs)
        if (item.per_video_metadata && typeof item.per_video_metadata === 'object') {
          const processedVideoMetadata: Record<string, any> = {};
          for (const [key, metadata] of Object.entries(item.per_video_metadata)) {
            if (metadata && typeof metadata === 'object') {
              const updatedMetadata = { ...metadata };
              
              // Handle video_url - skip presigning if fal.media
              if (metadata.video_url) {
                const videoUrl = metadata.video_url;
                if (videoUrl.includes('fal.media')) {
                  updatedMetadata.video_url = videoUrl; // Use as-is
                } else {
                  const presignedVideoUrl = await getPresignedUrl(videoUrl);
                  updatedMetadata.video_url = presignedVideoUrl || videoUrl;
                }
              }
              
              // Handle watermark_video_url - skip presigning if fal.media
              if (metadata.watermark_video_url) {
                const watermarkUrl = metadata.watermark_video_url;
                if (watermarkUrl.includes('fal.media')) {
                  updatedMetadata.watermark_video_url = watermarkUrl; // Use as-is
                } else {
                  const presignedWatermarkUrl = await getPresignedUrl(watermarkUrl);
                  updatedMetadata.watermark_video_url = presignedWatermarkUrl || watermarkUrl;
                }
              }
              
              processedVideoMetadata[key] = updatedMetadata;
            } else {
              processedVideoMetadata[key] = metadata;
            }
          }
          processedItem.per_video_metadata = processedVideoMetadata;
        }
        
        return processedItem;
      }));
      
      grouped[date] = processedItems;
    }

    return res.json({
      success: true,
      data: grouped,
      pagination: {
        page, totalPages: Math.ceil(totalDates / limitDates), limitDates, totalDates
      }
    });
  } catch (e: any) {
    logger.error(`Error fetching content: ${e.message}`, e);
    return res.status(500).json({ success: false, error: 'Failed to fetch content' });
  }
});

/**
 * GET /api/projects/:id/dashboard
 * Get dashboard statistics and recent activity for web3 project
 */
router.get('/:id/dashboard', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.id || '');
    
    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
    }

    const projectGeneratedContentRepo = AppDataSource.getRepository(ProjectGeneratedContent);
    const web3TwitterPostsRepo = AppDataSource.getRepository(Web3ProjectTwitterPost);
    const web3SchedulesRepo = AppDataSource.getRepository(Web3PostsSchedule);

    // 1. Total posts generated (sum of tweet_texts array lengths from all records)
    // Each record in project_generated_content can have multiple posts
    const allGeneratedContent = await projectGeneratedContentRepo.find({
      where: { project_id: projectId }
    });

    let totalGenerated = 0;
    allGeneratedContent.forEach(content => {
      // Count posts from tweet_texts array if available, otherwise use generated_image_urls length
      if (content.tweet_texts && Array.isArray(content.tweet_texts)) {
        totalGenerated += content.tweet_texts.length;
      } else if (content.generated_image_urls && Array.isArray(content.generated_image_urls)) {
        totalGenerated += content.generated_image_urls.length;
      } else {
        // Fallback: if neither array exists, count as 1 post per record
        totalGenerated += 1;
      }
    });

    // 2. Posts scheduled (count upcoming schedules from web3_posts_schedule)
    const now = new Date();
    const scheduledCount = await web3SchedulesRepo.count({
      where: {
        projectId,
        scheduledAt: MoreThan(now)
      }
    });

    // 3. Total posted to Twitter (count from web3_project_twitter_posts)
    const totalPosted = await web3TwitterPostsRepo.count({
      where: { projectId }
    });

    // 4. Total engagement (sum of likes, retweets, replies from all posted tweets)
    const allPostedTweets = await web3TwitterPostsRepo.find({
      where: { projectId }
    });

    let totalEngagement = {
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      views: 0,
      total: 0
    };

    allPostedTweets.forEach(tweet => {
      const totals = tweet.getTotalEngagement();
      totalEngagement.likes += totals.likes;
      totalEngagement.retweets += totals.retweets;
      totalEngagement.replies += totals.replies;
      totalEngagement.quotes += totals.quotes;
      totalEngagement.views += totals.views || 0;
    });

    totalEngagement.total = totalEngagement.likes + totalEngagement.retweets + 
                           totalEngagement.replies + totalEngagement.quotes;

    // 5. Recent Activity
    // - Recent posted tweets (last 5)
    const recentPosts = await web3TwitterPostsRepo.find({
      where: { projectId },
      order: { postedAt: 'DESC' },
      take: 5
    });

    // - Upcoming scheduled posts (next 5)
    const upcomingSchedules = await web3SchedulesRepo.find({
      where: {
        projectId,
        scheduledAt: MoreThan(now)
      },
      order: { scheduledAt: 'ASC' },
      take: 5
    });

    // - Recent generated content (last 3)
    const recentGenerated = await projectGeneratedContentRepo.find({
      where: { project_id: projectId },
      order: { created_at: 'DESC' },
      take: 3
    });

    return res.json({
      success: true,
      data: {
        metrics: {
          totalGenerated,
          scheduledCount,
          totalPosted,
          totalEngagement: totalEngagement.total,
          engagementBreakdown: {
            likes: totalEngagement.likes,
            retweets: totalEngagement.retweets,
            replies: totalEngagement.replies,
            quotes: totalEngagement.quotes,
            views: totalEngagement.views
          }
        },
        recentActivity: {
          recentPosts: recentPosts.map(post => ({
            id: post.id,
            mainTweet: post.mainTweet.substring(0, 100) + (post.mainTweet.length > 100 ? '...' : ''),
            postType: post.postType,
            postedAt: post.postedAt,
            engagement: post.getTotalEngagement(),
            mainTweetId: post.mainTweetId
          })),
          upcomingSchedules: upcomingSchedules.map(schedule => ({
            id: schedule.id,
            scheduledAt: schedule.scheduledAt,
            mediaType: schedule.mediaType,
            mainTweet: schedule.tweetText.main_tweet.substring(0, 100) + (schedule.tweetText.main_tweet.length > 100 ? '...' : '')
          })),
          recentGenerated: recentGenerated.map(content => ({
            id: content.id,
            jobId: content.job_id,
            status: content.status,
            createdAt: content.created_at,
            contentCount: content.generated_image_urls?.length || 0,
            hasVideo: (content.generated_video_urls?.length || 0) > 0
          }))
        }
      }
    });
  } catch (error: any) {
    logger.error(`Error fetching dashboard data: ${error.message}`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data'
    });
  }
});

export { router as projectContentRoutes };


