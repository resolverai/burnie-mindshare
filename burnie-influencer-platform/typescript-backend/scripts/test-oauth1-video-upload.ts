#!/usr/bin/env ts-node

/**
 * Standalone OAuth 1.0a Video Upload Test Script
 * Tests video upload for content ID 508 using Twitter API v1.1
 * 
 * Usage: cd typescript-backend && npx ts-node scripts/test-oauth1-video-upload.ts
 */

import crypto from 'crypto';
import fetch from 'node-fetch';
import FormData from 'form-data';
import * as readline from 'readline';

// OAuth 1.0a Credentials (from environment variables)
const TWITTER_API_KEY = process.env.TWITTER_CONSUMER_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_CONSUMER_SECRET;

if (!TWITTER_API_KEY || !TWITTER_API_SECRET) {
  console.error('❌ Twitter OAuth 1.0a credentials not found in environment variables');
  console.error('Please set TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET in your .env file');
  process.exit(1);
}

// Type assertions after validation
const consumerKey: string = TWITTER_API_KEY;
const consumerSecret: string = TWITTER_API_SECRET;

// Test content from content ID 508
const TEST_CONTENT = {
  id: 508,
  text: "Ever pondered how to make AI content as secure as a blockchain? ROAST's consensus mechanism weeds out the junk better than my debug sessions. Honest evaluators win big – finally, truth in the meme economy. $ROAST might just be the plot twist. 🤔 @burnieio",
  videoUrl: "https://burnie-mindshare-content-staging.s3.amazonaws.com/ai-generated/3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e/7/videos/video-generation/2025-10-08/073859_49267ab7.mp4"
};

// Global tokens (set after OAuth flow)
let TWITTER_ACCESS_TOKEN: string | null = null;
let TWITTER_ACCESS_TOKEN_SECRET: string | null = null;

interface OAuthTokens {
  requestToken: string;
  requestTokenSecret: string;
}

interface AccessTokens {
  accessToken: string;
  accessTokenSecret: string;
  screenName: string;
}

/**
 * Generate OAuth 1.0a signature for requests
 */
function generateOAuthSignature(
  method: string, 
  url: string, 
  params: Record<string, string>, 
  consumerSecret: string, 
  tokenSecret: string = ''
): string {
  // Create parameter string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] || '')}`)
    .join('&');

  // Create signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');

  // Create signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  // Generate signature
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  return signature;
}

/**
 * Generate OAuth 1.0a Authorization header
 */
function generateOAuthHeader(method: string, url: string, additionalParams: Record<string, string> = {}): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp.toString(),
    oauth_version: '1.0',
    ...additionalParams
  };

  // Add access token if available
  if (TWITTER_ACCESS_TOKEN) {
    oauthParams.oauth_token = TWITTER_ACCESS_TOKEN;
  }

  // Generate signature
  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    consumerSecret,
    TWITTER_ACCESS_TOKEN_SECRET || ''
  );

  oauthParams.oauth_signature = signature;

  // Build authorization header
  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key] || '')}"`)
    .join(', ');

  return authHeader;
}

/**
 * Step 1: Get OAuth 1.0a Request Token
 */
