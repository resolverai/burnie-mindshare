import crypto from 'crypto';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { env } from '../config/env';
import { getS3PresignedUrlService } from '../services/S3PresignedUrlService';

// Twitter OAuth1 credentials (same for all projects)
const TWITTER_CONSUMER_KEY = process.env.TWITTER_CONSUMER_KEY || '';
const TWITTER_CONSUMER_SECRET = process.env.TWITTER_CONSUMER_SECRET || '';

// Verify credentials are loaded (log only on startup, not on every call)
if (!TWITTER_CONSUMER_KEY || !TWITTER_CONSUMER_SECRET) {
  console.error('⚠️ WARNING: Twitter OAuth1 credentials not found in environment variables');
  console.error('   TWITTER_CONSUMER_KEY:', TWITTER_CONSUMER_KEY ? '✅ Set' : '❌ Missing');
  console.error('   TWITTER_CONSUMER_SECRET:', TWITTER_CONSUMER_SECRET ? '✅ Set' : '❌ Missing');
}

export interface OAuth1Tokens {
  accessToken: string;
  accessTokenSecret: string;
  screenName: string;
}

/**
 * Generate OAuth 1.0a signature base string
 */
function generateSignatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] || '')}`)
    .join('&');

  return `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
}

/**
 * Generate OAuth 1.0a signature
 */
function generateSignature(
  baseString: string,
  consumerSecret: string,
  tokenSecret: string = ''
): string {
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

/**
 * Generate OAuth 1.0a header
 */
export function generateOAuthHeader(
  method: string,
  url: string,
  accessToken: string,
  accessTokenSecret: string,
  additionalParams: Record<string, string> = {}
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: TWITTER_CONSUMER_KEY,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(32).toString('base64').replace(/\W/g, ''),
    oauth_version: '1.0',
  };

  // Only include oauth_token if accessToken is provided (not needed for request token step)
  if (accessToken) {
    oauthParams.oauth_token = accessToken;
  }

  const allParams = { ...oauthParams, ...additionalParams };
  const baseString = generateSignatureBaseString(method, url, allParams);
  const signature = generateSignature(baseString, TWITTER_CONSUMER_SECRET, accessTokenSecret);

  oauthParams.oauth_signature = signature;

  // For request token, include oauth_callback in the header
  // For other requests, additionalParams might contain other params
  const headerParams = { ...oauthParams };
  if (additionalParams.oauth_callback) {
    headerParams.oauth_callback = additionalParams.oauth_callback;
  }

  const authHeader =
    'OAuth ' +
    Object.keys(headerParams)
      .map((key) => `${encodeURIComponent(key)}="${encodeURIComponent(headerParams[key] || '')}"`)
      .join(', ');

  return authHeader;
}

/**
 * Get request token for OAuth1 flow
 */
export async function getRequestToken(callbackUrl: string): Promise<{
  oauthToken: string;
  oauthTokenSecret: string;
}> {
  const url = 'https://api.twitter.com/oauth/request_token';
  const params = {
    oauth_callback: callbackUrl,
  };

  console.log('🔍 OAuth1 Request Token Parameters:');
  console.log('   URL:', url);
  console.log('   Callback:', callbackUrl);
  console.log('   Consumer Key:', TWITTER_CONSUMER_KEY ? `${TWITTER_CONSUMER_KEY.substring(0, 10)}...` : 'MISSING');
  console.log('   Consumer Secret:', TWITTER_CONSUMER_SECRET ? `${TWITTER_CONSUMER_SECRET.substring(0, 10)}...` : 'MISSING');

  const authHeader = generateOAuthHeader('POST', url, '', '', params);
  
  console.log('🔍 OAuth1 Authorization Header:', authHeader.substring(0, 100) + '...');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
    },
  });

  console.log('🔍 Twitter Response Status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.log('🔍 Twitter Error Response:', error);
    throw new Error(`Failed to get request token: ${error}`);
  }

  const body = await response.text();
  const parsed = new URLSearchParams(body);
  const oauthToken = parsed.get('oauth_token');
  const oauthTokenSecret = parsed.get('oauth_token_secret');

  if (!oauthToken || !oauthTokenSecret) {
    throw new Error('Invalid response from Twitter');
  }

  return { oauthToken, oauthTokenSecret };
}

/**
 * Exchange OAuth verifier for access token
 */
