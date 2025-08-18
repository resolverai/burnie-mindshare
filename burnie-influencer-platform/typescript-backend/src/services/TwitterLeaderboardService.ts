import { logger } from '../config/logger';
import { env } from '../config/env';

export interface TwitterProfile {
  id: string;
  screen_name: string;
  name: string;
  description?: string;
  followers_count: number;
  following_count: number;
  tweets_count: number;
  verified: boolean;
  created_at?: string;
  profile_image_url?: string;
  location?: string;
  url?: string;
}

export interface TwitterTweet {
  id: string;
  text: string;
  created_at: string;
  likes: number;
  retweets: number;
  replies: number;
  hashtags: string[];
  mentions: string[];
  urls: string[];
  media: Array<{
    type: string;
    url: string;
    display_url: string;
  }>;
}

export interface TwitterEngagementMetrics {
  engagement_rate: number;
  avg_likes: number;
  avg_retweets: number;
  avg_replies: number;
  total_engagement: number;
  tweets_analyzed: number;
}

export interface TwitterFetchResult {
  success: boolean;
  twitter_handle?: string;
  yapper_name?: string;
  profile?: TwitterProfile;
  recent_tweets?: TwitterTweet[];
  tweet_image_urls?: string[];
  engagement_metrics?: TwitterEngagementMetrics;
  fetch_timestamp?: string;
  tweets_count?: number;
  images_count?: number;
  error?: string;
  retry_after?: number;
}

export class TwitterLeaderboardService {
  private pythonBackendUrl: string;

  constructor() {
    this.pythonBackendUrl = env.ai.pythonBackendUrl;
    if (!this.pythonBackendUrl) {
      throw new Error('PYTHON_AI_BACKEND_URL environment variable is required');
    }
  }

  /**
   * Fetch Twitter data for a yapper using the Python backend service
   */
  async fetchYapperTwitterData(
    twitterHandle: string, 
    yapperName: string
  ): Promise<TwitterFetchResult> {
    try {
      logger.info(`🐦 Fetching Twitter data for @${twitterHandle} (${yapperName})`);

      const response = await fetch(`${this.pythonBackendUrl}/api/twitter/fetch-yapper-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          twitter_handle: twitterHandle,
          yapper_name: yapperName
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`❌ Twitter API call failed: ${response.status} - ${errorText}`);
        
        if (response.status === 429) {
          return {
            success: false,
            error: 'rate_limited',
            retry_after: 900 // 15 minutes
          };
        }
        
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText}`
        };
      }

      const result = await response.json() as TwitterFetchResult;
      
      if (result.success) {
        logger.info(`✅ Successfully fetched Twitter data for @${twitterHandle}: ${result.tweets_count} tweets, ${result.images_count} images`);
      } else {
        logger.warn(`⚠️ Twitter fetch failed for @${twitterHandle}: ${result.error}`);
      }

      return result;

    } catch (error) {
      logger.error(`❌ Error fetching Twitter data for @${twitterHandle}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get Twitter API rate limit status
   */
  async getRateLimitStatus(): Promise<any> {
    try {
      const response = await fetch(`${this.pythonBackendUrl}/api/twitter/rate-limit-status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      return await response.json();

    } catch (error) {
      logger.error('❌ Error getting Twitter rate limit status:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Test Twitter API connectivity
   */
  async testTwitterAPI(): Promise<boolean> {
    try {
      const response = await fetch(`${this.pythonBackendUrl}/api/twitter/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return response.ok;

    } catch (error) {
      logger.error('❌ Twitter API health check failed:', error);
      return false;
    }
  }
}
