import { Router, Request, Response } from 'express';

// Extend Request type to include user
interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    walletAddress: string;
    username?: string;
  };
}
import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { YapperCookieProfile } from '../models/YapperCookieProfile';
import { logger } from '../config/logger';

const router = Router();

// Store yapper profile data extracted from snapshots
router.post('/store', async (req: Request, res: Response): Promise<Response> => {
  try {
    const {
      snapshot_id,
      yapper_twitter_handle,
      display_name,
      snapshot_date,
      
      // Core metrics (7D focus)
      total_snaps_7d,
      total_snaps_30d,
      total_snaps_90d,
      total_snaps_ytd,
      mindshare_percent,
      mindshare_percent_ytd,
      smart_followers_7d,
      smart_engagement,
      
      // Token sentiment
      token_sentiments,
      bullish_tokens,
      bearish_tokens,
      
      // Badges and achievements
      badges,
      total_badges,
      
      // Social graph
      social_graph,
      network_connections,
      
      // Trends
      mindshare_history,
      smart_followers_trend,
      
      // Metadata
      processing_status,
      extraction_confidence,
      llm_provider,
      extraction_notes
    } = req.body;

    if (!yapper_twitter_handle || !snapshot_date) {
      return res.status(400).json({
        success: false,
        message: 'yapper_twitter_handle and snapshot_date are required'
      });
    }

    const repository: Repository<YapperCookieProfile> = AppDataSource.getRepository(YapperCookieProfile);

    // Clean up Twitter handle (remove @ if present)
    const cleanHandle = yapper_twitter_handle.replace(/^@/, '');

    // Check if profile already exists for this handle and date
    const existingProfile = await repository.findOne({
      where: {
        twitterHandle: cleanHandle,
        snapshotDate: new Date(snapshot_date)
      }
    });

    let profile: YapperCookieProfile;

    if (existingProfile) {
      // Update existing profile
      profile = existingProfile;
      logger.info(`📝 Updating existing yapper profile for @${cleanHandle} on ${snapshot_date}`);
    } else {
      // Create new profile
      profile = new YapperCookieProfile();
      profile.twitterHandle = cleanHandle;
      profile.snapshotDate = new Date(snapshot_date);
      logger.info(`✨ Creating new yapper profile for @${cleanHandle} on ${snapshot_date}`);
    }

    // Update all fields
    profile.displayName = display_name || profile.displayName;
    
    // Core metrics
    profile.totalSnaps7d = total_snaps_7d !== undefined ? total_snaps_7d : profile.totalSnaps7d;
    profile.totalSnaps30d = total_snaps_30d !== undefined ? total_snaps_30d : profile.totalSnaps30d;
    profile.totalSnaps90d = total_snaps_90d !== undefined ? total_snaps_90d : profile.totalSnaps90d;
    profile.totalSnapsYtd = total_snaps_ytd !== undefined ? total_snaps_ytd : profile.totalSnapsYtd;
    profile.mindsharePercent = mindshare_percent !== undefined ? mindshare_percent : profile.mindsharePercent;
    profile.mindsharePercentYtd = mindshare_percent_ytd !== undefined ? mindshare_percent_ytd : profile.mindsharePercentYtd;
    profile.smartFollowers7d = smart_followers_7d !== undefined ? smart_followers_7d : profile.smartFollowers7d;
    profile.smartEngagement = smart_engagement !== undefined ? smart_engagement : profile.smartEngagement;

    // Token sentiment
    profile.tokenSentiments = token_sentiments || profile.tokenSentiments;
    profile.bullishTokens = bullish_tokens || profile.bullishTokens;
    profile.bearishTokens = bearish_tokens || profile.bearishTokens;

    // Badges
    profile.badges = badges || profile.badges;
    profile.totalBadges = total_badges !== undefined ? total_badges : profile.totalBadges;
    
    if (badges && Array.isArray(badges)) {
      profile.badgeTypes = badges.map((badge: any) => badge.type).filter((type: any) => type);
    }

    // Social graph
    profile.socialGraph = social_graph || profile.socialGraph;
    profile.socialGraphSize = network_connections !== undefined ? network_connections : profile.socialGraphSize;
    
    if (social_graph?.connections) {
      profile.socialGraphSize = social_graph.connections.length;
    }

    // Calculate network centrality if social graph available
    if (social_graph?.connections && Array.isArray(social_graph.connections)) {
      // Simple network centrality calculation based on connection strength
      const strongConnections = social_graph.connections.filter((conn: any) => 
        conn.connection_strength === 'strong'
      ).length;
      const totalConnections = social_graph.connections.length;
      profile.networkCentrality = totalConnections > 0 ? strongConnections / totalConnections : 0;
    }

    // Trends
    profile.mindshareHistory = mindshare_history || profile.mindshareHistory;
    profile.smartFollowersTrend = smart_followers_trend || profile.smartFollowersTrend;

    // Calculate average mindshare if history available
    if (mindshare_history && Array.isArray(mindshare_history) && mindshare_history.length > 0) {
      const avgMindshare = mindshare_history.reduce((sum: number, entry: any) => 
        sum + (entry.value || 0), 0
      ) / mindshare_history.length;
      profile.avgMindshare7d = avgMindshare;
    }

    // Calculate influence score (simple algorithm)
    profile.influenceScore = profile.getProfileScore();

    // Metadata
    profile.processingStatus = processing_status || 'completed';
    profile.extractionNotes = extraction_notes || profile.extractionNotes;

    // Save to database
    const savedProfile = await repository.save(profile);

    logger.info(`✅ Yapper profile saved successfully: ID ${savedProfile.id}, @${cleanHandle}, Score: ${savedProfile.influenceScore}`);

    return res.json({
      success: true,
      message: 'Yapper profile stored successfully',
      profile_id: savedProfile.id,
      yapper_handle: cleanHandle,
      snapshot_date: snapshot_date,
      profile_score: savedProfile.influenceScore,
      extraction_confidence: extraction_confidence,
      llm_provider: llm_provider
    });

  } catch (error) {
    logger.error('❌ Error storing yapper profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store yapper profile',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get yapper profile by handle and date
router.get('/:handle/:date', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { handle, date } = req.params;
    
    if (!handle || !date) {
      return res.status(400).json({
        success: false,
        message: 'Handle and date parameters are required'
      });
    }
    
    const cleanHandle = handle.replace(/^@/, '');

    const repository: Repository<YapperCookieProfile> = AppDataSource.getRepository(YapperCookieProfile);

    const profile = await repository.findOne({
      where: {
        twitterHandle: cleanHandle,
        snapshotDate: new Date(date)
      }
    });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Yapper profile not found'
      });
    }

    return res.json({
      success: true,
      profile: {
        id: profile.id,
        twitter_handle: profile.twitterHandle,
        display_name: profile.displayName,
        snapshot_date: profile.snapshotDate.toISOString().split('T')[0],
        
        // Core metrics
        total_snaps_7d: profile.totalSnaps7d,
        mindshare_percent: profile.mindsharePercent,
        smart_followers_7d: profile.smartFollowers7d,
        smart_engagement: profile.smartEngagement,
        
        // Token sentiment
        token_sentiments: profile.tokenSentiments,
        bullish_tokens: profile.bullishTokens,
        bearish_tokens: profile.bearishTokens,
        dominant_sentiment: profile.getDominantSentiment(),
        
        // Badges
        badges: profile.badges,
        total_badges: profile.totalBadges,
        
        // Social network
        social_graph: profile.socialGraph,
        network_centrality: profile.networkCentrality,
        influence_score: profile.influenceScore,
        
        // Insights
        engagement_category: profile.getEngagementCategory(),
        profile_score: profile.getProfileScore(),
        content_insights: profile.getContentInsights(),
        data_freshness: profile.isDataFresh(),
        
        // Metadata
        created_at: profile.createdAt,
        updated_at: profile.updatedAt
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching yapper profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch yapper profile',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get all profiles for a yapper (timeline)
router.get('/:handle/timeline', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { handle } = req.params;
    const { limit = 30, days = 90 } = req.query;
    
    if (!handle) {
      return res.status(400).json({
        success: false,
        message: 'Handle parameter is required'
      });
    }
    
    const cleanHandle = handle.replace(/^@/, '');

    const repository: Repository<YapperCookieProfile> = AppDataSource.getRepository(YapperCookieProfile);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days as string));

    const profiles = await repository
      .createQueryBuilder('profile')
      .where('profile.twitterHandle = :handle', { handle: cleanHandle })
      .andWhere('profile.snapshotDate >= :cutoffDate', { cutoffDate })
      .orderBy('profile.snapshotDate', 'DESC')
      .take(parseInt(limit as string))
      .getMany();

    // Add derived metrics for timeline analysis
    const timeline = profiles.map((profile, index) => {
      const prevProfile = profiles[index + 1];
      let growthMetrics = {};

      if (prevProfile) {
        growthMetrics = {
          mindshare_growth: profile.mindsharePercent && prevProfile.mindsharePercent 
            ? ((profile.mindsharePercent - prevProfile.mindsharePercent) / prevProfile.mindsharePercent * 100)
            : null,
          followers_growth: profile.smartFollowers7d && prevProfile.smartFollowers7d
            ? profile.smartFollowers7d - prevProfile.smartFollowers7d
            : null,
          snaps_growth: profile.totalSnaps7d && prevProfile.totalSnaps7d
            ? profile.totalSnaps7d - prevProfile.totalSnaps7d
            : null
        };
      }

      return {
        snapshot_date: profile.snapshotDate.toISOString().split('T')[0],
        mindshare_percent: profile.mindsharePercent,
        smart_followers_7d: profile.smartFollowers7d,
        total_snaps_7d: profile.totalSnaps7d,
        profile_score: profile.getProfileScore(),
        engagement_category: profile.getEngagementCategory(),
        ...growthMetrics
      };
    });

    return res.json({
      success: true,
      yapper_handle: cleanHandle,
      timeline_length: timeline.length,
      date_range: {
        latest: timeline[0]?.snapshot_date,
        earliest: timeline[timeline.length - 1]?.snapshot_date
      },
      timeline
    });

  } catch (error) {
    logger.error('❌ Error fetching yapper timeline:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch yapper timeline',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get top yappers by various metrics
router.get('/leaderboard/:metric', async (req: Request, res: Response): Promise<Response> => {
  try {
    const { metric } = req.params;
    const { limit = 50, date } = req.query;

    const repository: Repository<YapperCookieProfile> = AppDataSource.getRepository(YapperCookieProfile);

    let orderBy: any = {};
    
    switch (metric) {
      case 'mindshare':
        orderBy = { mindsharePercent: 'DESC' };
        break;
      case 'engagement':
        orderBy = { smartEngagement: 'DESC' };
        break;
      case 'influence':
        orderBy = { influenceScore: 'DESC' };
        break;
      case 'snaps':
        orderBy = { totalSnaps7d: 'DESC' };
        break;
      case 'followers':
        orderBy = { smartFollowers7d: 'DESC' };
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid metric. Use: mindshare, engagement, influence, snaps, followers'
        });
    }

    const queryBuilder = repository.createQueryBuilder('profile')
      .orderBy(`profile.${Object.keys(orderBy)[0]}`, Object.values(orderBy)[0] as 'ASC' | 'DESC')
      .take(parseInt(limit as string));

    if (date) {
      queryBuilder.where('profile.snapshotDate = :date', { date });
    } else {
      // Get latest snapshot for each yapper
      queryBuilder.distinctOn(['profile.twitterHandle'])
        .orderBy('profile.twitterHandle')
        .addOrderBy('profile.snapshotDate', 'DESC');
    }

    const profiles = await queryBuilder.getMany();

    const leaderboard = profiles.map((profile, index) => ({
      rank: index + 1,
      twitter_handle: profile.twitterHandle,
      display_name: profile.displayName,
      snapshot_date: profile.snapshotDate.toISOString().split('T')[0],
      metric_value: profile[Object.keys(orderBy)[0] as keyof YapperCookieProfile],
      profile_score: profile.getProfileScore(),
      engagement_category: profile.getEngagementCategory(),
      dominant_sentiment: profile.getDominantSentiment(),
      total_badges: profile.totalBadges
    }));

    return res.json({
      success: true,
      metric,
      leaderboard_size: leaderboard.length,
      date_filter: date || 'latest',
      leaderboard
    });

  } catch (error) {
    logger.error('❌ Error fetching yapper leaderboard:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch yapper leaderboard',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
