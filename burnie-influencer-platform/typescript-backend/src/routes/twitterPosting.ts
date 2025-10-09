import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Repository } from 'typeorm';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { UserTwitterPost, PostType, PlatformSource } from '../models/UserTwitterPost';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { User } from '../models/User';
import { logger } from '../config/logger';
import { uploadVideoOAuth1 } from '../utils/oauth1Utils';

// Helper function to extract S3 key from URL
function extractS3KeyFromUrl(url: string): string | null {
  try {
    if (!url.includes('s3.amazonaws.com')) {
      return null;
    }
    
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // Remove leading slash and query parameters
    const s3Key = path.substring(1).split('?')[0];
    
    if (s3Key && s3Key.length > 0) {
      return s3Key;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting S3 key from URL:', error);
    return null;
  }
}

// Helper function to generate presigned URL for Twitter media upload
async function generatePresignedUrlForTwitter(s3Key: string): Promise<string | null> {
  try {
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
    if (!pythonBackendUrl) {
      console.error('PYTHON_AI_BACKEND_URL environment variable is not set');
      return null;
    }

    console.log(`🔗 Requesting presigned URL for S3 key: ${s3Key}`);
    
    // Python backend expects query parameters, not JSON body
    const queryParams = new URLSearchParams({
      s3_key: s3Key,
      expiration: '3600' // 1 hour
    });
    
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Python backend responded with ${response.status}`);
    }

    const result = await response.json() as {
      status: string;
      presigned_url?: string;
      error?: string;
    };

    if (result.status === 'success' && result.presigned_url) {
      console.log(`✅ Generated presigned URL for S3 key: ${s3Key}`);
      return result.presigned_url;
    } else {
      console.error(`Failed to generate presigned URL: ${result.error}`);
      return null;
    }
  } catch (error) {
    console.error(`Error generating presigned URL for S3 key: ${s3Key}`, error);
    return null;
  }
}

const router = Router();

// Helper function to determine post type
function determinePostType(mainTweet: string, thread?: string[]): PostType {
  if (thread && thread.length > 0) {
    return 'thread';
  }
  
  // Consider longpost if tweet is longer than 280 characters (Twitter's limit)
  if (mainTweet.length > 280) {
    return 'longpost';
  }
  
  return 'shitpost';
}

// Helper function to extract Twitter image URL from media upload response
function extractTwitterImageUrl(mediaId: string): string | null {
  // Twitter doesn't return direct image URLs in media upload response
  // We'll store the media ID and can construct URL later if needed
  // For now, return null as we don't have direct access to the final image URL
  return null;
}

// Function to store Twitter post data
async function storeTwitterPostData(
  walletAddress: string,
  mainTweet: string,
  mainTweetId: string,
  threadTweetIds: string[],
  thread?: string[],
  mediaId?: string,
  imageUrl?: string,
  videoUrl?: string,
  contentId?: number,
  platformSource: PlatformSource = 'other'
): Promise<UserTwitterPost | null> {
  try {
    const userTwitterPostRepository = AppDataSource.getRepository(UserTwitterPost);
    
    const postType = determinePostType(mainTweet, thread);
    const twitterImageUrl = mediaId ? extractTwitterImageUrl(mediaId) : null;
    
    const userTwitterPost = new UserTwitterPost();
    userTwitterPost.walletAddress = walletAddress.toLowerCase();
    userTwitterPost.postType = postType;
    userTwitterPost.mainTweet = mainTweet;
    userTwitterPost.mainTweetId = mainTweetId;
    if (thread && thread.length > 0) {
      userTwitterPost.tweetThread = thread;
    }
    userTwitterPost.imageUrl = imageUrl || twitterImageUrl;
    userTwitterPost.videoUrl = videoUrl || null;
    userTwitterPost.engagementMetrics = {};
    userTwitterPost.postedAt = new Date();
    userTwitterPost.contentId = contentId || null;
    userTwitterPost.platformSource = platformSource;
    if (threadTweetIds.length > 1) {
      userTwitterPost.threadTweetIds = threadTweetIds;
    }
    userTwitterPost.twitterMediaId = mediaId || null;
    userTwitterPost.threadCount = threadTweetIds.length;
    userTwitterPost.lastEngagementFetch = null;

    const savedPost = await userTwitterPostRepository.save(userTwitterPost);
    
    logger.info(`✅ Stored Twitter post data: ${savedPost.id} for wallet ${walletAddress}`);
    logger.info(`📊 Post details: Type=${postType}, MainTweetId=${mainTweetId}, ThreadCount=${threadTweetIds.length}`);
    
    return savedPost;
  } catch (error) {
    logger.error('❌ Error storing Twitter post data:', error);
    return null;
  }
}

// YapperTwitterConnection model is imported above

// Helper function to refresh Twitter token
const refreshTwitterToken = async (connection: YapperTwitterConnection): Promise<string | null> => {
  try {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refreshToken || '',
        client_id: process.env.TWITTER_CLIENT_ID!
      })
    });

    if (!response.ok) {
      console.error('Token refresh failed:', await response.text());
      return null;
    }

    const data = await response.json() as any;
    
    // Update the connection with new tokens
    const repository = AppDataSource.getRepository('YapperTwitterConnection');
    await repository.update(connection.id, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || connection.refreshToken,
      tokenExpiresAt: new Date(Date.now() + (data.expires_in * 1000))
    });

    return data.access_token;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return null;
  }
};

// Upload image to Twitter
const uploadImageToTwitter = async (accessToken: string, imageUrl: string): Promise<string | null> => {
  try {
    console.log('🔍 Starting image upload for URL:', imageUrl);
    
    // Download the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    // For node-fetch v2, use arrayBuffer() instead of buffer()
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(imageArrayBuffer);
    console.log('🔍 Downloaded image, size:', imageBuffer.length, 'bytes');
    
    // Create form data for Twitter media upload
    const formData = new FormData();
    formData.append('media', imageBuffer, {
      filename: 'tweet-image.jpg',
      contentType: 'image/jpeg'
    });
    formData.append('media_category', 'tweet_image');
    
    console.log('🔍 FormData created with media size:', imageBuffer.length, 'bytes');

    // Upload to Twitter using API v2 endpoint
    const uploadResponse = await fetch('https://api.twitter.com/2/media/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
        // Don't set Content-Type - let FormData set it with boundary
      },
      body: formData
    });
    
    console.log('🔍 Twitter API request sent to:', 'https://api.twitter.com/2/media/upload');
    console.log('🔍 Request headers:', {
      'Authorization': `Bearer ${accessToken.substring(0, 10)}...`,
      'Content-Type': 'multipart/form-data (auto-generated)'
    });

    console.log('🔍 Media upload response status:', uploadResponse.status);
    console.log('🔍 Media upload response headers:', Object.fromEntries(uploadResponse.headers.entries()));
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('❌ Image upload failed with status:', uploadResponse.status);
      console.error('❌ Error response:', errorText);
      
      // Try to parse the error response
      try {
        const errorJson = JSON.parse(errorText);
        console.error('❌ Detailed error response:', errorJson);
      } catch (e) {
        console.error('❌ Error response is not JSON:', errorText);
      }
      
      // Media upload API v2 authentication issue
      if (uploadResponse.status === 403) {
        console.error('❌ Image upload 403: Check if user has media.write scope');
        console.error('🔧 May need to add media.write scope to OAuth request');
      }
      
      // Rate limit issue
      if (uploadResponse.status === 429) {
        console.error('❌ Image upload 429: Rate limit exceeded');
      }
      
      return null;
    }

    const uploadData = await uploadResponse.json() as any;
    console.log('🔍 Image upload response:', uploadData);
    
    // Twitter API v2 returns { data: { id: "media_id" } }
    return uploadData.data?.id || uploadData.media_id_string;
  } catch (error) {
    console.error('Error uploading image:', error);
    return null;
  }
};

// Upload video to Twitter using OAuth 1.0a (chunked upload process)
const uploadVideoToTwitter = async (
  walletAddress: string, 
  videoUrl: string
): Promise<string | null> => {
  try {
    console.log('🎬 Starting OAuth 1.0a video upload...');
    
    // Get user's OAuth 1.0a credentials
    const userRepository = AppDataSource.getRepository(User);
    const connectionRepository = AppDataSource.getRepository(YapperTwitterConnection);
    
    // Find user by wallet address
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() } 
    });
    
    if (!user) {
      console.error('❌ User not found for wallet:', walletAddress);
      return null;
    }
    
    // Find Twitter connection with OAuth 1.0a tokens
    const connection = await connectionRepository.findOne({
      where: { userId: user.id }
    });
    
    if (!connection) {
      console.error('❌ No Twitter connection found for user:', user.id);
      return null;
    }
    
    // Check if OAuth 1.0a tokens are available
    if (!connection.canUploadVideos()) {
      console.warn('⚠️ OAuth 1.0a tokens not available for video upload');
      console.warn('⚠️ User needs to complete OAuth 1.0a flow for video uploads');
      return null;
    }
    
    console.log('✅ OAuth 1.0a credentials found, proceeding with video upload');
    
    // Upload video using OAuth 1.0a
    const mediaId = await uploadVideoOAuth1(
      videoUrl,
      connection.oauth1AccessToken!,
      connection.oauth1AccessTokenSecret!
    );
    
    console.log('✅ Video uploaded successfully via OAuth 1.0a, media_id:', mediaId);
    return mediaId;

  } catch (error: any) {
    console.error('❌ Error uploading video to Twitter:', error.message);
    return null;
  }
};

// Create a tweet
const createTweet = async (accessToken: string, text: string, mediaId?: string, replyToId?: string): Promise<string | null> => {
  try {
    const tweetData: any = {
      text: text
    };

    if (mediaId) {
      tweetData.media = {
        media_ids: [mediaId]
      };
    }

    if (replyToId) {
      tweetData.reply = {
        in_reply_to_tweet_id: replyToId
      };
    }

    console.log('🔍 Creating tweet with data:', JSON.stringify(tweetData, null, 2));
    
    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(tweetData)
    });

    console.log('🔍 Tweet creation response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Tweet creation failed:', errorText);
      console.error('Tweet creation status:', response.status);
      console.error('Tweet data sent:', JSON.stringify(tweetData, null, 2));
      return null;
    }

    const data = await response.json() as any;
    return data.data.id;
  } catch (error) {
    console.error('Error creating tweet:', error);
    return null;
  }
};

// POST /api/twitter/post-thread
router.post('/post-thread', async (req: Request, res: Response) => {
  try {
    const { mainTweet, thread, imageUrl, videoUrl, contentId, platformSource } = req.body;
    const walletAddress = req.headers.authorization?.replace('Bearer ', '');

    if (!walletAddress) {
      return res.status(401).json({ success: false, error: 'Wallet address required' });
    }

    if (!mainTweet) {
      return res.status(400).json({ success: false, error: 'Main tweet content required' });
    }

    // Find user by wallet address (case-insensitive)
    const { User } = await import('../models/User');
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() } 
    });

    console.log('🔍 Twitter posting - wallet lookup:', {
      originalAddress: walletAddress,
      lowercaseAddress: walletAddress.toLowerCase(),
      userFound: !!user,
      userId: user?.id
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Find Twitter connection
    const { YapperTwitterConnection } = await import('../models/YapperTwitterConnection');
    const twitterRepository = AppDataSource.getRepository(YapperTwitterConnection);
    const connection = await twitterRepository.findOne({ 
      where: { userId: user.id, isConnected: true } 
    });

    console.log('🔍 Twitter posting - connection lookup:', {
      userId: user.id,
      connectionFound: !!connection,
      isConnected: connection?.isConnected,
      twitterUsername: connection?.twitterUsername
    });

    if (!connection) {
      return res.status(400).json({ 
        success: false, 
        error: 'Twitter not connected',
        requiresAuth: true 
      });
    }

    // Check if user has write permissions (look for scope in yapperData)
    const userScopes = connection.yapperData?.scope || '';
    const hasWriteAccess = userScopes.includes('tweet.write');
    const hasMediaWriteAccess = userScopes.includes('media.write');
    
    console.log('🔍 User OAuth scopes:', userScopes);
    console.log('🔍 Has write access:', hasWriteAccess);
    console.log('🔍 Has media write access:', hasMediaWriteAccess);

    if (!hasWriteAccess) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient Twitter permissions. Please reconnect your Twitter account to grant write access.',
        requiresReauth: true,
        currentScopes: userScopes
      });
    }

    let accessToken = connection.accessToken;

    console.log('🔍 Access token info:', {
      tokenLength: accessToken?.length,
      tokenPrefix: accessToken?.substring(0, 10) + '...',
      tokenExpiresAt: connection.tokenExpiresAt,
      isExpired: connection.tokenExpiresAt ? connection.tokenExpiresAt < new Date() : 'unknown'
    });

    // Test the token with a simple API call first
    try {
      const testResponse = await fetch('https://api.twitter.com/2/users/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'BurnieAI/1.0'
        }
      });
      console.log('🔍 Token test API call status:', testResponse.status);
      if (!testResponse.ok) {
        const errorText = await testResponse.text();
        console.log('🔍 Token test failed:', errorText);
      }
    } catch (error) {
      console.log('🔍 Token test error:', error);
    }

    // Check if token needs refresh
    if (connection.tokenExpiresAt && connection.tokenExpiresAt < new Date()) {
      const newToken = await refreshTwitterToken(connection as any);
      if (!newToken) {
        return res.status(400).json({ 
          success: false, 
          error: 'Twitter token expired and refresh failed',
          requiresAuth: true 
        });
      }
      accessToken = newToken;
    }

    // Check if accessToken is valid
    if (!accessToken) {
      return res.status(400).json({ 
        success: false, 
        error: 'No valid access token available',
        requiresAuth: true 
      });
    }

    // Upload media - prioritize video over image
    let mediaId: string | null = null;
    console.log('🔍 Checking for media URLs - Video:', !!videoUrl, 'Image:', !!imageUrl);
    
    if (videoUrl) {
      console.log('🎬 Video URL found, attempting video upload...');
      
      // Generate fresh presigned URL for video if it's from S3
      let freshVideoUrl = videoUrl;
      if (videoUrl.includes('s3.amazonaws.com')) {
        try {
          console.log('🎬 Generating fresh presigned URL for Twitter video upload...');
          const s3Key = extractS3KeyFromUrl(videoUrl);
          if (s3Key) {
            const presignedUrl = await generatePresignedUrlForTwitter(s3Key);
            if (presignedUrl) {
              freshVideoUrl = presignedUrl;
              console.log('✅ Generated fresh presigned URL for Twitter video upload');
            } else {
              console.warn('⚠️ Failed to generate fresh presigned URL for video, using original URL');
            }
          } else {
            console.warn('⚠️ Could not extract S3 key from video URL, using original URL');
          }
        } catch (error) {
          console.error('❌ Error generating fresh presigned URL for video:', error);
          console.warn('⚠️ Using original URL for video upload');
        }
      }
      
      mediaId = await uploadVideoToTwitter(walletAddress, freshVideoUrl);
      if (!mediaId) {
        console.error('❌ Video upload failed - no fallback to image upload');
        return res.status(400).json({ 
          success: false, 
          error: 'Video upload failed. Please try again or check if the video file is valid.',
          requiresRetry: true 
        });
      } else {
        console.log('✅ Video uploaded successfully, media ID:', mediaId);
      }
    } else if (imageUrl) {
      console.log('🔍 Image URL found, attempting image upload...');
      
      // Generate fresh presigned URL before uploading to Twitter
      let freshImageUrl = imageUrl;
      if (imageUrl.includes('s3.amazonaws.com')) {
        try {
          console.log('🔍 Generating fresh presigned URL for Twitter image upload...');
          const s3Key = extractS3KeyFromUrl(imageUrl);
          if (s3Key) {
            const presignedUrl = await generatePresignedUrlForTwitter(s3Key);
            if (presignedUrl) {
              freshImageUrl = presignedUrl;
              console.log('✅ Generated fresh presigned URL for Twitter image upload');
            } else {
              console.warn('⚠️ Failed to generate fresh presigned URL, using original URL');
            }
          } else {
            console.warn('⚠️ Could not extract S3 key from image URL, using original URL');
          }
        } catch (error) {
          console.error('❌ Error generating fresh presigned URL:', error);
          console.warn('⚠️ Using original URL for media upload');
        }
      }
      
      mediaId = await uploadImageToTwitter(accessToken, freshImageUrl);
      if (!mediaId) {
        console.warn('⚠️ Failed to upload image, proceeding without media');
      } else {
        console.log('✅ Image uploaded successfully, media ID:', mediaId);
      }
    } else {
      console.log('🔍 No media URLs provided, proceeding without media');
    }

    // Create main tweet
    const mainTweetId = await createTweet(accessToken, mainTweet, mediaId || undefined);
    if (!mainTweetId) {
      return res.status(500).json({ success: false, error: 'Failed to create main tweet' });
    }

    let lastTweetId = mainTweetId;
    const threadTweetIds: string[] = [mainTweetId];

    // Create thread replies
    if (thread && thread.length > 0) {
      for (const threadTweet of thread) {
        const tweetId = await createTweet(accessToken, threadTweet, undefined, lastTweetId);
        if (!tweetId) {
          console.warn('Failed to create thread tweet, stopping thread creation');
          break;
        }
        threadTweetIds.push(tweetId);
        lastTweetId = tweetId;
      }
    }

    // Store Twitter post data in database
    const storedPost = await storeTwitterPostData(
      walletAddress,
      mainTweet,
      mainTweetId,
      threadTweetIds,
      thread,
      mediaId || undefined,
      imageUrl,
      videoUrl,
      contentId,
      (platformSource as PlatformSource) || 'other'
    );

    if (!storedPost) {
      logger.warn(`⚠️ Failed to store Twitter post data for wallet ${walletAddress}, but tweet was posted successfully`);
    }

    return res.json({
      success: true,
      mainTweetId,
      threadTweetIds,
      tweetCount: threadTweetIds.length,
      postId: storedPost?.id || null
    });

  } catch (error) {
    console.error('Error posting thread:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// GET /api/twitter/status - Check Twitter connection status
router.get('/status', async (req: Request, res: Response) => {
  try {
    const walletAddress = req.headers.authorization?.replace('Bearer ', '');

    if (!walletAddress) {
      return res.status(401).json({ success: false, error: 'Wallet address required' });
    }

    // Find user by wallet address (case-insensitive)
    const { User } = await import('../models/User');
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() } 
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Find Twitter connection
    const { YapperTwitterConnection } = await import('../models/YapperTwitterConnection');
    const twitterRepository = AppDataSource.getRepository(YapperTwitterConnection);
    const connection = await twitterRepository.findOne({ 
      where: { userId: user.id, isConnected: true } 
    });

    if (!connection) {
      return res.json({
        success: true,
        connected: false,
        requiresAuth: true
      });
    }

    // Check token expiry
    const isExpired = connection.tokenExpiresAt && connection.tokenExpiresAt < new Date();

    return res.json({
      success: true,
      connected: true,
      username: connection.twitterUsername,
      displayName: connection.twitterDisplayName,
      profileImage: connection.profileImageUrl,
      tokenExpired: isExpired,
      requiresAuth: isExpired
    });

  } catch (error) {
    console.error('Error checking Twitter status:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error'
    });
  }
});

export default router;
