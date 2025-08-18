/**
 * Intelligence API Routes
 * 
 * Updated to use LeaderboardYapperData instead of separate LeaderboardYapperContentIntelligence table.
 * Content intelligence is now stored in leaderboardYapperData.anthropic_analysis.content_intelligence
 * 
 * Key changes:
 * - Removed /store-yapper-intelligence endpoint (data stored directly in leaderboard flow)
 * - Updated /training-data endpoints to query leaderboard_yapper_data
 * - Updated /patterns endpoint to extract intelligence from anthropic_analysis structure
 */
import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { LeaderboardYapperData } from '../models/LeaderboardYapperData';
import { PlatformYapperTwitterData } from '../models/PlatformYapperTwitterData';
import { PlatformYapperTwitterProfile } from '../models/PlatformYapperTwitterProfile';
import { ContentPerformanceTracking } from '../models/ContentPerformanceTracking';
import { logger } from '../config/logger';

const router = Router();


// Get intelligence data for training ML models
router.get('/training-data/:platform/:model_type', async (req: Request, res: Response) => {
  try {
    const { platform, model_type } = req.params;
    const { limit = 1000 } = req.query;

    logger.info(`📊 Fetching training data for ${platform} ${model_type}`);

    let training_data: any[] = [];

    if (model_type === 'snap_predictor') {
      // Get data for SNAP prediction training from leaderboard_yapper_data
      const query = `
        SELECT 
          lyd.twitterHandle as yapper_twitter_handle,
          lyd.platformSource as platform_source,
          lyd.leaderboardPosition as leaderboard_position,
          lyd.totalSnaps,
          lyd.snaps24h,
          lyd.smartFollowers,
          lyd.followersCount,
          lyd.followingCount,
          lyd.tweetsCount,
          lyd.anthropic_analysis,
          lyd.openai_analysis,
          lyd.recentTweets,
          lyd.tweetImageUrls,
          c.id as campaign_id,
          c.name as campaign_name,
          c.category as campaign_category
        FROM leaderboard_yapper_data lyd
        LEFT JOIN campaigns c ON lyd.campaignId = c.id
        WHERE lyd.platformSource = $1
          AND lyd.twitterFetchStatus = 'completed'
          AND lyd.anthropic_analysis IS NOT NULL
          AND lyd.totalSnaps IS NOT NULL
        ORDER BY lyd.createdAt DESC
        LIMIT $2
      `;

      const result = await AppDataSource.query(query, [platform, limit]);
      training_data = result;

    } else if (model_type === 'position_predictor') {
      // Get data for position change prediction training from leaderboard_yapper_data
      const query = `
        SELECT 
          lyd.twitterHandle as yapper_twitter_handle,
          lyd.platformSource as platform_source,
          lyd.leaderboardPosition as leaderboard_position,
          lyd.totalSnaps,
          lyd.snaps24h,
          lyd.smartFollowers,
          lyd.followersCount,
          lyd.followingCount,
          lyd.tweetsCount,
          lyd.anthropic_analysis,
          lyd.openai_analysis,
          lyd.recentTweets,
          lyd.tweetImageUrls,
          c.id as campaign_id,
          c.name as campaign_name,
          c.category as campaign_category
        FROM leaderboard_yapper_data lyd
        LEFT JOIN campaigns c ON lyd.campaignId = c.id
        WHERE lyd.platformSource = $1
          AND lyd.twitterFetchStatus = 'completed'
          AND lyd.anthropic_analysis IS NOT NULL
          AND lyd.leaderboardPosition IS NOT NULL
        ORDER BY lyd.createdAt DESC
        LIMIT $2
      `;

      const result = await AppDataSource.query(query, [platform, limit]);
      training_data = result;
    }

    // Process the data to extract features
    const processed_data = training_data.map(row => {
      const anthropic_data = typeof row.anthropic_analysis === 'string' 
        ? JSON.parse(row.anthropic_analysis) 
        : row.anthropic_analysis || {};
      
      const recent_tweets = typeof row.recentTweets === 'string'
        ? JSON.parse(row.recentTweets)
        : row.recentTweets || [];

      // Extract content intelligence from anthropic analysis
      const content_intelligence = anthropic_data.content_intelligence || {};
      
      // Calculate engagement metrics from recent tweets
      const total_engagement = recent_tweets.reduce((sum: number, tweet: any) => {
        return sum + (tweet.likes || 0) + (tweet.retweets || 0) + (tweet.replies || 0);
      }, 0);

      return {
        // Target variables (derived from leaderboard data)
        snap_earned: row.totalSnaps || 0,
        position_change: row.leaderboard_position ? (100 - row.leaderboard_position) : 0,
        
        // Content features from LLM analysis
        quality_score: anthropic_data.content_quality_score || content_intelligence.viral_potential_score || 5,
        viral_potential: content_intelligence.viral_potential_score || 5,
        category_relevance: anthropic_data.category_relevance || 5,
        content_length: recent_tweets.length > 0 ? (recent_tweets[0].text || '').length : 0,
        hashtag_count: recent_tweets.length > 0 ? ((recent_tweets[0].text || '').match(/#\w+/g) || []).length : 0,
        
        // Yapper features
        historical_performance: row.totalSnaps || 0,
        followers_count: row.followersCount || 0,
        engagement_rate: row.followersCount > 0 ? (total_engagement / (recent_tweets.length * row.followersCount)) * 100 : 0,
        current_position: row.leaderboard_position || 100,
        
        // Campaign features
        reward_pool: 0, // Not available in leaderboard data
        competition_level: row.leaderboard_position ? 100 - row.leaderboard_position : 50,
        
        // Timing features
        hour_of_day: new Date().getHours(), // Placeholder
        day_of_week: new Date().getDay(), // Placeholder
        
        // Engagement features
        predicted_engagement: total_engagement,
        
        // Platform features
        platform_source: row.platform_source,
        category_classification: content_intelligence.category_classification || 'other',
        
        // Content intelligence signals
        success_factors: content_intelligence.success_factors || {},
        intelligence_signals: content_intelligence.intelligence_signals || {},
        content_themes: content_intelligence.content_themes || []
      };
    });

    res.json({
      success: true,
      training_data: processed_data,
      count: processed_data.length,
      platform,
      model_type
    });

  } catch (error) {
    logger.error('❌ Error fetching training data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch training data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get intelligence patterns for specific platform/category from leaderboard yappers
router.get('/patterns/:platform', async (req: Request, res: Response) => {
  try {
    const { platform } = req.params;
    const { category, limit = 50 } = req.query;

    const leaderboardRepo = AppDataSource.getRepository(LeaderboardYapperData);
    
    const queryBuilder = leaderboardRepo.createQueryBuilder('yapper')
      .where('yapper.platformSource = :platform', { platform })
      .andWhere('yapper.twitterFetchStatus = :status', { status: 'completed' })
      .andWhere('yapper.anthropic_analysis IS NOT NULL');

    // Filter top performers (position <= 50)
    queryBuilder.andWhere('yapper.leaderboardPosition <= :maxPosition', { maxPosition: 50 });

    const yappers = await queryBuilder
      .orderBy('yapper.leaderboardPosition', 'ASC')
      .addOrderBy('yapper.createdAt', 'DESC')
      .limit(Number(limit))
      .getMany();

    // Aggregate patterns from content intelligence in anthropic analysis
    const aggregated_patterns: {
      trending_themes: Record<string, number>;
      viral_patterns: Record<string, number>;
      engagement_hooks: Record<string, number>;
      content_themes: Record<string, number>;
      category_distribution: Record<string, number>;
      success_factors: Record<string, number>;
    } = {
      trending_themes: {},
      viral_patterns: {},
      engagement_hooks: {},
      content_themes: {},
      category_distribution: {},
      success_factors: {}
    };

    yappers.forEach(yapper => {
      // Extract patterns from anthropic analysis content_intelligence
      if (yapper.anthropic_analysis) {
        try {
          const analysis = typeof yapper.anthropic_analysis === 'string' 
            ? JSON.parse(yapper.anthropic_analysis) 
            : yapper.anthropic_analysis;

          const content_intelligence = analysis.content_intelligence || {};

          // Aggregate content themes
          if (content_intelligence.content_themes) {
            content_intelligence.content_themes.forEach((theme: string) => {
              aggregated_patterns.content_themes[theme] = 
                (aggregated_patterns.content_themes[theme] || 0) + 1;
            });
          }

          // Aggregate viral elements from success factors
          if (content_intelligence.success_factors?.viral_elements) {
            content_intelligence.success_factors.viral_elements.forEach((element: string) => {
              aggregated_patterns.viral_patterns[element] = 
                (aggregated_patterns.viral_patterns[element] || 0) + 1;
            });
          }

          // Aggregate engagement triggers from intelligence signals
          if (content_intelligence.intelligence_signals?.engagement_triggers) {
            content_intelligence.intelligence_signals.engagement_triggers.forEach((hook: string) => {
              aggregated_patterns.engagement_hooks[hook] = 
                (aggregated_patterns.engagement_hooks[hook] || 0) + 1;
            });
          }

          // Aggregate trending themes from intelligence signals
          if (content_intelligence.intelligence_signals?.trending_themes) {
            content_intelligence.intelligence_signals.trending_themes.forEach((theme: string) => {
              aggregated_patterns.trending_themes[theme] = 
                (aggregated_patterns.trending_themes[theme] || 0) + 1;
            });
          }

          // Category distribution
          if (content_intelligence.category_classification) {
            aggregated_patterns.category_distribution[content_intelligence.category_classification] = 
              (aggregated_patterns.category_distribution[content_intelligence.category_classification] || 0) + 1;
          }

          // Success factors aggregation
          if (content_intelligence.success_factors?.platform_optimization) {
            content_intelligence.success_factors.platform_optimization.forEach((factor: string) => {
              aggregated_patterns.success_factors[factor] = 
                (aggregated_patterns.success_factors[factor] || 0) + 1;
            });
          }

        } catch (e) {
          logger.warn('Failed to parse anthropic analysis:', e);
        }
      }
    });

    res.json({
      success: true,
      platform,
      category: category || 'all',
      patterns: aggregated_patterns,
      sample_size: yappers.length,
      note: 'Patterns extracted from top-performing leaderboard yappers (position <= 50)'
    });

  } catch (error) {
    logger.error('❌ Error fetching intelligence patterns:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch intelligence patterns',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Store platform yapper Twitter data
router.post('/store-platform-yapper-data', async (req: Request, res: Response) => {
  try {
    const twitterDataRepo = AppDataSource.getRepository(PlatformYapperTwitterData);
    
    const twitterData = twitterDataRepo.create(req.body);
    const savedData = await twitterDataRepo.save(twitterData);

    return res.json({
      success: true,
      message: 'Platform yapper Twitter data stored successfully',
      data_id: (savedData as any).id
    });

  } catch (error) {
    logger.error('❌ Error storing platform yapper data:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store platform yapper data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Check leaderboard presence for a yapper
router.get('/leaderboard-presence', async (req: Request, res: Response) => {
  try {
    const { twitter_handle } = req.query;

    if (!twitter_handle) {
      return res.status(400).json({
        success: false,
        message: 'twitter_handle parameter is required'
      });
    }

    // Query leaderboard data for this yapper
    const query = `
      SELECT 
        platform_source,
        COUNT(*) as total_campaigns,
        AVG(CAST(position_rank AS FLOAT)) as avg_position,
        MIN(CAST(position_rank AS FLOAT)) as best_position,
        SUM(CASE WHEN snap_earned IS NOT NULL THEN snap_earned ELSE 0 END) as total_snap
      FROM leaderboard_yapper_data 
      WHERE yapper_twitter_handle = $1
      GROUP BY platform_source
    `;

    const results: any[] = await AppDataSource.query(query, [twitter_handle]);

    let present = results.length > 0;
    let platforms = results.map((r: any) => r.platform_source);
    let avg_position = null;
    let best_position = null;
    let total_campaigns = 0;
    let total_snap = 0;

    if (present) {
      // Calculate overall averages
      avg_position = results.reduce((sum: number, r: any) => sum + (r.avg_position || 0), 0) / results.length;
      best_position = Math.min(...results.map((r: any) => r.best_position || 100));
      total_campaigns = results.reduce((sum: number, r: any) => sum + (r.total_campaigns || 0), 0);
      total_snap = results.reduce((sum: number, r: any) => sum + (r.total_snap || 0), 0);
    }

    return res.json({
      success: true,
      present,
      platforms,
      avg_position: avg_position ? Math.round(avg_position) : null,
      best_position: best_position !== Infinity ? best_position : null,
      total_campaigns,
      total_snap
    });

  } catch (error) {
    logger.error('❌ Error checking leaderboard presence:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check leaderboard presence',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get yapper profile for predictions
router.get('/yapper-profile/:yapper_id', async (req: Request, res: Response) => {
  try {
    const { yapper_id } = req.params;

    const profileRepo = AppDataSource.getRepository(PlatformYapperTwitterProfile);
    
    if (!yapper_id) {
      return res.status(400).json({
        success: false,
        message: 'yapper_id parameter is required'
      });
    }

    const profile = await profileRepo.findOne({
      where: { yapper_id: parseInt(yapper_id) }
    });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Yapper profile not found'
      });
    }

    return res.json({
      success: true,
      profile
    });

  } catch (error) {
    logger.error('❌ Error getting yapper profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get yapper profile',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update platform yapper Twitter profile
router.post('/update-platform-yapper-profile', async (req: Request, res: Response) => {
  try {
    const profileRepo = AppDataSource.getRepository(PlatformYapperTwitterProfile);
    
    const existingProfile = await profileRepo.findOne({
      where: { yapper_id: req.body.yapper_id }
    });

    if (existingProfile) {
      await profileRepo.update(
        { yapper_id: req.body.yapper_id },
        { ...req.body, last_updated: new Date() }
      );
    } else {
      const profile = profileRepo.create(req.body);
      await profileRepo.save(profile);
    }

    res.json({
      success: true,
      message: 'Platform yapper profile updated successfully'
    });

  } catch (error) {
    logger.error('❌ Error updating platform yapper profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update platform yapper profile',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