async function getRequestToken(): Promise<OAuthTokens> {
  console.log('🔑 Step 1: Getting OAuth 1.0a request token...');
  
  const url = 'https://api.twitter.com/oauth/request_token';
  const authHeader = generateOAuthHeader('POST', url, {
    oauth_callback: 'oob' // Out-of-band for manual authorization
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Request token failed: ${response.status} - ${errorText}`);
    }

    const responseText = await response.text();
    console.log('✅ Request token response:', responseText);

    // Parse response
    const params = new URLSearchParams(responseText);
    const requestToken = params.get('oauth_token');
    const requestTokenSecret = params.get('oauth_token_secret');

    if (!requestToken || !requestTokenSecret) {
      throw new Error('Invalid request token response');
    }

    return { requestToken, requestTokenSecret };
  } catch (error: any) {
    console.error('❌ Request token error:', error.message);
    throw error;
  }
}

/**
 * Step 2: Get user authorization (manual step)
 */
function getAuthorizationUrl(requestToken: string): string {
  const authUrl = `https://api.twitter.com/oauth/authorize?oauth_token=${requestToken}`;
  console.log('\n🔗 Step 2: User Authorization Required');
  console.log('Please visit this URL to authorize the application:');
  console.log(authUrl);
  console.log('\nAfter authorization, you will get a PIN code.');
  console.log('Enter the PIN code when prompted to continue...\n');
  return authUrl;
}

/**
 * Step 3: Exchange request token + PIN for access token
 */
async function getAccessToken(requestToken: string, requestTokenSecret: string, verifier: string): Promise<AccessTokens> {
  console.log('🔑 Step 3: Exchanging request token for access token...');
  
  const url = 'https://api.twitter.com/oauth/access_token';
  
  // Temporarily set request token for signature generation
  const tempToken = TWITTER_ACCESS_TOKEN;
  const tempSecret = TWITTER_ACCESS_TOKEN_SECRET;
  TWITTER_ACCESS_TOKEN = requestToken;
  TWITTER_ACCESS_TOKEN_SECRET = requestTokenSecret;
  
  const authHeader = generateOAuthHeader('POST', url, {
    oauth_verifier: verifier
  });
  
  // Restore original tokens
  TWITTER_ACCESS_TOKEN = tempToken;
  TWITTER_ACCESS_TOKEN_SECRET = tempSecret;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `oauth_verifier=${verifier}`
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Access token failed: ${response.status} - ${errorText}`);
    }

    const responseText = await response.text();
    console.log('✅ Access token response:', responseText);

    // Parse response
    const params = new URLSearchParams(responseText);
    const accessToken = params.get('oauth_token');
    const accessTokenSecret = params.get('oauth_token_secret');
    const screenName = params.get('screen_name');

    if (!accessToken || !accessTokenSecret) {
      throw new Error('Invalid access token response');
    }

    console.log(`✅ Access token obtained for user: @${screenName}`);
    return { accessToken, accessTokenSecret, screenName: screenName || 'unknown' };
  } catch (error: any) {
    console.error('❌ Access token error:', error.message);
    throw error;
  }
}

/**
 * Generate fresh presigned URL for S3 video
 */
async function generateFreshPresignedUrl(s3Url: string): Promise<string> {
  console.log('🔗 Generating fresh presigned URL...');
  
  // Extract S3 key from URL
  const urlParts = s3Url.split('/');
  const bucketIndex = urlParts.findIndex(part => part.includes('s3.amazonaws.com'));
  if (bucketIndex === -1) {
    throw new Error('Invalid S3 URL format');
  }
  
  const s3Key = urlParts.slice(bucketIndex + 1).join('/').split('?')[0];
  console.log('🔑 Extracted S3 key:', s3Key);
  
  if (!s3Key) {
    throw new Error('Could not extract S3 key from URL');
  }
  
  try {
    // Call the Python backend to generate fresh presigned URL
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?s3_key=${encodeURIComponent(s3Key)}&expiration=3600`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to generate presigned URL: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    const freshUrl = data.presigned_url;
    
    console.log('✅ Generated fresh presigned URL');
    return freshUrl;
  } catch (error: any) {
    console.error('❌ Failed to generate fresh presigned URL:', error.message);
    throw error;
  }
}

/**
 * Upload video using OAuth 1.0a chunked upload
 */
async function uploadVideoOAuth1(videoUrl: string): Promise<string> {
  console.log('🎬 Starting OAuth 1.0a video upload...');
  console.log('🎬 Original Video URL:', videoUrl);

  try {
    // Generate fresh presigned URL
    const freshVideoUrl = await generateFreshPresignedUrl(videoUrl);
    console.log('🎬 Fresh Video URL generated');
    
    // Download video
    console.log('📥 Downloading video...');
    const videoResponse = await fetch(freshVideoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.statusText}`);
    }

    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const totalBytes = videoBuffer.length;
    console.log(`📥 Downloaded video: ${totalBytes} bytes`);

    // Step 1: INIT
    console.log('🎬 Step 1: Initializing upload...');
    const initUrl = 'https://upload.twitter.com/1.1/media/upload.json';
    const initParams = {
      command: 'INIT',
      total_bytes: totalBytes.toString(),
      media_type: 'video/mp4',
      media_category: 'tweet_video'
    };

    const initFormData = new FormData();
    Object.keys(initParams).forEach(key => {
      initFormData.append(key, (initParams as any)[key]);
    });

    const initAuthHeader = generateOAuthHeader('POST', initUrl);
    
    const initResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        'Authorization': initAuthHeader
      },
      body: initFormData
    });

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      throw new Error(`INIT failed: ${initResponse.status} - ${errorText}`);
    }

    const initData = await initResponse.json() as any;
    const mediaId = initData.media_id_string;
    console.log('✅ Upload initialized, media_id:', mediaId);

    // Step 2: APPEND chunks
    console.log('🎬 Step 2: Uploading chunks...');
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    const totalChunks = Math.ceil(totalBytes / chunkSize);

    for (let segmentIndex = 0; segmentIndex < totalChunks; segmentIndex++) {
      const start = segmentIndex * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      const chunk = videoBuffer.slice(start, end);

      console.log(`📤 Uploading chunk ${segmentIndex + 1}/${totalChunks} (${chunk.length} bytes)`);

      const appendFormData = new FormData();
      appendFormData.append('command', 'APPEND');
      appendFormData.append('media_id', mediaId);
      appendFormData.append('segment_index', segmentIndex.toString());
      appendFormData.append('media', chunk, {
        filename: `chunk_${segmentIndex}.mp4`,
        contentType: 'video/mp4'
      });

      const appendAuthHeader = generateOAuthHeader('POST', initUrl);
      
      const appendResponse = await fetch(initUrl, {
        method: 'POST',
        headers: {
          'Authorization': appendAuthHeader
        },
        body: appendFormData
      });

      if (!appendResponse.ok) {
        const errorText = await appendResponse.text();
        throw new Error(`APPEND chunk ${segmentIndex} failed: ${appendResponse.status} - ${errorText}`);
      }

      console.log(`✅ Chunk ${segmentIndex + 1}/${totalChunks} uploaded`);
    }

    // Step 3: FINALIZE
    console.log('🎬 Step 3: Finalizing upload...');
    const finalizeFormData = new FormData();
    finalizeFormData.append('command', 'FINALIZE');
    finalizeFormData.append('media_id', mediaId);

    const finalizeAuthHeader = generateOAuthHeader('POST', initUrl);
    
    const finalizeResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        'Authorization': finalizeAuthHeader
      },
      body: finalizeFormData
    });

    if (!finalizeResponse.ok) {
      const errorText = await finalizeResponse.text();
      throw new Error(`FINALIZE failed: ${finalizeResponse.status} - ${errorText}`);
    }

    const finalizeData = await finalizeResponse.json() as any;
    console.log('✅ Upload finalized');

    // Step 4: Check processing status if needed
    if (finalizeData.processing_info) {
      console.log('🎬 Step 4: Waiting for processing...');
      await waitForProcessing(mediaId);
    }

    console.log('🎬 ✅ Video upload completed successfully!');
    return mediaId;

  } catch (error: any) {
    console.error('❌ Video upload error:', error.message);
    throw error;
  }
}

/**
 * Wait for video processing to complete
 */
async function waitForProcessing(mediaId: string): Promise<void> {
  const maxAttempts = 30;
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    attempts++;

    const statusUrl = `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`;
    const statusAuthHeader = generateOAuthHeader('GET', statusUrl);

    try {
      const statusResponse = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          'Authorization': statusAuthHeader
        }
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json() as any;
        console.log(`🎬 Processing status (attempt ${attempts}):`, statusData.processing_info?.state);

        if (!statusData.processing_info) {
          console.log('✅ Processing completed');
          break;
        }

        if (statusData.processing_info.state === 'succeeded') {
          console.log('✅ Processing succeeded');
          break;
        } else if (statusData.processing_info.state === 'failed') {
          throw new Error('Video processing failed');
        }
      }
    } catch (error: any) {
      console.warn('⚠️ Status check failed:', error.message);
    }
  }
}

/**
 * Post tweet with media using OAuth 1.0a
 */
async function postTweetWithMedia(text: string, mediaId: string): Promise<any> {
  console.log('🐦 Posting tweet with video...');
  
  const tweetUrl = 'https://api.twitter.com/2/tweets';
  const tweetData = {
    text: text,
    media: {
      media_ids: [mediaId]
    }
  };

  const tweetAuthHeader = generateOAuthHeader('POST', tweetUrl);

  try {
    const response = await fetch(tweetUrl, {
      method: 'POST',
      headers: {
        'Authorization': tweetAuthHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tweetData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tweet failed: ${response.status} - ${errorText}`);
    }

    const tweetResult = await response.json() as any;
    console.log('✅ Tweet posted successfully!');
    console.log('🔗 Tweet ID:', tweetResult.data.id);
    console.log('🔗 Tweet URL:', `https://twitter.com/user/status/${tweetResult.data.id}`);
    
    return tweetResult;
  } catch (error: any) {
    console.error('❌ Tweet posting error:', error.message);
    throw error;
  }
}

