import { AppDataSource } from '../config/database';
import { UserTwitterPost } from '../models/UserTwitterPost';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { User } from '../models/User';
import { logger } from '../config/logger';
import fetch from 'node-fetch';

interface TwitterEngagementMetrics {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views?: number;
}

interface TwitterApiTweetResponse {
  data?: {
    id: string;
    public_metrics: {
      like_count: number;
      retweet_count: number;
      reply_count: number;
      quote_count: number;
      impression_count?: number;
    };
  };
  errors?: Array<{
    detail: string;
    type: string;
    title: string;
  }>;
}

export class TwitterEngagementService {
  
  /**
   * Fetch engagement metrics for a single tweet
   */
  private async fetchTweetEngagement(
    tweetId: string, 
    accessToken: string
  ): Promise<TwitterEngagementMetrics | null> {
    try {
      const url = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'BurnieAI/1.0'
        }
      });

      if (!response.ok) {
        logger.error(`❌ Twitter API error for tweet ${tweetId}: ${response.status}`);
        return null;
      }

      const data = await response.json() as TwitterApiTweetResponse;
      
      if (data.errors) {
        logger.error(`❌ Twitter API errors for tweet ${tweetId}:`, data.errors);
        return null;
      }

      if (!data.data?.public_metrics) {
        logger.warn(`⚠️ No public metrics found for tweet ${tweetId}`);
        return null;
      }

      const metrics = data.data.public_metrics;
      
      return {
        likes: metrics.like_count || 0,
        retweets: metrics.retweet_count || 0,
        replies: metrics.reply_count || 0,
        quotes: metrics.quote_count || 0,
        views: metrics.impression_count || 0
      };

    } catch (error) {
      logger.error(`❌ Error fetching engagement for tweet ${tweetId}:`, error);
      return null;
    }
  }

  /**
   * Fetch engagement metrics for multiple tweets in batch
   */
  private async fetchBatchTweetEngagement(
    tweetIds: string[], 
    accessToken: string
  ): Promise<Record<string, TwitterEngagementMetrics>> {
    const results: Record<string, TwitterEngagementMetrics> = {};
    
    // Twitter API allows up to 100 tweet IDs per request
    const batchSize = 100;
    
    for (let i = 0; i < tweetIds.length; i += batchSize) {
      const batch = tweetIds.slice(i, i + batchSize);
      
      try {
        const url = `https://api.twitter.com/2/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics`;
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'BurnieAI/1.0'
          }
        });

        if (!response.ok) {
          logger.error(`❌ Twitter API batch error: ${response.status}`);
          continue;
        }

        const data = await response.json() as { data?: Array<{
          id: string;
          public_metrics: {
            like_count: number;
            retweet_count: number;
            reply_count: number;
            quote_count: number;
            impression_count?: number;
          };
        }> };

        if (data.data) {
          data.data.forEach(tweet => {
            const metrics = tweet.public_metrics;
            results[tweet.id] = {
              likes: metrics.like_count || 0,
              retweets: metrics.retweet_count || 0,
              replies: metrics.reply_count || 0,
              quotes: metrics.quote_count || 0,
              views: metrics.impression_count || 0
            };
          });
        }

        // Rate limiting: wait 1 second between batches
        if (i + batchSize < tweetIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        logger.error(`❌ Error fetching batch engagement:`, error);
      }
    }
    
    return results;
  }

  /**
   * Get Twitter connection for a wallet address
   */
  private async getTwitterConnection(walletAddress: string): Promise<YapperTwitterConnection | null> {
    try {
      const userRepository = AppDataSource.getRepository(User);
      const twitterRepository = AppDataSource.getRepository(YapperTwitterConnection);

      // Find user by wallet address
      const user = await userRepository.findOne({
        where: { walletAddress: walletAddress.toLowerCase() }
      });

      if (!user) {
        logger.warn(`⚠️ User not found for wallet address: ${walletAddress}`);
        return null;
      }

      // Find Twitter connection
      const connection = await twitterRepository.findOne({
        where: { userId: user.id, isConnected: true }
      });

      if (!connection || !connection.hasValidToken()) {
        logger.warn(`⚠️ No valid Twitter connection for wallet: ${walletAddress}`);
        return null;
      }

      return connection;
    } catch (error) {
      logger.error(`❌ Error getting Twitter connection for ${walletAddress}:`, error);
      return null;
    }
  }

  /**
   * Update engagement metrics for a single post
   */
  public async updatePostEngagement(postId: number): Promise<boolean> {
    try {
      const postRepository = AppDataSource.getRepository(UserTwitterPost);
      
      const post = await postRepository.findOne({
        where: { id: postId }
      });

      if (!post) {
        logger.error(`❌ Post not found: ${postId}`);
        return false;
      }

      const connection = await this.getTwitterConnection(post.walletAddress);
      if (!connection) {
        return false;
      }

      // Collect all tweet IDs (main tweet + thread tweets)
      const tweetIds = [post.mainTweetId];
      if (post.threadTweetIds) {
        tweetIds.push(...post.threadTweetIds.filter(id => id !== post.mainTweetId));
      }

      // Fetch engagement metrics
      const engagementData = await this.fetchBatchTweetEngagement(tweetIds, connection.accessToken!);
      
      // Update engagement metrics with timestamp
      const updatedMetrics: Record<string, any> = {};
      const timestamp = new Date().toISOString();
      
      Object.entries(engagementData).forEach(([tweetId, metrics]) => {
        updatedMetrics[tweetId] = {
          ...metrics,
          last_updated: timestamp
        };
      });

      // Update post with new engagement data
      post.engagementMetrics = updatedMetrics;
      post.lastEngagementFetch = new Date();
      
      await postRepository.save(post);
      
      logger.info(`✅ Updated engagement metrics for post ${postId} (${Object.keys(updatedMetrics).length} tweets)`);
      return true;

    } catch (error) {
      logger.error(`❌ Error updating engagement for post ${postId}:`, error);
      return false;
    }
  }

  /**
   * Update engagement metrics for all posts by a wallet address
   */
  public async updateUserEngagement(walletAddress: string): Promise<{
    success: boolean;
    updatedPosts: number;
    totalPosts: number;
  }> {
    try {
      const postRepository = AppDataSource.getRepository(UserTwitterPost);
      
      // Get all posts for the user
      const posts = await postRepository.find({
        where: { walletAddress: walletAddress.toLowerCase() },
        order: { postedAt: 'DESC' }
      });

      if (posts.length === 0) {
        return { success: true, updatedPosts: 0, totalPosts: 0 };
      }

      const connection = await this.getTwitterConnection(walletAddress);
      if (!connection) {
        return { success: false, updatedPosts: 0, totalPosts: posts.length };
      }

      // Collect all tweet IDs from all posts
      const allTweetIds: string[] = [];
      const postTweetMapping: Record<string, number> = {}; // tweetId -> postId
      
      posts.forEach(post => {
        allTweetIds.push(post.mainTweetId);
        postTweetMapping[post.mainTweetId] = post.id;
        
        if (post.threadTweetIds) {
          post.threadTweetIds.forEach(tweetId => {
            if (tweetId !== post.mainTweetId) {
              allTweetIds.push(tweetId);
              postTweetMapping[tweetId] = post.id;
            }
          });
        }
      });

      logger.info(`📊 Fetching engagement for ${allTweetIds.length} tweets across ${posts.length} posts`);

      // Fetch all engagement data in batches
      const allEngagementData = await this.fetchBatchTweetEngagement(allTweetIds, connection.accessToken!);
      
      // Group engagement data by post
      const postEngagementData: Record<number, Record<string, any>> = {};
      const timestamp = new Date().toISOString();
      
      Object.entries(allEngagementData).forEach(([tweetId, metrics]) => {
        const postId = postTweetMapping[tweetId];
        if (!postEngagementData[postId]) {
          postEngagementData[postId] = {};
        }
        postEngagementData[postId][tweetId] = {
          ...metrics,
          last_updated: timestamp
        };
      });

      // Update all posts
      let updatedCount = 0;
      const updateTime = new Date();
      
      for (const post of posts) {
        if (postEngagementData[post.id]) {
          post.engagementMetrics = postEngagementData[post.id];
          post.lastEngagementFetch = updateTime;
          await postRepository.save(post);
          updatedCount++;
        }
      }

      logger.info(`✅ Updated engagement metrics for ${updatedCount}/${posts.length} posts for wallet ${walletAddress}`);
      
      return {
        success: true,
        updatedPosts: updatedCount,
        totalPosts: posts.length
      };

    } catch (error) {
      logger.error(`❌ Error updating user engagement for ${walletAddress}:`, error);
      return { success: false, updatedPosts: 0, totalPosts: 0 };
    }
  }

  /**
   * Get posts with engagement metrics for a wallet address
   */
  public async getUserPostsWithEngagement(walletAddress: string): Promise<UserTwitterPost[]> {
    try {
      const postRepository = AppDataSource.getRepository(UserTwitterPost);
      
      const posts = await postRepository.find({
        where: { walletAddress: walletAddress.toLowerCase() },
        order: { postedAt: 'DESC' },
        relations: ['content']
      });

      return posts;
    } catch (error) {
      logger.error(`❌ Error getting user posts for ${walletAddress}:`, error);
      return [];
    }
  }
}

export const twitterEngagementService = new TwitterEngagementService();
