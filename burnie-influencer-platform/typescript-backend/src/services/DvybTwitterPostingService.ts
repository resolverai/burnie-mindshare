import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybGeneratedContent } from '../models/DvybGeneratedContent';
import { DvybSchedule } from '../models/DvybSchedule';

export class DvybTwitterPostingService {
  /**
   * Post a single tweet
   */
  static async postTweet(
    accountId: number,
    params: {
      tweetText: string;
      generatedContentId?: number;
      imageUrl?: string;
      videoUrl?: string;
      mediaIds?: string[];
    }
  ): Promise<DvybTwitterPost> {
    try {
      // Get Twitter connection
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId, isActive: true },
      });

      if (!connection || !connection.oauth2AccessToken) {
        throw new Error('No active Twitter connection found');
      }

      // Post to Twitter using OAuth2
      const twitterResponse = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${connection.oauth2AccessToken}`,
        },
        body: JSON.stringify({
          text: params.tweetText,
          ...(params.mediaIds && params.mediaIds.length > 0 && {
            media: { media_ids: params.mediaIds },
          }),
        }),
      });

      if (!twitterResponse.ok) {
        const errorData = await twitterResponse.text();
        throw new Error(`Twitter API error: ${errorData}`);
      }

      const tweetData = await twitterResponse.json() as {
        data: { id: string };
      };
      const tweetId = tweetData.data.id;

      // Save to database
      const postRepo = AppDataSource.getRepository(DvybTwitterPost);
      const post = postRepo.create({
        accountId,
        generatedContentId: params.generatedContentId || null,
        postType: 'single',
        mainTweet: params.tweetText,
        mainTweetId: tweetId,
        imageUrl: params.imageUrl || null,
        videoUrl: params.videoUrl || null,
        twitterMediaIds: params.mediaIds || null,
        engagementMetrics: {},
        postedAt: new Date(),
      });

      await postRepo.save(post);

      // Update generated content if provided
      if (params.generatedContentId) {
        const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
        await contentRepo.update(
          { id: params.generatedContentId },
          { postedAt: new Date() }
        );
      }

      logger.info(`✅ Posted tweet for DVYB account ${accountId}: ${tweetId}`);
      return post;
    } catch (error) {
      logger.error('❌ DVYB tweet posting error:', error);
      throw error;
    }
  }

  /**
   * Post a thread
   */
  static async postThread(
    accountId: number,
    params: {
      tweets: string[];
      generatedContentId?: number;
      mediaUrls?: string[];
    }
  ): Promise<DvybTwitterPost> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId, isActive: true },
      });

      if (!connection || !connection.oauth2AccessToken) {
        throw new Error('No active Twitter connection found');
      }

      const threadTweetIds: string[] = [];
      let previousTweetId: string | null = null;

      // Post each tweet in the thread
      for (let i = 0; i < params.tweets.length; i++) {
        const tweetText = params.tweets[i];

        const twitterResponse = await fetch('https://api.twitter.com/2/tweets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${connection.oauth2AccessToken}`,
          },
          body: JSON.stringify({
            text: tweetText,
            ...(previousTweetId && {
              reply: { in_reply_to_tweet_id: previousTweetId },
            }),
          }),
        });

        if (!twitterResponse.ok) {
          const errorData = await twitterResponse.text();
          throw new Error(`Twitter API error on tweet ${i + 1}: ${errorData}`);
        }

        const tweetData = await twitterResponse.json() as {
          data: { id: string };
        };
        const tweetId = tweetData.data.id;
        threadTweetIds.push(tweetId);
        previousTweetId = tweetId;

        // Small delay to avoid rate limiting
        if (i < params.tweets.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Save to database
      const postRepo = AppDataSource.getRepository(DvybTwitterPost);
      const post = postRepo.create({
        accountId,
        generatedContentId: params.generatedContentId || null,
        postType: 'thread',
        mainTweet: params.tweets[0] || '',
        mainTweetId: threadTweetIds[0] || '',
        tweetThread: params.tweets,
        threadTweetIds: threadTweetIds,
        engagementMetrics: {},
        postedAt: new Date(),
      });

      await postRepo.save(post);

      // Update generated content if provided
      if (params.generatedContentId) {
        const contentRepo = AppDataSource.getRepository(DvybGeneratedContent);
        await contentRepo.update(
          { id: params.generatedContentId },
          { postedAt: new Date() }
        );
      }

      logger.info(`✅ Posted thread for DVYB account ${accountId}: ${threadTweetIds.length} tweets`);
      return post;
    } catch (error) {
      logger.error('❌ DVYB thread posting error:', error);
      throw error;
    }
  }

  /**
   * Schedule a post
   */
  static async schedulePost(
    accountId: number,
    params: {
      scheduledFor: Date;
      generatedContentId?: number;
      platform?: string;
      metadata?: any;
    }
  ): Promise<DvybSchedule> {
    try {
      const scheduleRepo = AppDataSource.getRepository(DvybSchedule);

      const schedule = scheduleRepo.create({
        accountId,
        generatedContentId: params.generatedContentId || null,
        scheduledFor: params.scheduledFor,
        platform: params.platform || 'twitter',
        status: 'pending',
        postMetadata: params.metadata || {},
      });

      await scheduleRepo.save(schedule);

      logger.info(`✅ Scheduled post for DVYB account ${accountId} at ${params.scheduledFor}`);
      return schedule;
    } catch (error) {
      logger.error('❌ DVYB schedule post error:', error);
      throw error;
    }
  }

  /**
   * Get all posts for an account
   */
  static async getAllPosts(accountId: number, limit = 50): Promise<DvybTwitterPost[]> {
    try {
      const postRepo = AppDataSource.getRepository(DvybTwitterPost);
      const posts = await postRepo.find({
        where: { accountId },
        order: { postedAt: 'DESC' },
        take: limit,
      });

      return posts;
    } catch (error) {
      logger.error('❌ Get DVYB posts error:', error);
      throw error;
    }
  }

  /**
   * Get scheduled posts
   */
  static async getScheduledPosts(accountId: number): Promise<DvybSchedule[]> {
    try {
      const scheduleRepo = AppDataSource.getRepository(DvybSchedule);
      const scheduled = await scheduleRepo.find({
        where: { accountId, status: 'pending' },
        order: { scheduledFor: 'ASC' },
      });

      return scheduled;
    } catch (error) {
      logger.error('❌ Get scheduled posts error:', error);
      throw error;
    }
  }

  /**
   * Delete a scheduled post
   */
  static async deleteScheduledPost(accountId: number, scheduleId: number): Promise<void> {
    try {
      const scheduleRepo = AppDataSource.getRepository(DvybSchedule);
      await scheduleRepo.update(
        { id: scheduleId, accountId },
        { status: 'cancelled' }
      );

      logger.info(`✅ Cancelled scheduled post ${scheduleId} for DVYB account ${accountId}`);
    } catch (error) {
      logger.error('❌ Delete scheduled post error:', error);
      throw error;
    }
  }

  /**
   * Fetch engagement metrics for a post
   */
  static async fetchEngagementMetrics(accountId: number, postId: number): Promise<void> {
    try {
      const postRepo = AppDataSource.getRepository(DvybTwitterPost);
      const post = await postRepo.findOne({ where: { id: postId, accountId } });

      if (!post) {
        throw new Error('Post not found');
      }

      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId, isActive: true },
      });

      if (!connection || !connection.oauth2AccessToken) {
        throw new Error('No active Twitter connection');
      }

      // Fetch tweet metrics from Twitter API
      const twitterResponse = await fetch(
        `https://api.twitter.com/2/tweets/${post.mainTweetId}?tweet.fields=public_metrics`,
        {
          headers: {
            Authorization: `Bearer ${connection.oauth2AccessToken}`,
          },
        }
      );

      if (twitterResponse.ok) {
        const tweetData = await twitterResponse.json() as {
          data?: {
            public_metrics?: {
              like_count?: number;
              retweet_count?: number;
              reply_count?: number;
              quote_count?: number;
              impression_count?: number;
            };
          };
        };
        const metrics = tweetData.data?.public_metrics;

        if (metrics) {
          post.engagementMetrics = {
            likes: metrics.like_count || 0,
            retweets: metrics.retweet_count || 0,
            replies: metrics.reply_count || 0,
            quotes: metrics.quote_count || 0,
            impressions: metrics.impression_count || 0,
          };
          post.lastEngagementFetch = new Date();
          await postRepo.save(post);

          logger.info(`✅ Updated engagement metrics for post ${postId}`);
        }
      }
    } catch (error) {
      logger.error('❌ Fetch engagement metrics error:', error);
      throw error;
    }
  }
}

