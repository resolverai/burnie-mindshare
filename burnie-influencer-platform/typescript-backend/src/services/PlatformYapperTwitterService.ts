import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { PlatformYapperTwitterData } from '../models/PlatformYapperTwitterData';
import { PlatformYapperTwitterProfile } from '../models/PlatformYapperTwitterProfile';
import { logger } from '../config/logger';

export interface TwitterDataFetchResult {
  success: boolean;
  tweets_collected?: number;
  profile_updated?: boolean;
  error?: string;
  skipped_reason?: string;
}

export class PlatformYapperTwitterService {
  private yapperConnectionRepository: Repository<YapperTwitterConnection>;
  private twitterDataRepository: Repository<PlatformYapperTwitterData>;
  private twitterProfileRepository: Repository<PlatformYapperTwitterProfile>;

  constructor() {
    this.yapperConnectionRepository = AppDataSource.getRepository(YapperTwitterConnection);
    this.twitterDataRepository = AppDataSource.getRepository(PlatformYapperTwitterData);
    this.twitterProfileRepository = AppDataSource.getRepository(PlatformYapperTwitterProfile);
  }

  /**
   * Check if Twitter data was already fetched today for a platform yapper
   */
  private async wasDataFetchedToday(yapperUserId: number): Promise<boolean> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const count = await this.twitterDataRepository
        .createQueryBuilder("data")
        .where("data.yapper_id = :yapperUserId", { yapperUserId })
        .andWhere("data.posted_at >= :today", { today })
        .andWhere("data.posted_at < :tomorrow", { tomorrow })
        .getCount();

      return count > 0;
    } catch (error) {
      logger.error(`❌ Error checking daily fetch status for yapper ${yapperUserId}:`, error);
      return true; // Return true to prevent duplicate attempts on error
    }
  }

  /**
   * Fetch Twitter data for a platform yapper using their OAuth access token
   */
  async fetchYapperTwitterData(connection: YapperTwitterConnection): Promise<TwitterDataFetchResult> {
    try {
      logger.info(`🐦 Fetching Twitter data for platform yapper @${connection.twitterUsername} using OAuth token`);

      // Check if data was already fetched today
      const alreadyFetchedToday = await this.wasDataFetchedToday(connection.userId);
      if (alreadyFetchedToday) {
        logger.info(`⏭️ Skipping Twitter data fetch for @${connection.twitterUsername} - already fetched today`);
        return {
          success: true,
          tweets_collected: 0,
          profile_updated: false,
          skipped_reason: 'Already fetched today'
        };
      }

      // Call Python backend to collect Twitter data using OAuth access token
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        const response = await fetch(`${process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000'}/api/platform-yapper-oauth-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            yapper_id: connection.userId,
            twitter_user_id: connection.twitterUserId,
            twitter_username: connection.twitterUsername,
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Python backend error: ${response.status} - ${errorText}`);
        }

        const result = await response.json() as any;

        if (!result.success) {
          return {
            success: false,
            error: result.error || 'Unknown error from Python backend'
          };
        }

        // Update the connection's last sync time
        connection.lastSyncAt = new Date();
        await this.yapperConnectionRepository.save(connection);

        logger.info(`✅ Successfully fetched Twitter data for @${connection.twitterUsername}`);
        logger.info(`   Tweets collected: ${result.tweets_stored || 0}`);
        logger.info(`   Profile updated: ${result.profile_updated ? 'Yes' : 'No'}`);

        return {
          success: true,
          tweets_collected: result.tweets_stored || 0,
          profile_updated: result.profile_updated || false
        };

      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } catch (error) {
      logger.error(`❌ Error fetching Twitter data for @${connection.twitterUsername}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fetch Twitter data for a platform yapper by user ID
   */
  async fetchYapperTwitterDataByUserId(userId: number): Promise<TwitterDataFetchResult> {
    try {
      const connection = await this.yapperConnectionRepository.findOne({
        where: { userId, isConnected: true }
      });

      if (!connection) {
        return {
          success: false,
          error: 'No active Twitter connection found for this yapper'
        };
      }

      return await this.fetchYapperTwitterData(connection);

    } catch (error) {
      logger.error(`❌ Error fetching Twitter data for user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get Twitter data statistics for a platform yapper
   */
  async getYapperTwitterStats(userId: number): Promise<{
    success: boolean;
    stats?: {
      total_tweets: number;
      last_fetch: string | null;
      profile_exists: boolean;
      connection_status: string;
    };
    error?: string;
  }> {
    try {
      const connection = await this.yapperConnectionRepository.findOne({
        where: { userId, isConnected: true }
      });

      if (!connection) {
        return {
          success: false,
          error: 'No active Twitter connection found'
        };
      }

      const tweetCount = await this.twitterDataRepository.count({
        where: { yapper_id: userId }
      });

      const profileExists = await this.twitterProfileRepository.findOne({
        where: { yapper_id: userId }
      }) !== null;

      return {
        success: true,
        stats: {
          total_tweets: tweetCount,
          last_fetch: connection.lastSyncAt?.toISOString() || null,
          profile_exists: profileExists,
          connection_status: connection.isConnected ? 'connected' : 'disconnected'
        }
      };

    } catch (error) {
      logger.error(`❌ Error getting Twitter stats for user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance
export const platformYapperTwitterService = new PlatformYapperTwitterService();
