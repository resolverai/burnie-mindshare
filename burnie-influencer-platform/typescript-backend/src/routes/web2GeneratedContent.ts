import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Web2GeneratedContent } from '../models/Web2GeneratedContent';
import { Account } from '../models/Account';
import { v4 as uuidv4 } from 'uuid';
import { UrlCacheService } from '../services/UrlCacheService';

// Helper function to generate presigned URL for AI-generated content with caching
async function generatePresignedUrl(s3Key: string): Promise<string | null> {
  try {
    // First, check if Redis is available and try to get cached URL
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();
    if (isRedisAvailable) {
      const cachedUrl = await UrlCacheService.getCachedUrl(s3Key);
      if (cachedUrl) {
        return cachedUrl;
      }
    }

    // If not cached or Redis unavailable, generate new presigned URL
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
    if (!pythonBackendUrl) {
      console.error('PYTHON_AI_BACKEND_URL environment variable is not set');
      return null;
    }

    console.log(`🔗 Requesting presigned URL for S3 key: ${s3Key}`);
    
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?s3_key=${encodeURIComponent(s3Key)}&expiration=3600`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Python backend responded with ${response.status}`);
    }

    const result = await response.json() as {
      status: string;
      presigned_url?: string;
      error?: string;
    };

    if (result.status === 'success' && result.presigned_url) {
      console.log(`✅ Generated presigned URL for S3 key: ${s3Key}`);
      
      // Cache the new URL if Redis is available
      if (isRedisAvailable) {
        await UrlCacheService.cacheUrl(s3Key, result.presigned_url, 3300); // 55 minutes TTL
      }
      
      return result.presigned_url;
    } else {
      console.error(`Failed to generate presigned URL: ${result.error}`);
      return null;
    }
  } catch (error) {
    console.error(`Error generating presigned URL for S3 key: ${s3Key}`, error);
    return null;
  }
}

const router = require('express').Router();

/**
 * @route POST /api/web2/generated-content
 * @desc Save generated content to database
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      account_id,
      account_client_id,
      content_type,
      image_model,
      video_model,
      clip_duration,
      user_prompt,
      user_images,
      theme,
      workflow_type,
      target_platform,
      include_logo,
      no_characters,
      human_characters_only,
      web3_characters,
      use_brand_aesthetics,
      viral_trends,
      image_prompt,
      clip_prompt,
      tweet_text,
      audio_prompt,
      voiceover_prompt,
      twitter_text,
      youtube_description,
      instagram_caption,
      linkedin_post,
      generated_image_urls,
      generated_prompts,
      product_categories,
      per_image_metadata,
      generated_video_url,
      generated_audio_url,
      generated_voiceover_url,
      final_content_url,
      status,
      error_message,
      auto_post,
      scheduled_post_time,
      posted_at,
      post_metadata,
      workflow_metadata,
      visual_analysis,
      num_variations,
      industry,
      brand_context
    } = req.body;

    // Validate required fields
    if (!account_id || !content_type) {
      res.status(400).json({
        success: false,
        message: 'account_id and content_type are required'
      });
      return;
    }

    // Verify account exists
    const accountRepository = AppDataSource.getRepository(Account);
    const account = await accountRepository.findOne({ where: { id: account_id } });
    
    if (!account) {
      res.status(404).json({
        success: false,
        message: 'Account not found'
      });
      return;
    }

    // Create new generated content record
    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    
    const generatedContent = generatedContentRepository.create({
      uuid: uuidv4(),
      account_id,
      account_client_id,
      content_type,
      image_model,
      video_model,
      clip_duration,
      user_prompt,
      user_images,
      theme,
      workflow_type,
      target_platform,
      include_logo: include_logo || false,
      no_characters: no_characters || false,
      human_characters_only: human_characters_only || false,
      web3_characters: web3_characters || false,
      use_brand_aesthetics: use_brand_aesthetics !== false,
      viral_trends: viral_trends || false,
      image_prompt,
      clip_prompt,
      tweet_text,
      audio_prompt,
      voiceover_prompt,
      twitter_text,
      youtube_description,
      instagram_caption,
      linkedin_post,
      generated_image_urls,
      generated_prompts,
      product_categories,
      per_image_metadata,
      generated_video_url,
      generated_audio_url,
      generated_voiceover_url,
      final_content_url,
      status: status || 'generating',
      error_message,
      auto_post: auto_post || false,
      scheduled_post_time,
      posted_at,
      post_metadata,
      workflow_metadata,
      visual_analysis,
      num_variations,
      industry,
      brand_context,
      job_id: req.body.job_id,
      progress_percent: req.body.progress_percent || 0,
      progress_message: req.body.progress_message || '',
      current_step: req.body.current_step || 'initializing'
    });

    const savedContent = await generatedContentRepository.save(generatedContent);

    res.status(201).json({
      success: true,
      message: 'Generated content saved successfully',
      data: savedContent
    });

  } catch (error) {
    console.error('Error saving generated content:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/web2/generated-content/job/:jobId
 * @desc Get generated content by job ID
 */
