import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

export interface DvybAffiliateAuthRequest extends Request {
  dvybAffiliateId?: number;
}

/**
 * Middleware to authenticate DVYB affiliate requests using session cookies or headers
 */
export const dvybAffiliateAuthMiddleware = async (
  req: DvybAffiliateAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const affiliateIdFromCookie = req.cookies?.dvyb_affiliate_id;
    const affiliateIdFromHeader = req.headers['x-dvyb-affiliate-id'] as string;
    const affiliateId = affiliateIdFromCookie || affiliateIdFromHeader;

    if (!affiliateId) {
      logger.warn('❌ DVYB affiliate auth: No affiliate ID in cookies or headers');
      res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in to your affiliate account.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.dvybAffiliateId = parseInt(affiliateId as string, 10);
    logger.debug(`✅ DVYB affiliate auth: Affiliate ${req.dvybAffiliateId} authenticated`);
    next();
  } catch (error) {
    logger.error('❌ DVYB affiliate auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication error',
      timestamp: new Date().toISOString(),
    });
  }
};
