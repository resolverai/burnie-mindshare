import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { PlatformYapperTwitterData } from '../models/PlatformYapperTwitterData';
import { PlatformYapperTwitterProfile } from '../models/PlatformYapperTwitterProfile';
import { logger } from '../config/logger';

const router = Router();

// Store platform yapper profile data
router.post('/platform-yapper-profile', async (req: Request, res: Response) => {
  try {
    const { yapper_id, twitter_user_id, profile_data, updated_at } = req.body;

    if (!yapper_id || !twitter_user_id || !profile_data) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: yapper_id, twitter_user_id, profile_data'
      });
    }

    const profileRepo = AppDataSource.getRepository(PlatformYapperTwitterProfile);

    // Check if profile already exists
    let profile = await profileRepo.findOne({
      where: { yapper_id }
    });

    if (profile) {
      // Update existing profile
      profile.twitter_handle = profile_data.username;
      profile.followers_count = profile_data.public_metrics?.followers_count || 0;
      profile.following_count = profile_data.public_metrics?.following_count || 0;
      profile.tweet_count = profile_data.public_metrics?.tweet_count || 0;
      profile.verified = profile_data.verified || false;

      await profileRepo.save(profile);
      logger.info(`✅ Updated profile for platform yapper ${yapper_id} (@${profile_data.username})`);
    } else {
      // Create new profile
      profile = new PlatformYapperTwitterProfile();
      profile.yapper_id = yapper_id;
      profile.twitter_handle = profile_data.username;
      profile.followers_count = profile_data.public_metrics?.followers_count || 0;
      profile.following_count = profile_data.public_metrics?.following_count || 0;
      profile.tweet_count = profile_data.public_metrics?.tweet_count || 0;
      profile.verified = profile_data.verified || false;

      await profileRepo.save(profile);
      logger.info(`✅ Created profile for platform yapper ${yapper_id} (@${profile_data.username})`);
    }

    return res.json({
      success: true,
      message: 'Profile data stored successfully',
      profile_id: profile.id
    });

  } catch (error) {
    logger.error('❌ Error storing platform yapper profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store profile data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Store platform yapper tweet data
router.post('/platform-yapper-tweets', async (req: Request, res: Response) => {
  try {
    const { yapper_id, twitter_user_id, twitter_username, tweets, llm_analysis, collected_at } = req.body;

    if (!yapper_id || !twitter_user_id || !twitter_username || !tweets || !Array.isArray(tweets)) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: yapper_id, twitter_user_id, twitter_username, tweets (array)'
      });
    }

    const twitterDataRepo = AppDataSource.getRepository(PlatformYapperTwitterData);
    let tweetsStored = 0;

    for (const tweet of tweets) {
      try {
        // Check if tweet already exists
        const existingTweet = await twitterDataRepo.findOne({
          where: { yapper_id, tweet_id: tweet.id }
        });

        if (existingTweet) {
          logger.debug(`⏭️ Tweet ${tweet.id} already exists for yapper ${yapper_id}, skipping`);
          continue;
        }

        // Create new tweet record
        const twitterData = new PlatformYapperTwitterData();
        twitterData.yapper_id = yapper_id;
        twitterData.twitter_handle = twitter_username; // Use the actual Twitter username
        twitterData.tweet_id = tweet.id;
        twitterData.tweet_text = tweet.text;
        twitterData.posted_at = new Date(tweet.created_at);
        
        // Store engagement metrics
        twitterData.engagement_metrics = {
          like_count: tweet.public_metrics?.like_count || 0,
          retweet_count: tweet.public_metrics?.retweet_count || 0,
          reply_count: tweet.public_metrics?.reply_count || 0,
          quote_count: tweet.public_metrics?.quote_count || 0,
          impression_count: tweet.public_metrics?.impression_count || null
        };

        // Store thread information
        twitterData.is_thread = tweet.conversation_id !== tweet.id;
        if (tweet.conversation_id && tweet.conversation_id !== tweet.id) {
          twitterData.parent_tweet_id = tweet.conversation_id;
        }

        // Store comprehensive LLM analysis if available
        if (llm_analysis && llm_analysis.success) {
          if (llm_analysis.provider_used === 'anthropic') {
            twitterData.anthropic_analysis = llm_analysis.anthropic_analysis;
          } else if (llm_analysis.provider_used === 'openai') {
            twitterData.openai_analysis = llm_analysis.openai_analysis;
          }
        }

        await twitterDataRepo.save(twitterData);
        tweetsStored++;

      } catch (tweetError) {
        logger.error(`❌ Error storing tweet ${tweet.id} for yapper ${yapper_id}:`, tweetError);
        continue;
      }
    }

    logger.info(`✅ Stored ${tweetsStored}/${tweets.length} tweets for platform yapper ${yapper_id}`);

    return res.json({
      success: true,
      message: `Stored ${tweetsStored} tweets successfully`,
      tweets_stored: tweetsStored,
      total_tweets: tweets.length
    });

  } catch (error) {
    logger.error('❌ Error storing platform yapper tweets:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store tweet data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get platform yapper Twitter data statistics
router.get('/platform-yapper-stats/:yapperId', async (req: Request, res: Response) => {
  try {
    const yapperIdParam = req.params.yapperId;
    if (!yapperIdParam) {
      return res.status(400).json({
        success: false,
        message: 'Yapper ID is required'
      });
    }

    const yapperId = parseInt(yapperIdParam);
    if (isNaN(yapperId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid yapper ID'
      });
    }

    const twitterDataRepo = AppDataSource.getRepository(PlatformYapperTwitterData);
    const profileRepo = AppDataSource.getRepository(PlatformYapperTwitterProfile);

    const tweetCount = await twitterDataRepo.count({
      where: { yapper_id: yapperId }
    });

    const profile = await profileRepo.findOne({
      where: { yapper_id: yapperId }
    });

    const latestTweet = await twitterDataRepo.findOne({
      where: { yapper_id: yapperId },
      order: { posted_at: 'DESC' }
    });

    return res.json({
      success: true,
      stats: {
        yapper_id: yapperId,
        total_tweets: tweetCount,
        profile_exists: !!profile,
        last_data_collection: latestTweet?.posted_at?.toISOString() || null,
        profile_last_updated: profile?.last_updated?.toISOString() || null,
        twitter_handle: profile?.twitter_handle || null,
        followers_count: profile?.followers_count || 0
      }
    });

  } catch (error) {
    logger.error(`❌ Error getting stats for yapper ${req.params.yapperId}:`, error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get statistics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
