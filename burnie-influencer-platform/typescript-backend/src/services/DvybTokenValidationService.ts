import { AppDataSource } from '../config/database';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybLinkedInConnection } from '../models/DvybLinkedInConnection';
import { DvybTikTokConnection } from '../models/DvybTikTokConnection';
import { DvybTwitterTokenService } from './DvybTwitterTokenService';
import { logger } from '../config/logger';

export interface PlatformTokenStatus {
  platform: string;
  connected: boolean;
  oauth2Valid?: boolean;
  oauth1Valid?: boolean; // For Twitter videos
  tokenExpiry?: Date | null;
  requiresReauth: boolean;
  error?: string;
}

export interface TokenValidationResult {
  allValid: boolean;
  platforms: PlatformTokenStatus[];
  missingPlatforms: string[];
  expiredPlatforms: string[];
}

/**
 * Service for validating tokens across all DVYB platforms
 */
export class DvybTokenValidationService {
  /**
   * Validate tokens for multiple platforms
   */
  static async validatePlatformTokens(
    accountId: number,
    platforms: string[],
    requireOAuth1ForTwitterVideo: boolean = false
  ): Promise<TokenValidationResult> {
    const platformStatuses: PlatformTokenStatus[] = [];
    const missingPlatforms: string[] = [];
    const expiredPlatforms: string[] = [];

    for (const platform of platforms) {
      let status: PlatformTokenStatus;

      switch (platform.toLowerCase()) {
        case 'twitter':
          status = await this.validateTwitterTokens(accountId, requireOAuth1ForTwitterVideo);
          break;
        case 'instagram':
          status = await this.validateInstagramTokens(accountId);
          break;
        case 'linkedin':
          status = await this.validateLinkedInTokens(accountId);
          break;
        case 'tiktok':
          status = await this.validateTikTokTokens(accountId);
          break;
        default:
          status = {
            platform,
            connected: false,
            requiresReauth: true,
            error: `Unsupported platform: ${platform}`,
          };
      }

      platformStatuses.push(status);

      if (!status.connected) {
        missingPlatforms.push(platform);
      } else if (status.requiresReauth) {
        expiredPlatforms.push(platform);
      }
    }

    const allValid = platformStatuses.every(s => s.connected && !s.requiresReauth);

    return {
      allValid,
      platforms: platformStatuses,
      missingPlatforms,
      expiredPlatforms,
    };
  }

