import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { ProjectTwitterConnection } from '../models/ProjectTwitterConnection';
import { logger } from '../config/logger';

/**
 * Middleware to authorize project access
 * Validates that the requested project_id belongs to the authenticated Twitter user
 * 
 * This middleware uses a session cookie to identify the Twitter user.
 * The session is set when the user authenticates via Twitter OAuth.
 */
export const projectAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Support both :id and :projectId route parameters
    const projectIdParam = req.params.id || req.params.projectId;
    
    if (!projectIdParam) {
      res.status(400).json({
        success: false,
        error: 'Project ID is required'
      });
      return;
    }

    const projectId = parseInt(projectIdParam, 10);
    
    if (isNaN(projectId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
      return;
    }

    if (!AppDataSource.isInitialized) {
      res.status(503).json({
        success: false,
        error: 'Database not ready'
      });
      return;
    }

    // Get Twitter user ID from session cookie
    const sessionTwitterUserId = req.cookies?.project_twitter_user_id;
    
    if (!sessionTwitterUserId) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated. Please sign in with Twitter.',
        requiresAuth: true,
        message: 'Session cookie not found. Please visit /projects/{id}/twitter/status first to set your session cookie.'
      });
      return;
    }

    // Get the project's Twitter connection
    const connectionRepo = AppDataSource.getRepository(ProjectTwitterConnection);
    const connection = await connectionRepo.findOne({
      where: { projectId }
    });

    if (!connection) {
      // No connection found - project doesn't exist or not connected
      res.status(401).json({
        success: false,
        error: 'Project not found or not connected to Twitter',
        requiresAuth: true
      });
      return;
    }

    // Verify that the Twitter user ID from session matches the project's Twitter user ID
    if (connection.twitterUserId !== sessionTwitterUserId) {
      logger.warn(`⚠️ Unauthorized access attempt: User ${sessionTwitterUserId} tried to access project ${projectId} (owned by ${connection.twitterUserId})`);
      res.status(401).json({
        success: false,
        error: 'Unauthorized access to project',
        requiresAuth: true,
        correctProjectId: null // We'll set this in a helper endpoint
      });
      return;
    }

    // Check if OAuth2 token is valid (not expired)
    const now = new Date();
    const hasValidToken = !!(
      connection.oauth2AccessToken &&
      connection.oauth2ExpiresAt &&
      connection.oauth2ExpiresAt > now
    );

    if (!hasValidToken) {
      res.status(401).json({
        success: false,
        error: 'Twitter authentication expired. Please reconnect.',
        requiresAuth: true,
        needsReconnect: true
      });
      return;
    }

    // Authorization successful - attach project info to request
    (req as any).projectId = projectId;
    (req as any).twitterUserId = sessionTwitterUserId;
    (req as any).twitterHandle = connection.twitterHandle;
    
    next();
  } catch (error: any) {
    logger.error(`❌ Project auth middleware error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Authorization check failed'
    });
  }
};

/**
 * Helper function to get user's project_id from Twitter user ID
 * This can be used by frontend to verify project ownership
 */
export async function getUserProjectId(twitterUserId: string): Promise<number | null> {
  try {
    if (!AppDataSource.isInitialized) {
      return null;
    }

    const connectionRepo = AppDataSource.getRepository(ProjectTwitterConnection);
    const connection = await connectionRepo.findOne({
      where: { twitterUserId }
    });

    if (!connection) {
      return null;
    }

    // Check if token is still valid
    const now = new Date();
    const hasValidToken = !!(
      connection.oauth2AccessToken &&
      connection.oauth2ExpiresAt &&
      connection.oauth2ExpiresAt > now
    );

    if (!hasValidToken) {
      return null;
    }

    return connection.projectId;
  } catch (error: any) {
    logger.error(`❌ Error getting user project ID: ${error.message}`);
    return null;
  }
}

