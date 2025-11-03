import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Web3ProjectTwitterPost, PostType } from '../models/Web3ProjectTwitterPost';
import { ProjectTwitterConnection } from '../models/ProjectTwitterConnection';
import { logger } from '../config/logger';
import { uploadVideoOAuth1 } from '../utils/oauth1Utils';
import { ProjectTwitterTokenService } from '../services/ProjectTwitterTokenService';
import FormData from 'form-data';
import fetch from 'node-fetch';

const router = Router();

// Helper functions (similar to twitterPosting.ts)
function extractS3KeyFromUrl(url: string): string | null {
  try {
    if (!url.includes('s3.amazonaws.com')) {
      return null;
    }
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const s3Key = path.substring(1).split('?')[0];
    return s3Key && s3Key.length > 0 ? s3Key : null;
  } catch (error) {
    logger.error('Error extracting S3 key from URL:', error);
    return null;
  }
}

async function generatePresignedUrlForTwitter(s3Key: string): Promise<string | null> {
  try {
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    const queryParams = new URLSearchParams({
      s3_key: s3Key,
      expiration: '3600'
    });
    
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Python backend responded with ${response.status}`);
    }

    const result = await response.json() as { status: string; presigned_url?: string; error?: string };
    return result.status === 'success' && result.presigned_url ? result.presigned_url : null;
  } catch (error) {
    logger.error(`Error generating presigned URL: ${error}`);
    return null;
  }
}

function determinePostType(mainTweet: string, thread?: string[]): PostType {
  if (thread && thread.length > 0) return 'thread';
  if (mainTweet.length > 280) return 'longpost';
  return 'shitpost';
}

// Upload image to Twitter using OAuth2 (API v2)
const uploadImageToTwitter = async (accessToken: string, imageUrl: string): Promise<string | null> => {
  try {
    logger.info('🖼️ Starting image upload for URL:', imageUrl);
    
    // Generate fresh presigned URL if it's from S3
    let freshImageUrl = imageUrl;
    if (imageUrl.includes('s3.amazonaws.com')) {
      const s3Key = extractS3KeyFromUrl(imageUrl);
      if (s3Key) {
        const presignedUrl = await generatePresignedUrlForTwitter(s3Key);
        if (presignedUrl) {
          freshImageUrl = presignedUrl;
          logger.info('✅ Generated fresh presigned URL for image upload');
        }
      }
    }

    // Download image
    const imageResponse = await fetch(freshImageUrl);
    if (!imageResponse.ok) {
      logger.error(`Failed to download image: ${imageResponse.statusText}`);
      return null;
    }

    // For node-fetch v2, use arrayBuffer() instead of buffer()
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(imageArrayBuffer);
    logger.info(`📦 Downloaded image, size: ${imageBuffer.length} bytes`);
    
    // Create form data for Twitter media upload
    const formData = new FormData();
    formData.append('media', imageBuffer, {
      filename: 'tweet-image.jpg',
      contentType: 'image/jpeg'
    });
    formData.append('media_category', 'tweet_image');
    
    logger.info(`📦 FormData created with media size: ${imageBuffer.length} bytes`);

    // Upload to Twitter using API v2 endpoint
    const uploadResponse = await fetch('https://api.twitter.com/2/media/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
        // Don't set Content-Type - let FormData set it with boundary
      },
      body: formData
    });

    logger.info(`📡 Twitter API request sent to: https://api.twitter.com/2/media/upload`);
    logger.info(`📊 Media upload response status: ${uploadResponse.status}`);
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      logger.error(`❌ Image upload failed: ${uploadResponse.status} - ${errorText}`);
      
      // Try to parse the error response
      try {
        const errorJson = JSON.parse(errorText);
        logger.error('❌ Detailed error response:', JSON.stringify(errorJson, null, 2));
        
        // Check for specific error codes
        if (uploadResponse.status === 403) {
          logger.error('❌ Image upload 403: Check if OAuth2 token has media.write scope');
          logger.error('🔧 May need to re-authorize with media.write scope');
        }
        if (uploadResponse.status === 429) {
          logger.error('❌ Image upload 429: Rate limit exceeded');
        }
      } catch (e) {
        logger.error('❌ Error response is not JSON:', errorText);
      }
      
      return null;
    }

    const data = await uploadResponse.json() as any;
    logger.info('📦 Image upload response:', JSON.stringify(data, null, 2));
    
    // API v2 returns { data: { id: "media_id" } } format
    // Also check for media_id_string (legacy format) or media_id
    const mediaId = data.data?.id || data.media_id_string || data.media_id;
    if (!mediaId) {
      logger.error('❌ No media ID found in response:', data);
      return null;
    }
    
    logger.info('✅ Image uploaded successfully, media ID:', mediaId);
    return mediaId;
  } catch (error: any) {
    logger.error(`❌ Error uploading image: ${error.message}`);
    return null;
  }
};

