import { AppDataSource } from '../config/database';
import { ProjectTwitterConnection } from '../models/ProjectTwitterConnection';
import { logger } from '../config/logger';

export interface TokenValidationResult {
  oauth2Valid: boolean;
  oauth1Valid: boolean;
  oauth2ExpiresAt: Date | null;
  oauth1ExpiresAt: Date | null;
  needsOAuth2: boolean;
  needsOAuth1: boolean;
}

export class ProjectTwitterTokenService {
  /**
   * Validate tokens for a project
   */
  static async validateTokens(projectId: number): Promise<TokenValidationResult> {
    try {
      const connectionRepository = AppDataSource.getRepository(ProjectTwitterConnection);
      const connection = await connectionRepository.findOne({
        where: { projectId }
      });

      if (!connection) {
        return {
          oauth2Valid: false,
          oauth1Valid: false,
          oauth2ExpiresAt: null,
          oauth1ExpiresAt: null,
          needsOAuth2: true,
          needsOAuth1: true,
        };
      }

      // Check OAuth2 validity
      const oauth2Valid = this.isOAuth2Valid(connection);
      const oauth1Valid = this.isOAuth1Valid(connection);

      return {
        oauth2Valid,
        oauth1Valid,
        oauth2ExpiresAt: connection.oauth2ExpiresAt,
        oauth1ExpiresAt: connection.oauth1ExpiresAt,
        needsOAuth2: !oauth2Valid,
        needsOAuth1: !oauth1Valid,
      };
    } catch (error: any) {
      logger.error(`❌ Error validating project tokens: ${error.message}`);
      return {
        oauth2Valid: false,
        oauth1Valid: false,
        oauth2ExpiresAt: null,
        oauth1ExpiresAt: null,
        needsOAuth2: true,
        needsOAuth1: true,
      };
    }
  }

  /**
   * Check if OAuth2 token is valid
   */
  static isOAuth2Valid(connection: ProjectTwitterConnection): boolean {
    if (!connection.oauth2AccessToken) {
      return false;
    }

    // Check expiration
    if (connection.oauth2ExpiresAt) {
      const now = new Date();
      const expiresAt = new Date(connection.oauth2ExpiresAt);
      if (expiresAt <= now) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if OAuth1 token is valid
   */
  static isOAuth1Valid(connection: ProjectTwitterConnection): boolean {
    if (!connection.oauth1Token || !connection.oauth1TokenSecret) {
      return false;
    }

    // Check expiration
    if (connection.oauth1ExpiresAt) {
      const now = new Date();
      const expiresAt = new Date(connection.oauth1ExpiresAt);
      if (expiresAt <= now) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get button label based on content type and token validity
   */
  static getButtonLabel(
    hasVideo: boolean,
    tokenValidation: TokenValidationResult
  ): 'Post on X' | 'Reconnect X' {
    if (hasVideo) {
      // For video, both tokens must be valid
      if (tokenValidation.oauth2Valid && tokenValidation.oauth1Valid) {
        return 'Post on X';
      }
      return 'Reconnect X';
    } else {
      // For image, only OAuth2 is needed
      if (tokenValidation.oauth2Valid) {
        return 'Post on X';
      }
      return 'Reconnect X';
    }
  }
}

