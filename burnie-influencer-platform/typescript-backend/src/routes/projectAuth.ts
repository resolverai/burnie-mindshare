import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';
import { AppDataSource } from '../config/database';
import crypto from 'crypto';
import { Web3ProjectAccount } from '../models/Web3ProjectAccount';
import { ProjectTwitterConnection } from '../models/ProjectTwitterConnection';
import { getUserProjectId } from '../middleware/projectAuthMiddleware';

const router = Router();

// GET /api/projects/twitter/login - initiate OAuth2 login for project
router.get('/twitter/login', async (req: Request, res: Response) => {
  try {
    const clientId = process.env.TWITTER_CLIENT_ID;
    const callbackUrl = process.env.TWITTER_CALLBACK_URL_PROJECTS;

    if (!clientId || !callbackUrl) {
      return res.status(500).json({ success: false, error: 'Twitter OAuth not configured (clientId/callback)' });
    }

    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', callbackUrl);
    // Align scopes with Yapper purchase flow to enable media posting
    authUrl.searchParams.append('scope', 'tweet.read tweet.write media.write users.read follows.read offline.access');
    authUrl.searchParams.append('state', `${state}:${codeVerifier}`); // pack verifier with state
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');

    return res.json({ success: true, data: { oauth_url: authUrl.toString(), state, code_challenge: codeChallenge } });
  } catch (e) {
    logger.error('project twitter login error', e);
    return res.status(500).json({ success: false, error: 'Failed to initiate Twitter login' });
  }
});

// POST /api/projects/twitter/callback - exchange code and create/find project
router.post('/twitter/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.body;
    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    const callbackUrl = process.env.TWITTER_CALLBACK_URL_PROJECTS;

    if (!clientId || !clientSecret || !callbackUrl) {
      return res.status(500).json({ success: false, error: 'Twitter OAuth not configured (env missing)' });
    }

    const [, codeVerifier] = (state || '').split(':');

    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
        code_verifier: codeVerifier || state
      })
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      logger.error('Twitter token exchange failed', errText);
      return res.status(400).json({ success: false, error: 'Failed to exchange authorization code', details: errText });
    }

    const tokenResult = await tokenResponse.json() as any;

    // Fetch user identity
    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${tokenResult.access_token}`, 'User-Agent': 'BurnieAI/1.0' }
    });
    if (!userResponse.ok) {
      return res.status(400).json({ success: false, error: 'Failed to fetch user data from Twitter' });
    }
    const userData = await userResponse.json() as any;
    const twitterUserId = userData?.data?.id;
    const twitterHandle = userData?.data?.username;
    const name = userData?.data?.name || twitterHandle;

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ success: false, error: 'Database not ready' });
    }

    const projectRepo = AppDataSource.getRepository(Web3ProjectAccount);
    const connRepo = AppDataSource.getRepository(ProjectTwitterConnection);

    let project = await projectRepo.findOne({ where: { twitterUserId } });
    const exists = !!project;
    if (!project) {
      project = projectRepo.create({ twitterUserId, twitterHandle, name, slug: null, logoS3Key: null, website: null });
      await projectRepo.save(project);
    }

    // upsert connection
    let conn = await connRepo.findOne({ where: { projectId: project.id } });
    if (!conn) conn = connRepo.create({ projectId: project.id, twitterUserId, twitterHandle });
    conn.oauth2AccessToken = tokenResult.access_token;
    conn.oauth2RefreshToken = tokenResult.refresh_token || null;
    // Set our effective expiry to 7 days to avoid frequent reauth (we will refresh when needed)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    conn.oauth2ExpiresAt = new Date(Date.now() + sevenDaysMs);
    conn.scopes = (tokenResult.scope || '').toString();
    await connRepo.save(conn);

    // Set session cookie with Twitter user ID for authorization
    res.cookie('project_twitter_user_id', twitterUserId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days (matches token expiry)
    });

    return res.json({ success: true, data: { project_id: project.id, exists, twitter_user_id: twitterUserId } });
  } catch (e) {
    logger.error('project twitter callback error', e);
    return res.status(500).json({ success: false, error: 'Twitter callback failed' });
  }
});

// POST /api/projects/logout - Logout and clear session cookie
router.post('/logout', async (req: Request, res: Response) => {
  try {
    // Clear the session cookie
    res.clearCookie('project_twitter_user_id', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    logger.info('✅ User logged out, session cookie cleared');
    
    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (e) {
    logger.error('Error during logout:', e);
    return res.status(500).json({
      success: false,
      error: 'Failed to logout'
    });
  }
});

export { router as projectAuthRoutes };

// Additional status route mounted separately to avoid circular imports
export const projectAuthStatusRoutes = Router();

// GET /api/projects/my-project - Get the project_id for the authenticated user
// This endpoint uses the session cookie to identify the user
// MUST be defined before /:id routes to avoid route conflicts
projectAuthStatusRoutes.get('/my-project', async (req: Request, res: Response) => {
  try {
    // Get Twitter user ID from session cookie
    const twitterUserId = req.cookies?.project_twitter_user_id;
    
    if (!twitterUserId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated. Please sign in with Twitter.',
        requiresAuth: true
      });
    }

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ success: false, error: 'Database not ready' });
    }

    const connectionRepo = AppDataSource.getRepository(ProjectTwitterConnection);
    
    // Use Twitter user ID to find project
    const connection = await connectionRepo.findOne({
      where: { twitterUserId }
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'No project found for this Twitter account',
        requiresAuth: true
      });
    }

    return res.json({
      success: true,
      data: {
        project_id: connection.projectId,
        twitter_user_id: twitterUserId
      }
    });
  } catch (e) {
    logger.error('Error getting user project:', e);
    return res.status(500).json({ success: false, error: 'Failed to get user project' });
  }
});

projectAuthStatusRoutes.get('/:id/twitter/status', async (req: Request, res: Response) => {
  try {
    if (!AppDataSource.isInitialized) return res.status(503).json({ success: false, error: 'Database not ready' });
    const idParam = req.params.id;
    if (!idParam) return res.status(400).json({ success: false, error: 'Missing project id' });
    const projectId = parseInt(idParam, 10);
    if (isNaN(projectId)) return res.status(400).json({ success: false, error: 'Invalid project id' });
    const repo = AppDataSource.getRepository(ProjectTwitterConnection);
    const conn = await repo.findOne({ where: { projectId } });
    const now = new Date();
    const valid = !!(conn && conn.oauth2AccessToken && conn.oauth2ExpiresAt && conn.oauth2ExpiresAt > now);
    
    // If tokens are valid but user doesn't have a cookie, set it automatically
    // This handles the case where user logged in before cookie system was added
    if (valid && conn && !req.cookies?.project_twitter_user_id) {
      res.cookie('project_twitter_user_id', conn.twitterUserId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
      logger.info(`✅ Auto-set session cookie for project ${projectId} (user ${conn.twitterUserId})`);
    }
    
    return res.json({ success: true, exists: !!conn, valid, expires_at: conn?.oauth2ExpiresAt || null, scopes: conn?.scopes || null });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Failed to check status' });
  }
});

