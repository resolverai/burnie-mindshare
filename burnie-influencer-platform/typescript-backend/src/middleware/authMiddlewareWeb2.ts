import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { AccountUser } from '../models/AccountUser';
import { AccountSocialMediaConnection } from '../models/AccountSocialMediaConnection';
import { logger } from '../config/logger';

/**
 * Middleware to authenticate Web2 users using Twitter OAuth token
 * Validates token and checks if connection exists and is active
 */
export const authMiddlewareWeb2 = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No authorization token provided',
        requiresAuth: true
      });
      return;
    }

    const token = authHeader.substring(7);

    // Verify token with Twitter
    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!userResponse.ok) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        requiresAuth: true
      });
      return;
    }

    const userData = await userResponse.json() as any;
    const { id: twitter_user_id } = userData.data;

    // Get user from database
    const accountUserRepo = AppDataSource.getRepository(AccountUser);
    const accountUser = await accountUserRepo.findOne({
      where: { twitter_user_id },
      relations: ['account']
    });

    if (!accountUser) {
      res.status(404).json({
        success: false,
        error: 'User not found',
        requiresAuth: true
      });
      return;
    }

    // Check if social media connection exists and is active
    const socialConnectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    const socialConnection = await socialConnectionRepo.findOne({
      where: {
        account_id: accountUser.account_id,
        platform: 'twitter',
        platform_user_id: twitter_user_id
      }
    });

    if (!socialConnection) {
      res.status(401).json({
        success: false,
        error: 'No Twitter connection found. Please reconnect your account.',
        requiresReconnect: true,
        accountId: accountUser.account_id
      });
      return;
    }

    // Check if token is expired
    if (socialConnection.token_expires_at && socialConnection.token_expires_at < new Date()) {
      res.status(401).json({
        success: false,
        error: 'Twitter token has expired. Please reconnect your account.',
        requiresReconnect: true,
        accountId: accountUser.account_id
      });
      return;
    }

    // Check if connection is active
    if (socialConnection.status !== 'active') {
      res.status(401).json({
        success: false,
        error: 'Twitter connection is not active. Please reconnect your account.',
        requiresReconnect: true,
        accountId: accountUser.account_id
      });
      return;
    }

    // Attach user info to request
    req.web2User = {
      userId: accountUser.id.toString(),
      accountId: accountUser.account_id.toString(),
      email: accountUser.email || '',
      role: accountUser.role,
      twitterUserId: twitter_user_id,
      twitterUsername: accountUser.twitter_username || ''
    };

    next();
  } catch (error) {
    logger.error('Web2 auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      web2User?: {
        userId: string;
        accountId: string;
        email: string;
        role: string;
        twitterUserId: string;
        twitterUsername: string;
      };
    }
  }
}

