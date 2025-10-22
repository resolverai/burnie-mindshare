import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Web2GeneratedContent } from '../models/Web2GeneratedContent';
import { Account } from '../models/Account';
import { v4 as uuidv4 } from 'uuid';

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
      brand_context
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

    res.json({
      success: true,
      data: content,
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