  /**
   * Validate Twitter tokens
   */
  static async validateTwitterTokens(
    accountId: number,
    requireOAuth1: boolean = false
  ): Promise<PlatformTokenStatus> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId, isActive: true },
      });

      if (!connection) {
        return {
          platform: 'twitter',
          connected: false,
          requiresReauth: true,
          error: 'Twitter not connected',
        };
      }

      // Use token service to validate
      const tokenValidation = await DvybTwitterTokenService.validateTokens(accountId);

      // Check OAuth2
      if (!tokenValidation.oauth2Valid) {
        return {
          platform: 'twitter',
          connected: true,
          oauth2Valid: false,
          requiresReauth: true,
          tokenExpiry: connection.oauth2ExpiresAt,
          error: 'Twitter OAuth2 token expired. Please reconnect.',
        };
      }

      // Check OAuth1 if required (for videos)
      if (requireOAuth1 && !tokenValidation.oauth1Valid) {
        return {
          platform: 'twitter',
          connected: true,
          oauth2Valid: true,
          oauth1Valid: false,
          requiresReauth: true,
          error: 'Twitter OAuth1 authorization required for video posting.',
        };
      }

      return {
        platform: 'twitter',
        connected: true,
        oauth2Valid: tokenValidation.oauth2Valid,
        oauth1Valid: tokenValidation.oauth1Valid,
        tokenExpiry: connection.oauth2ExpiresAt,
        requiresReauth: false,
      };
    } catch (error: any) {
      logger.error(`Error validating Twitter tokens: ${error.message}`);
      return {
        platform: 'twitter',
        connected: false,
        requiresReauth: true,
        error: error.message,
      };
    }
  }

  /**
   * Validate Instagram tokens
   */
  static async validateInstagramTokens(accountId: number): Promise<PlatformTokenStatus> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId },
      });

      if (!connection || connection.status !== 'active') {
        return {
          platform: 'instagram',
          connected: false,
          requiresReauth: true,
          error: 'Instagram not connected',
        };
      }

      // Check token expiry (Instagram tokens are valid for 60 days)
      if (connection.tokenExpiresAt) {
        const now = new Date();
        const expiresAt = new Date(connection.tokenExpiresAt);
        const bufferTime = 24 * 60 * 60 * 1000; // 1 day buffer

        if (expiresAt.getTime() - bufferTime <= now.getTime()) {
          return {
            platform: 'instagram',
            connected: true,
            requiresReauth: true,
            tokenExpiry: connection.tokenExpiresAt,
            error: 'Instagram token expired or expiring soon. Please reconnect.',
          };
        }
      }

      return {
        platform: 'instagram',
        connected: true,
        tokenExpiry: connection.tokenExpiresAt,
        requiresReauth: false,
      };
    } catch (error: any) {
      logger.error(`Error validating Instagram tokens: ${error.message}`);
      return {
        platform: 'instagram',
        connected: false,
        requiresReauth: true,
        error: error.message,
      };
    }
  }

  /**
   * Validate LinkedIn tokens
   */
  static async validateLinkedInTokens(accountId: number): Promise<PlatformTokenStatus> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId },
      });

      if (!connection || connection.status !== 'active') {
        return {
          platform: 'linkedin',
          connected: false,
          requiresReauth: true,
          error: 'LinkedIn not connected',
        };
      }

      // Check token expiry (LinkedIn tokens are valid for 60 days)
      if (connection.tokenExpiresAt) {
        const now = new Date();
        const expiresAt = new Date(connection.tokenExpiresAt);
        const bufferTime = 24 * 60 * 60 * 1000; // 1 day buffer

        if (expiresAt.getTime() - bufferTime <= now.getTime()) {
          return {
            platform: 'linkedin',
            connected: true,
            requiresReauth: true,
            tokenExpiry: connection.tokenExpiresAt,
            error: 'LinkedIn token expired or expiring soon. Please reconnect.',
          };
        }
      }

      return {
        platform: 'linkedin',
        connected: true,
        tokenExpiry: connection.tokenExpiresAt,
        requiresReauth: false,
      };
    } catch (error: any) {
      logger.error(`Error validating LinkedIn tokens: ${error.message}`);
      return {
        platform: 'linkedin',
        connected: false,
        requiresReauth: true,
        error: error.message,
      };
    }
  }

  /**
   * Validate TikTok tokens
   */
  static async validateTikTokTokens(accountId: number): Promise<PlatformTokenStatus> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTikTokConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId },
      });

      if (!connection || connection.status !== 'active') {
        return {
          platform: 'tiktok',
          connected: false,
          requiresReauth: true,
          error: 'TikTok not connected',
        };
      }

      // Check token expiry
      if (connection.tokenExpiresAt) {
        const now = new Date();
        const expiresAt = new Date(connection.tokenExpiresAt);
        const bufferTime = 24 * 60 * 60 * 1000; // 1 day buffer

        if (expiresAt.getTime() - bufferTime <= now.getTime()) {
          return {
            platform: 'tiktok',
            connected: true,
            requiresReauth: true,
            tokenExpiry: connection.tokenExpiresAt,
            error: 'TikTok token expired or expiring soon. Please reconnect.',
          };
        }
      }

      return {
        platform: 'tiktok',
        connected: true,
        tokenExpiry: connection.tokenExpiresAt,
        requiresReauth: false,
      };
    } catch (error: any) {
      logger.error(`Error validating TikTok tokens: ${error.message}`);
      return {
        platform: 'tiktok',
        connected: false,
        requiresReauth: true,
        error: error.message,
      };
    }
  }
}

