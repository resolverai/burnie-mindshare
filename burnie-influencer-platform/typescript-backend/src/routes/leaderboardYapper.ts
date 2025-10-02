import { Router, Request, Response } from 'express';
import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { LeaderboardYapperData, PlatformSource } from '../models/LeaderboardYapperData';
import { TwitterHandleMetadata } from '../models/TwitterHandleMetadata';
import { Campaign } from '../models/Campaign';
import { PlatformSnapshot } from '../models/PlatformSnapshot';
import { logger } from '../config/logger';

type AuthenticatedRequest = Request & {
  user?: {
    id: number;
    walletAddress: string;
    username?: string;
  };
}

const router = Router();

// Store leaderboard yapper data extracted from snapshots
router.post('/store', async (req: Request, res: Response): Promise<Response> => {
  try {
    const {
      snapshot_ids,
      campaign_id,
      platform_source,
      snapshot_date,
      
      // Yapper information
      yapper_twitter_handle,
      yapper_display_name,
      daily_rank,
      
      // SNAP metrics
      total_snaps,
      snaps_24h,
      snap_velocity,
      
      // Social metrics
      smart_followers_count,
      engagement_rate,
      
      // Metadata
      extraction_confidence,
      llm_provider,
      processing_status
    } = req.body;

    if (!yapper_twitter_handle || !campaign_id || !snapshot_date || !platform_source) {
      return res.status(400).json({
        success: false,
        message: 'yapper_twitter_handle, campaign_id, snapshot_date, and platform_source are required'
      });
    }

    const repository: Repository<LeaderboardYapperData> = AppDataSource.getRepository(LeaderboardYapperData);
    const campaignRepository: Repository<Campaign> = AppDataSource.getRepository(Campaign);
    const snapshotRepository: Repository<PlatformSnapshot> = AppDataSource.getRepository(PlatformSnapshot);

    // Clean up Twitter handle (remove @ if present)
    const cleanHandle = yapper_twitter_handle.replace(/^@/, '');

    // Verify campaign exists
    const campaign = await campaignRepository.findOne({ where: { id: campaign_id } });
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: `Campaign with ID ${campaign_id} not found`
      });
    }

    // Use the first snapshot ID for the main record
    const primarySnapshotId = Array.isArray(snapshot_ids) ? snapshot_ids[0] : snapshot_ids;
    
    // Verify snapshot exists
    const snapshot = await snapshotRepository.findOne({ where: { id: primarySnapshotId } });
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: `Snapshot with ID ${primarySnapshotId} not found`
      });
    }

    // Check if leaderboard entry already exists for this handle, campaign, platform, and date
    const existingEntry = await repository.findOne({
      where: {
        twitterHandle: cleanHandle,
        campaignId: campaign_id,
        platformSource: platform_source as PlatformSource,
        snapshotDate: new Date(snapshot_date)
      }
    });

    let yapperData: LeaderboardYapperData;

    if (existingEntry) {
      // Update existing entry
      existingEntry.displayName = yapper_display_name || existingEntry.displayName;
      existingEntry.leaderboardPosition = daily_rank || existingEntry.leaderboardPosition;
      existingEntry.totalSnaps = total_snaps !== undefined ? total_snaps : existingEntry.totalSnaps;
      existingEntry.snaps24h = snaps_24h !== undefined ? snaps_24h : existingEntry.snaps24h;
      existingEntry.smartFollowers = smart_followers_count !== undefined ? smart_followers_count : existingEntry.smartFollowers;
      
      // Update leaderboard data with additional metadata
      existingEntry.leaderboardData = {
        ...existingEntry.leaderboardData,
        snap_velocity,
        engagement_rate,
        extraction_confidence,
        llm_provider,
        processing_status,
        updated_at: new Date().toISOString()
      };

      yapperData = await repository.save(existingEntry);
      logger.info(`📝 Updated existing leaderboard entry for @${cleanHandle} in campaign ${campaign_id}`);
    } else {
      // Create new entry
      yapperData = repository.create({
        twitterHandle: cleanHandle,
        displayName: yapper_display_name,
        campaignId: campaign_id,
        snapshotId: primarySnapshotId,
        platformSource: platform_source as PlatformSource,
        snapshotDate: new Date(snapshot_date),
        leaderboardPosition: daily_rank || 0,
        totalSnaps: total_snaps,
        snaps24h: snaps_24h,
        smartFollowers: smart_followers_count,
        leaderboardData: {
          snap_velocity,
          engagement_rate,
          extraction_confidence,
          llm_provider,
          processing_status,
          snapshot_ids,
          created_at: new Date().toISOString()
        }
      });

      yapperData = await repository.save(yapperData);
      logger.info(`✅ Created new leaderboard entry for @${cleanHandle} in campaign ${campaign_id}`);
    }

    return res.json({
      success: true,
      message: existingEntry ? 'Leaderboard entry updated successfully' : 'Leaderboard entry created successfully',
      data: {
        id: yapperData.id,
        twitter_handle: yapperData.twitterHandle,
        display_name: yapperData.displayName,
        campaign_id: yapperData.campaignId,
        platform_source: yapperData.platformSource,
        snapshot_date: yapperData.snapshotDate instanceof Date ? yapperData.snapshotDate.toISOString().split('T')[0] : String(yapperData.snapshotDate).split('T')[0],
        leaderboard_position: yapperData.leaderboardPosition,
        total_snaps: yapperData.totalSnaps,
        snaps_24h: yapperData.snaps24h,
        smart_followers: yapperData.smartFollowers
      }
    });

  } catch (error) {
    logger.error('❌ Error storing leaderboard yapper data:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store leaderboard yapper data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get all yappers from leaderboard data (latest snapshot per yapper) + popular Twitter handles
router.get('/all', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { limit = 100 } = req.query;

    const leaderboardRepository: Repository<LeaderboardYapperData> = AppDataSource.getRepository(LeaderboardYapperData);
    const twitterMetadataRepository: Repository<TwitterHandleMetadata> = AppDataSource.getRepository(TwitterHandleMetadata);

    // Get latest snapshot for each unique yapper (by twitter handle)
    const leaderboardQueryBuilder = leaderboardRepository.createQueryBuilder('leaderboard')
      .leftJoinAndSelect('leaderboard.campaign', 'campaign')
      .distinctOn(['leaderboard.twitterHandle'])
      .orderBy('leaderboard.twitterHandle', 'ASC')
      .addOrderBy('leaderboard.snapshotDate', 'DESC')
      .take(parseInt(limit as string));

    const leaderboardData = await leaderboardQueryBuilder.getMany();

    // Get popular Twitter handles from metadata table (active status only)
    const twitterHandlesData = await twitterMetadataRepository.find({
      where: { status: 'active' },
      order: { followers_count: 'DESC' },
      take: parseInt(limit as string)
    });

    // Format leaderboard data
    const formattedLeaderboardData = leaderboardData.map(entry => ({
      id: entry.id,
      twitter_handle: entry.twitterHandle,
      display_name: entry.displayName,
      campaign_id: entry.campaignId,
      campaign_title: entry.campaign?.title,
      platform_source: entry.platformSource,
      snapshot_date: entry.snapshotDate instanceof Date ? entry.snapshotDate.toISOString().split('T')[0] : entry.snapshotDate,
      leaderboard_position: entry.leaderboardPosition,
      total_snaps: entry.totalSnaps,
      snaps_24h: entry.snaps24h,
      smart_followers: entry.smartFollowers,
      twitter_fetch_status: entry.twitterFetchStatus,
      additional_data: entry.leaderboardData,
      source: 'leaderboard' // Mark as leaderboard data
    }));

    // Format Twitter handles data
    const formattedTwitterHandlesData = twitterHandlesData.map(handle => ({
      id: `twitter_${handle.id}`, // Prefix to avoid ID conflicts
      twitter_handle: handle.twitter_handle,
      display_name: handle.display_name || handle.twitter_handle,
      followers_count: handle.followers_count,
      verified: handle.verified,
      profile_image_url: handle.profile_image_url,
      source: 'popular_handles' // Mark as popular handles data
    }));

    // Combine both datasets
    const combinedData = [...formattedLeaderboardData, ...formattedTwitterHandlesData];

    return res.json({
      success: true,
      total_yappers: combinedData.length,
      leaderboard_count: formattedLeaderboardData.length,
      popular_handles_count: formattedTwitterHandlesData.length,
      yappers: combinedData
    });

  } catch (error) {
    logger.error('❌ Error fetching all yappers data:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch yappers data',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
});

// Get leaderboard data for a campaign
router.get('/campaign/:campaignId', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { campaignId } = req.params;
    const { date, limit = 50 } = req.query;

    const repository: Repository<LeaderboardYapperData> = AppDataSource.getRepository(LeaderboardYapperData);

    const queryBuilder = repository.createQueryBuilder('leaderboard')
      .leftJoinAndSelect('leaderboard.campaign', 'campaign')
      .where('leaderboard.campaignId = :campaignId', { campaignId })
      .orderBy('leaderboard.leaderboardPosition', 'ASC')
      .take(parseInt(limit as string));

    if (date) {
      queryBuilder.andWhere('leaderboard.snapshotDate = :date', { date });
    } else {
      // Get latest snapshot for each yapper
      queryBuilder.andWhere('leaderboard."snapshotDate" = (SELECT MAX(l2."snapshotDate") FROM leaderboard_yapper_data l2 WHERE l2."campaignId" = :campaignId)', { campaignId });
    }

    const leaderboardData = await queryBuilder.getMany();

    const formattedData = leaderboardData.map(entry => ({
      id: entry.id,
      twitter_handle: entry.twitterHandle,
      display_name: entry.displayName,
      campaign_id: entry.campaignId,
      campaign_title: entry.campaign?.title,
      platform_source: entry.platformSource,
      snapshot_date: entry.snapshotDate instanceof Date ? entry.snapshotDate.toISOString().split('T')[0] : entry.snapshotDate,
      leaderboard_position: entry.leaderboardPosition,
      total_snaps: entry.totalSnaps,
      snaps_24h: entry.snaps24h,
      smart_followers: entry.smartFollowers,
      twitter_fetch_status: entry.twitterFetchStatus,
      additional_data: entry.leaderboardData
    }));

    return res.json({
      success: true,
      campaign_id: campaignId,
      date_filter: date || 'latest',
      leaderboard_size: formattedData.length,
      leaderboard: formattedData
    });

  } catch (error) {
    logger.error('❌ Error fetching campaign leaderboard data:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch campaign leaderboard data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/leaderboard-yapper/add-handle
 * @desc Add a new Twitter handle to the yapper list (public endpoint for Choose Yapper feature)
 */
router.post('/add-handle', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { twitter_handle } = req.body;

    if (!twitter_handle) {
      return res.status(400).json({
        success: false,
        message: 'Twitter handle is required'
      });
    }

    // Clean handle (remove @ if present and trim whitespace)
    const cleanHandle = twitter_handle.replace(/^@/, '').toLowerCase().trim();

    if (!cleanHandle) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Twitter handle'
      });
    }

    const { TwitterHandleMetadata } = await import('../models/TwitterHandleMetadata');
    const repository = AppDataSource.getRepository(TwitterHandleMetadata);

    // Check if handle already exists
    const existingHandle = await repository.findOne({
      where: { twitter_handle: cleanHandle }
    });

    if (existingHandle) {
      // Track existing yapper lookup
      logger.info(`📊 MIXPANEL_BACKEND_EVENT: yapperAdded`, {
        yapperHandle: cleanHandle,
        yapperDisplayName: existingHandle.display_name || existingHandle.twitter_handle,
        addedFromSearch: true,
        alreadyExisted: true,
        source: 'choose_yapper_search',
        timestamp: new Date().toISOString()
      });

      // Return existing handle data
      return res.json({
        success: true,
        message: 'Twitter handle already exists',
        data: {
          id: `twitter_${existingHandle.id}`,
          twitter_handle: existingHandle.twitter_handle,
          display_name: existingHandle.display_name || existingHandle.twitter_handle,
          followers_count: existingHandle.followers_count,
          verified: existingHandle.verified,
          profile_image_url: existingHandle.profile_image_url,
          source: 'popular_handles'
        },
        already_exists: true
      });
    }

    // Create new handle metadata
    const newHandle = repository.create({
      twitter_handle: cleanHandle,
      display_name: cleanHandle,
      priority: 5, // Default priority
      status: 'pending' // Will be processed by background service
    });

    await repository.save(newHandle);
    logger.info(`✅ Added new Twitter handle for Choose Yapper: @${cleanHandle}`);

    // Track yapper addition in backend logs
    logger.info(`📊 MIXPANEL_BACKEND_EVENT: yapperAdded`, {
      yapperHandle: cleanHandle,
      yapperDisplayName: cleanHandle,
      addedFromSearch: true,
      alreadyExisted: false,
      source: 'choose_yapper_search',
      timestamp: new Date().toISOString()
    });

    // Try to fetch metadata from Python backend (non-blocking)
    try {
      const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      
      const response = await fetch(`${pythonBackendUrl}/api/twitter-handles/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          handle_ids: [newHandle.id],
          twitter_handles: [cleanHandle],
          last_tweet_ids: [""]
        }),
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (response.ok) {
        const result = await response.json() as any;
        
        if (result.success && result.results && result.results.length > 0) {
          const handleResult = result.results[0];
          
          // Update metadata with fetched data
          await repository.update(newHandle.id, {
            status: 'active',
            followers_count: handleResult.followers_count || 0,
            following_count: handleResult.following_count || 0,
            verified: handleResult.verified || false,
            profile_image_url: handleResult.profile_image_url || null,
            last_tweet_id: handleResult.latest_tweet_id || null,
            last_fetch_at: new Date(),
            fetch_count: 1,
            tweet_count: handleResult.tweets_count || 0
          });

          logger.info(`✅ Successfully fetched metadata for @${cleanHandle}`);
        }
      }
    } catch (fetchError) {
      // Non-blocking - just log the error
      logger.warn(`⚠️ Could not fetch metadata for @${cleanHandle}:`, fetchError);
      // Set status to active anyway so it can be used
      await repository.update(newHandle.id, {
        status: 'active'
      });
    }

    return res.json({
      success: true,
      message: `Successfully added @${cleanHandle} to yapper list`,
      data: {
        id: `twitter_${newHandle.id}`,
        twitter_handle: cleanHandle,
        display_name: cleanHandle,
        followers_count: 0,
        verified: false,
        profile_image_url: null,
        source: 'popular_handles'
      },
      already_exists: false
    });

  } catch (error) {
    logger.error('❌ Error adding Twitter handle for Choose Yapper:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add Twitter handle',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