export async function exchangeOAuthToken(
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string
): Promise<OAuth1Tokens> {
  const url = 'https://api.twitter.com/oauth/access_token';
  const params = {
    oauth_verifier: oauthVerifier,
  };

  console.log('🔍 OAuth1 Token Exchange Parameters:');
  console.log('   URL:', url);
  console.log('   oauth_token:', oauthToken ? `${oauthToken.substring(0, 15)}...` : 'MISSING');
  console.log('   oauth_token_secret:', oauthTokenSecret ? `${oauthTokenSecret.substring(0, 15)}...` : 'MISSING');
  console.log('   oauth_verifier:', oauthVerifier ? `${oauthVerifier.substring(0, 15)}...` : 'MISSING');

  const authHeader = generateOAuthHeader('POST', url, oauthToken, oauthTokenSecret, params);
  
  console.log('🔍 OAuth1 Exchange Authorization Header:', authHeader.substring(0, 100) + '...');

  // Create form data for POST body with oauth_verifier
  const formData = new URLSearchParams();
  formData.append('oauth_verifier', oauthVerifier);

  console.log('🔍 POST body params:', formData.toString());

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  console.log('🔍 Twitter Exchange Response Status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.log('🔍 Twitter Exchange Error:', error);
    throw new Error(`Failed to exchange token: ${error}`);
  }

  const body = await response.text();
  const parsed = new URLSearchParams(body);
  const accessToken = parsed.get('oauth_token');
  const accessTokenSecret = parsed.get('oauth_token_secret');
  const screenName = parsed.get('screen_name');

  if (!accessToken || !accessTokenSecret) {
    throw new Error('Invalid access token response');
  }

  return {
    accessToken,
    accessTokenSecret,
    screenName: screenName || 'unknown',
  };
}

/**
 * Generate fresh presigned URL from S3 key or existing presigned URL
 */
async function generateFreshPresignedUrl(url: string): Promise<string> {
  try {
    // If it's already a full URL (contains http), extract the S3 key
    if (url.includes('http')) {
      // Extract S3 key from presigned URL or direct S3 URL
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      // Remove leading slash and decode
      const s3Key = decodeURIComponent(pathname.substring(1));
      
      console.log(`📎 Extracted S3 key from URL: ${s3Key}`);
      
      // Generate fresh presigned URL
      const s3Service = getS3PresignedUrlService();
      const freshUrl = await s3Service.generatePresignedUrl(s3Key);
      if (!freshUrl) {
        throw new Error('Failed to generate presigned URL for S3 key');
      }
      console.log(`✅ Generated fresh presigned URL`);
      return freshUrl;
    }
    
    // If it's just an S3 key, generate presigned URL
    console.log(`📎 Using S3 key directly: ${url}`);
    const s3Service = getS3PresignedUrlService();
    const freshUrl = await s3Service.generatePresignedUrl(url);
    if (!freshUrl) {
      throw new Error('Failed to generate presigned URL');
    }
    console.log(`✅ Generated fresh presigned URL`);
    return freshUrl;
  } catch (error) {
    console.error('⚠️ Failed to generate fresh presigned URL, using original:', error);
    return url; // Fallback to original URL
  }
}

/**
 * Upload image to Twitter using OAuth 1.0a (v1.1 endpoint)
 * Twitter media upload endpoint only supports OAuth 1.0a, NOT OAuth 2.0
 */
