import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Middleware to authenticate DVYB onboarding requests using X-DVYB-API-Key header.
 * Used for discover ads in onboarding modal (unauthenticated users).
 */
export const dvybApiKeyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const apiKey = env.dvybOAuth.onboardingApiKey;
  if (!apiKey) {
    logger.warn('❌ DVYB onboarding API key not configured (DVYB_ONBOARDING_API_KEY)');
    res.status(503).json({
      success: false,
      error: 'Onboarding API not configured',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const providedKey = req.headers['x-dvyb-api-key'] as string;
  if (!providedKey || providedKey !== apiKey) {
    res.status(401).json({
      success: false,
      error: 'Invalid or missing API key',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
};
