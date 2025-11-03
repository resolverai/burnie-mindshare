import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { ProjectTwitterConnection } from '../models/ProjectTwitterConnection';
import { ProjectTwitterTokenService } from '../services/ProjectTwitterTokenService';
import { logger } from '../config/logger';
import crypto from 'crypto';
import { 
  getRequestToken, 
  getAuthorizationUrl, 
  getAccessToken,
} from '../utils/oauth1Utils';

const router = Router();

// Twitter OAuth credentials (should be in env)
// Use same environment variables as initial sign-in flow (projectAuth.ts)
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
// Use the same callback URL as initial sign-in flow
// This points to the frontend callback page, which will then route to the appropriate backend endpoint
const TWITTER_CALLBACK_URL_PROJECTS = process.env.TWITTER_CALLBACK_URL_PROJECTS || '';

/**
 * GET /api/projects/:projectId/twitter-tokens/validate
 * Validate OAuth2 and OAuth1 tokens for a project
 */
router.get('/:projectId/twitter-tokens/validate', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
    }

    const validation = await ProjectTwitterTokenService.validateTokens(projectId);

    return res.json({
      success: true,
      data: validation
    });
  } catch (error: any) {
    logger.error(`❌ Error validating project tokens: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to validate tokens'
    });
  }
});

/**
 * POST /api/projects/:projectId/twitter-auth/oauth2/initiate
 * Initiate OAuth2 flow for project
 */
router.post('/:projectId/twitter-auth/oauth2/initiate', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
    }

    if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'Twitter OAuth credentials not configured'
      });
    }

    // Note: We use RECONNECT_CALLBACK_URI which points to the reconnect flow's callback endpoint
    // This is different from initial sign-in which may use a different callback URL

    // Generate state parameter for security
    // Prefix with "reconnect_" so frontend callback page can detect this is a reconnect flow
    const stateBase = crypto.randomBytes(32).toString('hex');
    const state = `reconnect_${stateBase}`;
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Store state and code verifier in memory (in production, use Redis or similar)
    const sessionKey = `project_oauth_${state}`;
    (global as any).projectOAuthSessions = (global as any).projectOAuthSessions || {};
    (global as any).projectOAuthSessions[sessionKey] = {
      codeVerifier,
      projectId,
      timestamp: Date.now()
    };
    
    // Log session storage for debugging
    logger.info(`📦 Stored OAuth session for project ${projectId}:`, { 
      sessionKey, 
      hasCodeVerifier: !!codeVerifier,
      timestamp: Date.now() 
    });
    
    // Cleanup old sessions (older than 15 minutes)
    const now = Date.now();
    for (const [key, value] of Object.entries((global as any).projectOAuthSessions)) {
      if ((value as any).timestamp && now - (value as any).timestamp > 900000) { // 15 minutes
        delete (global as any).projectOAuthSessions[key];
        logger.info(`🧹 Cleaned up expired OAuth session: ${key}`);
      }
    }

    if (!TWITTER_CALLBACK_URL_PROJECTS) {
      logger.error('❌ TWITTER_CALLBACK_URL_PROJECTS not configured');
      return res.status(500).json({ 
        success: false, 
        error: 'Twitter OAuth callback URL not configured' 
      });
    }

    // Build OAuth URL
    // Use the same callback URL as initial sign-in flow (from .env)
    // This is the frontend callback URL that Twitter will redirect to
    const redirectUri = TWITTER_CALLBACK_URL_PROJECTS;
    
    logger.info(`🔧 Reconnect flow - Using redirect URI: ${redirectUri}`);
    logger.info(`🔧 Environment check - TWITTER_CLIENT_ID: ${TWITTER_CLIENT_ID ? 'set' : 'NOT SET'}`);
    logger.info(`🔧 Environment check - TWITTER_CLIENT_SECRET: ${TWITTER_CLIENT_SECRET ? 'set' : 'NOT SET'}`);
    logger.info(`🔧 Environment check - TWITTER_CALLBACK_URL_PROJECTS: ${TWITTER_CALLBACK_URL_PROJECTS}`);
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: TWITTER_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'tweet.read tweet.write media.write users.read follows.read offline.access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;

    logger.info(`🔗 Generated OAuth2 URL for project ${projectId}`);

    return res.json({
      success: true,
      data: {
        oauth_url: authUrl,
        state,
        code_verifier: codeVerifier,
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error initiating OAuth2 flow: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate OAuth2 flow'
    });
  }
});

/**
 * POST /api/projects/twitter-auth/oauth2/callback
 * OAuth2 callback handler for reconnect flow
 * This is called by the frontend callback page after Twitter redirects
 */
router.post('/twitter-auth/oauth2/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      logger.error('❌ OAuth2 callback missing parameters:', { hasCode: !!code, hasState: !!state });
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
      // Try to extract projectId from state or use a default redirect
      return res.redirect(`${frontendUrl}/projects/error?oauth_error=missing_parameters`);
    }

    // Retrieve session data
    const sessionKey = `project_oauth_${state}`;
    const sessions = (global as any).projectOAuthSessions || {};
    const session = sessions[sessionKey];

    if (!session || Date.now() - session.timestamp > 600000) { // 10 minutes expiry
      logger.error(`❌ OAuth2 callback session invalid or expired:`, { 
        hasSession: !!session, 
        expired: session ? (Date.now() - session.timestamp > 600000) : 'no session',
        sessionKey 
      });
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
      // If we have session, try to get projectId from it
      const projectId = session?.projectId || 'error';
      return res.redirect(`${frontendUrl}/projects/${projectId}/daily-posts?oauth2_error=invalid_session`);
    }

    const { codeVerifier, projectId } = session;

    if (!TWITTER_CALLBACK_URL_PROJECTS) {
      logger.error('❌ TWITTER_CALLBACK_URL_PROJECTS not configured');
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/projects/${projectId}/daily-posts?oauth2_error=config_error`);
    }

    // Exchange code for tokens
    // CRITICAL: Must use the EXACT same redirect_uri as used in the authorization request
    // This MUST be TWITTER_CALLBACK_URL_PROJECTS (same as initial sign-in flow)
    const redirectUri = TWITTER_CALLBACK_URL_PROJECTS;
    
    logger.info(`🔧 Token exchange using redirect URI: ${redirectUri}`);
    logger.info(`🔧 This MUST match the redirect_uri used in authorization request`);
    
    const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
    const tokenData = {
      grant_type: 'authorization_code',
      client_id: TWITTER_CLIENT_ID,
      redirect_uri: redirectUri,
      code: code as string,
      code_verifier: codeVerifier
    };

    const authHeader = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

    // Log the exact token exchange request details (without sensitive data)
    logger.info(`📤 Token exchange request:`, {
      redirect_uri: redirectUri,
      grant_type: tokenData.grant_type,
      client_id: TWITTER_CLIENT_ID ? `${TWITTER_CLIENT_ID.substring(0, 10)}...` : 'NOT SET',
      hasCode: !!tokenData.code,
      codeLength: tokenData.code?.length || 0,
      hasCodeVerifier: !!tokenData.code_verifier,
      codeVerifierLength: tokenData.code_verifier?.length || 0,
      tokenUrl: tokenUrl
    });
    
    // Build the request body manually to ensure proper encoding
    const requestBody = new URLSearchParams(tokenData).toString();
    logger.info(`📦 Request body length: ${requestBody.length} characters`);
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`,
        'User-Agent': 'BurnieAI/1.0'
      },
      body: requestBody
    });

    logger.info(`📊 Token exchange response status: ${tokenResponse.status} ${tokenResponse.statusText}`);
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error(`❌ Token exchange failed: ${errorText}`);
      logger.error(`❌ Full token exchange request details:`, {
        redirect_uri: redirectUri,
        redirect_uri_length: redirectUri.length,
        client_id: TWITTER_CLIENT_ID ? `${TWITTER_CLIENT_ID.substring(0, 10)}...` : 'NOT SET',
        client_id_length: TWITTER_CLIENT_ID?.length || 0,
        hasCode: !!tokenData.code,
        codeLength: tokenData.code?.length || 0,
        hasCodeVerifier: !!tokenData.code_verifier,
        codeVerifierLength: tokenData.code_verifier?.length || 0,
        tokenUrl: tokenUrl,
        requestBodyPreview: requestBody.substring(0, 100) + '...'
      });
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/projects/${projectId}/daily-posts?oauth2_error=token_exchange_failed`);
    }

    const tokenResult = await tokenResponse.json() as any;
    logger.info(`✅ Received OAuth2 tokens for project ${projectId}`);

    // Fetch user data
    const userResponse = await fetch('https://api.twitter.com/2/users/me', {
      headers: {
        'Authorization': `Bearer ${tokenResult.access_token}`,
        'User-Agent': 'BurnieAI/1.0'
      }
    });

    if (!userResponse.ok) {
      logger.error(`❌ Failed to fetch user data: ${userResponse.status}`);
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/projects/${projectId}/daily-posts?oauth2_error=fetch_user_failed`);
    }

    const userData = await userResponse.json() as any;
    const twitterUserId = userData.data?.id;
    const twitterHandle = userData.data?.username;

    if (!twitterUserId || !twitterHandle) {
      logger.error(`❌ Failed to get Twitter user information:`, userData);
      const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/projects/${projectId}/daily-posts?oauth2_error=invalid_user_data`);
    }

    // Calculate expiration time (usually 7200 seconds / 2 hours)
    const expiresIn = tokenResult.expires_in || 7200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Save or update connection
    const connectionRepository = AppDataSource.getRepository(ProjectTwitterConnection);
    let connection = await connectionRepository.findOne({
      where: { projectId }
    });

    if (!connection) {
      connection = new ProjectTwitterConnection();
      connection.projectId = projectId;
      connection.twitterUserId = twitterUserId;
      connection.twitterHandle = twitterHandle;
    }

    connection.oauth2AccessToken = tokenResult.access_token;
    connection.oauth2RefreshToken = tokenResult.refresh_token || null;
    connection.oauth2ExpiresAt = expiresAt;
    // Store scopes from token exchange response
    // Twitter returns scopes as space-separated string or comma-separated
    const scopes = tokenResult.scope || 'tweet.read tweet.write media.write users.read follows.read offline.access';
    connection.scopes = scopes;
    
    logger.info(`📋 Stored OAuth scopes for project ${projectId}: ${scopes}`);
    
    // Verify critical scopes are present
    if (!scopes.includes('tweet.write')) {
      logger.warn(`⚠️ Missing tweet.write scope for project ${projectId}`);
    }
    if (!scopes.includes('media.write')) {
      logger.warn(`⚠️ Missing media.write scope for project ${projectId}`);
    }

    await connectionRepository.save(connection);
    logger.info(`✅ OAuth2 tokens saved for project ${projectId}`);

    // Clean up session
    delete sessions[sessionKey];

    // Return JSON response (frontend callback page will handle it)
    return res.json({
      success: true,
      data: {
        projectId,
        twitterHandle,
        twitterUserId,
        reconnect: true
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error in OAuth2 callback: ${error.message}`);
    const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
    // Try to get projectId from query params or use error page
    const projectId = (req.query as any).projectId || 'error';
    return res.redirect(`${frontendUrl}/projects/${projectId}/daily-posts?oauth2_error=callback_failed`);
  }
});

// Temporary storage for request tokens (in production, use Redis or database)
const projectRequestTokenStore = new Map<string, { 
  requestToken: string; 
  requestTokenSecret: string; 
  projectId: number;
  expiresAt: Date;
}>();

// Cleanup expired request tokens
setInterval(() => {
  const now = new Date();
  for (const [sessionId, tokenData] of projectRequestTokenStore.entries()) {
    if (now > tokenData.expiresAt) {
      projectRequestTokenStore.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

/**
 * POST /api/projects/:projectId/twitter-auth/oauth1/initiate
 * Initiate OAuth1 flow for video uploads
 */
router.post('/:projectId/twitter-auth/oauth1/initiate', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');

    if (isNaN(projectId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid project ID'
      });
    }

    // Verify OAuth2 is already connected (required before OAuth1)
    const connectionRepository = AppDataSource.getRepository(ProjectTwitterConnection);
    const connection = await connectionRepository.findOne({
      where: { projectId }
    });

    if (!connection || !connection.oauth2AccessToken) {
      return res.status(400).json({
        success: false,
        error: 'OAuth2 must be connected first before OAuth1'
      });
    }

    // Get request token from Twitter with callback URL
    const callbackUrl = `${process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000'}/projects/${projectId}/daily-posts?oauth1_callback=true`;
    const { requestToken, requestTokenSecret } = await getRequestToken(callbackUrl);

    // Store request token temporarily (expires in 15 minutes)
    const sessionId = `project_${projectId}_${Date.now()}`;
    projectRequestTokenStore.set(sessionId, {
      requestToken,
      requestTokenSecret,
      projectId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    });

    // Generate authorization URL
    const authUrl = getAuthorizationUrl(requestToken, callbackUrl);

    logger.info(`🔗 Generated OAuth1 URL for project ${projectId}`);

    return res.json({
      success: true,
      data: {
        sessionId,
        authUrl,
        requestToken,
        requestTokenSecret
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error initiating OAuth1 flow: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate OAuth1 flow',
      details: error.message
    });
  }
});

/**
 * POST /api/projects/:projectId/twitter-auth/oauth1/callback
 * Complete OAuth1 flow with verifier
 */
router.post('/:projectId/twitter-auth/oauth1/callback', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const { sessionId, oauthToken, oauthVerifier } = req.body;

    if (isNaN(projectId) || !sessionId || !oauthToken || !oauthVerifier) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    // Retrieve stored request token data
    const tokenData = projectRequestTokenStore.get(sessionId);
    if (!tokenData || tokenData.projectId !== projectId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired session'
      });
    }

    const { requestTokenSecret } = tokenData;

    // Exchange request token for access token
    const { accessToken, accessTokenSecret } = await getAccessToken(
      oauthToken,
      requestTokenSecret,
      oauthVerifier
    );

    // Save OAuth1 tokens to database
    const connectionRepository = AppDataSource.getRepository(ProjectTwitterConnection);
    let connection = await connectionRepository.findOne({
      where: { projectId }
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Project Twitter connection not found. Please connect OAuth2 first.'
      });
    }

    connection.oauth1Token = accessToken;
    connection.oauth1TokenSecret = accessTokenSecret;
    // Set OAuth1 token expiration (OAuth1 tokens don't expire, but we'll set a long expiration for security)
    connection.oauth1ExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

    await connectionRepository.save(connection);

    // Clean up session data
    projectRequestTokenStore.delete(sessionId);

    logger.info(`✅ OAuth1 connection completed for project ${projectId}`);

    return res.json({
      success: true,
      data: {
        message: 'OAuth 1.0a connection successful! Video uploads are now enabled.'
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error in OAuth1 callback: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to complete OAuth1 flow',
      details: error.message
    });
  }
});

export { router as projectTwitterAuthRoutes };

