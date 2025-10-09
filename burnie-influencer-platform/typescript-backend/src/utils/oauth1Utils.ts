/**
 * OAuth 1.0a Utility Functions for Twitter API
 * Based on working test script implementation
 */

import crypto from 'crypto';
import fetch from 'node-fetch';
import FormData from 'form-data';

// OAuth 1.0a Consumer Credentials
const TWITTER_CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY;
const TWITTER_CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET;

if (!TWITTER_CONSUMER_KEY || !TWITTER_CONSUMER_SECRET) {
  throw new Error('Twitter OAuth 1.0a credentials not found in environment variables');
}

// Type assertions after validation
const consumerKey: string = TWITTER_CONSUMER_KEY;
const consumerSecret: string = TWITTER_CONSUMER_SECRET;

export interface OAuth1Tokens {
  accessToken: string;
  accessTokenSecret: string;
  screenName: string;
}

export interface OAuth1RequestTokens {
  requestToken: string;
  requestTokenSecret: string;
}

/**
 * Generate OAuth 1.0a signature for requests
 */
export function generateOAuthSignature(
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
export function generateOAuthHeader(
  method: string, 
  url: string, 
  accessToken?: string,
  accessTokenSecret?: string,
  additionalParams: Record<string, string> = {}
): string {
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
  if (accessToken) {
    oauthParams.oauth_token = accessToken;
  }

  // Generate signature
  const signature = generateOAuthSignature(
    method,
    url,
    oauthParams,
    consumerSecret,
    accessTokenSecret || ''
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
export async function getRequestToken(callbackUrl?: string): Promise<OAuth1RequestTokens> {
  const url = 'https://api.twitter.com/oauth/request_token';
  const authHeader = generateOAuthHeader('POST', url, undefined, undefined, {
    oauth_callback: callbackUrl || 'oob' // Use callback URL or out-of-band
  });

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

  // Parse response
  const params = new URLSearchParams(responseText);
  const requestToken = params.get('oauth_token');
  const requestTokenSecret = params.get('oauth_token_secret');

  if (!requestToken || !requestTokenSecret) {
    throw new Error('Invalid request token response');
  }

  return { requestToken, requestTokenSecret };
}

/**
 * Step 2: Generate authorization URL
 */
export function getAuthorizationUrl(requestToken: string, callbackUrl?: string): string {
  let url = `https://api.twitter.com/oauth/authorize?oauth_token=${requestToken}`;
  if (callbackUrl) {
    url += `&oauth_callback=${encodeURIComponent(callbackUrl)}`;
  }
  return url;
}

/**
 * Step 3: Exchange request token + PIN for access token
 */
export async function getAccessToken(
  requestToken: string, 
  requestTokenSecret: string, 
  verifier: string
): Promise<OAuth1Tokens> {
  const url = 'https://api.twitter.com/oauth/access_token';
  
  const authHeader = generateOAuthHeader('POST', url, requestToken, requestTokenSecret, {
    oauth_verifier: verifier
  });

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

  // Parse response
  const params = new URLSearchParams(responseText);
  const accessToken = params.get('oauth_token');
  const accessTokenSecret = params.get('oauth_token_secret');
  const screenName = params.get('screen_name');

  if (!accessToken || !accessTokenSecret) {
    throw new Error('Invalid access token response');
  }

  return { 
    accessToken, 
    accessTokenSecret, 
    screenName: screenName || 'unknown' 
  };
}

/**
 * Upload video using OAuth 1.0a chunked upload
 */
export async function uploadVideoOAuth1(
  videoUrl: string,
  accessToken: string,
  accessTokenSecret: string
): Promise<string> {
  // Generate fresh presigned URL first
  const freshVideoUrl = await generateFreshPresignedUrl(videoUrl);
  
  // Download video
  console.log('📥 Downloading video for Twitter upload...');
  const videoResponse = await fetch(freshVideoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video: ${videoResponse.statusText}`);
  }

  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
  const totalBytes = videoBuffer.length;
  const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
  
  console.log(`🎬 Starting OAuth 1.0a video upload (${totalMB} MB)`);
  const uploadStartTime = Date.now();

  // Step 1: INIT
  console.log('📋 Step 1/3: Initializing video upload...');
  const initUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  const initFormData = new FormData();
  initFormData.append('command', 'INIT');
  initFormData.append('total_bytes', totalBytes.toString());
  initFormData.append('media_type', 'video/mp4');
  initFormData.append('media_category', 'tweet_video');

  const initAuthHeader = generateOAuthHeader('POST', initUrl, accessToken, accessTokenSecret);
  
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
  console.log(`✅ Video upload initialized (Media ID: ${mediaId})`);

  // Step 2: APPEND chunks
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks
  const totalChunks = Math.ceil(totalBytes / chunkSize);
  console.log(`📦 Step 2/3: Uploading ${totalChunks} video chunks...`);

  for (let segmentIndex = 0; segmentIndex < totalChunks; segmentIndex++) {
    const start = segmentIndex * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunk = videoBuffer.slice(start, end);
    const chunkMB = (chunk.length / 1024 / 1024).toFixed(2);
    
    console.log(`📤 Uploading chunk ${segmentIndex + 1}/${totalChunks} (${chunkMB} MB)...`);

    const appendFormData = new FormData();
    appendFormData.append('command', 'APPEND');
    appendFormData.append('media_id', mediaId);
    appendFormData.append('segment_index', segmentIndex.toString());
    appendFormData.append('media', chunk, {
      filename: `chunk_${segmentIndex}.mp4`,
      contentType: 'video/mp4'
    });

    const appendAuthHeader = generateOAuthHeader('POST', initUrl, accessToken, accessTokenSecret);
    
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
    
    console.log(`✅ Chunk ${segmentIndex + 1}/${totalChunks} uploaded successfully`);
  }
  
  console.log('🎉 All video chunks uploaded successfully!');

  // Step 3: FINALIZE
  console.log('🔄 Step 3/3: Finalizing video upload...');
  const finalizeFormData = new FormData();
  finalizeFormData.append('command', 'FINALIZE');
  finalizeFormData.append('media_id', mediaId);

  const finalizeAuthHeader = generateOAuthHeader('POST', initUrl, accessToken, accessTokenSecret);
  
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
  console.log('✅ Video upload finalized successfully');

  // Step 4: Check processing status if needed
  if (finalizeData.processing_info) {
    console.log('⏳ Video requires processing, waiting for completion...');
    await waitForProcessing(mediaId, accessToken, accessTokenSecret);
  } else {
    console.log('🎬 Video ready immediately (no processing required)');
  }

  const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(1);
  console.log(`🎉 OAuth 1.0a video upload completed! Media ID: ${mediaId} (took ${uploadDuration}s)`);
  return mediaId;
}

/**
 * Wait for video processing to complete
 */
async function waitForProcessing(
  mediaId: string,
  accessToken: string,
  accessTokenSecret: string
): Promise<void> {
  const maxAttempts = 60;
  let attempts = 0;

  console.log('🔄 Monitoring video processing status...');

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    attempts++;
    
    console.log(`⏳ Checking processing status (attempt ${attempts}/${maxAttempts})...`);

    const statusUrl = `https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`;
    const statusAuthHeader = generateOAuthHeader('GET', statusUrl, accessToken, accessTokenSecret);

    try {
      const statusResponse = await fetch(statusUrl, {
        method: 'GET',
        headers: {
          'Authorization': statusAuthHeader
        }
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json() as any;

        if (!statusData.processing_info) {
          console.log('✅ Video processing completed (no processing info)');
          break;
        }

        const state = statusData.processing_info.state;
        const progress = statusData.processing_info.progress_percent || 0;
        
        console.log(`📊 Processing status: ${state} (${progress}% complete)`);

        if (state === 'succeeded') {
          console.log('🎉 Video processing completed successfully!');
          break;
        } else if (state === 'failed') {
          const error = statusData.processing_info.error?.message || 'Unknown error';
          throw new Error(`Video processing failed: ${error}`);
        } else if (state === 'in_progress') {
          console.log(`⏳ Video still processing... ${progress}% complete`);
        }
      }
    } catch (error: any) {
      console.warn('⚠️ Status check failed:', error.message);
    }
  }
  
  console.error('❌ Video processing timed out after 60 attempts (5 minutes)');
  throw new Error('Video processing timed out');
}

/**
 * Generate fresh presigned URL for S3 video
 */
async function generateFreshPresignedUrl(s3Url: string): Promise<string> {
  // Extract S3 key from URL
  const urlParts = s3Url.split('/');
  const bucketIndex = urlParts.findIndex(part => part.includes('s3.amazonaws.com'));
  if (bucketIndex === -1) {
    throw new Error('Invalid S3 URL format');
  }
  
  const s3Key = urlParts.slice(bucketIndex + 1).join('/').split('?')[0];
  
  if (!s3Key) {
    throw new Error('Could not extract S3 key from URL');
  }
  
  // Call the Python backend to generate fresh presigned URL
  const response = await fetch(`http://localhost:8000/api/s3/generate-presigned-url?s3_key=${encodeURIComponent(s3Key)}&expiration=3600`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to generate presigned URL: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as any;
  return data.presigned_url;
}
