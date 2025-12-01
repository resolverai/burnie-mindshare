import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { DvybSchedule } from '../models/DvybSchedule';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { dvybAuthMiddleware, DvybAuthRequest } from '../middleware/dvybAuthMiddleware';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/dvyb/debug/schedules
 * Debug endpoint to check schedule data
 */
router.get('/', dvybAuthMiddleware, async (req: DvybAuthRequest, res: Response) => {
  try {
    const accountId = req.dvybAccountId!;
    
    const scheduleRepo = AppDataSource.getRepository(DvybSchedule);
    const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
    
    // Get all schedules for this account
    const schedules = await scheduleRepo
      .createQueryBuilder('schedule')
      .where('schedule.accountId = :accountId', { accountId })
      .orderBy('schedule.createdAt', 'DESC')
      .getMany();
    
    // Get all generated content
    const allContent = await contentRepo
      .createQueryBuilder('content')
      .where('content.accountId = :accountId', { accountId })
      .andWhere('content.status = :status', { status: 'completed' })
      .orderBy('content.createdAt', 'DESC')
      .getMany();
    
    // Analyze each schedule
    const scheduleAnalysis = schedules.map(schedule => {
      const content = allContent.find(c => c.id === schedule.generatedContentId);
      const postMetadata = schedule.postMetadata || {};
      const postIndex = postMetadata.postIndex;
      
      let matchingPlatformText = null;
      if (content && content.platformTexts && Array.isArray(content.platformTexts)) {
        matchingPlatformText = content.platformTexts.find((pt: any) => 
          pt.post_index === postIndex || 
          pt.post_index === Number(postIndex)
        );
      }
      
      return {
        scheduleId: schedule.id,
        status: schedule.status,
        scheduledFor: schedule.scheduledFor,
        generatedContentId: schedule.generatedContentId,
        contentExists: !!content,
        contentUuid: content?.uuid,
        postMetadataPostIndex: postIndex,
        postIndexType: typeof postIndex,
        numberOfPlatformTexts: content?.platformTexts?.length || 0,
        platformTextExists: !!matchingPlatformText,
        matchingPlatformText: matchingPlatformText ? {
          post_index: matchingPlatformText.post_index,
          content_type: matchingPlatformText.content_type,
          topic: matchingPlatformText.topic
        } : null,
        platforms: schedule.platform,
      };
    });
    
    return res.json({
      success: true,
      data: {
        totalSchedules: schedules.length,
        totalContent: allContent.length,
        schedules: scheduleAnalysis,
        rawSchedules: schedules.map(s => ({
          id: s.id,
          generatedContentId: s.generatedContentId,
          postMetadata: s.postMetadata,
          status: s.status,
          scheduledFor: s.scheduledFor,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('❌ Debug schedules error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to debug schedules',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

