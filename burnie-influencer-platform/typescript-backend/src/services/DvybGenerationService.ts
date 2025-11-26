import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybContextService } from './DvybContextService';
import { v4 as uuidv4 } from 'uuid';

export class DvybGenerationService {
  /**
   * Start content generation job
   */
  static async startGeneration(
    accountId: number,
    generationParams: {
      contentType: 'thread' | 'single_post' | 'carousel' | 'video' | 'story';
      platform?: string;
      userPrompt?: string;
      numVariations?: number;
      includeImage?: boolean;
      includeVideo?: boolean;
      autoPost?: boolean;
      scheduledPostTime?: Date;
      metadata?: any;
    }
  ): Promise<{ content: DvybGeneratedContent; jobId: string }> {
    try {
      const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);

      // Get context for AI generation
      const context = await DvybContextService.getContext(accountId);
      if (!context) {
        throw new Error('Account context not found. Please complete onboarding first.');
      }

      // Create content record
      const uuid = uuidv4();
      const content = contentRepo.create({
        accountId,
        uuid,
        // Note: contentType and platform are legacy properties, not in DvybGeneratedContent model
        status: 'queued',
        progressPercent: 0,
        progressMessage: 'Initializing generation...',
        autoPost: generationParams.autoPost || false,
        scheduledPostTime: generationParams.scheduledPostTime || null,
        metadata: generationParams.metadata || {},
      });

      await contentRepo.save(content);

      // Call Python AI backend
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      const aiContext = DvybContextService.buildAIContextPayload(context);

      const aiPayload = {
        account_id: accountId,
        content_id: content.id,
        uuid: uuid,
        content_type: generationParams.contentType,
        platform: generationParams.platform || 'twitter',
        user_prompt: generationParams.userPrompt,
        num_variations: generationParams.numVariations || 1,
        include_image: generationParams.includeImage || false,
        include_video: generationParams.includeVideo || false,
        context: aiContext,
      };

      logger.info(`🚀 Calling AI backend for DVYB content generation: ${content.id}`);

      const response = await fetch(`${pythonBackendUrl}/api/dvyb/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(aiPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI generation failed: ${errorText}`);
      }

      const result = await response.json() as { job_id?: string; jobId?: string };
      const jobId = result.job_id || result.jobId || uuid;

      // Update content with job ID
      content.jobId = jobId;
      content.status = 'processing';
      content.progressMessage = 'Generation started...';
      await contentRepo.save(content);

      logger.info(`✅ DVYB generation started for account ${accountId}, jobId: ${jobId}`);

      return { content, jobId };
    } catch (error) {
      logger.error('❌ DVYB generation start error:', error);
      throw error;
    }
  }

  /**
   * Get generation progress
   */
  static async getProgress(accountId: number, jobId: string): Promise<any> {
    try {
      const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
      const content = await contentRepo.findOne({
        where: { accountId, jobId },
      });

      if (!content) {
        throw new Error('Content not found');
      }

      // If completed, return final result
      if (content.status === 'completed' || content.status === 'failed') {
        return {
          status: content.status,
          progress: content.progressPercent,
          message: content.progressMessage,
          error: content.errorMessage,
          result: {
            // Note: legacy tweetText/tweetTexts properties removed - use platformTexts instead
            platformTexts: content.platformTexts,
            imageUrls: content.generatedImageUrls,
            videoUrls: content.generatedVideoUrls,
            // Note: legacy audioUrl/finalContentUrl properties removed
          },
        };
      }

      // Poll Python AI backend for progress
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${pythonBackendUrl}/api/dvyb/progress/${jobId}`);

      if (response.ok) {
        const progressData = await response.json() as {
          progress?: number;
          message?: string;
          status?: string;
          result?: {
            platform_texts?: any;
            image_urls?: string[];
            video_urls?: string[];
          };
          error?: string;
        };

        // Update local content record
        content.progressPercent = progressData.progress || content.progressPercent;
        content.progressMessage = progressData.message || content.progressMessage;
        content.status = progressData.status || content.status;

        if (progressData.status === 'completed') {
          // Note: legacy tweetText/tweetTexts properties removed - use platformTexts instead
          if (progressData.result?.platform_texts) {
            content.platformTexts = progressData.result.platform_texts;
          }
          if (progressData.result?.image_urls) {
            content.generatedImageUrls = progressData.result.image_urls;
          }
          if (progressData.result?.video_urls) {
            content.generatedVideoUrls = progressData.result.video_urls;
          }
          // Note: legacy audioUrl/finalContentUrl properties removed
        } else if (progressData.status === 'failed') {
          content.errorMessage = progressData.error || 'Generation failed';
        }

        await contentRepo.save(content);

        return progressData;
      }

      // Return current status
      return {
        status: content.status,
        progress: content.progressPercent,
        message: content.progressMessage,
      };
    } catch (error) {
      logger.error('❌ DVYB progress check error:', error);
      throw error;
    }
  }

  /**
   * Get all generated content for an account
   */
  static async getAllContent(
    accountId: number,
    filters?: {
      status?: string;
      contentType?: string;
      platform?: string;
      limit?: number;
    }
  ): Promise<DvybGeneratedContent[]> {
    try {
      const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
      
      const query = contentRepo.createQueryBuilder('content')
        .where('content.accountId = :accountId', { accountId })
        .orderBy('content.createdAt', 'DESC');

      if (filters?.status) {
        query.andWhere('content.status = :status', { status: filters.status });
      }
      if (filters?.contentType) {
        query.andWhere('content.contentType = :contentType', { contentType: filters.contentType });
      }
      if (filters?.platform) {
        query.andWhere('content.platform = :platform', { platform: filters.platform });
      }
      if (filters?.limit) {
        query.limit(filters.limit);
      }

      const content = await query.getMany();

      logger.debug(`📚 Retrieved ${content.length} content items for DVYB account ${accountId}`);
      return content;
    } catch (error) {
      logger.error('❌ Get DVYB content error:', error);
      throw error;
    }
  }

  /**
   * Get single content by ID
   */
  static async getContentById(accountId: number, contentId: number): Promise<DvybGeneratedContent | null> {
    try {
      const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
      const content = await contentRepo.findOne({
        where: { id: contentId, accountId },
      });

      return content;
    } catch (error) {
      logger.error('❌ Get DVYB content by ID error:', error);
      throw error;
    }
  }

  /**
   * Delete generated content
   */
  static async deleteContent(accountId: number, contentId: number): Promise<void> {
    try {
      const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
      await contentRepo.delete({ id: contentId, accountId });

      logger.info(`✅ Deleted DVYB content ${contentId} for account ${accountId}`);
    } catch (error) {
      logger.error('❌ Delete DVYB content error:', error);
      throw error;
    }
  }
}

