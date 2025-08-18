import express, { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { CampaignMindshareData } from '../models/CampaignMindshareData';
import { Campaign } from '../models/Campaign';
import { logger } from '../config/logger';

const router = express.Router();

// Store campaign mindshare data
router.post('/store', async (req: Request, res: Response): Promise<Response> => {
  try {
    const {
      campaignId,
      platformSource = 'cookie.fun',
      snapshotDate,
      // Project mindshare metrics
      mindsharePercentage,
      totalSnaps,
      activeParticipants,
      growth24h,
      // Market sentiment
      sentimentScore,
      sentimentLabel,
      communityMood,
      socialSignals,
      // Trending & engagement
      trendingTopics,
      engagementSignals,
      // Metadata
      extractionConfidence = 0.0,
      dataQuality = 'medium',
      screenshotsAnalyzed = 1,
      llmProvider,
      processingStatus = 'completed'
    } = req.body;

    if (!campaignId || !snapshotDate) {
      return res.status(400).json({
        success: false,
        error: 'Campaign ID and snapshot date are required'
      });
    }

    // Verify campaign exists
    const campaignRepository = AppDataSource.getRepository(Campaign);
    const campaign = await campaignRepository.findOne({
      where: { id: campaignId }
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    const repository = AppDataSource.getRepository(CampaignMindshareData);

    // Check if record already exists for this campaign and date
    const existingRecord = await repository.findOne({
      where: {
        campaignId,
        snapshotDate: new Date(snapshotDate),
        platformSource
      }
    });

    let mindshareData: CampaignMindshareData;

    if (existingRecord) {
      // Update existing record
      Object.assign(existingRecord, {
        mindsharePercentage,
        totalSnaps,
        activeParticipants,
        growth24h,
        sentimentScore,
        sentimentLabel,
        communityMood,
        socialSignals,
        trendingTopics,
        engagementSignals,
        extractionConfidence,
        dataQuality,
        screenshotsAnalyzed,
        llmProvider,
        processingStatus,
        updatedAt: new Date()
      });

      mindshareData = await repository.save(existingRecord);
      logger.info(`📊 Updated campaign mindshare data for campaign ${campaignId} on ${snapshotDate}`);
    } else {
      // Create new record
      mindshareData = repository.create({
        campaignId,
        platformSource,
        snapshotDate: new Date(snapshotDate),
        mindsharePercentage,
        totalSnaps,
        activeParticipants,
        growth24h,
        sentimentScore,
        sentimentLabel,
        communityMood,
        socialSignals,
        trendingTopics,
        engagementSignals,
        extractionConfidence,
        dataQuality,
        screenshotsAnalyzed,
        llmProvider,
        processingStatus
      });

      mindshareData = await repository.save(mindshareData);
      logger.info(`📊 Created new campaign mindshare data for campaign ${campaignId} on ${snapshotDate}`);
    }

    return res.json({
      success: true,
      data: mindshareData,
      message: existingRecord ? 'Campaign mindshare data updated' : 'Campaign mindshare data created'
    });

  } catch (error) {
    logger.error('Error storing campaign mindshare data:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to store campaign mindshare data'
    });
  }
});

// Get campaign mindshare data
router.get('/campaign/:campaignId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { campaignId } = req.params;
    const { startDate, endDate, platformSource } = req.query;

    const repository = AppDataSource.getRepository(CampaignMindshareData);
    const queryBuilder = repository.createQueryBuilder('mindshare')
      .leftJoinAndSelect('mindshare.campaign', 'campaign')
      .where('mindshare.campaignId = :campaignId', { campaignId });

    if (startDate) {
      queryBuilder.andWhere('mindshare.snapshotDate >= :startDate', { startDate });
    }

    if (endDate) {
      queryBuilder.andWhere('mindshare.snapshotDate <= :endDate', { endDate });
    }

    if (platformSource) {
      queryBuilder.andWhere('mindshare.platformSource = :platformSource', { platformSource });
    }

    const mindshareData = await queryBuilder
      .orderBy('mindshare.snapshotDate', 'DESC')
      .getMany();

    return res.json({
      success: true,
      data: mindshareData,
      count: mindshareData.length
    });

  } catch (error) {
    logger.error('Error fetching campaign mindshare data:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign mindshare data'
    });
  }
});

// Get aggregated mindshare analytics
router.get('/analytics/:campaignId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { campaignId } = req.params;
    const { days = 30 } = req.query;

    const repository = AppDataSource.getRepository(CampaignMindshareData);
    
    const analytics = await repository
      .createQueryBuilder('mindshare')
      .select([
        'AVG(mindshare.mindsharePercentage) as avgMindshare',
        'MAX(mindshare.mindsharePercentage) as maxMindshare',
        'MIN(mindshare.mindsharePercentage) as minMindshare',
        'AVG(mindshare.sentimentScore) as avgSentiment',
        'AVG(mindshare.totalSnaps) as avgTotalSnaps',
        'AVG(mindshare.activeParticipants) as avgActiveParticipants',
        'COUNT(*) as dataPoints'
      ])
      .where('mindshare.campaignId = :campaignId', { campaignId })
      .andWhere('mindshare.snapshotDate >= :startDate', { 
        startDate: new Date(Date.now() - parseInt(days as string) * 24 * 60 * 60 * 1000)
      })
      .getRawOne();

    return res.json({
      success: true,
      analytics,
      period: `Last ${days} days`
    });

  } catch (error) {
    logger.error('Error fetching campaign mindshare analytics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign mindshare analytics'
    });
  }
});

export default router;
