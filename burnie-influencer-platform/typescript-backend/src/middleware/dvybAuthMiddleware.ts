import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export interface DvybAuthRequest extends Request {
  dvybAccountId?: number;
  dvybTwitterUserId?: string;
  dvybTwitterHandle?: string;
}

/**
 * Middleware to authenticate DVYB requests using session cookies or headers
 * Supports both cookies (primary) and X-DVYB-Account-ID header (fallback for Safari/ITP)
 */
export const dvybAuthMiddleware = async (
  req: DvybAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Check for account ID in cookies first, then fall back to header
    // Safari ITP can block cookies, so header fallback is essential
    const accountIdFromCookie = req.cookies?.dvyb_account_id;
    const accountIdFromHeader = req.headers['x-dvyb-account-id'] as string;
    const accountId = accountIdFromCookie || accountIdFromHeader;
    
    const twitterUserId = req.cookies?.dvyb_twitter_user_id;
    const twitterHandle = req.cookies?.dvyb_twitter_handle;

    if (!accountId) {
      logger.warn('❌ DVYB auth middleware: No account ID in cookies or headers');
      res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Attach to request for use in route handlers
    req.dvybAccountId = parseInt(accountId as string, 10);
    req.dvybTwitterUserId = twitterUserId as string;
    req.dvybTwitterHandle = twitterHandle as string;

    logger.debug(`✅ DVYB auth: Account ${req.dvybAccountId} authenticated (source: ${accountIdFromCookie ? 'cookie' : 'header'})`);
    next();
  } catch (error) {
    logger.error('❌ DVYB auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication error',
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Optional middleware - doesn't fail if not authenticated
 * Supports both cookies and header fallback for Safari/ITP
 */
export const dvybAuthOptional = async (
  req: DvybAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const accountIdFromCookie = req.cookies?.dvyb_account_id;
    const accountIdFromHeader = req.headers['x-dvyb-account-id'] as string;
    const accountId = accountIdFromCookie || accountIdFromHeader;
    
    if (accountId) {
      req.dvybAccountId = parseInt(accountId as string, 10);
      req.dvybTwitterUserId = req.cookies?.dvyb_twitter_user_id;
      req.dvybTwitterHandle = req.cookies?.dvyb_twitter_handle;
    }
    
    next();
  } catch (error) {
    logger.error('❌ DVYB optional auth error:', error);
    next(); // Continue anyway for optional auth
  }
};

