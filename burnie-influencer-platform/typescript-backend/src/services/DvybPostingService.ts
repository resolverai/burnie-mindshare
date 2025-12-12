import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { DvybAccount } from '../models/DvybAccount';
import { DvybTwitterConnection } from '../models/DvybTwitterConnection';
import { DvybInstagramConnection } from '../models/DvybInstagramConnection';
import { DvybLinkedInConnection } from '../models/DvybLinkedInConnection';
import { DvybTikTokConnection } from '../models/DvybTikTokConnection';
import { DvybTwitterPost } from '../models/DvybTwitterPost';
import { DvybInstagramPost } from '../models/DvybInstagramPost';
import { DvybLinkedInPost } from '../models/DvybLinkedInPost';
import { DvybTikTokPost } from '../models/DvybTikTokPost';
import { DvybCaption } from '../models/DvybCaption';
import { DvybImageEdit } from '../models/DvybImageEdit';
import { DvybAuthService } from './DvybAuthService';
import { DvybInstagramService } from './DvybInstagramService';
import { DvybLinkedInService } from './DvybLinkedInService';
import { DvybTikTokService } from './DvybTikTokService';
import { DvybTwitterTokenService } from './DvybTwitterTokenService';
import { uploadVideoOAuth1 } from '../utils/oauth1Utils';
import axios from 'axios';

export interface PostNowRequest {
  accountId: number;
  platforms: string[]; // ['twitter', 'instagram', 'linkedin', 'tiktok']
  content: {
    caption: string; // Fallback caption (for backward compatibility)
    platformTexts?: { // Platform-specific full texts (preferred)
      twitter?: string;
      instagram?: string;
      linkedin?: string;
      tiktok?: string;
    };
    mediaUrl: string; // S3 URL (specific media from the array)
    mediaType: 'image' | 'video';
    generatedContentId?: number; // ID of dvyb_generated_content record
    postIndex?: number; // Index within the generatedImageUrls/generatedVideoUrls arrays
  };
}

export interface PostNowResult {
  success: boolean;
  results: {
    platform: string;
    success: boolean;
    postId?: number;
    twitterPostId?: string;
    instagramPostId?: string;
    linkedinPostId?: string;
    tiktokPostId?: string;
    error?: string;
    needsOAuth1?: boolean; // For Twitter video
  }[];
  message: string;
}

export class DvybPostingService {
  /**
   * Fetch user-edited captions from database and merge with original platformTexts
   * User-edited captions take priority over system-generated ones
   */
  private static async getEffectivePlatformTexts(
    accountId: number,
    content: { caption: string; platformTexts?: any; generatedContentId?: number; postIndex?: number }
  ): Promise<{ [key: string]: string }> {
    const originalTexts = content.platformTexts || {};
    const effectiveTexts = { ...originalTexts };

    // If we have generatedContentId and postIndex, check for user-edited captions
    if (content.generatedContentId && content.postIndex !== undefined) {
      try {
        const captionRepo = AppDataSource.getRepository(DvybCaption);
        const editedCaptions = await captionRepo.find({
          where: {
            accountId,
            generatedContentId: content.generatedContentId,
            postIndex: content.postIndex,
          },
        });

        // Merge edited captions (they take priority)
        editedCaptions.forEach((ec) => {
          effectiveTexts[ec.platform] = ec.caption;
          logger.info(`📝 Using edited caption for ${ec.platform} (content ${content.generatedContentId}, post ${content.postIndex})`);
        });
      } catch (error) {
        logger.warn('⚠️ Failed to fetch edited captions, using original platformTexts:', error);
      }
    }

    return effectiveTexts;
  }

