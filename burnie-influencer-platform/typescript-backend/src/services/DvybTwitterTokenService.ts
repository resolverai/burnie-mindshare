import { AppDataSource } from '../config/database';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { logger } from '../config/logger';

export interface TokenValidationResult {
  oauth2Valid: boolean;
  oauth1Valid: boolean;
}

/**
 * Service for validating DVYB Twitter tokens
 */
export class DvybTwitterTokenService {
  /**
   * Validate tokens for a DVYB account
   */
  static async validateTokens(accountId: number): Promise<TokenValidationResult> {
    const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
    const connection = await connectionRepo.findOne({
      where: { accountId, isActive: true },
    });

    if (!connection) {
      return {
        oauth2Valid: false,
        oauth1Valid: false,
      };
    }

    return {
      oauth2Valid: this.isOAuth2Valid(connection),
      oauth1Valid: this.isOAuth1Valid(connection),
    };
  }

  /**
   * Check if OAuth2 token is valid
   */
  static isOAuth2Valid(connection: DvybTwitterConnection): boolean {
    if (!connection.oauth2AccessToken) {
      return false;
    }

    // Check expiration
    if (connection.oauth2ExpiresAt) {
      const now = new Date();
      const expiresAt = new Date(connection.oauth2ExpiresAt);
      // Add 5-minute buffer
      const bufferTime = 5 * 60 * 1000;
      if (expiresAt.getTime() - bufferTime <= now.getTime()) {
        return false;
      }
    }

    // Check if required scopes are present
    const scopes = connection.scopes || '';
    const requiredScopes = ['tweet.write', 'tweet.read', 'users.read'];
    const hasRequiredScopes = requiredScopes.every((scope) => scopes.includes(scope));
    
    if (!hasRequiredScopes) {
      return false;
    }

    return true;
  }

  /**
   * Check if OAuth1 token is valid
   */
  static isOAuth1Valid(connection: DvybTwitterConnection): boolean {
    if (!connection.oauth1Token || !connection.oauth1TokenSecret) {
      return false;
    }

    // Check expiration (if set)
    if (connection.oauth1ExpiresAt) {
      const now = new Date();
      const expiresAt = new Date(connection.oauth1ExpiresAt);
      if (expiresAt <= now) {
        return false;
      }
    }

    // OAuth1 tokens typically don't expire, but we check in case the field is set
    return true;
  }

  /**
   * Get button label based on content type and token validity
   */
  static getButtonLabel(
    hasVideo: boolean,
    tokenValidation: TokenValidationResult
  ): 'Post Now' | 'Reconnect Twitter' {
    
    if (hasVideo) {
      // Video requires both OAuth1 and OAuth2
      if (!tokenValidation.oauth2Valid || !tokenValidation.oauth1Valid) {
        return 'Reconnect Twitter';
      }
    } else {
      // Image only requires OAuth2
      if (!tokenValidation.oauth2Valid) {
        return 'Reconnect Twitter';
      }
    }

    return 'Post Now';
  }
}

