import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Repository } from 'typeorm';
import fetch from 'node-fetch';
import FormData from 'form-data';

const router = Router();

// Import the YapperTwitterConnection model
interface YapperTwitterConnection {
  id: number;
  userId: number;
  twitterUserId: string;
  twitterUsername: string;
  twitterDisplayName: string;
  accessToken: string;
  refreshToken: string;
  profileImageUrl?: string;
  twitterFollowers?: number;
  twitterFollowing?: number;
  tokenExpiresAt?: Date;
  isConnected: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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
        refresh_token: connection.refreshToken,
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

// Upload media to Twitter
const uploadMediaToTwitter = async (accessToken: string, imageUrl: string): Promise<string | null> => {
  try {
    // Download the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.buffer();
    
    // Create form data for Twitter media upload
    const formData = new FormData();
    formData.append('media', imageBuffer, {
      filename: 'tweet-image.jpg',
      contentType: 'image/jpeg'
    });
    formData.append('media_category', 'tweet_image');

    // Upload to Twitter using API v2 endpoint
    const uploadResponse = await fetch('https://api.x.com/2/media/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    console.log('🔍 Media upload response status:', uploadResponse.status);
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Media upload failed:', errorText);
      console.error('Upload response status:', uploadResponse.status);
      console.error('Upload response headers:', Object.fromEntries(uploadResponse.headers.entries()));
      
      // Try to parse the error response
      try {
        const errorJson = JSON.parse(errorText);
        console.error('Detailed error response:', errorJson);
      } catch (e) {
        console.error('Error response is not JSON:', errorText);
      }
      
      // Media upload API v2 authentication issue
      if (uploadResponse.status === 403) {
        console.error('❌ Media upload 403: Check if user has media.write scope');
        console.error('🔧 May need to add media.write scope to OAuth request');
      }
      
      return null;
    }

    const uploadData = await uploadResponse.json() as any;
    console.log('🔍 Media upload response:', uploadData);
    
    // Twitter API v2 returns { data: { id: "media_id" } }
    return uploadData.data?.id || uploadData.media_id_string;
  } catch (error) {
    console.error('Error uploading media:', error);
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
    const { mainTweet, thread, imageUrl } = req.body;
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

    // Upload media if image exists
    let mediaId: string | null = null;
    if (imageUrl) {
      mediaId = await uploadMediaToTwitter(accessToken, imageUrl);
      if (!mediaId) {
        console.warn('Failed to upload media, proceeding without image');
      }
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

    return res.json({
      success: true,
      mainTweetId,
      threadTweetIds,
      tweetCount: threadTweetIds.length
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