  /**
   * Get effective media URL - checks if there's an edited image and uses that instead
   * @returns A presigned URL for the edited image if available, otherwise the original mediaUrl
   */
  private static async getEffectiveMediaUrl(
    accountId: number,
    content: { mediaUrl: string; mediaType: 'image' | 'video'; generatedContentId?: number; postIndex?: number }
  ): Promise<string> {
    // Only check for edited images (not videos)
    if (content.mediaType !== 'image') {
      return content.mediaUrl;
    }

    // If we don't have generatedContentId and postIndex, can't look up edited images
    if (!content.generatedContentId || content.postIndex === undefined) {
      return content.mediaUrl;
    }

    try {
      const imageEditRepo = AppDataSource.getRepository(DvybImageEdit);
      const imageEdit = await imageEditRepo.findOne({
        where: {
          accountId,
          generatedContentId: content.generatedContentId,
          postIndex: content.postIndex,
          status: 'completed',
        },
      });

      if (imageEdit?.editedImageUrl) {
        logger.info(`🎨 Found edited image for posting (content ${content.generatedContentId}, post ${content.postIndex}): ${imageEdit.editedImageUrl}`);
        
        // Generate presigned URL for the edited image (platforms need accessible URLs)
        const { S3PresignedUrlService } = await import('./S3PresignedUrlService');
        const s3Service = new S3PresignedUrlService();
        const presignedUrl = await s3Service.generatePresignedUrl(imageEdit.editedImageUrl, 3600, true);
        
        if (presignedUrl) {
          logger.info(`🎨 Using edited image presigned URL for posting`);
          return presignedUrl;
        } else {
          logger.warn('⚠️ Failed to generate presigned URL for edited image, using original');
        }
      }
    } catch (error) {
      logger.warn('⚠️ Failed to fetch edited image, using original mediaUrl:', error);
    }

    return content.mediaUrl;
  }