router.get('/job/:jobId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      res.status(400).json({
        success: false,
        message: 'Job ID is required'
      });
      return;
    }

    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    const content = await generatedContentRepository.findOne({ 
      where: { job_id: jobId },
      order: { created_at: 'DESC' }
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Generated content not found for this job ID'
      });
      return;
    }

    // Generate presigned URLs for generated images before sending to frontend
    let contentWithPresignedUrls = { ...content };
    
    // Generate presigned URLs for generated images
    if (content.generated_image_urls) {
      try {
        // Handle backward compatibility: convert string to array if needed
        let imageUrls: string[] = [];
        if (Array.isArray(content.generated_image_urls)) {
          imageUrls = content.generated_image_urls;
        } else if (typeof content.generated_image_urls === 'string') {
          // Handle legacy string format
          imageUrls = content.generated_image_urls ? [content.generated_image_urls] : [];
        }
        
        if (imageUrls.length > 0) {
          const presignedUrls = await Promise.all(
            imageUrls.map(async (url: string) => {
              if (url && url.startsWith('s3://')) {
                // Extract S3 key from S3 URL
                const s3Key = url.replace('s3://burnie-mindshare-content-staging/', '');
                return await generatePresignedUrl(s3Key);
              }
              return url; // Already a presigned URL
            })
          );
          // Filter out null values
          contentWithPresignedUrls.generated_image_urls = presignedUrls.filter((url): url is string => url !== null);
        }
      } catch (error) {
        console.error('Error generating presigned URLs for images:', error);
        // Keep original URLs if presigned URL generation fails
      }
    }

    res.json({
      success: true,
      data: contentWithPresignedUrls
    });

  } catch (error) {
    console.error('Error fetching content by job ID:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/web2/generated-content/:account_id
 * @desc Get generated content for an account
 */
router.get('/:account_id', async (req: Request, res: Response) => {
  try {
    const { account_id } = req.params;
    const { page = 1, limit = 10, content_type, status } = req.query;

    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    
    const queryBuilder = generatedContentRepository
      .createQueryBuilder('content')
      .where('content.account_id = :account_id', { account_id })
      .orderBy('content.created_at', 'DESC');

    // Add filters
    if (content_type) {
      queryBuilder.andWhere('content.content_type = :content_type', { content_type });
    }
    
    if (status) {
      queryBuilder.andWhere('content.status = :status', { status });
    }

    // Add pagination
    const offset = (Number(page) - 1) * Number(limit);
    queryBuilder.skip(offset).take(Number(limit));

    const [content, total] = await queryBuilder.getManyAndCount();

    // Generate presigned URLs for generated images and user images before sending to frontend
    const contentWithPresignedUrls = await Promise.all(content.map(async (item) => {
      const updatedItem = { ...item };
      
      // Generate presigned URLs for generated images
      if (item.generated_image_urls && item.generated_image_urls.length > 0) {
        try {
          const presignedUrls = await Promise.all(
            item.generated_image_urls.map(async (url: string) => {
              if (url.startsWith('s3://')) {
                // Extract S3 key from S3 URL
                const s3Key = url.replace('s3://burnie-mindshare-content-staging/', '');
                return await generatePresignedUrl(s3Key);
              }
              return url; // Already a presigned URL
            })
          );
          // Filter out null values
          updatedItem.generated_image_urls = presignedUrls.filter((url): url is string => url !== null);
        } catch (error) {
          console.error('Error generating presigned URLs for generated images:', error);
          // Keep original URLs if presigned URL generation fails
        }
      }

      // Generate presigned URLs for user images (input images)
      if (item.user_images && item.user_images.length > 0) {
        try {
          const presignedUrls = await Promise.all(
            item.user_images.map(async (url: string) => {
              if (url.startsWith('s3://')) {
                // Extract S3 key from S3 URL
                const s3Key = url.replace('s3://burnie-mindshare-content-staging/', '');
                return await generatePresignedUrl(s3Key);
              }
              return url; // Already a presigned URL
            })
          );
          // Filter out null values
          updatedItem.user_images = presignedUrls.filter((url): url is string => url !== null);
        } catch (error) {
          console.error('Error generating presigned URLs for user images:', error);
          // Keep original URLs if presigned URL generation fails
        }
      }
      
      return updatedItem;
    }));

    res.json({
      success: true,
      data: contentWithPresignedUrls,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching generated content:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route PUT /api/web2/generated-content/:id
 * @desc Update generated content record
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Content ID is required'
      });
      return;
    }

    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    const content = await generatedContentRepository.findOne({ where: { id: parseInt(id) } });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Generated content not found'
      });
      return;
    }

    // Update the content with provided data
    Object.assign(content, updateData);
    await generatedContentRepository.save(content);

    res.json({
      success: true,
      message: 'Content updated successfully',
      data: content
    });

  } catch (error) {
    console.error('Error updating content:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route PUT /api/web2/generated-content/:id/progress
 * @desc Update progress for generated content
 */
router.put('/:id/progress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { progress_percent, progress_message, current_step } = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Content ID is required'
      });
      return;
    }

    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    const content = await generatedContentRepository.findOne({ where: { id: parseInt(id) } });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Generated content not found'
      });
      return;
    }

    // Update progress fields
    content.progress_percent = progress_percent || 0;
    content.progress_message = progress_message || '';
    content.current_step = current_step || 'processing';

    await generatedContentRepository.save(content);

    res.json({
      success: true,
      message: 'Progress updated successfully',
      data: {
        id: content.id,
        progress_percent: content.progress_percent,
        progress_message: content.progress_message,
        current_step: content.current_step
      }
    });

  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/web2/generated-content/:id/per-image-data
 * @desc Get per-image data for a specific generated content
 */