export async function uploadImageOAuth1(
  imageUrl: string,
  accessToken: string,
  accessTokenSecret: string
): Promise<string> {
  // Generate fresh presigned URL first
  const freshImageUrl = await generateFreshPresignedUrl(imageUrl);
  
  // Download image
  console.log('📥 Downloading image for Twitter upload...');
  const imageResponse = await fetch(freshImageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageResponse.statusText}`);
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const imageSizeKB = (imageBuffer.length / 1024).toFixed(2);
  
  console.log(`🖼️ Starting OAuth 1.0a image upload (${imageSizeKB} KB)`);

  // Upload using simple upload endpoint (not chunked - for images under 5MB)
  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  const formData = new FormData();
  formData.append('media', imageBuffer, {
    filename: 'image.jpg',
    contentType: 'image/jpeg',
  });

  const authHeader = generateOAuthHeader('POST', uploadUrl, accessToken, accessTokenSecret);
  
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      ...formData.getHeaders(),
    },
    body: formData,
  });

  console.log('🔍 Image upload response status:', uploadResponse.status);

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error('❌ Image upload failed:', uploadResponse.status, errorText);
    throw new Error(`Image upload failed: ${uploadResponse.status} - ${errorText}`);
  }

  const data = await uploadResponse.json() as { media_id_string: string };
  const mediaId = data.media_id_string;

  console.log(`✅ Image uploaded successfully. Media ID: ${mediaId}`);
  return mediaId;
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

  console.log('🔍 INIT request parameters:', {
    command: 'INIT',
    total_bytes: totalBytes,
    media_type: 'video/mp4',
    media_category: 'tweet_video'
  });

  const initAuthHeader = generateOAuthHeader('POST', initUrl, accessToken, accessTokenSecret);
  console.log('🔍 INIT auth header (first 50 chars):', initAuthHeader.substring(0, 50) + '...');
  
  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: {
      'Authorization': initAuthHeader
    },
    body: initFormData
  });

  console.log('🔍 INIT response status:', initResponse.status);
  console.log('🔍 INIT response headers:', Object.fromEntries(initResponse.headers.entries()));

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    console.error('❌ INIT failed:', initResponse.status, errorText);
    throw new Error(`Video upload INIT failed: ${errorText}`);
  }

  const initData = await initResponse.json() as { media_id_string: string };
  const mediaId = initData.media_id_string;
  console.log('✅ INIT successful. Media ID:', mediaId);

  // Step 2: APPEND (chunked upload)
  console.log('📦 Step 2/3: Uploading video in chunks...');
  const chunkSize = 5 * 1024 * 1024; // 5MB chunks
  const totalChunks = Math.ceil(totalBytes / chunkSize);
  console.log(`📊 Total chunks: ${totalChunks}`);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const chunk = videoBuffer.slice(start, end);
    
    const chunkFormData = new FormData();
    chunkFormData.append('command', 'APPEND');
    chunkFormData.append('media_id', mediaId);
    chunkFormData.append('segment_index', i.toString());
    chunkFormData.append('media', chunk, {
      filename: 'chunk.mp4',
      contentType: 'application/octet-stream',
    });

    const appendAuthHeader = generateOAuthHeader('POST', initUrl, accessToken, accessTokenSecret);
    
    const appendResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        'Authorization': appendAuthHeader,
        ...chunkFormData.getHeaders(),
      },
      body: chunkFormData,
    });

    if (!appendResponse.ok) {
      const errorText = await appendResponse.text();
      console.error(`❌ Chunk ${i} upload failed:`, errorText);
      throw new Error(`Video chunk ${i} upload failed: ${errorText}`);
    }

    const progress = ((i + 1) / totalChunks * 100).toFixed(1);
    console.log(`✅ Uploaded chunk ${i + 1}/${totalChunks} (${progress}%)`);
  }

  console.log('✅ All chunks uploaded');

  // Step 3: FINALIZE
  console.log('🔄 Step 3/3: Finalizing upload...');
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
    console.error('❌ FINALIZE failed:', errorText);
    throw new Error(`Video upload FINALIZE failed: ${errorText}`);
  }

  const finalizeData = await finalizeResponse.json() as { processing_info?: { state: string } };
  console.log('✅ FINALIZE successful');

  // Step 4: Check processing status if needed
  if (finalizeData.processing_info) {
    console.log('⏳ Video is processing, checking status...');
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes max

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const statusFormData = new FormData();
      statusFormData.append('command', 'STATUS');
      statusFormData.append('media_id', mediaId);

      const statusAuthHeader = generateOAuthHeader('GET', `${initUrl}?command=STATUS&media_id=${mediaId}`, accessToken, accessTokenSecret);
      
      const statusResponse = await fetch(`${initUrl}?command=STATUS&media_id=${mediaId}`, {
        method: 'GET',
        headers: {
          'Authorization': statusAuthHeader
        }
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json() as { processing_info?: { state: string; check_after_secs?: number } };
        const state = statusData.processing_info?.state;
        
        console.log(`🔄 Processing status: ${state} (attempt ${attempts + 1}/${maxAttempts})`);
        
        if (state === 'succeeded') {
          console.log('✅ Video processing completed');
          break;
        } else if (state === 'failed') {
          throw new Error('Video processing failed');
        }
        
        // Wait for the recommended time if provided
        if (statusData.processing_info?.check_after_secs) {
          await new Promise(resolve => setTimeout(resolve, statusData.processing_info!.check_after_secs! * 1000));
        }
      }
      
      attempts++;
    }
  }

  const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(1);
  console.log(`✅ Video upload completed in ${uploadDuration}s. Media ID: ${mediaId}`);
  
  return mediaId;
}