  /**
   * Post content immediately to selected platforms
   */
  static async postNow(request: PostNowRequest): Promise<PostNowResult> {
    const { accountId, platforms, content } = request;
    const results: PostNowResult['results'] = [];

    logger.info(`🚀 Starting immediate post for account ${accountId} to platforms: ${platforms.join(', ')}`);
    
    // Get effective platform texts (original + edited captions merged)
    const effectivePlatformTexts = await this.getEffectivePlatformTexts(accountId, content);
    
    // Get effective media URL (use edited image if available)
    const effectiveMediaUrl = await this.getEffectiveMediaUrl(accountId, content);
    
    const enhancedContent = {
      ...content,
      platformTexts: effectivePlatformTexts,
      mediaUrl: effectiveMediaUrl,
    };

    // Process each platform
    for (const platform of platforms) {
      try {
        let result;
        
        switch (platform.toLowerCase()) {
          case 'twitter':
            result = await this.postToTwitter(accountId, enhancedContent);
            break;
          case 'instagram':
            result = await this.postToInstagram(accountId, enhancedContent);
            break;
          case 'linkedin':
            result = await this.postToLinkedIn(accountId, enhancedContent);
            break;
          case 'tiktok':
            result = await this.postToTikTok(accountId, enhancedContent);
            break;
          default:
            result = {
              platform,
              success: false,
              error: `Unsupported platform: ${platform}`
            };
        }
        
        results.push(result);
      } catch (error: any) {
        // Avoid circular structure error by logging only the message
        const errorMsg = error.response?.data ? 
          `${error.message} - ${JSON.stringify(error.response.data)}` : 
          error.message;
        logger.error(`❌ Error posting to ${platform}: ${errorMsg}`);
        results.push({
          platform,
          success: false,
          error: error.message || `Failed to post to ${platform}`
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const message = successCount === platforms.length
      ? `Successfully posted to all ${successCount} platform(s)`
      : `Posted to ${successCount}/${platforms.length} platform(s)`;

    return {
      success: successCount > 0,
      results,
      message
    };
  }

  /**
   * Post to Twitter
   */
  private static async postToTwitter(
    accountId: number,
    content: { caption: string; platformTexts?: any; mediaUrl: string; mediaType: 'image' | 'video'; generatedContentId?: number }
  ): Promise<PostNowResult['results'][0]> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybTwitterConnection);
      const connection = await connectionRepo.findOne({
        where: { accountId, isActive: true }
      });

      if (!connection) {
        return {
          platform: 'twitter',
          success: false,
          error: 'Twitter not connected. Please connect your Twitter account first.'
        };
      }

      // Validate tokens using token service (similar to web3 projects)
      const tokenValidation = await DvybTwitterTokenService.validateTokens(accountId);
      const isVideo = content.mediaType === 'video';
      
      if (isVideo) {
        // Videos require both OAuth1 and OAuth2
        if (!tokenValidation.oauth2Valid || !tokenValidation.oauth1Valid) {
          logger.warn(`⚠️ Invalid tokens for account ${accountId} video upload. OAuth2: ${tokenValidation.oauth2Valid ? 'valid' : 'invalid'}, OAuth1: ${tokenValidation.oauth1Valid ? 'valid' : 'invalid'}`);
          return {
            platform: 'twitter',
            success: false,
            needsOAuth1: !tokenValidation.oauth1Valid,
            error: !tokenValidation.oauth1Valid 
              ? 'Video posting requires OAuth1 authorization. Please authorize OAuth1 access.'
              : 'Twitter OAuth2 token expired. Please reconnect your Twitter account.'
          };
        }
      } else {
        // Images require OAuth2 only
        if (!tokenValidation.oauth2Valid) {
          logger.warn(`⚠️ Invalid OAuth2 token for account ${accountId} image upload`);
          return {
            platform: 'twitter',
            success: false,
            error: 'Twitter OAuth2 token expired. Please reconnect your Twitter account.'
          };
        }
      }
      
      // Additional presence check for OAuth1 tokens if video
      if (isVideo && (!connection.oauth1Token || !connection.oauth1TokenSecret)) {
        logger.warn(`⚠️ OAuth1 tokens not found for account ${accountId}`);
        return {
          platform: 'twitter',
          success: false,
          needsOAuth1: true,
          error: 'Video posting requires OAuth1 authorization. Please authorize OAuth1 access.'
        };
      }

      // Get valid OAuth2 token (auto-refreshes if needed)
      const accessToken = await DvybAuthService.getValidToken(accountId);

      let mediaId: string | null = null;

      // Upload media
      if (content.mediaType === 'video') {
        // Videos require OAuth1 for chunked upload
        if (!connection.oauth1Token || !connection.oauth1TokenSecret) {
          logger.warn(`⚠️ OAuth1 tokens not found for account ${accountId}, video upload requires OAuth1`);
          return {
            platform: 'twitter',
            success: false,
            needsOAuth1: true,
            error: 'Video posting requires OAuth1 authorization. Please authorize OAuth1 access.'
          };
        }
        
        logger.info(`🎬 Uploading video using OAuth1...`);
        mediaId = await uploadVideoOAuth1(
          content.mediaUrl,
          connection.oauth1Token,
          connection.oauth1TokenSecret
        );

        if (!mediaId) {
          throw new Error('Video upload failed');
        }
      } else {
        // Images use OAuth2 with v2 endpoint
        logger.info(`🖼️ Uploading image using OAuth2...`);
        mediaId = await this.uploadImageToTwitter(accessToken, content.mediaUrl);

        if (!mediaId) {
          throw new Error('Image upload failed');
        }
      }

      // Post tweet
      logger.info(`📝 Creating tweet with media...`);
      logger.info(`   Media ID: ${mediaId}`);
      logger.info(`   Media ID type: ${typeof mediaId}`);
      logger.info(`   Media ID length: ${mediaId.length}`);
      
      // Ensure mediaId is a clean string with no whitespace
      const cleanMediaId = mediaId.trim();
      
      // Use platform-specific text if available, otherwise fall back to caption
      const tweetText = content.platformTexts?.twitter || content.caption;
      
      const tweetPayload = {
        text: tweetText,
        media: { media_ids: [cleanMediaId] },
      };
      
      logger.info(`📤 Tweet payload:`, JSON.stringify(tweetPayload, null, 2));
      
      const twitterResponse = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(tweetPayload),
      });

      logger.info(`📥 Twitter response status: ${twitterResponse.status}`);
      
      if (!twitterResponse.ok) {
        const errorData = await twitterResponse.text();
        logger.error(`❌ Twitter API error (${twitterResponse.status}):`, errorData);
        throw new Error(`Twitter API error: ${errorData}`);
      }

      const tweetData = await twitterResponse.json() as { data: { id: string } };
      const tweetId = tweetData.data.id;
      
      logger.info(`✅ Tweet created successfully. Tweet ID: ${tweetId}`);

      // Save to database
      const postRepo = AppDataSource.getRepository(DvybTwitterPost);
      const post = postRepo.create({
        accountId,
        generatedContentId: content.generatedContentId || null,
        postType: 'single', // Single post with media
        mainTweet: tweetText, // Use platform-specific text
        mainTweetId: tweetId,
        imageUrl: content.mediaType === 'image' ? content.mediaUrl : null,
        videoUrl: content.mediaType === 'video' ? content.mediaUrl : null,
        twitterMediaIds: [cleanMediaId], // Use cleaned media ID
        engagementMetrics: {},
        postedAt: new Date(),
      });

      await postRepo.save(post);

      logger.info(`✅ Successfully posted to Twitter: ${tweetId}`);

      return {
        platform: 'twitter',
        success: true,
        postId: post.id,
        twitterPostId: tweetId
      };
    } catch (error: any) {
      // Avoid circular structure error by logging only relevant parts
      if (error.response) {
        logger.error(`❌ Twitter posting error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`❌ Twitter posting error: ${error.message}`);
      }
      return {
        platform: 'twitter',
        success: false,
        error: error.message || 'Failed to post to Twitter'
      };
    }
  }

  /**
   * Upload image to Twitter using OAuth2
   */
  private static async uploadImageToTwitter(accessToken: string, imageUrl: string): Promise<string | null> {
    try {
      // Generate presigned URL if S3 URL
      let downloadUrl = imageUrl;
      if (imageUrl.includes('s3.amazonaws.com') || imageUrl.startsWith('s3://')) {
        logger.info('🔗 Generating presigned URL for S3 image...');
        // Use the image URL directly - if it's already a presigned URL it will work
        // If it's an S3 URL without signature, axios will handle it if the bucket is public
        downloadUrl = imageUrl;
      }

      // Download image
      logger.info(`📥 Downloading image from: ${downloadUrl.substring(0, 100)}...`);
      const imageResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);
      logger.info(`✅ Downloaded image: ${imageBuffer.length} bytes`);

      // Upload to Twitter using multipart form data
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('media', imageBuffer, {
        filename: 'tweet-image.jpg',
        contentType: 'image/jpeg',
      });
      formData.append('media_category', 'tweet_image');

      logger.info('📤 Uploading image to Twitter v2 endpoint...');
      
      // Use axios instead of fetch for proper FormData handling
      const uploadResponse = await axios.post('https://api.twitter.com/2/media/upload', formData, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          ...formData.getHeaders() // This adds the correct Content-Type with boundary
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      const data = uploadResponse.data as any;
      logger.info('📦 Image upload response:', JSON.stringify(data, null, 2));
      
      // API v2 returns { data: { id: "media_id" } } format
      // Also check for media_id_string (legacy format) or media_id
      const mediaId = data.data?.id || data.media_id_string || data.media_id;
      
      if (!mediaId) {
        logger.error('❌ No media ID in response:', data);
        return null;
      }
      
      logger.info(`✅ Image uploaded to Twitter: ${mediaId}`);
      return mediaId;
    } catch (error: any) {
      if (error.response) {
        // Axios error with response
        logger.error(`❌ Image upload failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`❌ Error uploading image: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Post to Instagram
   */
  private static async postToInstagram(
    accountId: number,
    content: { caption: string; platformTexts?: any; mediaUrl: string; mediaType: 'image' | 'video'; generatedContentId?: number }
  ): Promise<PostNowResult['results'][0]> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybInstagramConnection);
      const connection = await connectionRepo.findOne({ where: { accountId } });

      if (!connection || connection.status !== 'active') {
        return {
          platform: 'instagram',
          success: false,
          error: 'Instagram not connected. Please connect your Instagram account first.'
        };
      }

      // Get valid token (auto-refreshes if needed)
      const accessToken = await DvybInstagramService.getValidToken(accountId);

      // Get Instagram Business Account ID (stored as instagramUserId)
      if (!connection.instagramUserId) {
        throw new Error('Instagram Business Account ID not found');
      }

      const instagramAccountId = connection.instagramUserId;

      // Step 1: Create media container
      logger.info(`📤 Creating ${content.mediaType} container on Instagram...`);
      
      // Use platform-specific text if available, otherwise fall back to caption
      const instagramCaption = content.platformTexts?.instagram || content.caption;
      
      const containerParams: any = {
        caption: instagramCaption,
      };

      if (content.mediaType === 'image') {
        containerParams.image_url = content.mediaUrl;
      } else {
        // Instagram now requires REELS instead of VIDEO for video posts
        containerParams.media_type = 'REELS';
        containerParams.video_url = content.mediaUrl;
      }

      const containerResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media`,
        containerParams,
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      const containerId = containerResponse.data.id;
      logger.info(`✅ Media container created: ${containerId}`);

      // Step 2: Wait for media processing (applies to both images and videos)
      // Instagram needs time to process media before it can be published
      logger.info(`⏳ Waiting for ${content.mediaType} processing...`);
      let status = 'IN_PROGRESS';
      let attempts = 0;
      const maxAttempts = content.mediaType === 'video' ? 60 : 15; // Videos need more time
      const waitTime = content.mediaType === 'video' ? 2000 : 1000; // 2s for video, 1s for image

      while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        try {
          const statusResponse = await axios.get(
            `https://graph.facebook.com/v18.0/${containerId}`,
            {
              params: {
                fields: 'status_code',
                access_token: accessToken,
              },
            }
          );

          status = statusResponse.data.status_code;
          attempts++;
          logger.info(`🔄 ${content.mediaType} processing status: ${status} (attempt ${attempts}/${maxAttempts})`);
          
          // For images, if no status_code returned, it might be ready
          if (!status && content.mediaType === 'image') {
            logger.info('📷 Image status not returned, assuming ready');
            status = 'FINISHED';
          }
        } catch (statusError: any) {
          // If we get a 400 error checking status, wait and retry
          logger.warn(`⚠️ Status check error: ${statusError.message}, retrying...`);
          attempts++;
        }
      }

      if (status !== 'FINISHED') {
        throw new Error(`Media processing failed or timed out. Status: ${status}`);
      }

      // Step 3: Publish the media
      logger.info('📢 Publishing to Instagram...');
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${instagramAccountId}/media_publish`,
        {
          creation_id: containerId,
        },
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      const instagramPostId = publishResponse.data.id;

      // Save to database
      const postRepo = AppDataSource.getRepository(DvybInstagramPost);
      const post = postRepo.create({
        accountId,
        generatedContentId: content.generatedContentId || null,
        caption: instagramCaption, // Use platform-specific text
        mediaUrl: content.mediaUrl,
        mediaType: content.mediaType,
        instagramMediaId: instagramPostId,
        status: 'posted',
        postedAt: new Date(),
        engagementMetrics: {},
      });

      await postRepo.save(post);

      logger.info(`✅ Successfully posted to Instagram: ${instagramPostId}`);

      return {
        platform: 'instagram',
        success: true,
        postId: post.id,
        instagramPostId: instagramPostId
      };
    } catch (error: any) {
      // Avoid circular structure error by logging only relevant parts
      if (error.response) {
        logger.error(`❌ Instagram posting error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`❌ Instagram posting error: ${error.message}`);
      }
      return {
        platform: 'instagram',
        success: false,
        error: error.response?.data?.error?.message || error.message || 'Failed to post to Instagram'
      };
    }
  }

  /**
   * Post to LinkedIn
   */
  private static async postToLinkedIn(
    accountId: number,
    content: { caption: string; platformTexts?: any; mediaUrl: string; mediaType: 'image' | 'video'; generatedContentId?: number }
  ): Promise<PostNowResult['results'][0]> {
    try {
      const connectionRepo = AppDataSource.getRepository(DvybLinkedInConnection);
      const connection = await connectionRepo.findOne({ where: { accountId } });

      if (!connection || connection.status !== 'active') {
        return {
          platform: 'linkedin',
          success: false,
          error: 'LinkedIn not connected. Please connect your LinkedIn account first.'
        };
      }

      // Get valid token (auto-refreshes if needed)
      const accessToken = await DvybLinkedInService.getValidToken(accountId);

      // Get LinkedIn person URN from stored connection (no API call needed!)
      // The linkedInUserId is the 'sub' from OpenID Connect userinfo
      if (!connection.linkedInUserId) {
        logger.error(`❌ LinkedIn user ID not found in connection for account ${accountId}`);
        return {
          platform: 'linkedin',
          success: false,
          error: 'LinkedIn user ID not found. Please reconnect your LinkedIn account.'
        };
      }
      
      const personUrn = `urn:li:person:${connection.linkedInUserId}`;
      logger.info(`📋 Using LinkedIn person URN: ${personUrn}`);

      let mediaAsset: string | null = null;

      // Upload media if provided
      if (content.mediaType === 'image') {
        logger.info('🖼️ Uploading image to LinkedIn...');
        
        // Step 1: Register upload
        const registerResponse = await axios.post(
          'https://api.linkedin.com/v2/assets?action=registerUpload',
          {
            registerUploadRequest: {
              owner: personUrn,
              recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
              serviceRelationships: [
                {
                  relationshipType: 'OWNER',
                  identifier: 'urn:li:userGeneratedContent',
                },
              ],
            },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
        const asset = registerResponse.data.value.asset;

        // Step 2: Download image from S3
        const imageResponse = await axios.get(content.mediaUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Step 3: Upload to LinkedIn
        await axios.put(uploadUrl, imageBuffer, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'image/jpeg',
          },
        });

        mediaAsset = asset;
        logger.info('✅ Image uploaded to LinkedIn');
      }

      // Create LinkedIn post
      // Use platform-specific text if available, otherwise fall back to caption
      const linkedinText = content.platformTexts?.linkedin || content.caption;
      
      const postPayload: any = {
        author: personUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: linkedinText,
            },
            shareMediaCategory: mediaAsset ? 'IMAGE' : 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      if (mediaAsset) {
        postPayload.specificContent['com.linkedin.ugc.ShareContent'].media = [
          {
            status: 'READY',
            media: mediaAsset,
          },
        ];
      }

      const postResponse = await axios.post(
        'https://api.linkedin.com/v2/ugcPosts',
        postPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      );

      const linkedinPostId = postResponse.data.id;

      // Save to database
      const postRepo = AppDataSource.getRepository(DvybLinkedInPost);
      const post = postRepo.create({
        accountId,
        generatedContentId: content.generatedContentId || null,
        postText: linkedinText, // Use platform-specific text
        mediaUrl: content.mediaUrl,
        mediaType: content.mediaType,
        linkedInPostId: linkedinPostId,
        status: 'posted',
        postedAt: new Date(),
        engagementMetrics: {},
      });

      await postRepo.save(post);

      logger.info(`✅ Successfully posted to LinkedIn: ${linkedinPostId}`);

      return {
        platform: 'linkedin',
        success: true,
        postId: post.id,
        linkedinPostId: linkedinPostId
      };
    } catch (error: any) {
      // Avoid circular structure error by logging only relevant parts
      if (error.response) {
        logger.error(`❌ LinkedIn posting error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`❌ LinkedIn posting error: ${error.message}`);
      }
      return {
        platform: 'linkedin',
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to post to LinkedIn'
      };
    }
  }

  /**
   * Post to TikTok
   */
  private static async postToTikTok(
    accountId: number,
    content: { caption: string; platformTexts?: any; mediaUrl: string; mediaType: 'image' | 'video'; generatedContentId?: number }
  ): Promise<PostNowResult['results'][0]> {
    try {
      if (content.mediaType !== 'video') {
        return {
          platform: 'tiktok',
          success: false,
          error: 'TikTok only supports video posts'
        };
      }

      const connectionRepo = AppDataSource.getRepository(DvybTikTokConnection);
      const connection = await connectionRepo.findOne({ where: { accountId } });

      if (!connection || connection.status !== 'active') {
        return {
          platform: 'tiktok',
          success: false,
          error: 'TikTok not connected. Please connect your TikTok account first.'
        };
      }

      // Get valid token (auto-refreshes if needed)
      const accessToken = await DvybTikTokService.getValidToken(accountId);

      // Step 1: Initialize video upload
      logger.info('🎬 Initiating TikTok video upload...');
      
      // Use platform-specific text if available, otherwise fall back to caption
      const tiktokCaption = content.platformTexts?.tiktok || content.caption;
      
      const initResponse = await axios.post(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
          post_info: {
            title: tiktokCaption.substring(0, 150), // TikTok title max 150 chars
            privacy_level: 'SELF_ONLY', // Can be PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, SELF_ONLY
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: content.mediaUrl,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const publishId = initResponse.data.data.publish_id;
      logger.info(`✅ TikTok video upload initiated: ${publishId}`);

      // Step 2: Check upload status
      logger.info('⏳ Checking TikTok upload status...');
      let uploadStatus = 'PROCESSING_UPLOAD';
      let attempts = 0;
      const maxAttempts = 30;

      while (uploadStatus === 'PROCESSING_UPLOAD' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds

        const statusResponse = await axios.post(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          {
            publish_id: publishId,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        uploadStatus = statusResponse.data.data.status;
        attempts++;
        logger.info(`🔄 TikTok upload status: ${uploadStatus} (attempt ${attempts}/${maxAttempts})`);
      }

      if (uploadStatus !== 'PUBLISH_COMPLETE') {
        throw new Error(`TikTok upload failed or timed out. Status: ${uploadStatus}`);
      }

      // Save to database
      const postRepo = AppDataSource.getRepository(DvybTikTokPost);
      const post = postRepo.create({
        accountId,
        generatedContentId: content.generatedContentId || null,
        caption: tiktokCaption, // Use platform-specific text
        videoUrl: content.mediaUrl,
        tiktokVideoId: publishId,
        status: 'posted',
        postedAt: new Date(),
        engagementMetrics: {},
      });

      await postRepo.save(post);

      logger.info(`✅ Successfully posted to TikTok: ${publishId}`);

      return {
        platform: 'tiktok',
        success: true,
        postId: post.id,
        tiktokPostId: publishId
      };
    } catch (error: any) {
      // Avoid circular structure error by logging only relevant parts
      if (error.response) {
        logger.error(`❌ TikTok posting error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else {
        logger.error(`❌ TikTok posting error: ${error.message}`);
      }
      return {
        platform: 'tiktok',
        success: false,
        error: error.response?.data?.error?.message || error.message || 'Failed to post to TikTok'
      };
    }
  }
}