router.get('/:id/per-image-data', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Content ID is required'
      });
      return;
    }

    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    const content = await generatedContentRepository.findOne({ 
      where: { id: parseInt(id) },
      select: ['id', 'generated_image_urls', 'generated_prompts', 'product_categories', 'per_image_metadata', 'twitter_text', 'instagram_caption', 'linkedin_post']
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Generated content not found'
      });
      return;
    }

    // Structure the per-image data
    const perImageData = [];
    const imageUrls = content.generated_image_urls || [];
    const prompts = content.generated_prompts || [];
    const categories = content.product_categories || [];
    const perImageMetadata = content.per_image_metadata || {};

    for (let i = 0; i < imageUrls.length; i++) {
      const imageKey = `image_${i + 1}`;
      const metadata = perImageMetadata[imageKey] || {};
      
      perImageData.push({
        imageIndex: i,
        imageUrl: imageUrls[i],
        prompt: prompts[i] || metadata.prompt || '',
        productCategory: categories[i] || metadata.product_category || 'Unknown',
        platformTexts: metadata.platform_texts || {
          twitter: content.twitter_text || '',
          instagram: content.instagram_caption || '',
          linkedin: content.linkedin_post || ''
        }
      });
    }

    res.json({
      success: true,
      data: {
        contentId: content.id,
        perImageData
      }
    });

  } catch (error) {
    console.error('Error fetching per-image data:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route PUT /api/web2/generated-content/:id
 * @desc Update generated content
 */
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      res.status(400).json({ error: 'Content ID is required' });
      return;
    }

    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    
    const content = await generatedContentRepository.findOne({ where: { id: parseInt(id) } });
    
    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Generated content not found'
      });
      return;
    }

    // Update the content
    Object.assign(content, updateData);
    const updatedContent = await generatedContentRepository.save(content);

    res.json({
      success: true,
      message: 'Generated content updated successfully',
      data: updatedContent
    });

  } catch (error) {
    console.error('Error updating generated content:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route DELETE /api/web2/generated-content/:id
 * @desc Delete generated content
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: 'Content ID is required' });
      return;
    }

    const generatedContentRepository = AppDataSource.getRepository(Web2GeneratedContent);
    
    const content = await generatedContentRepository.findOne({ where: { id: parseInt(id) } });
    
    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Generated content not found'
      });
      return;
    }

    await generatedContentRepository.remove(content);

    res.json({
      success: true,
      message: 'Generated content deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting generated content:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

module.exports = router;