/**
 * Get user input from command line
 */
function getUserInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Main test function
 */
async function main(): Promise<void> {
  console.log('🚀 OAuth 1.0a Video Upload Test Script');
  console.log('=====================================\n');
  
  console.log('📋 Test Content:');
  console.log('Content ID:', TEST_CONTENT.id);
  console.log('Text:', TEST_CONTENT.text);
  console.log('Video URL:', TEST_CONTENT.videoUrl);
  console.log('');

  try {
    // Step 1: Get request token
    const { requestToken, requestTokenSecret } = await getRequestToken();
    
    // Step 2: Get user authorization
    getAuthorizationUrl(requestToken);
    
    // Wait for user input
    const verifier = await getUserInput('Enter the PIN code from Twitter: ');
    
    // Step 3: Get access token
    const { accessToken, accessTokenSecret, screenName } = await getAccessToken(
      requestToken, 
      requestTokenSecret, 
      verifier
    );
    
    // Set global tokens
    TWITTER_ACCESS_TOKEN = accessToken;
    TWITTER_ACCESS_TOKEN_SECRET = accessTokenSecret;
    
    console.log(`\n🎯 Ready to upload video for @${screenName}`);
    
    // Step 4: Upload video
    const mediaId = await uploadVideoOAuth1(TEST_CONTENT.videoUrl);
    
    // Step 5: Post tweet
    await postTweetWithMedia(TEST_CONTENT.text, mediaId);
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error: any) {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}

export {
  generateOAuthSignature,
  generateOAuthHeader,
  uploadVideoOAuth1,
  postTweetWithMedia
};