// Upload video using OAuth1 with Twitter API v1.1 endpoint
// This uses the chunked upload process via uploadVideoOAuth1 from oauth1Utils
// Endpoint: https://upload.twitter.com/1.1/media/upload.json (v1.1)
// Authentication: OAuth 1.0a (requires oauth1Token and oauth1TokenSecret)
const uploadVideoToTwitter = async (
  videoUrl: string,
  oauth1Token: string,
  oauth1TokenSecret: string
): Promise<string | null> => {
  try {
    logger.info('🎬 Starting video upload using OAuth1.0a with Twitter API v1.1...');
    logger.info('📡 Using endpoint: https://upload.twitter.com/1.1/media/upload.json');
    const mediaId = await uploadVideoOAuth1(videoUrl, oauth1Token, oauth1TokenSecret);
    if (mediaId) {
      logger.info(`✅ Video uploaded successfully via OAuth1.0a, media ID: ${mediaId}`);
    } else {
      logger.error('❌ Video upload returned null media ID');
    }
    return mediaId;
  } catch (error: any) {
    logger.error(`❌ Error uploading video: ${error.message}`);
    return null;
  }
};

// Create tweet using OAuth2 with Twitter API v2 endpoint
// Endpoint: https://api.twitter.com/2/tweets (v2)
// Authentication: OAuth2 Bearer token (accessToken)
// This endpoint supports posting tweets with media_ids obtained from both:
//   - Video uploads (OAuth1/v1.1) 
//   - Image uploads (OAuth2/v2)
const createTweet = async (accessToken: string, text: string, mediaId?: string, replyToId?: string): Promise<string | null> => {
  try {
    const tweetData: any = { text };

    if (mediaId) {
      tweetData.media = { media_ids: [mediaId] };
      logger.info(`📎 Including media ID in tweet: ${mediaId}`);
    }

    if (replyToId) {
      tweetData.reply = { in_reply_to_tweet_id: replyToId };
      logger.info(`💬 Creating reply tweet to: ${replyToId}`);
    }

    logger.info('📝 Creating tweet using OAuth2 with Twitter API v2...');
    logger.info('📡 Using endpoint: https://api.twitter.com/2/tweets');
    logger.info('📦 Tweet data:', JSON.stringify(tweetData, null, 2));

    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(tweetData)
    });

    logger.info(`📊 Tweet creation response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`❌ Tweet creation failed: ${response.status} - ${errorText}`);
      
      // Try to parse error response
      try {
        const errorJson = JSON.parse(errorText);
        logger.error('❌ Detailed error response:', JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Not JSON, already logged as text
      }
      
      return null;
    }

    const data = await response.json() as any;
    logger.info('✅ Tweet created successfully:', JSON.stringify(data, null, 2));
    
    if (!data.data?.id) {
      logger.error('❌ No tweet ID in response:', data);
      return null;
    }
    
    return data.data.id;
  } catch (error: any) {
    logger.error(`❌ Error creating tweet: ${error.message}`);
    return null;
  }
};

// Refresh OAuth2 token
const refreshOAuth2Token = async (connection: ProjectTwitterConnection): Promise<string | null> => {
  try {
    if (!connection.oauth2RefreshToken) {
      return null;
    }

    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.oauth2RefreshToken,
        client_id: process.env.TWITTER_CLIENT_ID!
      })
    });

    if (!response.ok) {
      logger.error('Token refresh failed:', await response.text());
      return null;
    }

    const data = await response.json() as any;
    
    logger.info('✅ Token refresh successful, updating connection in database...');
    
    // Update connection
    const repository = AppDataSource.getRepository(ProjectTwitterConnection);
    connection.oauth2AccessToken = data.access_token;
    if (data.refresh_token) {
      connection.oauth2RefreshToken = data.refresh_token;
    }
    // Preserve existing scopes if not provided in refresh response
    // (Twitter refresh typically doesn't return scopes, so we keep the original)
    // Only update if explicitly provided
    if (data.scope) {
      connection.scopes = data.scope;
      logger.info(`📋 Updated scopes from refresh: ${data.scope}`);
    }
    const expiresIn = data.expires_in || 7200;
    connection.oauth2ExpiresAt = new Date(Date.now() + expiresIn * 1000);
    await repository.save(connection);

    logger.info(`✅ Token refreshed and saved. New expiration: ${connection.oauth2ExpiresAt}`);
    logger.info(`📋 Current scopes: ${connection.scopes || 'not stored'}`);
    return data.access_token;
  } catch (error: any) {
    logger.error(`Error refreshing token: ${error.message}`);
    return null;
  }
};

// Store post in database
async function storeProjectTwitterPost(
  projectId: number,
  mainTweet: string,
  mainTweetId: string,
  threadTweetIds: string[],
  thread?: string[],
  mediaId?: string,
  imageUrl?: string,
  videoUrl?: string,
  scheduleId?: number | null
): Promise<Web3ProjectTwitterPost | null> {
  try {
    const postRepository = AppDataSource.getRepository(Web3ProjectTwitterPost);
    const postType = determinePostType(mainTweet, thread);
    
    const post = new Web3ProjectTwitterPost();
    post.projectId = projectId;
    post.scheduleId = scheduleId || null;
    post.postType = postType;
    post.mainTweet = mainTweet;
    post.mainTweetId = mainTweetId;
    if (thread && thread.length > 0) {
      post.tweetThread = thread;
    }
    post.imageUrl = imageUrl || null;
    post.videoUrl = videoUrl || null;
    post.twitterMediaId = mediaId || null;
    post.engagementMetrics = {};
    post.postedAt = new Date();
    if (threadTweetIds.length > 1) {
      post.threadTweetIds = threadTweetIds;
    }
    post.threadCount = threadTweetIds.length;

    const savedPost = await postRepository.save(post);
    logger.info(`✅ Stored project Twitter post: ${savedPost.id} for project ${projectId}`);
    return savedPost;
  } catch (error) {
    logger.error('❌ Error storing project Twitter post:', error);
    return null;
  }
}

/**
 * POST /api/projects/:projectId/twitter/post
 * Post content to Twitter on behalf of a project
 */
router.post('/:projectId/twitter/post', async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(req.params.projectId || '');
    const { mainTweet, thread, imageUrl, videoUrl, scheduleId } = req.body;

    if (isNaN(projectId)) {
      return res.status(400).json({ success: false, error: 'Invalid project ID' });
    }

    if (!mainTweet) {
      return res.status(400).json({ success: false, error: 'Main tweet content required' });
    }

    // Get project Twitter connection
    const connectionRepository = AppDataSource.getRepository(ProjectTwitterConnection);
    const connection = await connectionRepository.findOne({
      where: { projectId }
    });

    if (!connection) {
      return res.status(400).json({
        success: false,
        error: 'Twitter not connected for this project',
        requiresAuth: true
      });
    }

    // Validate tokens
    const tokenValidation = await ProjectTwitterTokenService.validateTokens(projectId);

    // Determine required tokens
    const hasVideo = !!videoUrl;
    if (hasVideo && (!tokenValidation.oauth2Valid || !tokenValidation.oauth1Valid)) {
      return res.status(400).json({
        success: false,
        error: 'Both OAuth2 and OAuth1 tokens required for video posting',
        requiresAuth: true,
        needsOAuth2: !tokenValidation.oauth2Valid,
        needsOAuth1: !tokenValidation.oauth1Valid
      });
    }

    if (!hasVideo && !tokenValidation.oauth2Valid) {
      return res.status(400).json({
        success: false,
        error: 'OAuth2 token required for posting',
        requiresAuth: true
      });
    }

    // Always reload connection from database to get latest tokens (never use cached connection)
    logger.info('📦 Reloading connection from database to ensure latest tokens...');
    let freshConnection = await connectionRepository.findOne({
      where: { projectId }
    });

    if (!freshConnection) {
      return res.status(400).json({
        success: false,
        error: 'Twitter not connected for this project',
        requiresAuth: true
      });
    }

    // Check OAuth scopes from fresh database record
    const userScopes = freshConnection.scopes || '';
    const hasWriteAccess = userScopes.includes('tweet.write');
    const hasMediaWriteAccess = userScopes.includes('media.write');
    
    logger.info('🔍 Project OAuth scopes:', userScopes);
    logger.info('🔍 Has write access:', hasWriteAccess);
    logger.info('🔍 Has media write access:', hasMediaWriteAccess);

    if (!hasWriteAccess) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient Twitter permissions. Please reconnect your Twitter account to grant write access.',
        requiresReauth: true,
        currentScopes: userScopes
      });
    }

    if (!hasMediaWriteAccess && (imageUrl || videoUrl)) {
      logger.warn('⚠️ Missing media.write scope but proceeding (may fail if required)');
    }

    // Get OAuth2 token from fresh database record
    let oauth2Token = freshConnection.oauth2AccessToken;

    // Check if token exists
    if (!oauth2Token) {
      return res.status(400).json({
        success: false,
        error: 'OAuth2 access token not found',
        requiresAuth: true
      });
    }

    // Refresh token if expired - always reload from database after refresh
    if (freshConnection.oauth2ExpiresAt && freshConnection.oauth2ExpiresAt < new Date()) {
      logger.info('🔄 OAuth2 token expired, refreshing...');
      const refreshed = await refreshOAuth2Token(freshConnection);
      if (!refreshed) {
        return res.status(400).json({
          success: false,
          error: 'Token expired and refresh failed',
          requiresAuth: true
        });
      }
      
      // CRITICAL: Always reload connection from database after token refresh to get latest tokens
      logger.info('📦 Reloading connection from database after token refresh...');
      freshConnection = await connectionRepository.findOne({
        where: { projectId }
      });
      
      if (!freshConnection || !freshConnection.oauth2AccessToken) {
        return res.status(400).json({
          success: false,
          error: 'Failed to reload connection after token refresh',
          requiresAuth: true
        });
      }
      
      // Use token from freshly reloaded database record
      oauth2Token = freshConnection.oauth2AccessToken;
      logger.info('✅ Using refreshed token from database');
    }

    // Test the token with a simple API call (like the working flow does)
    logger.info('🔍 Testing OAuth2 token validity...');
    try {
      const testResponse = await fetch('https://api.twitter.com/2/users/me', {
        headers: {
          'Authorization': `Bearer ${oauth2Token}`,
          'User-Agent': 'BurnieAI/1.0'
        }
      });
      logger.info(`🔍 Token test API call status: ${testResponse.status}`);
      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        logger.error(`❌ Token test failed: ${testResponse.status} - ${errorText}`);
        // Token is invalid, need to re-authenticate
        // Return 401 status with requiresAuth flag (matches what frontend expects)
        return res.status(401).json({
          success: false,
          error: 'OAuth2 token is invalid or expired. Please reconnect your Twitter account.',
          requiresAuth: true,
          requiresReauth: true // Also include this for compatibility
        });
      }
      logger.info('✅ OAuth2 token is valid');
    } catch (error: any) {
      logger.error(`❌ Token test error: ${error.message}`);
      return res.status(401).json({
        success: false,
        error: 'Failed to validate OAuth2 token. Please reconnect your Twitter account.',
        requiresAuth: true,
        requiresReauth: true // Also include this for compatibility
      });
    }

    // Upload media
    let mediaId: string | null = null;
    
    if (videoUrl) {
      logger.info('🎬 Video content detected - using OAuth1.0a with Twitter API v1.1 for upload...');
      
      // CRITICAL: Always reload connection from database to get latest OAuth1 tokens
      logger.info('📦 Reloading connection from database to get latest OAuth1 tokens...');
      const oauth1Connection = await connectionRepository.findOne({
        where: { projectId }
      });
      
      if (!oauth1Connection || !oauth1Connection.oauth1Token || !oauth1Connection.oauth1TokenSecret) {
        return res.status(400).json({
          success: false,
          error: 'OAuth1 tokens required for video upload',
          requiresAuth: true
        });
      }
      
      logger.info(`🔑 Using OAuth1 token from database: ${oauth1Connection.oauth1Token.substring(0, 10)}... (length: ${oauth1Connection.oauth1Token.length})`);
      
      // Video upload uses OAuth1.0a with v1.1 endpoint (uploadVideoOAuth1)
      // Always use tokens from fresh database record
      mediaId = await uploadVideoToTwitter(videoUrl, oauth1Connection.oauth1Token, oauth1Connection.oauth1TokenSecret);
    } else if (imageUrl) {
      logger.info('🖼️ Image content detected - using OAuth2 with Twitter API v2 for upload...');
      logger.info(`🔑 Using OAuth2 token from database: ${oauth2Token.substring(0, 10)}... (length: ${oauth2Token.length})`);
      // Image upload uses OAuth2 with v2 endpoint (uploadImageToTwitter)
      mediaId = await uploadImageToTwitter(oauth2Token, imageUrl);
    }

    if ((videoUrl || imageUrl) && !mediaId) {
      return res.status(500).json({
        success: false,
        error: 'Failed to upload media to Twitter'
      });
    }

    // Before creating tweet, reload connection one more time to ensure we have the absolute latest token
    // This is especially important if token was refreshed earlier
    logger.info('📦 Final reload of connection from database before creating tweet...');
    const finalConnection = await connectionRepository.findOne({
      where: { projectId }
    });
    
    if (!finalConnection || !finalConnection.oauth2AccessToken) {
      return res.status(400).json({
        success: false,
        error: 'Failed to reload connection before creating tweet',
        requiresAuth: true
      });
    }
    
    // Use the absolutely latest token from database
    const finalOAuth2Token = finalConnection.oauth2AccessToken;
    logger.info('✅ Using final OAuth2 token from database for tweet creation');
    
    // Create main tweet using OAuth2 with Twitter API v2 endpoint
    // This works with media_ids from both OAuth1 (video) and OAuth2 (image) uploads
    logger.info('📝 Creating main tweet using OAuth2 with Twitter API v2...');
    if (mediaId) {
      logger.info(`📎 Using media ID from ${videoUrl ? 'OAuth1 video upload' : 'OAuth2 image upload'}: ${mediaId}`);
    }
    // Always use token from fresh database record
    const mainTweetId = await createTweet(finalOAuth2Token, mainTweet, mediaId || undefined);

    if (!mainTweetId) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create tweet'
      });
    }

    // Create thread tweets if any - use same token from database
    const threadTweetIds = [mainTweetId];
    if (thread && thread.length > 0) {
      for (const threadTweet of thread) {
        const threadTweetId = await createTweet(finalOAuth2Token, threadTweet, undefined, threadTweetIds[threadTweetIds.length - 1]);
        if (threadTweetId) {
          threadTweetIds.push(threadTweetId);
        } else {
          logger.warn(`Failed to create thread tweet: ${threadTweet}`);
        }
      }
    }

    // Store in database
    await storeProjectTwitterPost(
      projectId,
      mainTweet,
      mainTweetId,
      threadTweetIds,
      thread,
      mediaId || undefined,
      imageUrl || undefined,
      videoUrl || undefined,
      scheduleId || null
    );

    logger.info(`✅ Successfully posted to Twitter for project ${projectId}`);

    return res.json({
      success: true,
      data: {
        mainTweetId,
        threadTweetIds,
        mediaId,
        tweetUrl: `https://twitter.com/i/web/status/${mainTweetId}`
      }
    });
  } catch (error: any) {
    logger.error(`❌ Error posting to Twitter: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to post to Twitter',
      details: error.message
    });
  }
});

export { router as projectTwitterPostingRoutes };

