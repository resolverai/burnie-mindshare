import { Router, Request, Response } from 'express';
import { AppDataSource, recoverDatabaseConnection } from '../config/database';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { BiddingSystem } from '../models/BiddingSystem';
import { PaymentTransaction, TransactionType, Currency } from '../models/PaymentTransaction';
import { User, UserRoleType } from '../models/User';
import { Campaign } from '../models/Campaign';
import { env } from '../config/env';
import { MoreThan, LessThan, In, Between } from 'typeorm';
import { ContentPurchase } from '../models/ContentPurchase';
import { logger } from '../config/logger';
import { TreasuryService } from '../services/TreasuryService';
import { fetchROASTPrice } from '../services/priceService';
import AsyncReferralPayoutService from '../services/AsyncReferralPayoutService';
import { WatermarkService } from '../services/WatermarkService';
import { VideoWatermarkService } from '../services/VideoWatermarkService';
import { createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { MarketplaceContentService } from '../services/MarketplaceContentService';
import { UrlCacheService } from '../services/UrlCacheService';
import { contentIntegrationService } from '../services/contentIntegrationService';
import { SomniaBlockchainService } from '../services/somniaBlockchainService';
import { UserReferral } from '../models/UserReferral';
import { ReferralCode } from '../models/ReferralCode';
import { ethers } from 'ethers';
const AWS = require('aws-sdk');

const router = Router();

// Helper function to convert tier string to number for smart contract
function getTierNumber(tier: string): number {
  const tierMap: Record<string, number> = {
    'SILVER': 0,
    'GOLD': 1,
    'PLATINUM': 2,
    'EMERALD': 3,
    'DIAMOND': 4,
    'UNICORN': 5
  };
  return tierMap[tier.toUpperCase()] || 0;
}

/**
 * Ensure user referral is registered on Somnia blockchain (fallback for signup)
 * @param userWalletAddress User's wallet address
 */
async function ensureReferralRegisteredOnChain(userWalletAddress: string): Promise<void> {
  try {
    const somniaService = new SomniaBlockchainService();
    
    // Check if user is already registered on-chain
    const onChainData = await somniaService.getUserReferralData(userWalletAddress);
    
    if (onChainData.isActive) {
      logger.info(`✅ User ${userWalletAddress} already registered on-chain`);
      return;
    }
    
    logger.info(`⚠️ User ${userWalletAddress} not registered on-chain, registering now as fallback...`);
    
    // Get user referral data from database
    const userRepository = AppDataSource.getRepository(User);
    const userReferralRepository = AppDataSource.getRepository(UserReferral);
    const referralCodeRepository = AppDataSource.getRepository(ReferralCode);
    
    const user = await userRepository.findOne({
      where: { walletAddress: userWalletAddress.toLowerCase() }
    });
    
    if (!user) {
      logger.warn(`⚠️ User ${userWalletAddress} not found in database - registering with no referral`);
      // Register with zero addresses (no referral payouts will be given)
      await somniaService.registerReferral(
        userWalletAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0 // SILVER tier default
      );
      return;
    }
    
    // Get user referral record
    const userReferral = await userReferralRepository.findOne({
      where: { userId: user.id },
      relations: ['referralCode', 'directReferrer', 'grandReferrer']
    });
    
    if (!userReferral) {
      logger.info(`ℹ️ User ${userWalletAddress} has no referral in DB - registering without referral payouts`);
      // Register with zero addresses (no referral)
      await somniaService.registerReferral(
        userWalletAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        0 // SILVER tier default
      );
      return;
    }
    
    // Get referral code to determine tier
    const referralCode = await referralCodeRepository.findOne({
      where: { id: userReferral.referralCodeId }
    });
    
    const tierNumber = getTierNumber(referralCode?.tier || 'SILVER');
    
    // Register on blockchain
    const txHash = await somniaService.registerReferral(
      userWalletAddress,
      userReferral.directReferrer?.walletAddress || ethers.ZeroAddress,
      userReferral.grandReferrer?.walletAddress || ethers.ZeroAddress,
      tierNumber
    );
    
    logger.info(`✅ Fallback: Registered user ${userWalletAddress} on Somnia blockchain: ${txHash}`);
    
  } catch (error) {
    logger.error('❌ Failed to ensure referral registration on blockchain:', error);
    // Don't fail purchase - just log and continue
    // User will get no referral payouts but can still purchase
  }
}

// Database connection check middleware
const checkDatabaseConnection = async (req: Request, res: Response, next: Function): Promise<void> => {
  try {
    if (!AppDataSource.isInitialized) {
      logger.error('❌ Database not initialized, attempting recovery...');
      const recovered = await recoverDatabaseConnection();
      if (!recovered) {
        res.status(503).json({
          success: false,
          message: 'Database service unavailable'
        });
        return;
      }
    }
    
    // Test database connection
    await AppDataSource.query('SELECT 1');
    next();
  } catch (error) {
    logger.error('❌ Database connection check failed, attempting recovery...', error);
    try {
      const recovered = await recoverDatabaseConnection();
      if (recovered) {
        next();
      } else {
        res.status(503).json({
          success: false,
          message: 'Database connection failed'
        });
        return;
      }
    } catch (recoveryError) {
      logger.error('❌ Database recovery failed:', recoveryError);
      res.status(503).json({
        success: false,
        message: 'Database service unavailable'
      });
      return;
    }
  }
};

// Apply database connection check to all routes
router.use(checkDatabaseConnection);

// Configure AWS S3 for pre-signed URL generation
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content-staging';

// Log AWS configuration for debugging
logger.info(`🔧 AWS S3 Configuration:`);
logger.info(`   Bucket: ${S3_BUCKET_NAME}`);
logger.info(`   Region: ${process.env.AWS_REGION || 'us-east-1'}`);
logger.info(`   Access Key ID: ${process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET'}`);
logger.info(`   Secret Access Key: ${process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET'}`);

/**
 * Check if a pre-signed URL has expired
 */
function isUrlExpired(preSignedUrl: string): boolean {
  try {
    const url = new URL(preSignedUrl);
    
    // Check for AWS Signature Version 4 (X-Amz-Date and X-Amz-Expires)
    const amzDate = url.searchParams.get('X-Amz-Date');
    const amzExpires = url.searchParams.get('X-Amz-Expires');
    
    if (amzDate && amzExpires) {
      // X-Amz-Date is in format: YYYYMMDDTHHMMSSZ
      // Parse it to timestamp
      const year = parseInt(amzDate.substring(0, 4));
      const month = parseInt(amzDate.substring(4, 6)) - 1; // months are 0-indexed
      const day = parseInt(amzDate.substring(6, 8));
      const hour = parseInt(amzDate.substring(9, 11));
      const minute = parseInt(amzDate.substring(11, 13));
      const second = parseInt(amzDate.substring(13, 15));
      
      const creationTime = Math.floor(new Date(Date.UTC(year, month, day, hour, minute, second)).getTime() / 1000);
      const expiresInSeconds = parseInt(amzExpires, 10);
      const expirationTime = creationTime + expiresInSeconds;
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Add 5-minute buffer to refresh URLs before they actually expire
      const bufferSeconds = 300; // 5 minutes
      const isExpired = currentTime >= (expirationTime - bufferSeconds);
      
      if (isExpired) {
        logger.info(`🕐 URL expired: Current time ${currentTime}, Expiration time ${expirationTime} (with 5min buffer)`);
      }
      
      return isExpired;
    }
    
    // Check for AWS Signature Version 2 (Expires parameter)
    const expiresParam = url.searchParams.get('Expires');
    if (expiresParam) {
      const expirationTime = parseInt(expiresParam, 10);
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Add 5-minute buffer
      const bufferSeconds = 300;
      const isExpired = currentTime >= (expirationTime - bufferSeconds);
      
      if (isExpired) {
        logger.info(`🕐 URL expired (v2 signature): Current time ${currentTime}, Expiration time ${expirationTime} (with 5min buffer)`);
      }
      
      return isExpired;
    }
    
    // No expiration parameters found - assume it's a non-presigned URL or expired
    logger.warn(`⚠️ No expiration parameters found in URL, treating as expired`);
    return true;
  } catch (error) {
    logger.error(`❌ Failed to check URL expiration: ${preSignedUrl}`, error);
    return true; // Assume expired if we can't parse
  }
}

/**
 * Extract S3 key from pre-signed URL or direct S3 URL
 */
function extractS3KeyFromUrl(preSignedUrl: string): string | null {
  try {
    const url = new URL(preSignedUrl);
    
    // Handle bucket.s3.amazonaws.com format (both presigned and direct URLs)
    if (url.hostname.includes('.s3.amazonaws.com')) {
      const s3Key = url.pathname.substring(1); // Remove leading slash
      logger.info(`🔍 Extracted S3 key from ${url.hostname}: ${s3Key}`);
      return s3Key;
    }
    
    logger.warn(`⚠️ URL does not contain .s3.amazonaws.com: ${preSignedUrl}`);
    return null;
  } catch (error) {
    logger.error(`❌ Failed to extract S3 key from URL: ${preSignedUrl}`, error);
    return null;
  }
}

/**
 * Generate presigned URL using Python backend (same as carousel route) with caching
 */
async function generatePresignedUrl(s3Key: string): Promise<string | null> {
  try {
    // First, check if Redis is available and try to get cached URL
    const isRedisAvailable = await UrlCacheService.isRedisAvailable();
    if (isRedisAvailable) {
      const cachedUrl = await UrlCacheService.getCachedUrl(s3Key);
      if (cachedUrl) {
        return cachedUrl;
      }
    }

    // If not cached or Redis unavailable, generate new presigned URL
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
    if (!pythonBackendUrl) {
      logger.error('PYTHON_AI_BACKEND_URL environment variable is not set, falling back to local generation');
      return generatePresignedUrlLocal(s3Key);
    }

    // Retry mechanism with exponential backoff
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🔗 Requesting presigned URL for S3 key: ${s3Key} (attempt ${attempt}/${maxRetries})`);
        
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?s3_key=${encodeURIComponent(s3Key)}&expiration=3600`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Python backend responded with ${response.status}`);
        }

        const result = await response.json() as {
          status: string;
          presigned_url?: string;
          error?: string;
        };

        if (result.status === 'success' && result.presigned_url) {
          logger.info(`✅ Generated presigned URL for S3 key: ${s3Key}`);
          
          // Cache the new URL if Redis is available
          if (isRedisAvailable) {
            await UrlCacheService.cacheUrl(s3Key, result.presigned_url, 3300); // 55 minutes TTL
          }
          
          return result.presigned_url;
        } else {
          throw new Error(`Failed to generate presigned URL: ${result.error}`);
        }
        
      } catch (error) {
        lastError = error as Error;
        logger.error(`Error generating presigned URL for S3 key: ${s3Key} (attempt ${attempt}/${maxRetries})`, error);
        
        // If this is the last attempt, fallback to local generation
        if (attempt === maxRetries) {
          logger.info(`🔄 All attempts failed, falling back to local generation for S3 key: ${s3Key}`);
          return generatePresignedUrlLocal(s3Key);
        }
        
        // Wait before retrying (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 seconds
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This should never be reached, but just in case
    return generatePresignedUrlLocal(s3Key);
  } catch (error) {
    logger.error(`❌ Unexpected error in generatePresignedUrl for S3 key: ${s3Key}`, error);
    return generatePresignedUrlLocal(s3Key);
  }
}

/**
 * Generate presigned URL locally (fallback)
 */
function generatePresignedUrlLocal(s3Key: string): string | null {
  try {
    logger.info(`🔍 Generating presigned URL locally for S3 key: ${s3Key}`);
    logger.info(`🔍 Using bucket: ${S3_BUCKET_NAME}`);
    logger.info(`🔍 AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
    
    const params = {
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
      Expires: 3600 // 1 hour
    };

    const url = s3.getSignedUrl('getObject', params);
    logger.info(`🔄 Generated local presigned URL for: ${s3Key}`);
    logger.info(`🔍 Presigned URL: ${url.substring(0, 150)}...`);
    return url;
  } catch (error) {
    logger.error(`❌ Failed to generate local presigned URL for ${s3Key}:`, error);
    logger.error(`❌ AWS Config: Access Key ID exists: ${!!process.env.AWS_ACCESS_KEY_ID}, Secret exists: ${!!process.env.AWS_SECRET_ACCESS_KEY}`);
    return null;
  }
}

/**
 * Process content and refresh expired URLs
 */
async function refreshExpiredUrls(content: any): Promise<any> {
  // Process content text (contains S3 URLs)
  if (content.contentText && typeof content.contentText === 'string') {
    const s3UrlRegex = /https:\/\/[^.\s]+\.s3\.amazonaws\.com\/[^\s)]+/g;
    const urls = content.contentText.match(s3UrlRegex) || [];

    let updatedText = content.contentText;
    for (const url of urls) {
              if (isUrlExpired(url)) {
          const s3Key = extractS3KeyFromUrl(url);
          if (s3Key) {
            const freshUrl = await generatePresignedUrl(s3Key);
            if (freshUrl) {
              updatedText = updatedText.replace(url, freshUrl);
              logger.info(`🔄 Refreshed expired URL in content ${content.id}`);
            }
          }
        }
    }
    content.contentText = updatedText;
  }

  // Process content images (handle both camelCase and snake_case field names)
  const contentImages = content.contentImages || content.content_images;
  if (contentImages) {
    if (Array.isArray(contentImages)) {
      const updatedImages = await Promise.all(
        contentImages.map(async (imageUrl: string) => {
          if (typeof imageUrl === 'string' && isUrlExpired(imageUrl)) {
            const s3Key = extractS3KeyFromUrl(imageUrl);
            if (s3Key) {
              const freshUrl = await generatePresignedUrl(s3Key);
              if (freshUrl) {
                logger.info(`🔄 Refreshed expired image URL in content ${content.id}`);
                return freshUrl;
              }
            }
          }
          return imageUrl;
        })
      );
      // Update both possible field names
      if (content.contentImages) {
        content.contentImages = updatedImages;
      }
      if (content.content_images) {
        content.content_images = updatedImages;
      }
    }
  }

  // Process watermark image (ALWAYS generate presigned URL - watermark images are stored as direct S3 URLs)
  // Support both camelCase (database) and snake_case (formatted) field names
  const watermarkImage = content.watermarkImage || content.watermark_image;
  if (watermarkImage && typeof watermarkImage === 'string') {
    logger.info(`🔍 Processing watermark image for content ${content.id}: ${watermarkImage}`);
    
    // Check if this is already a presigned URL
    if (watermarkImage.includes('?') && (watermarkImage.includes('X-Amz-Signature') || watermarkImage.includes('Signature'))) {
      logger.info(`🔍 Watermark image already has presigned URL for content ${content.id}`);
    } else {
      // This is a direct S3 URL - convert it to presigned URL
      logger.info(`🔍 Converting direct S3 URL to presigned URL for content ${content.id}`);
      
      const s3Key = extractS3KeyFromUrl(watermarkImage);
      logger.info(`🔍 Extracted S3 key: ${s3Key}`);
      
      if (s3Key) {
        const freshUrl = await generatePresignedUrl(s3Key);
        logger.info(`🔍 Generated presigned URL: ${freshUrl ? 'SUCCESS' : 'FAILED'}`);
        
        if (freshUrl) {
          // Update both possible field names
          if (content.watermarkImage) {
            content.watermarkImage = freshUrl;
          }
          if (content.watermark_image) {
            content.watermark_image = freshUrl;
          }
          logger.info(`🔄 Generated presigned URL for watermark in content ${content.id}`);
        } else {
          logger.error(`❌ Failed to generate presigned URL for watermark in content ${content.id}, S3 key: ${s3Key}`);
          // Fallback: keep the original URL but log the error
          logger.warn(`⚠️ Keeping original watermark URL for content ${content.id}: ${watermarkImage}`);
        }
      } else {
        logger.error(`❌ Failed to extract S3 key from watermark URL: ${watermarkImage}`);
        // Try alternative extraction method for watermark URLs
        if (watermarkImage.includes('s3.amazonaws.com')) {
          try {
            const url = new URL(watermarkImage);
            const alternativeS3Key = url.pathname.substring(1); // Remove leading slash
            logger.info(`🔍 Alternative S3 key extraction: ${alternativeS3Key}`);
            
            const freshUrl = await generatePresignedUrl(alternativeS3Key);
            if (freshUrl) {
              // Update both possible field names
              if (content.watermarkImage) {
                content.watermarkImage = freshUrl;
              }
              if (content.watermark_image) {
                content.watermark_image = freshUrl;
              }
              logger.info(`🔄 Generated presigned URL using alternative method for content ${content.id}`);
            } else {
              logger.error(`❌ Alternative presigned URL generation failed for S3 key: ${alternativeS3Key}`);
            }
          } catch (error) {
            logger.error(`❌ Alternative S3 key extraction failed: ${error}`);
          }
        } else {
          logger.warn(`⚠️ Watermark URL does not contain s3.amazonaws.com: ${watermarkImage}`);
        }
      }
    }
  }

  // Process video URL (ALWAYS generate presigned URL for videos)
  const videoUrl = content.videoUrl || content.video_url;
  if (videoUrl && typeof videoUrl === 'string') {
    logger.info(`🎬 Processing video URL for content ${content.id}: ${videoUrl.substring(0, 100)}...`);
    
    if (isUrlExpired(videoUrl)) {
      const s3Key = extractS3KeyFromUrl(videoUrl);
      if (s3Key) {
        const freshUrl = await generatePresignedUrl(s3Key);
        if (freshUrl) {
          // Update both possible field names
          if (content.videoUrl) {
            content.videoUrl = freshUrl;
          }
          if (content.video_url) {
            content.video_url = freshUrl;
          }
          logger.info(`🔄 Refreshed expired video URL in content ${content.id}`);
        }
      }
    }
  }

  // Process watermark video URL (ALWAYS generate presigned URL for watermarked videos)
  const watermarkVideoUrl = content.watermarkVideoUrl || content.watermark_video_url;
  if (watermarkVideoUrl && typeof watermarkVideoUrl === 'string') {
    logger.info(`🎬 Processing watermark video URL for content ${content.id}: ${watermarkVideoUrl.substring(0, 100)}...`);
    
    if (isUrlExpired(watermarkVideoUrl)) {
      const s3Key = extractS3KeyFromUrl(watermarkVideoUrl);
      if (s3Key) {
        const freshUrl = await generatePresignedUrl(s3Key);
        if (freshUrl) {
          // Update both possible field names
          if (content.watermarkVideoUrl) {
            content.watermarkVideoUrl = freshUrl;
          }
          if (content.watermark_video_url) {
            content.watermark_video_url = freshUrl;
          }
          logger.info(`🔄 Refreshed expired watermark video URL in content ${content.id}`);
        }
      }
    }
  }

  return content;
}

/**
 * Process content for MinerMyContent - always use unwatermarked URLs and generate fresh presigned URLs
 * AGGRESSIVE URL REFRESH: Always regenerate URLs to prevent any expired URL issues for miners
 */
async function refreshUrlsForMinerContent(content: any): Promise<any> {
  // For MinerMyContent, we ALWAYS want fresh presigned URLs and NEVER watermarked content
  // This is the user's own content, so they should see the original unwatermarked version
  
  // Process content images - ALWAYS generate fresh presigned URLs for miner content
  const contentImages = content.contentImages || content.content_images;
  if (contentImages) {
    if (Array.isArray(contentImages)) {
      // Process images sequentially to prevent connection exhaustion
      const updatedImages = [];
      for (const imageUrl of contentImages) {
        if (typeof imageUrl === 'string') {
          const s3Key = extractS3KeyFromUrl(imageUrl);
          if (s3Key) {
            try {
              const freshUrl = await generatePresignedUrl(s3Key);
              if (freshUrl) {
                logger.info(`🔄 Generated fresh presigned URL for image in content ${content.id}`);
                updatedImages.push(freshUrl);
              } else {
                logger.warn(`⚠️ Failed to generate presigned URL for image, using original`);
                updatedImages.push(imageUrl); // Fallback to original
              }
            } catch (error) {
              logger.error(`Error generating presigned URL for image in content ${content.id}:`, error);
              updatedImages.push(imageUrl); // Fallback to original
            }
          } else {
            logger.warn(`⚠️ Could not extract S3 key from image URL: ${imageUrl.substring(0, 100)}`);
            updatedImages.push(imageUrl); // Fallback to original
          }
        } else {
          updatedImages.push(imageUrl);
        }
      }
      // Update both possible field names
      if (content.contentImages) {
        content.contentImages = updatedImages;
      }
      if (content.content_images) {
        content.content_images = updatedImages;
      }
    }
  }

  // Process video URL - ALWAYS generate fresh presigned URL for miner content
  const videoUrl = content.videoUrl || content.video_url;
  if (videoUrl && typeof videoUrl === 'string') {
    logger.info(`🎬 Generating fresh presigned URL for video in content ${content.id}`);
    
    const s3Key = extractS3KeyFromUrl(videoUrl);
    if (s3Key) {
      try {
        const freshUrl = await generatePresignedUrl(s3Key);
        if (freshUrl) {
          // Update both possible field names
          if (content.videoUrl) {
            content.videoUrl = freshUrl;
          }
          if (content.video_url) {
            content.video_url = freshUrl;
          }
          logger.info(`🔄 Generated fresh presigned URL for video in content ${content.id}`);
        } else {
          logger.warn(`⚠️ Failed to generate presigned URL for video, keeping original`);
        }
      } catch (error) {
        logger.error(`Error generating video URL for content ${content.id}:`, error);
      }
    }
  }

  // Process watermark video URL - ALWAYS generate fresh presigned URL for miner content
  const watermarkVideoUrl = content.watermarkVideoUrl || content.watermark_video_url;
  if (watermarkVideoUrl && typeof watermarkVideoUrl === 'string') {
    logger.info(`🎬 Generating fresh presigned URL for watermarked video in content ${content.id}`);
    
    const s3Key = extractS3KeyFromUrl(watermarkVideoUrl);
    if (s3Key) {
      try {
        const freshUrl = await generatePresignedUrl(s3Key);
        if (freshUrl) {
          // Update both possible field names
          if (content.watermarkVideoUrl) {
            content.watermarkVideoUrl = freshUrl;
          }
          if (content.watermark_video_url) {
            content.watermark_video_url = freshUrl;
          }
          logger.info(`🔄 Generated fresh presigned URL for watermarked video in content ${content.id}`);
        } else {
          logger.warn(`⚠️ Failed to generate presigned URL for watermarked video, keeping original`);
        }
      } catch (error) {
        logger.error(`Error generating watermark video URL for content ${content.id}:`, error);
      }
    }
  }

  return content;
}

/**
 * Automatically process expired auctions and select winners
 */
async function processExpiredAuctions(): Promise<void> {
  try {
    console.log('🕐 Processing expired auctions...');
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    
    // Find content with expired bidding periods that haven't been processed yet
    const expiredContent = await contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .where('content.isBiddable = :biddable', { biddable: true })
      .andWhere('content.biddingEndDate <= :now', { now: new Date() })
      .andWhere('content.isAvailable = :available', { available: true })
      .getMany();

    console.log(`📋 Found ${expiredContent.length} expired auctions to process`);

    for (const content of expiredContent) {
      // Get all bids for this content
      const bids = await biddingRepository
        .createQueryBuilder('bid')
        .leftJoinAndSelect('bid.bidder', 'bidder')
        .where('bid.contentId = :contentId', { contentId: content.id })
        .andWhere('bid.hasWon = :hasWon', { hasWon: false }) // Only unprocessed bids
        .orderBy('bid.bidAmount', 'DESC')
        .addOrderBy('bid.createdAt', 'ASC') // Earlier bid wins if amounts are equal
        .getMany();

      if (bids.length > 0) {
        const winningBid = bids[0];
        
        if (winningBid) {
          // Mark the winning bid
          winningBid.hasWon = true;
          winningBid.isWinning = true;
          winningBid.wonAt = new Date();
          
          // Mark all other bids as losing
          const losingBids = bids.slice(1);
          losingBids.forEach(bid => {
            bid.isWinning = false;
            bid.hasWon = false;
          });

          // Save all bid updates
          await biddingRepository.save([winningBid, ...losingBids]);

          // Mark content as no longer available for bidding (auction ended)
          content.isAvailable = false;
          content.isBiddable = false;
          await contentRepository.save(content);

          console.log(`🏆 Winner selected for content ${content.id}: User ${winningBid.bidderId} with bid ${winningBid.bidAmount} ${winningBid.bidCurrency}`);
        }
      } else {
        // No bids, just mark as ended
        content.isAvailable = false;
        content.isBiddable = false;
        await contentRepository.save(content);
        
        console.log(`⏰ Auction ended with no bids for content ${content.id}`);
      }
    }
    
    console.log('✅ Expired auction processing completed');
  } catch (error) {
    console.error('❌ Error processing expired auctions:', error);
  }
}

/**
 * Apply personalized edits to content if user has completed edits
 */
const applyPersonalizedEdits = async (content: any, walletAddress: string): Promise<any> => {
  try {
    logger.info(`🔍 Checking personalized edits for content ${content.id}, wallet ${walletAddress.substring(0, 10)}...`);
    
    // Check for user edits in user_tweet_edits table
    const { UserTweetEdits, EditStatus } = await import('../models/UserTweetEdits');
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    
    // Find the most recent completed edit for this content by this user (case-insensitive)
    const latestEdit = await editRepository.findOne({
      where: { 
        contentId: content.id,
        walletAddress: walletAddress.toLowerCase(), // Ensure lowercase comparison
        status: EditStatus.COMPLETED
      },
      order: { updatedAt: 'DESC' }
    });

    logger.info(`🔍 Edit query result for content ${content.id}:`, {
      contentId: content.id,
      walletAddress: walletAddress.substring(0, 10) + '...',
      editFound: !!latestEdit,
      editId: latestEdit?.id,
      editStatus: latestEdit?.status
    });

    if (!latestEdit) {
      // No personalized edit found, return original content
      logger.info(`❌ No personalized edit found for content ${content.id}`);
      return content;
    }

    logger.info(`🎨 Found personalized edit for content ${content.id}, wallet ${walletAddress.substring(0, 10)}...`);

    // Helper function to regenerate presigned URL (reuse from content/:id endpoint)
    const regeneratePresignedUrl = async (existingUrl: string): Promise<string | null> => {
      if (!existingUrl) return null;
      
      try {
        logger.info(`🔄 Regenerating presigned URL for marketplace: ${existingUrl.substring(0, 100)}...`);
        
        const url = new URL(existingUrl);
        const s3Key = url.pathname.substring(1); // Remove leading slash
        
        const queryParams = new URLSearchParams({
          s3_key: s3Key,
          expiration: '3600'
        });
        
        const fullUrl = `${env.ai.pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams}`;
        
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          const result = await response.json() as { presigned_url: string };
          logger.info(`✅ Generated fresh presigned URL for marketplace`);
          return result.presigned_url;
        } else {
          const errorText = await response.text();
          logger.warn(`⚠️ Failed to regenerate presigned URL for marketplace: ${s3Key}, Response: ${errorText}`);
        }
        
        return existingUrl; // Return original if regeneration fails
      } catch (error) {
        logger.error(`❌ Error regenerating presigned URL for marketplace: ${error}`);
        return existingUrl;
      }
    };

    // Regenerate presigned URLs for edit images
    const newWatermarkImageUrl = latestEdit.newWatermarkImageUrl ? 
      await regeneratePresignedUrl(latestEdit.newWatermarkImageUrl) : null;

    // Update the edit record with fresh watermark URL if it changed
    if (newWatermarkImageUrl && newWatermarkImageUrl !== latestEdit.newWatermarkImageUrl) {
      latestEdit.newWatermarkImageUrl = newWatermarkImageUrl;
      await editRepository.save(latestEdit);
      logger.info(`✅ Updated edit record with fresh watermark URL for marketplace`);
    }

    // Create personalized content with user's edits
    const personalizedContent = {
      ...content,
      // Replace text with user's edited version
      content_text: latestEdit.newTweetText || content.content_text,
      tweet_thread: latestEdit.newThread || content.tweet_thread,
      // For marketplace (pre-purchase), show watermarked image only
      watermark_image: newWatermarkImageUrl || content.watermark_image,
      // Keep original content_images unchanged (they're for post-purchase)
      // Add metadata to indicate this is personalized
      isPersonalized: true,
      personalizedAt: latestEdit.updatedAt
    };

    logger.info(`🎨 Applied personalized edit to content ${content.id} for marketplace display`);
    return personalizedContent;

  } catch (error) {
    logger.error(`❌ Error applying personalized edits to content ${content.id}:`, error);
    // Return original content if personalization fails
    return content;
  }
};

/**
 * @route GET /api/marketplace/content
 * @desc Get available content in marketplace with filters (updated for immediate purchase system)
 */
router.get('/content', async (req, res) => {
  try {
    const { 
      search,
      platform_source,
      project_name,
      post_type,
      video_only,
      sort_by = 'bidding_enabled',
      page = 1,
      limit = 18,
      network = 'base' // Default to base network
    } = req.query;

    // Get wallet address from Authorization header (optional for marketplace browsing)
    const walletAddress = req.headers.authorization?.replace('Bearer ', '');
    logger.info(`🔍 Marketplace request - wallet address: ${walletAddress ? walletAddress.substring(0, 10) + '...' : 'anonymous'}`);
    logger.info(`🔍 Marketplace request - network: ${network}`);

    const marketplaceService = new MarketplaceContentService();
    
    const result = await marketplaceService.getMarketplaceContent({
      search: search as string,
      platform_source: platform_source as string,
      project_name: project_name as string,
      post_type: post_type as string,
      video_only: video_only === 'true',
      sort_by: sort_by as string,
      page: Number(page),
      limit: Number(limit),
      network: network as string // Pass network filter
    });

    // Refresh expired pre-signed URLs in all content
    const refreshedContents = await Promise.all(
      result.data.map(content => refreshExpiredUrls(content))
    );

    // Apply personalized edits if user is logged in
    let personalizedContents = refreshedContents;
    if (walletAddress) {
      logger.info(`🎨 Applying personalized edits for wallet: ${walletAddress.substring(0, 10)}...`);
      logger.info(`🎨 Processing ${refreshedContents.length} content items, IDs: ${refreshedContents.map(c => c.id).join(', ')}`);
      personalizedContents = await Promise.all(
        refreshedContents.map(content => applyPersonalizedEdits(content, walletAddress.toLowerCase()))
      );
    } else {
      logger.info(`🔍 No wallet address provided, skipping personalization`);
    }

    // Update the result with personalized content
    result.data = personalizedContents;

    res.json(result);

  } catch (error) {
    logger.error('❌ Error fetching marketplace content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch marketplace content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/search-suggestions
 * @desc Get search suggestions for platforms, projects, and post types
 */
router.get('/search-suggestions', async (req, res) => {
  try {
    const marketplaceService = new MarketplaceContentService();
    const suggestions = await marketplaceService.getSearchSuggestions();
    
    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    logger.error('❌ Error fetching search suggestions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch search suggestions',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/content-old
 * @desc Original database-based content endpoint (for future use)
 */
router.get('/content-old', async (req, res) => {
  try {
    const { 
      campaign_id, 
      min_quality_score, 
      max_price, 
      sort_by = 'predicted_mindshare',
      order = 'DESC',
      page = 1,
      limit = 20 
    } = req.query;

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const queryBuilder = contentRepository.createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('content.isAvailable = :isAvailable', { isAvailable: true });

    // Apply filters
    if (campaign_id) {
      queryBuilder.andWhere('content.campaignId = :campaignId', { campaignId: campaign_id });
    }

    if (min_quality_score) {
      queryBuilder.andWhere('content.qualityScore >= :minQuality', { minQuality: min_quality_score });
    }

    if (max_price) {
      queryBuilder.andWhere('content.askingPrice <= :maxPrice', { maxPrice: max_price });
    }

    // Sorting
    const validSortFields = ['predicted_mindshare', 'quality_score', 'asking_price', 'created_at'];
    const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'predicted_mindshare';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    queryBuilder.orderBy(`content.${sortField.replace('_', '')}`, sortOrder);

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    queryBuilder.skip(offset).take(limitNum);

    const [contents, total] = await queryBuilder.getManyAndCount();

    res.json({
      success: true,
      data: contents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching marketplace content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch marketplace content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route PUT /api/marketplace/content/:id/update-text-only
 * @desc Update content with text-only regeneration data from Python backend
 */
router.put('/content/:id/update-text-only', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { updatedTweet, updatedThread, imagePrompt } = req.body;
    
    if (!id || isNaN(parseInt(id))) {
      res.status(400).json({
        error: 'Invalid content ID',
        message: 'Valid content ID is required'
      });
      return;
    }
    
    if (!updatedTweet) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'updatedTweet is required'
      });
      return;
    }
    
    logger.info(`📝 Updating content ${id} with text-only regeneration data`);
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) }
    });
    
    if (!content) {
      res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found'
      });
      return;
    }
    
    // Update the content with new text data
    content.updatedTweet = updatedTweet;
    content.updatedThread = updatedThread || [];
    content.imagePrompt = imagePrompt || '';
    
    await contentRepository.save(content);
    
    logger.info(`✅ Successfully updated content ${id} with text-only regeneration data`);
    
    res.json({
      success: true,
      message: 'Content updated successfully',
      content: {
        id: content.id,
        updatedTweet: content.updatedTweet,
        updatedThread: content.updatedThread,
        imagePrompt: content.imagePrompt
      }
    });
    
  } catch (error) {
    logger.error(`❌ Error updating content ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route PUT /api/marketplace/content/:id/edit-text
 * @desc Update content text through user editing (post-purchase)
 */
router.put('/content/:id/edit-text', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { updatedTweet, updatedThread, walletAddress } = req.body;
    
    if (!id || isNaN(parseInt(id))) {
      res.status(400).json({
        error: 'Invalid content ID',
        message: 'Valid content ID is required'
      });
      return;
    }
    
    if (!updatedTweet) {
      res.status(400).json({
        error: 'Missing required fields',
        message: 'updatedTweet is required'
      });
      return;
    }
    
    if (!walletAddress) {
      res.status(400).json({
        error: 'Missing wallet address',
        message: 'walletAddress is required for ownership verification'
      });
      return;
    }
    
    logger.info(`📝 User editing content ${id} with wallet ${walletAddress}`);
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['creator']
    });
    
    if (!content) {
      res.status(404).json({
        error: 'Content not found',
        message: 'Content with this ID not found'
      });
      return;
    }
    
    // Verify ownership - check if user has purchased this content
    const purchase = await purchaseRepository.findOne({
      where: {
        contentId: parseInt(id),
        buyerWalletAddress: walletAddress.toLowerCase(),
        paymentStatus: 'completed'
      }
    });
    
    if (!purchase) {
      res.status(403).json({
        error: 'Access denied',
        message: 'You can only edit content you have purchased'
      });
      return;
    }
    
    // Validate character limits based on post type
    const postType = content.postType || 'thread';
    const maxChars = postType === 'longpost' ? 25000 : 280;
    
    if (updatedTweet.length > maxChars) {
      res.status(400).json({
        error: 'Character limit exceeded',
        message: `${postType} content cannot exceed ${maxChars} characters`
      });
      return;
    }
    
    // Validate thread items if provided
    if (updatedThread && Array.isArray(updatedThread)) {
      for (const [index, threadItem] of updatedThread.entries()) {
        if (typeof threadItem !== 'string') {
          res.status(400).json({
            error: 'Invalid thread item',
            message: `Thread item ${index + 1} must be a string`
          });
          return;
        }
        
        if (threadItem.length > 280) {
          res.status(400).json({
            error: 'Thread item too long',
            message: `Thread item ${index + 1} cannot exceed 280 characters`
          });
          return;
        }
      }
    }
    
    // Update the content with new text data
    content.updatedTweet = updatedTweet;
    content.updatedThread = updatedThread || [];
    
    await contentRepository.save(content);
    
    logger.info(`✅ Successfully updated content ${id} with user edits`);
    
    res.json({
      success: true,
      message: 'Content updated successfully',
      content: {
        id: content.id,
        updatedTweet: content.updatedTweet,
        updatedThread: content.updatedThread,
        postType: content.postType
      }
    });
    
  } catch (error) {
    logger.error(`❌ Error updating content ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/content/:id
 * @desc Get specific content details with bidding information
 */
router.get('/content/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      res.status(400).json({
        success: false,
        message: 'Invalid content ID'
      });
      return;
    }
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['creator', 'campaign', 'campaign.project'] // Load project to get somniaWhitelisted
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found'
      });
      return;
    }

    // Check for user edits in user_tweet_edits table
    const { UserTweetEdits, EditStatus } = await import('../models/UserTweetEdits');
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    
    // Find the most recent completed edit for this content
    const latestEdit = await editRepository.findOne({
      where: { 
        contentId: parseInt(id),
        status: EditStatus.COMPLETED
      },
      order: { updatedAt: 'DESC' }
    });

    // If edit exists, regenerate presigned URLs and update the record
    let editContent = null;
    if (latestEdit) {
      logger.info(`🔄 Found completed edit for content ${id}, regenerating presigned URLs`);
      
      // Helper function to regenerate presigned URL
      const regeneratePresignedUrl = async (existingUrl: string): Promise<string | null> => {
        if (!existingUrl) return null;
        
        try {
          logger.info(`🔄 Regenerating presigned URL for: ${existingUrl.substring(0, 100)}...`);
          
          // Extract S3 key from existing URL
          // URL format: https://burnie-mindshare-content-staging.s3.amazonaws.com/path/to/file.jpg?params
          const url = new URL(existingUrl);
          const s3Key = url.pathname.substring(1); // Remove leading slash
          
          logger.info(`🔑 Extracted S3 key: ${s3Key}`);
          logger.info(`🌐 Using Python backend URL: ${env.ai.pythonBackendUrl}`);
          
          // Generate fresh presigned URL using query parameters
          const queryParams = new URLSearchParams({
            s3_key: s3Key,
            expiration: '3600'
          });
          
          const fullUrl = `${env.ai.pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams}`;
          logger.info(`🔗 Calling: ${fullUrl}`);
          
          const response = await fetch(fullUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          logger.info(`📡 S3 API response status: ${response.status}`);
          
          if (response.ok) {
            const result = await response.json() as { presigned_url: string };
            logger.info(`✅ Generated new presigned URL: ${result.presigned_url.substring(0, 100)}...`);
            return result.presigned_url;
          } else {
            const errorText = await response.text();
            logger.warn(`⚠️ Failed to regenerate presigned URL for: ${s3Key}, Response: ${errorText}`);
          }
          
          return existingUrl; // Return original if regeneration fails
        } catch (error) {
          logger.error(`❌ Error regenerating presigned URL: ${error}`);
          return existingUrl;
        }
      };

      // Regenerate presigned URLs
      const newImageUrl = latestEdit.newImageUrl ? await regeneratePresignedUrl(latestEdit.newImageUrl) : null;
      const newWatermarkImageUrl = latestEdit.newWatermarkImageUrl ? await regeneratePresignedUrl(latestEdit.newWatermarkImageUrl) : null;

      // Update the edit record with fresh URLs if they changed
      if ((newImageUrl && newImageUrl !== latestEdit.newImageUrl) || 
          (newWatermarkImageUrl && newWatermarkImageUrl !== latestEdit.newWatermarkImageUrl)) {
        
        if (newImageUrl) latestEdit.newImageUrl = newImageUrl;
        if (newWatermarkImageUrl) latestEdit.newWatermarkImageUrl = newWatermarkImageUrl;
        
        await editRepository.save(latestEdit);
        logger.info(`✅ Updated edit record with fresh presigned URLs for content ${id}`);
      }

      editContent = {
        newTweetText: latestEdit.newTweetText,
        newThread: latestEdit.newThread || [],
        newImageUrl: newImageUrl,
        newWatermarkImageUrl: newWatermarkImageUrl,
        editedAt: latestEdit.updatedAt
      };
      
      logger.info(`📤 Returning editContent with URLs:`);
      logger.info(`   - newImageUrl: ${newImageUrl?.substring(0, 100)}...`);
      logger.info(`   - newWatermarkImageUrl: ${newWatermarkImageUrl?.substring(0, 100)}...`);
    }

    // Refresh expired URLs before formatting (including video URLs)
    const refreshedContent = await refreshExpiredUrls(content);

    // Format content for frontend consumption (same as MarketplaceContentService)
    const formattedContent = {
      id: refreshedContent.id,
      content_text: refreshedContent.contentText,
      tweet_thread: refreshedContent.tweetThread || null,
      content_images: refreshedContent.contentImages || [],
      watermark_image: refreshedContent.watermarkImage || null,
      predicted_mindshare: Number(refreshedContent.predictedMindshare || 0),
      quality_score: Number(refreshedContent.qualityScore || 0),
      asking_price: Number(refreshedContent.biddingAskPrice || refreshedContent.askingPrice || 0),
      bidding_ask_price: Number(refreshedContent.biddingAskPrice || refreshedContent.askingPrice || 0),
      post_type: refreshedContent.postType || 'thread',
      // Add text-only regeneration fields
      updatedTweet: refreshedContent.updatedTweet || null,
      updatedThread: refreshedContent.updatedThread || null,
      // Note: imagePrompt excluded from response (proprietary information)
      // Video fields with fresh presigned URLs
      is_video: refreshedContent.isVideo || false,
      video_url: refreshedContent.videoUrl || null,
      watermark_video_url: refreshedContent.watermarkVideoUrl || null,
      video_duration: refreshedContent.videoDuration || null,
      // Note: Proprietary prompt information (subsequent_frame_prompts, clip_prompts, audio_prompt, audio_prompts) excluded from response
      creator: {
        id: refreshedContent.creator?.id,
        username: refreshedContent.creator?.username || 'Anonymous',
        reputation_score: Number(refreshedContent.creator?.reputationScore || 0),
        wallet_address: refreshedContent.creator?.walletAddress
      },
      campaign: {
        id: refreshedContent.campaign?.id,
        title: refreshedContent.campaign?.title || 'Unknown Campaign',
        project_name: refreshedContent.campaign?.projectName || refreshedContent.campaign?.title || 'Unknown Project',
        platform_source: refreshedContent.campaign?.platformSource || 'unknown',
        reward_token: refreshedContent.campaign?.rewardToken || 'ROAST',
        somnia_whitelisted: refreshedContent.campaign?.project?.somniaWhitelisted || false // Add Somnia whitelist status
      },
      agent_name: refreshedContent.agentName,
      created_at: refreshedContent.createdAt.toISOString(),
      approved_at: refreshedContent.approvedAt?.toISOString(),
      bidding_enabled_at: refreshedContent.biddingEnabledAt?.toISOString() || 
        (refreshedContent.isBiddable ? refreshedContent.createdAt.toISOString() : null),
      is_biddable: refreshedContent.isBiddable,
      is_available: refreshedContent.isAvailable,
      isAvailable: refreshedContent.isAvailable, // Add this for frontend compatibility
      approval_status: refreshedContent.approvalStatus
    };

    // Get current bids
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const bids = await biddingRepository.find({
      where: { contentId: parseInt(id) },
      relations: ['bidder'],
      order: { bidAmount: 'DESC' }
    });

    // Get highest bid
    const highestBid = bids.length > 0 ? bids[0] : null;

    res.json({
      success: true,
      data: {
        content: formattedContent,
        editContent: editContent, // Include edit overlay data if available
        bids: bids.map(bid => ({
          id: bid.id,
          bidAmount: bid.bidAmount,
          bidCurrency: bid.bidCurrency,
          bidderUsername: bid.bidder.username,
          createdAt: bid.createdAt,
          isWinning: bid.isWinning
        })),
        highestBid: highestBid ? {
          amount: highestBid.bidAmount,
          currency: highestBid.bidCurrency,
          bidder: highestBid.bidder.username
        } : null,
        totalBids: bids.length
      }
    });
  } catch (error) {
    console.error('Error fetching content details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content details',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/content/:id/blockchain-registration
 * @desc Check if content is registered on blockchain (Somnia)
 */
router.get('/content/:id/blockchain-registration', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      res.status(400).json({
        success: false,
        message: 'Invalid content ID',
        isRegistered: false
      });
      return;
    }
    
    const ContentBlockchainTransaction = (await import('../models/ContentBlockchainTransaction')).ContentBlockchainTransaction;
    const txRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
    
    // Check if there's a SUCCESSFUL 'registration' transaction for this content on Somnia
    // Only count it as registered if status is 'confirmed'
    const registrationTx = await txRepository.findOne({
      where: {
        contentId: parseInt(id),
        transactionType: 'registration',
        network: 'somnia_testnet',
        status: 'confirmed' // ✅ Only count successful registrations
      }
    });
    
    const isRegistered = !!registrationTx;
    
    logger.info(`📋 Blockchain registration check for content ${id}: ${isRegistered ? 'REGISTERED' : 'NOT REGISTERED'}`);
    
    res.json({
      success: true,
      isRegistered,
      blockchainContentId: registrationTx?.blockchainContentId || null
    });
  } catch (error) {
    logger.error('❌ Error checking blockchain registration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check blockchain registration',
      isRegistered: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/bid
 * @desc Place a bid on content
 */
router.post('/bid', async (req: Request, res: Response): Promise<void> => {
  try {
    const { content_id, bid_amount, bid_currency = 'ROAST', wallet_address } = req.body;

    // Validation
    if (!content_id || !bid_amount || !wallet_address) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: content_id, bid_amount, wallet_address'
      });
      return;
    }

    if (bid_amount < env.platform.minimumBidAmount) {
      res.status(400).json({
        success: false,
        message: `Minimum bid amount is ${env.platform.minimumBidAmount} ${bid_currency}`
      });
      return;
    }

    // Check if content exists and is available for bidding
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { 
        id: content_id, 
        isAvailable: true,
        isBiddable: true,
        biddingEndDate: MoreThan(new Date()) // Only allow bids on active auctions
      }
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found, not available for bidding, or bidding has ended'
      });
      return;
    }

    // Find or create user by wallet address
    const userRepository = AppDataSource.getRepository(User);
    let user = await userRepository.findOne({ 
      where: { walletAddress: wallet_address.toLowerCase() } 
    });

    if (!user) {
      // Create new user if they don't exist
      user = new User();
      user.walletAddress = wallet_address.toLowerCase();
      user.roleType = UserRoleType.YAPPER;
      user = await userRepository.save(user);
      console.log('✅ Created new yapper user:', user.id, user.walletAddress);
    }

    // Check user balance (simplified for MVP - assuming users have sufficient balance)
    // const hasBalance = user.canAfford(bid_amount, bid_currency as 'ROAST' | 'USDC');
    // if (!hasBalance) {
    //   res.status(400).json({
    //     success: false,
    //     message: `Insufficient ${bid_currency} balance`
    //   });
    //   return;
    // }

    // Check if user already has a bid on this content
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const existingBid = await biddingRepository.findOne({
      where: { contentId: content_id, bidderId: user.id }
    });

    if (existingBid) {
      // Update existing bid
      existingBid.bidAmount = bid_amount;
      existingBid.bidCurrency = bid_currency as any;
      // createdAt will be updated automatically by TypeORM
      await biddingRepository.save(existingBid);

      // Update winning status
      await updateWinningBids(content_id);

      res.json({
        success: true,
        message: 'Bid updated successfully',
        data: {
          ...existingBid,
          user: { 
            id: user.id, 
            walletAddress: user.walletAddress,
            username: user.username 
          }
        }
      });
    } else {
      // Create new bid
      const newBid = biddingRepository.create({
        contentId: content_id,
        bidderId: user.id,
        bidAmount: bid_amount,
        bidCurrency: bid_currency as any
      });

      await biddingRepository.save(newBid);

      // Update winning status
      await updateWinningBids(content_id);

      res.json({
        success: true,
        message: 'Bid placed successfully',
        data: {
          ...newBid,
          user: { 
            id: user.id, 
            walletAddress: user.walletAddress,
            username: user.username 
          }
        }
      });
    }

  } catch (error) {
    console.error('Error placing bid:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route POST /api/marketplace/content/:id/purchase
 * @desc Purchase content directly (if allowed)
 */
router.post('/content/:id/purchase', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { user_id, payment_currency = 'ROAST' } = req.body;

    if (!id || isNaN(parseInt(id))) {
      res.status(400).json({
        success: false,
        message: 'Invalid content ID'
      });
      return;
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(id), isAvailable: true },
      relations: ['creator']
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found or not available'
      });
      return;
    }

    const userRepository = AppDataSource.getRepository(User);
    const buyer = await userRepository.findOne({ where: { id: user_id } });

    if (!buyer) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Use biddingAskPrice for purchase calculations (fallback to askingPrice for legacy content)
    const purchasePrice = content.biddingAskPrice || content.askingPrice || 0;

    // Check balance
    const hasBalance = buyer.canAfford(purchasePrice, payment_currency as 'ROAST' | 'USDC');
    if (!hasBalance) {
      res.status(400).json({
        success: false,
        message: `Insufficient ${payment_currency} balance`
      });
      return;
    }

    // Calculate platform fee
    const platformFee = purchasePrice * (env.platform.platformFeePercentage / 100);
    const creatorAmount = purchasePrice - platformFee;

    // Create payment transaction
    const transactionRepository = AppDataSource.getRepository(PaymentTransaction);
    const transaction = transactionRepository.create({
      fromUserId: user_id,
      toUserId: content.creatorId,
      amount: purchasePrice,
      currency: payment_currency as Currency,
      transactionType: TransactionType.CONTENT_PURCHASE,
      platformFee,
      metadata: {
        contentId: content.id,
        contentPreview: content.contentText.substring(0, 100)
      }
    });

    await transactionRepository.save(transaction);

    // Update user balances
    if (payment_currency === 'ROAST') {
      buyer.roastBalance -= purchasePrice;
      content.creator.roastBalance += creatorAmount;
    } else {
      buyer.usdcBalance -= purchasePrice;
      content.creator.usdcBalance += creatorAmount;
    }

    await userRepository.save([buyer, content.creator]);

    // Mark content as sold
    content.isAvailable = false;
    await contentRepository.save(content);

    res.json({
      success: true,
      message: 'Content purchased successfully',
      data: {
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          platformFee: transaction.platformFee,
          creatorAmount: creatorAmount
        },
        content: {
          id: content.id,
          contentText: content.contentText,
          predictedMindshare: content.predictedMindshare,
          qualityScore: content.qualityScore
        }
      }
    });

  } catch (error) {
    console.error('Error purchasing content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to purchase content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/my-bids/:user_id
 * @desc Get user's bidding history
 */
router.get('/my-bids/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const { status = 'all', page = 1, limit = 20 } = req.query;

    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const queryBuilder = biddingRepository.createQueryBuilder('bid')
      .leftJoinAndSelect('bid.content', 'content')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('bid.bidderId = :userId', { userId: user_id });

    if (status === 'winning') {
      queryBuilder.andWhere('bid.isWinning = :isWinning', { isWinning: true });
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    queryBuilder
      .orderBy('bid.createdAt', 'DESC')
      .skip(offset)
      .take(limitNum);

    const [bids, total] = await queryBuilder.getManyAndCount();

    res.json({
      success: true,
      data: bids,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching user bids:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user bids',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/approve
 * @desc Approve content from mining interface to marketplace
 */
router.post('/approve', async (req, res) => {
  try {
    const {
      campaignId,
      agentId,
      agentName,
      walletAddress,
      contentText,
      tweetThread,
      contentImages,
      predictedMindshare,
      qualityScore,
      generationMetadata,
      askingPrice = 100, // Default asking price
      postType = 'thread', // Default post type
      // Video fields
      isVideo = false,
      videoUrl,
      videoDuration,
      subsequentFramePrompts,
      clipPrompts,
      audioPrompt,
      audioPrompts
    } = req.body;

    // Debug: Log received data
    console.log('🔍 Approval request received:', {
      campaignId,
      agentId,
      agentName,
      walletAddress,
      contentText: contentText ? contentText.substring(0, 100) + '...' : null,
      tweetThread: tweetThread ? `Array with ${tweetThread.length} tweets` : null,
      contentImages,
      predictedMindshare,
      qualityScore,
      askingPrice
    });

    // Validate required fields
    if (!campaignId || !contentText || !walletAddress) {
      console.error('❌ Missing required fields:', { campaignId, contentText: !!contentText, walletAddress });
      res.status(400).json({
        success: false,
        error: 'Missing required fields: campaignId, contentText, walletAddress'
      });
      return;
    }

    // Save approved content to database
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const userRepository = AppDataSource.getRepository(User);
    
    // Find user by wallet address (case-insensitive) to get creatorId
    console.log('🔍 Looking for user with wallet address:', walletAddress);
    const creator = await userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .getOne();
    
    if (!creator) {
      console.error('❌ Creator not found with wallet address:', walletAddress);
      res.status(404).json({
        success: false,
        error: 'User not found. Content should have been synced to marketplace during generation.'
      });
      return;
    }
    
    console.log('✅ Found existing user:', creator.id, creator.walletAddress);

    // Try to find existing pending content record to update instead of creating new
    // Find the most recent pending content for this campaign and creator
    let existingContent = await contentRepository
      .createQueryBuilder('content')
      .where('content.campaignId = :campaignId', { campaignId: Number(campaignId) })
      .andWhere('content.creatorId = :creatorId', { creatorId: creator.id })
      .andWhere('content.contentText = :contentText', { contentText })
      .andWhere('content.approvalStatus = :status', { status: 'pending' })
      .orderBy('content.createdAt', 'DESC')
      .getOne();

    if (existingContent) {
      // UPDATE existing record
      console.log('📝 Updating existing content record:', existingContent.id);
      
      existingContent.predictedMindshare = Number(predictedMindshare) || existingContent.predictedMindshare || 75;
      existingContent.qualityScore = Number(qualityScore) || existingContent.qualityScore || 80;
      existingContent.askingPrice = Number(askingPrice) || existingContent.askingPrice;
      existingContent.postType = postType; // Add post type
      existingContent.approvalStatus = 'approved';
      existingContent.isAvailable = true;
      
      if (agentId) {
        existingContent.agentId = Number(agentId);
      }
      if (agentName) {
        existingContent.agentName = agentName;
      }
      if (walletAddress) {
        existingContent.walletAddress = walletAddress;
      }

      // Save to DB first
      const savedContent = await contentRepository.save(existingContent);

      // Approve on blockchain (async, non-blocking)
      const { contentIntegrationService } = require('../services/contentIntegrationService');
      const priceForBlockchain = savedContent.biddingAskPrice || Number(askingPrice) || 0;
      contentIntegrationService.approveContentOnChain(savedContent.id, priceForBlockchain).catch((error: any) => {
        console.error(`❌ Failed to approve content ${savedContent.id} on blockchain:`, error);
      });
      
      existingContent = savedContent; // Update reference
      
      // Determine if content has video based on videoUrl presence
      // IMPORTANT: Validate that videoUrl is actually a video, not an image
      const hasVideoUrl = videoUrl && videoUrl.trim() !== '';
      const isActuallyVideo = hasVideoUrl && !videoUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
      
      // If videoUrl contains an image extension, it's not a video - clear it
      if (hasVideoUrl && !isActuallyVideo) {
        console.log('⚠️ WARNING: video_url contains an image URL, clearing it for content approval:', {
          videoUrl: videoUrl.substring(0, 100),
          willClearVideoFields: true
        });
      }
      
      // Generate watermarked image if content has images
      let watermarkImageUrl: string | null = null;
      if (contentImages) {
        try {
          console.log('🖼️ Starting image watermarking for existing content update. Images:', contentImages);
          const s3Bucket = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';
          watermarkImageUrl = await WatermarkService.createWatermarkForContent(contentImages, s3Bucket);
          console.log('✅ Watermarked image created:', watermarkImageUrl);
        } catch (error) {
          console.error('❌ Failed to create image watermark:', error);
        }
      }

      // Start background video watermarking if content has video (non-blocking)
      if (isActuallyVideo) {
        try {
          console.log('🎬 Starting background video watermarking for content:', existingContent.id, 'Video URL:', videoUrl);
          const s3Bucket = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';
          // Start background task - don't wait for completion
          await VideoWatermarkService.createWatermarkForVideo(videoUrl!, s3Bucket, existingContent.id);
          console.log('✅ Video watermarking task queued in background for content:', existingContent.id);
        } catch (error) {
          console.error('❌ Failed to start video watermarking task:', error);
          // Log the full error for debugging
          if (error instanceof Error) {
            console.error('❌ Video watermarking error details:', error.message, error.stack);
          }
        }
      } else {
        console.log('⏭️ Skipping video watermarking - no valid video URL present for content:', existingContent.id);
      }

      // Always update contentImages and tweetThread regardless of value (null, array, etc.)
      existingContent.contentImages = contentImages;
      existingContent.tweetThread = tweetThread;
      if (watermarkImageUrl) {
        existingContent.watermarkImage = watermarkImageUrl;
      }
      // Update video fields - enforce consistency: isVideo should match ACTUAL video presence (not image URLs)
      existingContent.isVideo = Boolean(isActuallyVideo);
      existingContent.videoUrl = isActuallyVideo ? videoUrl : null;
      
      // Don't set watermarkVideoUrl here - it will be set later via callback (only if actual video exists)
      if (isActuallyVideo) {
        existingContent.watermarkVideoUrl = null; // Reset to null, will be updated by background task
      } else {
        existingContent.watermarkVideoUrl = null; // Clear if no video or if image URL was in video_url
      }
      
      // Video duration should only exist if actual video exists
      existingContent.videoDuration = isActuallyVideo && videoDuration !== undefined ? videoDuration : null;
      
      // Only update video metadata fields if actual video exists and they are provided (not null/undefined)
      if (isActuallyVideo && subsequentFramePrompts !== undefined && subsequentFramePrompts !== null) {
        existingContent.subsequentFramePrompts = subsequentFramePrompts;
      } else if (!isActuallyVideo) {
        existingContent.subsequentFramePrompts = null; // Clear if no video
      }
      
      if (isActuallyVideo && clipPrompts !== undefined && clipPrompts !== null) {
        existingContent.clipPrompts = clipPrompts;
      } else if (!isActuallyVideo) {
        existingContent.clipPrompts = null; // Clear if no video
      }
      
      if (isActuallyVideo && audioPrompt !== undefined && audioPrompt !== null) {
        existingContent.audioPrompt = audioPrompt;
      } else if (!isActuallyVideo) {
        existingContent.audioPrompt = null; // Clear if no video
      }
      
      if (isActuallyVideo && audioPrompts !== undefined && audioPrompts !== null) {
        existingContent.audioPrompts = audioPrompts;
      } else if (!isActuallyVideo) {
        existingContent.audioPrompts = null; // Clear if no video
      }
      if (generationMetadata) {
        existingContent.generationMetadata = generationMetadata;
      }
      
      existingContent.approvedAt = new Date();

      const updatedContent = await contentRepository.save(existingContent);

      console.log('✅ Content approved and updated in marketplace:', {
        id: updatedContent.id,
        creatorId: updatedContent.creatorId,
        campaignId: updatedContent.campaignId,
        agentId: updatedContent.agentId,
        agentName: updatedContent.agentName,
        walletAddress: updatedContent.walletAddress,
        contentText: updatedContent.contentText.substring(0, 100) + '...',
        tweetThread: updatedContent.tweetThread ? `Array with ${updatedContent.tweetThread.length} tweets` : null,
        contentImages: updatedContent.contentImages,
        predictedMindshare: updatedContent.predictedMindshare,
        qualityScore: updatedContent.qualityScore,
        askingPrice: updatedContent.askingPrice,
        approvedAt: updatedContent.approvedAt,
        action: 'UPDATED'
      });

      res.json({
        success: true,
        data: {
          id: updatedContent.id,
          message: 'Content approved and updated in marketplace',
          marketplace_url: `/marketplace/content/${updatedContent.id}`,
          approvedAt: updatedContent.approvedAt,
          action: 'updated'
        }
      });
      return;
    } else {
      // No pending content found - this shouldn't happen in normal flow
      console.error('❌ No pending content found for approval:', {
        campaignId,
        creatorId: creator.id,
        contentText: contentText.substring(0, 100) + '...'
      });
      
      res.status(404).json({
        success: false,
        error: 'No pending content found for approval. Content should have been synced to marketplace during generation.'
      });
      return;
    }

  } catch (error) {
    console.error('❌ Error approving content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve content'
    });
  }
});

/**
 * @route POST /api/marketplace/reject
 * @desc Reject content from mining interface
 */
router.post('/reject', async (req, res) => {
  try {
    const {
      campaignId,
      agentId,
      walletAddress,
      contentText,
      reason = 'Quality standards not met'
    } = req.body;

    // Validate required fields
    if (!campaignId || !contentText || !walletAddress) {
      console.error('❌ Missing required fields for rejection:', { campaignId, contentText: !!contentText, walletAddress });
      res.status(400).json({
        success: false,
        error: 'Missing required fields: campaignId, contentText, walletAddress'
      });
      return;
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const userRepository = AppDataSource.getRepository(User);
    
    // Find user by wallet address
    const creator = await userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .getOne();
    
    if (!creator) {
      console.error('❌ Creator not found for rejection:', walletAddress);
      res.status(400).json({
        success: false,
        error: 'Creator not found with the provided wallet address'
      });
      return;
    }

    // Try to find existing pending content record to update
    // Find the most recent pending content for this campaign and creator
    let existingContent = await contentRepository
      .createQueryBuilder('content')
      .where('content.campaignId = :campaignId', { campaignId: Number(campaignId) })
      .andWhere('content.creatorId = :creatorId', { creatorId: creator.id })
      .andWhere('content.contentText = :contentText', { contentText })
      .andWhere('content.approvalStatus = :status', { status: 'pending' })
      .orderBy('content.createdAt', 'DESC')
      .getOne();

    if (existingContent) {
      // UPDATE existing record
      console.log('📝 Rejecting existing content record:', existingContent.id);
      
      existingContent.approvalStatus = 'rejected';
      existingContent.isAvailable = false;
      existingContent.rejectedAt = new Date();
      
      if (agentId) {
        existingContent.agentId = Number(agentId);
      }
      
      const updatedContent = await contentRepository.save(existingContent);

      console.log('✅ Content rejected and updated in marketplace:', {
        id: updatedContent.id,
        creatorId: updatedContent.creatorId,
        campaignId: updatedContent.campaignId,
        agentId: updatedContent.agentId,
        walletAddress: updatedContent.walletAddress,
        contentText: updatedContent.contentText.substring(0, 100) + '...',
        rejectedAt: updatedContent.rejectedAt,
        reason,
        action: 'UPDATED'
      });

      res.json({
        success: true,
        data: {
          id: updatedContent.id,
          message: 'Content rejected and updated in marketplace',
          reason,
          rejectedAt: updatedContent.rejectedAt,
          action: 'updated'
        }
      });
      return;
    } else {
      // CREATE new rejected record (fallback when no pending record found)
      console.log('📝 Creating new rejected content record for:', {
        campaignId,
        agentId,
        walletAddress,
        contentText: contentText?.substring(0, 100) + '...',
        reason
      });
      
      const newContent = new ContentMarketplace();
      newContent.creatorId = creator.id;
      newContent.campaignId = Number(campaignId);
      if (agentId) {
        newContent.agentId = Number(agentId);
      }
      newContent.walletAddress = walletAddress;
      newContent.contentText = contentText;
      newContent.approvalStatus = 'rejected';
      newContent.isAvailable = false;
      newContent.rejectedAt = new Date();
      // Set default values for required fields
      newContent.askingPrice = 0;
      newContent.predictedMindshare = 0; // Default mindshare for rejected content
      newContent.qualityScore = 0; // Default quality score for rejected content

      const savedContent = await contentRepository.save(newContent);

      console.log('✅ New rejected content record created:', {
        id: savedContent.id,
        creatorId: savedContent.creatorId,
        campaignId: savedContent.campaignId,
        agentId: savedContent.agentId,
        walletAddress: savedContent.walletAddress,
        contentText: savedContent.contentText.substring(0, 100) + '...',
        rejectedAt: savedContent.rejectedAt,
        reason,
        action: 'CREATED'
      });

      res.json({
        success: true,
        data: {
          id: savedContent.id,
          message: 'Content rejected and recorded in marketplace',
          reason,
          rejectedAt: savedContent.rejectedAt,
          action: 'created'
        }
      });
      return;
    }

  } catch (error) {
    console.error('❌ Error rejecting content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject content'
    });
  }
});

/**
 * @route GET /api/marketplace/my-content/miner/wallet/:walletAddress/totals
 * @desc Get miner's content totals for metrics (no pagination)
 * @query include_pending - if 'true', includes all content statuses, otherwise only approved
 * @query only_available - if 'true', only returns content where isAvailable = true
 * @query search - search term for content text, campaign title, agent name
 * @query status_filter - filter by status: 'pending', 'approved', 'rejected'
 * @query bidding_filter - filter by bidding: 'enabled', 'disabled'
 * @query availability_filter - filter by availability: 'available', 'unavailable'
 */
router.get('/my-content/miner/wallet/:walletAddress/totals', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const { include_pending, only_available, search, status_filter, bidding_filter, availability_filter } = req.query;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address'
      });
    }

    // First, try to find the user by wallet address to get the creatorId
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress }
    });

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    let queryBuilder = contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign');

    if (user) {
      // If user exists, use the original logic (walletAddress OR creatorId)
      queryBuilder = queryBuilder.where('(LOWER(content.walletAddress) = LOWER(:walletAddress) OR (content.walletAddress IS NULL AND content.creatorId = :creatorId))', 
        { walletAddress, creatorId: user.id });
    } else {
      // If user doesn't exist (pure mining interface user), only look by walletAddress
      queryBuilder = queryBuilder.where('LOWER(content.walletAddress) = LOWER(:walletAddress)', 
        { walletAddress });
    }
    
    // Only filter by approval status if include_pending is not true
    if (include_pending !== 'true') {
      queryBuilder = queryBuilder.andWhere('content.approvalStatus = :status', { status: 'approved' });
    }
    
    // Filter by availability if only_available is true
    if (only_available === 'true') {
      queryBuilder = queryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
    }

    // Apply search filter
    if (search && search.toString().trim()) {
      const searchTerm = search.toString().trim();
      queryBuilder = queryBuilder.andWhere(
        '(content.contentText ILIKE :search OR campaign.title ILIKE :search OR content.agentName ILIKE :search)',
        { search: `%${searchTerm}%` }
      );
    }

    // Apply status filter
    if (status_filter && status_filter !== 'all') {
      queryBuilder = queryBuilder.andWhere('content.approvalStatus = :status', { status: status_filter });
    }

    // Apply bidding filter
    if (bidding_filter && bidding_filter !== 'all') {
      if (bidding_filter === 'enabled') {
        queryBuilder = queryBuilder.andWhere('content.isBiddable = :isBiddable', { isBiddable: true });
      } else if (bidding_filter === 'disabled') {
        queryBuilder = queryBuilder.andWhere('content.isBiddable = :isBiddable', { isBiddable: false });
      }
    }

    // Apply availability filter
    if (availability_filter && availability_filter !== 'all') {
      if (availability_filter === 'available') {
        queryBuilder = queryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
      } else if (availability_filter === 'unavailable') {
        queryBuilder = queryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: false });
      }
    }
    
    // Get all content without pagination for totals
    const contents = await queryBuilder
      .orderBy('content.createdAt', 'DESC')
      .getMany();

    // For totals endpoint, we don't need to refresh URLs since this is only used for analytics
    // This prevents unnecessary load on the Python AI backend
    const formattedContents = contents.map(content => ({
      id: content.id,
      content_text: content.contentText,
      tweet_thread: content.tweetThread || null,
      content_images: content.contentImages,
      // Don't send watermarked URLs for MinerMyContent - user should see original content
      // watermark_image: null,
      predicted_mindshare: Number(content.predictedMindshare),
      quality_score: Number(content.qualityScore),
      asking_price: Number(content.askingPrice),
      post_type: content.postType || 'thread',
      status: content.approvalStatus,
      is_available: content.isAvailable,
      // Video fields - add missing video data for consistency with Mining screen
      is_video: content.isVideo || false,
      video_url: content.videoUrl || null,
      // Send watermarked video URL for status display (watermarking progress badge)
      watermark_video_url: content.watermarkVideoUrl || null,
      video_duration: content.videoDuration || null,
      subsequent_frame_prompts: content.subsequentFramePrompts || null,
      clip_prompts: content.clipPrompts || null,
      audio_prompt: content.audioPrompt || null,
      creator: {
        username: content.creator?.username || 'Anonymous',
        reputation_score: content.creator?.reputationScore || 0
      },
      campaign: {
        title: content.campaign?.title || 'Unknown Campaign',
        platform_source: content.campaign?.platformSource || 'unknown',
        reward_token: content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: content.agentName,
      created_at: content.createdAt.toISOString(),
      approved_at: content.approvedAt?.toISOString() || null,
      is_biddable: content.isBiddable,
      bidding_end_date: content.biddingEndDate?.toISOString() || null,
      bidding_ask_price: content.biddingAskPrice ? Number(content.biddingAskPrice) : null,
      bidding_enabled_at: content.biddingEnabledAt?.toISOString() || null
    }));

    return res.json({
      success: true,
      data: formattedContents
    });

  } catch (error) {
    console.error('❌ Error fetching miner content totals:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch miner content totals'
    });
  }
});

/**
 * @route GET /api/marketplace/my-content/miner/wallet/:walletAddress
 * @desc Get miner's content for My Content section by wallet address with pagination
 * @query include_pending - if 'true', includes all content statuses, otherwise only approved
 * @query only_available - if 'true', only returns content where isAvailable = true
 * @query page - page number (default: 1)
 * @query limit - items per page (default: 20)
 * @query search - search term for content text, campaign title, agent name
 * @query status_filter - filter by status: 'pending', 'approved', 'rejected'
 * @query bidding_filter - filter by bidding: 'enabled', 'disabled'
 * @query availability_filter - filter by availability: 'available', 'unavailable'
 */
router.get('/my-content/miner/wallet/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const { include_pending, only_available, page = 1, limit = 20, search, status_filter, bidding_filter, availability_filter } = req.query;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address'
      });
    }

    const { env } = require('../config/env');
    const isAdminWallet = env.miner.adminWalletAddresses.includes(walletAddress.toLowerCase());

    // If this is an admin wallet, show content from both admin_content_approvals AND content_marketplace where admin is creator
    if (isAdminWallet) {
      const { AdminContentApproval } = await import('../models/AdminContentApproval');
      const approvalRepository = AppDataSource.getRepository(AdminContentApproval);
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);

      // 1. Get approvals for this admin (content generated by miners that needs approval)
      let approvalQueryBuilder = approvalRepository
        .createQueryBuilder('approval')
        .leftJoinAndSelect('approval.content', 'content')
        .leftJoinAndSelect('content.creator', 'creator')
        .leftJoinAndSelect('content.campaign', 'campaign')
        .where('approval.adminWalletAddress = :adminWallet', { adminWallet: walletAddress.toLowerCase() });

      // Apply status filter for approvals
      if (status_filter && status_filter !== 'all') {
        if (status_filter === 'pending') {
          approvalQueryBuilder = approvalQueryBuilder.andWhere('approval.status = :status', { status: 'pending' });
        } else if (status_filter === 'approved') {
          approvalQueryBuilder = approvalQueryBuilder.andWhere('approval.status = :status', { status: 'approved' });
        } else if (status_filter === 'rejected') {
          approvalQueryBuilder = approvalQueryBuilder.andWhere('approval.status = :status', { status: 'rejected' });
        }
      } else if (include_pending !== 'true') {
        // Default: only show pending approvals if include_pending is not explicitly true
        approvalQueryBuilder = approvalQueryBuilder.andWhere('approval.status = :status', { status: 'pending' });
      }

      // Apply search filter to approvals
      if (search && search.toString().trim()) {
        const searchTerm = search.toString().trim();
        approvalQueryBuilder = approvalQueryBuilder.andWhere(
          '(content.contentText ILIKE :search OR campaign.title ILIKE :search OR content.agentName ILIKE :search)',
          { search: `%${searchTerm}%` }
        );
      }

      // Apply bidding filter to approvals
      if (bidding_filter && bidding_filter !== 'all') {
        if (bidding_filter === 'enabled') {
          approvalQueryBuilder = approvalQueryBuilder.andWhere('content.isBiddable = :isBiddable', { isBiddable: true });
        } else if (bidding_filter === 'disabled') {
          approvalQueryBuilder = approvalQueryBuilder.andWhere('(content.isBiddable = :isBiddable OR content.isBiddable IS NULL)', { isBiddable: false });
        }
      }

      // Apply availability filter to approvals
      if (availability_filter && availability_filter !== 'all') {
        if (availability_filter === 'available') {
          approvalQueryBuilder = approvalQueryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
        } else if (availability_filter === 'unavailable') {
          approvalQueryBuilder = approvalQueryBuilder.andWhere('(content.isAvailable = :isAvailable OR content.isAvailable IS NULL)', { isAvailable: false });
        }
      }

      // Apply only_available filter to approvals (if specified)
      if (only_available === 'true') {
        approvalQueryBuilder = approvalQueryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
      }

      // Get all approvals (we'll paginate after combining with admin-created content)
      const approvals = await approvalQueryBuilder
        .orderBy('approval.assignedAt', 'DESC')
        .getMany();

      // 2. Get content from content_marketplace where admin is the creator
      let adminContentQueryBuilder = contentRepository
        .createQueryBuilder('content')
        .leftJoinAndSelect('content.creator', 'creator')
        .leftJoinAndSelect('content.campaign', 'campaign')
        .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress });

      // Only filter by approval status if include_pending is not true
      if (include_pending !== 'true') {
        adminContentQueryBuilder = adminContentQueryBuilder.andWhere('content.approvalStatus = :status', { status: 'approved' });
      }

      // Apply only_available filter to admin-created content (if specified)
      if (only_available === 'true') {
        adminContentQueryBuilder = adminContentQueryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
      }

      // Apply status filter for admin-created content
      if (status_filter && status_filter !== 'all') {
        if (status_filter === 'pending') {
          adminContentQueryBuilder = adminContentQueryBuilder.andWhere('content.approvalStatus = :status', { status: 'pending' });
        } else if (status_filter === 'approved') {
          adminContentQueryBuilder = adminContentQueryBuilder.andWhere('content.approvalStatus = :status', { status: 'approved' });
        } else if (status_filter === 'rejected') {
          adminContentQueryBuilder = adminContentQueryBuilder.andWhere('content.approvalStatus = :status', { status: 'rejected' });
        }
      }

      // Apply search filter to admin-created content
      if (search && search.toString().trim()) {
        const searchTerm = search.toString().trim();
        adminContentQueryBuilder = adminContentQueryBuilder.andWhere(
          '(content.contentText ILIKE :search OR campaign.title ILIKE :search OR content.agentName ILIKE :search)',
          { search: `%${searchTerm}%` }
        );
      }

      // Apply bidding filter to admin-created content
      if (bidding_filter && bidding_filter !== 'all') {
        if (bidding_filter === 'enabled') {
          adminContentQueryBuilder = adminContentQueryBuilder.andWhere('content.isBiddable = :isBiddable', { isBiddable: true });
        } else if (bidding_filter === 'disabled') {
          adminContentQueryBuilder = adminContentQueryBuilder.andWhere('(content.isBiddable = :isBiddable OR content.isBiddable IS NULL)', { isBiddable: false });
        }
      }

      // Apply availability filter to admin-created content
      if (availability_filter && availability_filter !== 'all') {
        if (availability_filter === 'available') {
          adminContentQueryBuilder = adminContentQueryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
        } else if (availability_filter === 'unavailable') {
          adminContentQueryBuilder = adminContentQueryBuilder.andWhere('(content.isAvailable = :isAvailable OR content.isAvailable IS NULL)', { isAvailable: false });
        }
      }

      // Get all admin-created content
      const adminCreatedContent = await adminContentQueryBuilder
        .orderBy('content.createdAt', 'DESC')
        .getMany();

      // 3. Format approval content with admin approval info
      // IMPORTANT: Refresh presigned URLs for miner-generated content so admins can see images
      logger.info(`🔄 Refreshing presigned URLs for ${approvals.length} miner-generated content items for admin ${walletAddress}`);
      const approvalContents = await Promise.all(approvals.map(async (approval) => {
        const content = approval.content;
        
        // Log original URLs for debugging
        logger.info(`🔍 Content ${content.id} - Original images: ${JSON.stringify(content.contentImages?.slice(0, 1).map((url: string) => url?.substring(0, 80)))}`);
        
        // Refresh presigned URLs for images and videos so admins can view them
        await refreshUrlsForMinerContent(content);
        
        // Log refreshed URLs
        logger.info(`✅ Content ${content.id} - Refreshed images: ${JSON.stringify(content.contentImages?.slice(0, 1).map((url: string) => url?.substring(0, 80)))}`);
        
        return {
          id: content.id,
          content_text: content.contentText,
          tweet_thread: content.tweetThread || null,
          content_images: content.contentImages,
          predicted_mindshare: Number(content.predictedMindshare),
          quality_score: Number(content.qualityScore),
          asking_price: Number(content.askingPrice),
          post_type: content.postType || 'thread',
          status: content.approvalStatus,
          is_available: content.isAvailable,
          is_video: content.isVideo || false,
          video_url: content.videoUrl || null,
          watermark_video_url: content.watermarkVideoUrl || null,
          video_duration: content.videoDuration || null,
          subsequent_frame_prompts: content.subsequentFramePrompts || null,
          clip_prompts: content.clipPrompts || null,
          audio_prompt: content.audioPrompt || null,
          creator: {
            username: content.creator?.username || 'Anonymous',
            reputation_score: content.creator?.reputationScore || 0
          },
          campaign: {
            title: content.campaign?.title || 'Unknown Campaign',
            platform_source: content.campaign?.platformSource || 'unknown',
            reward_token: content.campaign?.rewardToken || 'ROAST'
          },
          agent_name: content.agentName,
          created_at: content.createdAt.toISOString(),
          approved_at: content.approvedAt?.toISOString() || null,
          is_biddable: content.isBiddable,
          bidding_end_date: content.biddingEndDate?.toISOString() || null,
          bidding_ask_price: content.biddingAskPrice ? Number(content.biddingAskPrice) : null,
          bidding_enabled_at: content.biddingEnabledAt?.toISOString() || null,
          // Admin-specific fields for miner-generated content
          is_miner_generated: true,
          miner_wallet_address: approval.minerWalletAddress,
          approval_id: approval.id,
          approval_status: approval.status,
          admin_notes: approval.adminNotes,
          sort_date: approval.assignedAt.getTime() // For sorting
        };
      }));

      // 4. Format admin-created content
      // IMPORTANT: Also refresh presigned URLs for admin's own content
      logger.info(`🔄 Refreshing presigned URLs for ${adminCreatedContent.length} admin-created content items for admin ${walletAddress}`);
      const formattedAdminContent = await Promise.all(adminCreatedContent.map(async (content) => {
        // Log original URLs for debugging
        logger.info(`🔍 Admin Content ${content.id} - Original images: ${JSON.stringify(content.contentImages?.slice(0, 1).map((url: string) => url?.substring(0, 80)))}`);
        
        // Refresh presigned URLs for images and videos so admins can view their own content
        await refreshUrlsForMinerContent(content);
        
        // Log refreshed URLs
        logger.info(`✅ Admin Content ${content.id} - Refreshed images: ${JSON.stringify(content.contentImages?.slice(0, 1).map((url: string) => url?.substring(0, 80)))}`);
        
        return {
          id: content.id,
          content_text: content.contentText,
          tweet_thread: content.tweetThread || null,
          content_images: content.contentImages,
          predicted_mindshare: Number(content.predictedMindshare),
          quality_score: Number(content.qualityScore),
          asking_price: Number(content.askingPrice),
          post_type: content.postType || 'thread',
          status: content.approvalStatus,
          is_available: content.isAvailable,
          is_video: content.isVideo || false,
          video_url: content.videoUrl || null,
          watermark_video_url: content.watermarkVideoUrl || null,
          video_duration: content.videoDuration || null,
          subsequent_frame_prompts: content.subsequentFramePrompts || null,
          clip_prompts: content.clipPrompts || null,
          audio_prompt: content.audioPrompt || null,
          creator: {
            username: content.creator?.username || 'Anonymous',
            reputation_score: content.creator?.reputationScore || 0
          },
          campaign: {
            title: content.campaign?.title || 'Unknown Campaign',
            platform_source: content.campaign?.platformSource || 'unknown',
            reward_token: content.campaign?.rewardToken || 'ROAST'
          },
          agent_name: content.agentName,
          created_at: content.createdAt.toISOString(),
          approved_at: content.approvedAt?.toISOString() || null,
          is_biddable: content.isBiddable,
          bidding_end_date: content.biddingEndDate?.toISOString() || null,
          bidding_ask_price: content.biddingAskPrice ? Number(content.biddingAskPrice) : null,
          bidding_enabled_at: content.biddingEnabledAt?.toISOString() || null,
          // Admin-specific fields for admin-created content
          is_miner_generated: false,
          miner_wallet_address: null,
          approval_id: null,
          approval_status: null,
          admin_notes: null,
          sort_date: content.createdAt.getTime() // For sorting
        };
      }));

      // 5. Combine both sets, remove duplicates by content ID, and sort by date (newest first)
      const contentMap = new Map<number, any>();
      
      // Add approval contents first (they take precedence if duplicate)
      approvalContents.forEach(item => {
        contentMap.set(item.id, item);
      });
      
      // Add admin-created content (skip if already exists from approvals)
      formattedAdminContent.forEach(item => {
        if (!contentMap.has(item.id)) {
          contentMap.set(item.id, item);
        }
      });

      // Convert to array and sort by sort_date (newest first)
      const allContents = Array.from(contentMap.values()).sort((a, b) => b.sort_date - a.sort_date);

      // Remove sort_date before returning
      const finalContents = allContents.map(({ sort_date, ...rest }) => rest);

      // 6. Apply pagination to combined results
      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 20;
      const offset = (pageNum - 1) * limitNum;
      const totalCount = finalContents.length;
      const paginatedContents = finalContents.slice(offset, offset + limitNum);

      return res.json({
        success: true,
        data: paginatedContents,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limitNum)
        }
      });
    }

    // Regular miner flow - show their own content
    // First, try to find the user by wallet address to get the creatorId
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress }
    });

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    let queryBuilder = contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign');

    if (user) {
      // If user exists, use the original logic (walletAddress OR creatorId)
      queryBuilder = queryBuilder.where('(LOWER(content.walletAddress) = LOWER(:walletAddress) OR (content.walletAddress IS NULL AND content.creatorId = :creatorId))', 
        { walletAddress, creatorId: user.id });
    } else {
      // If user doesn't exist (pure mining interface user), only look by walletAddress
      queryBuilder = queryBuilder.where('LOWER(content.walletAddress) = LOWER(:walletAddress)', 
        { walletAddress });
    }
    
    // Only filter by approval status if include_pending is not true
    if (include_pending !== 'true') {
      queryBuilder = queryBuilder.andWhere('content.approvalStatus = :status', { status: 'approved' });
    }
    
    // Filter by availability if only_available is true
    if (only_available === 'true') {
      queryBuilder = queryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
    }

    // Apply search filter
    if (search && search.toString().trim()) {
      const searchTerm = search.toString().trim();
      queryBuilder = queryBuilder.andWhere(
        '(content.contentText ILIKE :search OR campaign.title ILIKE :search OR content.agentName ILIKE :search)',
        { search: `%${searchTerm}%` }
      );
    }

    // Apply status filter
    if (status_filter && status_filter !== 'all') {
      queryBuilder = queryBuilder.andWhere('content.approvalStatus = :status', { status: status_filter });
    }

    // Apply bidding filter
    if (bidding_filter && bidding_filter !== 'all') {
      if (bidding_filter === 'enabled') {
        queryBuilder = queryBuilder.andWhere('content.isBiddable = :isBiddable', { isBiddable: true });
      } else if (bidding_filter === 'disabled') {
        queryBuilder = queryBuilder.andWhere('content.isBiddable = :isBiddable', { isBiddable: false });
      }
    }

    // Apply availability filter
    if (availability_filter && availability_filter !== 'all') {
      if (availability_filter === 'available') {
        queryBuilder = queryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: true });
      } else if (availability_filter === 'unavailable') {
        queryBuilder = queryBuilder.andWhere('content.isAvailable = :isAvailable', { isAvailable: false });
      }
    }
    
    // Get total count for pagination
    const totalCount = await queryBuilder.getCount();
    
    // Apply pagination
    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 20;
    const offset = (pageNum - 1) * limitNum;
    
    const contents = await queryBuilder
      .orderBy('content.createdAt', 'DESC')
      .skip(offset)
      .take(limitNum)
      .getMany();

    // Refresh URLs for miner content - use unwatermarked URLs with fresh presigned URLs
    // Only process the paginated content items (not all content in database)
    logger.info(`🔄 Refreshing URLs for ${contents.length} content items (page ${pageNum}, limit ${limitNum})`);
    
    // Process content sequentially to prevent connection exhaustion
    const refreshedContents = [];
    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      try {
        const refreshedContent = await refreshUrlsForMinerContent(content);
        refreshedContents.push(refreshedContent);
        
        // Add small delay between content items to prevent overwhelming the system
        if (i < contents.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        logger.error(`Error refreshing URLs for content ${content?.id || 'unknown'}:`, error);
        refreshedContents.push(content); // Use original content if refresh fails
      }
    }

    const formattedContents = refreshedContents.map(content => ({
      id: content.id,
      content_text: content.contentText,
      tweet_thread: content.tweetThread || null, // Include tweet thread data
      content_images: content.contentImages,
      // Don't send watermarked URLs for MinerMyContent - user should see original content
      // watermark_image: null,
      predicted_mindshare: Number(content.predictedMindshare),
      quality_score: Number(content.qualityScore),
      asking_price: Number(content.askingPrice),
      post_type: content.postType || 'thread', // Include post type
      status: content.approvalStatus, // Add approval status
      is_available: content.isAvailable, // Add availability status
      // Video fields - add missing video data for consistency with Mining screen
      is_video: content.isVideo || false,
      video_url: content.videoUrl || null,
      // Send watermarked video URL for status display (watermarking progress badge)
      watermark_video_url: content.watermarkVideoUrl || null,
      video_duration: content.videoDuration || null,
      subsequent_frame_prompts: content.subsequentFramePrompts || null,
      clip_prompts: content.clipPrompts || null,
      audio_prompt: content.audioPrompt || null,
      creator: {
        username: content.creator?.username || 'Anonymous',
        reputation_score: content.creator?.reputationScore || 0
      },
      campaign: {
        title: content.campaign?.title || 'Unknown Campaign',
        platform_source: content.campaign?.platformSource || 'unknown',
        reward_token: content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: content.agentName,
      created_at: content.createdAt.toISOString(),
      approved_at: content.approvedAt?.toISOString() || null,
      is_biddable: content.isBiddable,
      bidding_end_date: content.biddingEndDate?.toISOString() || null,
      bidding_ask_price: content.biddingAskPrice ? Number(content.biddingAskPrice) : null,
      bidding_enabled_at: content.biddingEnabledAt?.toISOString() || null
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    return res.json({
      success: true,
      data: formattedContents,
      pagination: {
        currentPage: pageNum,
        limit: limitNum,
        totalItems: totalCount,
        totalPages: totalPages,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage,
        nextPage: hasNextPage ? pageNum + 1 : null,
        prevPage: hasPrevPage ? pageNum - 1 : null
      }
    });

  } catch (error) {
    console.error('❌ Error fetching miner content by wallet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch miner content'
    });
  }
});

/**
 * @route GET /api/marketplace/my-content/miner/:userId
 * @desc Get miner's approved content for My Content section (legacy - by user ID)
 */
router.get('/my-content/miner/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const contents = await contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('content.creatorId = :userId', { userId: parseInt(userId) })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .orderBy('content.createdAt', 'DESC')
      .getMany();

    const formattedContents = contents.map(content => ({
      id: content.id,
      content_text: content.contentText,
      tweet_thread: content.tweetThread || null, // Include tweet thread data
      content_images: content.contentImages,
      watermark_image: content.watermarkImage || null,
      predicted_mindshare: Number(content.predictedMindshare),
      quality_score: Number(content.qualityScore),
      asking_price: Number(content.askingPrice),
      creator: {
        username: content.creator?.username || 'Anonymous',
        reputation_score: content.creator?.reputationScore || 0
      },
      campaign: {
        title: content.campaign?.title || 'Unknown Campaign',
        platform_source: content.campaign?.platformSource || 'unknown',
        reward_token: content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: content.agentName,
      created_at: content.createdAt.toISOString(),
      approved_at: content.approvedAt?.toISOString() || null,
      is_biddable: content.isBiddable,
      bidding_end_date: content.biddingEndDate?.toISOString() || null,
      bidding_ask_price: content.biddingAskPrice ? Number(content.biddingAskPrice) : null,
      bidding_enabled_at: content.biddingEnabledAt?.toISOString() || null
    }));

    return res.json({
      success: true,
      data: formattedContents
    });

  } catch (error) {
    console.error('❌ Error fetching miner content:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch miner content'
    });
  }
});

/**
 * Apply personalized edits to My Content (purchased content - always use unwatermarked version)
 */
const applyPersonalizedEditsToMyContent = async (content: any, walletAddress: string): Promise<any> => {
  try {
    // Check for user edits in user_tweet_edits table
    const { UserTweetEdits, EditStatus } = await import('../models/UserTweetEdits');
    const editRepository = AppDataSource.getRepository(UserTweetEdits);
    
    // Find the most recent completed edit for this content by this user
    const latestEdit = await editRepository.findOne({
      where: { 
        contentId: content.id,
        walletAddress: walletAddress.toLowerCase(),
        status: EditStatus.COMPLETED
      },
      order: { updatedAt: 'DESC' }
    });

    if (!latestEdit) {
      // No personalized edit found, return original content
      return content;
    }

    logger.info(`🎨 [MyContent] Found personalized edit for content ${content.id}, wallet ${walletAddress.substring(0, 10)}...`);

    // Helper function to regenerate presigned URL (reuse logic)
    const regeneratePresignedUrl = async (existingUrl: string): Promise<string | null> => {
      if (!existingUrl) return null;
      
      try {
        const url = new URL(existingUrl);
        const s3Key = url.pathname.substring(1);
        
        const queryParams = new URLSearchParams({
          s3_key: s3Key,
          expiration: '3600'
        });
        
        const fullUrl = `${env.ai.pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams}`;
        
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          const result = await response.json() as { presigned_url: string };
          return result.presigned_url;
        } else {
          const errorText = await response.text();
          logger.warn(`⚠️ [MyContent] Failed to regenerate presigned URL: ${s3Key}, Response: ${errorText}`);
        }
        
        return existingUrl;
      } catch (error) {
        logger.error(`❌ [MyContent] Error regenerating presigned URL: ${error}`);
        return existingUrl;
      }
    };

    // For My Content (purchased), always use unwatermarked version
    const newImageUrl = latestEdit.newImageUrl ? 
      await regeneratePresignedUrl(latestEdit.newImageUrl) : null;

    // Update the edit record with fresh URL if it changed
    if (newImageUrl && newImageUrl !== latestEdit.newImageUrl) {
      latestEdit.newImageUrl = newImageUrl;
      await editRepository.save(latestEdit);
      logger.info(`✅ [MyContent] Updated edit record with fresh URL`);
    }

    // Create personalized content with user's edits (unwatermarked for purchased content)
    const personalizedContent = {
      ...content,
      // Use updatedTweet and updatedThread to follow existing frontend priority logic
      updatedTweet: latestEdit.newTweetText || content.updatedTweet || content.contentText,
      updatedThread: latestEdit.newThread || content.updatedThread || content.tweetThread,
      // For My Content (purchased), use unwatermarked image
      contentImages: newImageUrl ? [newImageUrl] : content.contentImages,
      // Add metadata to indicate this is personalized
      isPersonalized: true,
      personalizedAt: latestEdit.updatedAt
    };

    logger.info(`🎨 [MyContent] Applied personalized edit to content ${content.id} (unwatermarked)`);
    logger.info(`🎨 [MyContent] Updated text - original: "${content.contentText?.substring(0, 50)}..." -> personalized: "${latestEdit.newTweetText?.substring(0, 50)}..."`);
    return personalizedContent;

  } catch (error) {
    logger.error(`❌ [MyContent] Error applying personalized edits to content ${content.id}:`, error);
    // Return original content if personalization fails
    return content;
  }
};

/**
 * @route GET /api/marketplace/my-content/yapper/wallet/:walletAddress
 * @desc Get yapper's owned content (direct purchases only) for My Content section with pagination and search
 */
router.get('/my-content/yapper/wallet/:walletAddress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.params;
    const { 
      search,
      platform_source,
      project_name,
      post_type,
      page = 1,
      limit = 18 
    } = req.query;
    
    if (!walletAddress) {
      res.status(400).json({
        success: false,
        message: 'Invalid wallet address'
      });
      return;
    }

    // For immediate purchase system, only show content from purchases (not won bids)
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    // Build query with filters
    let queryBuilder = purchaseRepository
      .createQueryBuilder('purchase')
      .leftJoinAndSelect('purchase.content', 'content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('LOWER(purchase.buyerWalletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('purchase.paymentStatus = :status', { status: 'completed' });

    // Apply search filters
    if (search && search.toString().trim()) {
      const searchTerm = `%${search.toString().toLowerCase()}%`;
      queryBuilder = queryBuilder.andWhere(
        '(LOWER(content.contentText) LIKE :search OR LOWER(campaign.title) LIKE :search OR LOWER(campaign.projectName) LIKE :search OR campaign.platformSource::text LIKE :search)',
        { search: searchTerm }
      );
    }

    if (platform_source && platform_source !== 'all') {
      queryBuilder = queryBuilder.andWhere('campaign.platformSource = :platformSource', { platformSource: platform_source });
    }

    if (project_name && project_name !== 'all') {
      queryBuilder = queryBuilder.andWhere('LOWER(campaign.projectName) = LOWER(:projectName)', { projectName: project_name });
    }

    if (post_type && post_type !== 'all') {
      queryBuilder = queryBuilder.andWhere('content.postType = :postType', { postType: post_type });
    }

    // Get total count for pagination
    const totalCount = await queryBuilder.getCount();

    // Apply pagination
    const pageNum = Math.max(1, parseInt(page.toString()));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit.toString())));
    const offset = (pageNum - 1) * limitNum;

    queryBuilder = queryBuilder
      .orderBy('purchase.purchasedAt', 'DESC')
      .skip(offset)
      .take(limitNum);

    const purchases = await queryBuilder.getMany();

    // Refresh expired pre-signed URLs in purchased content
    const refreshedPurchases = await Promise.all(
      purchases.map(async purchase => {
        purchase.content = await refreshExpiredUrls(purchase.content);
        return purchase;
      })
    );

    // Apply personalized edits for purchased content (always use unwatermarked version)
    const personalizedPurchases = await Promise.all(
      refreshedPurchases.map(async purchase => {
        purchase.content = await applyPersonalizedEditsToMyContent(purchase.content, walletAddress.toLowerCase());
        return purchase;
      })
    );

    // Format content from direct purchases
    const formattedPurchaseContent = personalizedPurchases.map(purchase => ({
      id: purchase.content.id,
      content_text: purchase.content.contentText,
      tweet_thread: purchase.content.tweetThread || null,
      content_images: purchase.content.contentImages, // Use original images, not watermarked
      watermark_image: purchase.content.watermarkImage || null,
      // Add video fields for purchased content (always unwatermarked since user owns it)
      is_video: purchase.content.isVideo || false,
      video_url: purchase.content.videoUrl || null,
      watermark_video_url: purchase.content.watermarkVideoUrl || null,
      video_duration: purchase.content.videoDuration || null,
      predicted_mindshare: Number(purchase.content.predictedMindshare),
      quality_score: Number(purchase.content.qualityScore),
      asking_price: Number(purchase.content.askingPrice),
      post_type: purchase.content.postType || 'thread',
      // Add text-only regeneration fields
      updatedTweet: purchase.content.updatedTweet || null,
      updatedThread: purchase.content.updatedThread || null,
      creator: {
        username: purchase.content.creator?.username || 'Anonymous',
        reputation_score: purchase.content.creator?.reputationScore || 0
      },
      campaign: {
        title: purchase.content.campaign?.title || 'Unknown Campaign',
        platform_source: purchase.content.campaign?.platformSource || 'unknown',
        project_name: purchase.content.campaign?.projectName || null,
        reward_token: purchase.content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: purchase.content.agentName,
      created_at: purchase.content.createdAt?.toISOString() || null,
      approved_at: purchase.content.approvedAt?.toISOString() || null,
      purchased_at: purchase.purchasedAt?.toISOString() || null,
      acquisition_type: 'purchase' as const,
      payment_details: {
        payment_currency: purchase.paymentCurrency,
        conversion_rate: purchase.conversionRate || 1,
        original_roast_price: purchase.originalRoastPrice,
        miner_payout_roast: purchase.minerPayoutRoast
      },
      transaction_hash: purchase.transactionHash,
      treasury_transaction_hash: purchase.treasuryTransactionHash
    }));

    console.log(`📦 Found ${formattedPurchaseContent.length} purchases for yapper ${walletAddress} (page ${pageNum}, limit ${limitNum})`);

    res.json({
      success: true,
      data: formattedPurchaseContent,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum),
        hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
        hasPreviousPage: pageNum > 1
      },
      metadata: {
        total: totalCount,
        won_bids: 0, // No longer showing won bids
        direct_purchases: totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching yapper content:', error);
    res.status(500).json({ error: 'Failed to fetch yapper content' });
  }
});


/**
 * @route GET /api/marketplace/my-content/yapper/:userId
 * @desc Get yapper's won content for My Content section (legacy - by user ID)
 */
router.get('/my-content/yapper/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Get content where this user has the winning bid
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    
    const winningBids = await biddingRepository
      .createQueryBuilder('bid')
      .leftJoinAndSelect('bid.bidder', 'bidder')
      .leftJoinAndSelect('bid.content', 'content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('bid.bidderId = :userId', { userId: parseInt(userId) })
      .andWhere('bid.isWinning = :winning', { winning: true })
      .orderBy('bid.createdAt', 'DESC')
      .getMany();

    const formattedContents = winningBids.map(bid => ({
      id: bid.content.id,
      content_text: bid.content.contentText,
      content_images: bid.content.contentImages,
      predicted_mindshare: Number(bid.content.predictedMindshare),
      quality_score: Number(bid.content.qualityScore),
      asking_price: Number(bid.content.askingPrice),
      creator: {
        username: bid.content.creator?.username || 'Anonymous',
        reputation_score: bid.content.creator?.reputationScore || 0
      },
      campaign: {
        title: bid.content.campaign?.title || 'Unknown Campaign',
        platform_source: bid.content.campaign?.platformSource || 'unknown',
        reward_token: bid.content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: bid.content.agentName,
      created_at: bid.content.createdAt?.toISOString() || null,
      approved_at: bid.content.approvedAt?.toISOString() || null,
      winning_bid: {
        amount: Number(bid.bidAmount),
        currency: bid.bidCurrency,
        bid_date: bid.createdAt?.toISOString() || null
      }
    }));

    return res.json({
      success: true,
      data: formattedContents
    });

  } catch (error) {
    console.error('❌ Error fetching yapper content:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch yapper content'
    });
  }
});

/**
 * @route PUT /api/marketplace/content/:id/bidding
 * @desc Enable/disable bidding for content and set pricing
 */
router.put('/content/:id/bidding', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { is_biddable, bidding_end_date, bidding_ask_price, wallet_address } = req.body;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content ID'
      });
    }

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['creator']
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Verify ownership by wallet address or creatorId (for backward compatibility)
    // OR check if user is an admin (for miner-generated content)
    let isOwner = false;
    let isAdmin = false;
    
    // Check if wallet is an admin wallet
    const { env } = require('../config/env');
    isAdmin = env.miner.adminWalletAddresses.includes(wallet_address.toLowerCase());
    
    if (content.walletAddress) {
      // Modern ownership check: compare wallet addresses
      isOwner = content.walletAddress.toLowerCase() === wallet_address.toLowerCase();
    } else {
      // Legacy ownership check: find user by wallet address and compare creatorId
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { walletAddress: wallet_address.toLowerCase() }
      });
      
      if (user && content.creatorId === user.id) {
        isOwner = true;
        // Update content with wallet address for future requests
        content.walletAddress = wallet_address;
        console.log('📝 Updated legacy content with wallet address:', {
          contentId: content.id,
          walletAddress: wallet_address
        });
      }
    }
    
    // Allow modification if:
    // 1. User is the owner (wallet_address matches)
    // 2. User is an admin (can modify miner-generated content)
    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You can only modify your own content (or you must be an admin)'
      });
    }
    
    // Log admin action for audit trail
    if (isAdmin && !isOwner) {
      logger.info(`👮 Admin ${wallet_address} is modifying bidding settings for content ${content.id} (owner: ${content.walletAddress || 'N/A'})`);
    }

    // Update bidding settings
    const oldPrice = content.biddingAskPrice;
    content.isBiddable = is_biddable;
    if (is_biddable) {
      content.biddingEndDate = bidding_end_date ? new Date(bidding_end_date) : null;
      content.biddingAskPrice = bidding_ask_price !== undefined && bidding_ask_price !== null ? parseFloat(bidding_ask_price) : null;
      
      // Ensure biddingEnabledAt is always set when enabling bidding
      if (!content.biddingEnabledAt) {
        content.biddingEnabledAt = new Date();
        logger.info(`🔧 Set biddingEnabledAt for content ID ${content.id} (was missing)`);
      }
    } else {
      content.biddingEndDate = null;
      content.biddingAskPrice = null;
      content.biddingEnabledAt = null;
    }

    const updatedContent = await contentRepository.save(content);

    // Update price on blockchain if changed and non-zero
    const newPrice = updatedContent.biddingAskPrice;
    if (newPrice && newPrice > 0 && newPrice !== oldPrice && updatedContent.approvalStatus === 'approved') {
      const { contentIntegrationService } = require('../services/contentIntegrationService');
      contentIntegrationService.updateContentPriceOnChain(updatedContent.id, newPrice).catch((error: any) => {
        logger.error(`❌ Failed to update price on blockchain for content ${updatedContent.id}:`, error);
      });
    }

    return res.json({
      success: true,
      data: {
        id: updatedContent.id,
        is_biddable: updatedContent.isBiddable,
        bidding_end_date: updatedContent.biddingEndDate?.toISOString() || null,
        bidding_ask_price: updatedContent.biddingAskPrice !== null ? Number(updatedContent.biddingAskPrice) : null,
        bidding_enabled_at: updatedContent.biddingEnabledAt?.toISOString() || null
      },
      message: is_biddable ? 'Content enabled for bidding' : 'Content disabled for bidding'
    });

  } catch (error) {
    console.error('❌ Error updating bidding settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update bidding settings'
    });
  }
});

/**
 * Helper function to update winning bid status
 */
async function updateWinningBids(contentId: number) {
  const biddingRepository = AppDataSource.getRepository(BiddingSystem);
  
  // Reset all bids for this content
  await biddingRepository.update({ contentId }, { isWinning: false });
  
  // Find highest bid
  const highestBid = await biddingRepository.findOne({
    where: { contentId },
    order: { bidAmount: 'DESC' }
  });

  if (highestBid) {
    highestBid.isWinning = true;
    await biddingRepository.save(highestBid);
  }
}

// Analytics endpoints for real dashboard data

/**
 * GET /api/marketplace/analytics/content-stats/:walletAddress
 * Get comprehensive content statistics for a miner
 */
router.get('/analytics/content-stats/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);

    // First, get miner's content
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    const contentIds = minerContent.map(c => c.id);
    
    // Calculate basic content stats
    const totalContent = minerContent.length;
    const biddableContent = minerContent.filter(c => c.isBiddable).length;
    const avgQualityScore = minerContent.length > 0 
      ? minerContent.reduce((sum, c) => sum + (Number(c.qualityScore) || 0), 0) / minerContent.length 
      : 0;

    if (contentIds.length === 0) {
      return res.json({ 
        data: {
          totalContent: 0,
          totalBids: 0,
          totalRevenue: 0,
          contentReputation: Math.round(avgQualityScore),
          biddableContent: 0,
          avgBidAmount: 0
        }
      });
    }

    // Use raw SQL since TypeORM query seems to have issues
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        COUNT(b.id) as "totalBids",
        COUNT(DISTINCT b."bidderId") as "uniqueBidders",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "totalRevenue",
        AVG(b."bidAmount") as "avgBidAmount"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
    `, [contentIds]);

    const bidStats = bidStatsRaw[0] || {};

    // Calculate content reputation: quality_score + bid_trust_factor
    const bidActivity = parseInt(bidStats.totalBids) || 0;
    const uniqueBidders = parseInt(bidStats.uniqueBidders) || 0;
    const bidTrustFactor = (uniqueBidders * 10) + (bidActivity * 2);
    const contentReputation = Math.min(100, Math.round(avgQualityScore + bidTrustFactor));

    const result = {
      totalContent,
      totalBids: parseInt(bidStats.totalBids) || 0,
      totalRevenue: parseFloat(bidStats.totalRevenue) || 0,
      contentReputation: contentReputation > 0 ? contentReputation : Math.round(avgQualityScore),
      biddableContent,
      avgBidAmount: parseFloat(bidStats.avgBidAmount) || 0
    };

    return res.json({ data: result });
  } catch (error) {
    console.error('Error fetching content stats:', error);
    return res.status(500).json({ error: 'Failed to fetch content stats' });
  }
});

/**
 * GET /api/marketplace/analytics/bidding-trends/:walletAddress
 * Get real bidding trends for a miner's content over the last 30 days
 */
router.get('/analytics/bidding-trends/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get bidding trends for the last 30 days using raw SQL - simplified approach
    const rawData = await AppDataSource.query(`
      SELECT 
        TO_CHAR(DATE(b."createdAt"), 'YYYY-MM-DD') as date,
        COUNT(*) as "bidCount",
        SUM(b."bidAmount") as "totalRevenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY DATE(b."createdAt")
      ORDER BY DATE(b."createdAt") ASC
    `, [contentIds]);

    // Fill in missing days with zero values for the last 30 days
    const trends = [];
    const today = new Date();
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = rawData.find((d: any) => d.date === dateStr);
      
      trends.push({
        date: dateStr,
        bidCount: dayData ? parseInt(dayData.bidCount) : 0,
        revenue: dayData ? parseFloat(dayData.totalRevenue) : 0
      });
    }

    return res.json({ data: trends });
  } catch (error) {
    console.error('Error fetching bidding trends:', error);
    return res.status(500).json({ error: 'Failed to fetch bidding trends' });
  }
});

/**
 * GET /api/marketplace/analytics/top-content/:walletAddress
 * Get top performing content with real bid data
 */
router.get('/analytics/top-content/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    if (minerContent.length === 0) {
      return res.json({ data: [] });
    }

    // Get bid statistics for all content using raw SQL
    const contentIds = minerContent.map(c => c.id);
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        b."contentId",
        COUNT(b.id) as "bidCount",
        MAX(b."bidAmount") as "maxBid",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "revenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY b."contentId"
    `, [contentIds]);

    // Create lookup map for bid stats
    const bidStatsMap = bidStatsRaw.reduce((map: any, stats: any) => {
      map[stats.contentId] = stats;
      return map;
    }, {});

    // Combine content with bid statistics
    const contentWithBids = minerContent.map((content) => {
      const bidStats = bidStatsMap[content.id] || {};
      
      // Extract title from content text (first 50 characters)
      let title = content.contentText || 'Untitled Content';
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }

      return {
        id: content.id,
        title,
        bidCount: parseInt(bidStats.bidCount) || 0,
        maxBid: parseFloat(bidStats.maxBid) || 0,
        qualityScore: Number(content.qualityScore) || 0,
        revenue: parseFloat(bidStats.revenue) || 0
      };
    });

    // Sort by revenue, then maxBid, then bidCount
    const result = contentWithBids
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        if (b.maxBid !== a.maxBid) return b.maxBid - a.maxBid;
        return b.bidCount - a.bidCount;
      })
      .slice(0, 5);

    return res.json({ data: result });
  } catch (error) {
    console.error('Error fetching top content:', error);
    return res.status(500).json({ error: 'Failed to fetch top content' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper-engagement/:walletAddress
 * Get real yapper engagement data for a miner's content
 */
router.get('/analytics/yapper-engagement/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get yapper engagement data using raw SQL
    const engagementRaw = await AppDataSource.query(`
      SELECT 
        u.id as "bidderId",
        u."walletAddress",
        u.username,
        COUNT(b.id) as "totalBids",
        SUM(b."bidAmount") as "totalAmount",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "wonContent"
      FROM bidding_system b
      INNER JOIN users u ON b."bidderId" = u.id
      WHERE b."contentId" = ANY($1)
      GROUP BY u.id, u."walletAddress", u.username
      ORDER BY "totalAmount" DESC
      LIMIT 10
    `, [contentIds]);

    const yappers = engagementRaw.map((data: any) => ({
      walletAddress: data.walletAddress || 'Unknown',
      username: data.username || `User${data.bidderId}`,
      totalBids: parseInt(data.totalBids) || 0,
      totalAmount: parseFloat(data.totalAmount) || 0,
      wonContent: parseInt(data.wonContent) || 0
    }));

    return res.json({ data: yappers });
  } catch (error) {
    console.error('Error fetching yapper engagement:', error);
    return res.status(500).json({ error: 'Failed to fetch yapper engagement' });
  }
});

/**
 * GET /api/marketplace/analytics/agent-performance/:walletAddress
 * Get real agent performance data for a miner
 */
router.get('/analytics/agent-performance/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content grouped by agent
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .andWhere('content.agentName IS NOT NULL')
      .getMany();

    if (minerContent.length === 0) {
      return res.json({ data: [] });
    }

    // Group content by agent
    const agentGroups: Record<string, any[]> = minerContent.reduce((groups: Record<string, any[]>, content) => {
      const agentName = content.agentName || 'Default Agent';
      if (!groups[agentName]) {
        groups[agentName] = [];
      }
      groups[agentName].push(content);
      return groups;
    }, {});

    // Get bid statistics for all content using raw SQL
    const contentIds = minerContent.map(c => c.id);
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        b."contentId",
        COUNT(b.id) as "bidCount",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "revenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY b."contentId"
    `, [contentIds]);

    // Create lookup map for bid stats
    const bidStatsMap = bidStatsRaw.reduce((map: any, stats: any) => {
      map[stats.contentId] = stats;
      return map;
    }, {});

    // Calculate performance for each agent
    const agentPerformance = Object.entries(agentGroups).map(([agentName, contents]) => {
      // Calculate total bid count and revenue for this agent's content
      let totalBidCount = 0;
      let totalRevenue = 0;
      
      contents.forEach(content => {
        const bidStats = bidStatsMap[content.id];
        if (bidStats) {
          totalBidCount += parseInt(bidStats.bidCount) || 0;
          totalRevenue += parseFloat(bidStats.revenue) || 0;
        }
      });

      // Calculate average quality
      const avgQuality = contents.reduce((sum, c) => sum + (Number(c.qualityScore) || 0), 0) / contents.length;

      return {
        agentName,
        contentCount: contents.length,
        bidCount: totalBidCount,
        revenue: totalRevenue,
        avgQuality: Math.round(avgQuality)
      };
    });

    return res.json({ data: agentPerformance });
  } catch (error) {
    console.error('Error fetching agent performance:', error);
    return res.status(500).json({ error: 'Failed to fetch agent performance' });
  }
});

/**
 * GET /api/marketplace/analytics/time-analysis/:walletAddress
 * Get real time-based bidding analysis for a miner's content
 */
router.get('/analytics/time-analysis/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ 
        data: {
          heatmap: [],
          peakTimes: []
        }
      });
    }

    // Get hourly bidding patterns using proper PostgreSQL EXTRACT functions
    const heatmapData = await biddingRepository
      .createQueryBuilder('bid')
      .select([
        'EXTRACT(DOW FROM bid.createdAt) as day',
        'EXTRACT(HOUR FROM bid.createdAt) as hour',
        'COUNT(*) as bidCount'
      ])
      .where('bid.contentId IN (:...contentIds)', { contentIds })
      .groupBy('EXTRACT(DOW FROM bid.createdAt), EXTRACT(HOUR FROM bid.createdAt)')
      .getRawMany();

    // Convert to heatmap format
    const maxBids = Math.max(...heatmapData.map(d => Number(d.bidcount) || 0), 1);
    const heatmap = heatmapData.map(data => ({
      day: Number(data.day),
      hour: Number(data.hour),
      bidCount: Number(data.bidcount) || 0,
      intensity: (Number(data.bidcount) || 0) / maxBids
    }));

    // Calculate peak times
    const hourlyStats = await biddingRepository
      .createQueryBuilder('bid')
      .select([
        'EXTRACT(HOUR FROM bid.createdAt) as hour',
        'COUNT(*) as bidCount'
      ])
      .where('bid.contentId IN (:...contentIds)', { contentIds })
      .groupBy('EXTRACT(HOUR FROM bid.createdAt)')
      .orderBy('bidCount', 'DESC')
      .limit(4)
      .getRawMany();

    const totalBids = heatmapData.reduce((sum, d) => sum + (Number(d.bidcount) || 0), 0);
    const peakTimes = hourlyStats.map(stat => {
      const hour = Number(stat.hour);
      const bidCount = Number(stat.bidcount) || 0;
      const activity = totalBids > 0 ? Math.round((bidCount / totalBids) * 100) : 0;
      
      return {
        timeRange: `${hour}:00-${hour + 1}:00`,
        bidActivity: activity
      };
    });

    return res.json({ 
      data: {
        heatmap,
        peakTimes
      }
    });
  } catch (error) {
    console.error('Error fetching time analysis:', error);
    return res.status(500).json({ error: 'Failed to fetch time analysis' });
  }
});

/**
 * GET /api/marketplace/analytics/content-categories/:walletAddress
 * Get real content category performance for a miner
 */
router.get('/analytics/content-categories/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    if (minerContent.length === 0) {
      return res.json({ data: [] });
    }

    // Get bid statistics for all content using raw SQL
    const contentIds = minerContent.map(c => c.id);
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        b."contentId",
        COUNT(b.id) as "bidCount",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "revenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY b."contentId"
    `, [contentIds]);

    // Create lookup map for bid stats
    const bidStatsMap = bidStatsRaw.reduce((map: any, stats: any) => {
      map[stats.contentId] = stats;
      return map;
    }, {});

    // Categorize content based on text patterns
    const categories: any = {
      memes: [],
      techAnalysis: [],
      marketInsights: [],
      newsCommentary: [],
      communityUpdates: []
    };

    minerContent.forEach((content) => {
      const text = (content.contentText || '').toLowerCase();
      
      if (text.includes('meme') || text.includes('😂') || text.includes('🔥') || text.includes('lol') || text.includes('funny')) {
        categories.memes.push(content);
      } else if (text.includes('analysis') || text.includes('technical') || text.includes('data') || text.includes('chart')) {
        categories.techAnalysis.push(content);
      } else if (text.includes('market') || text.includes('price') || text.includes('trading') || text.includes('crypto')) {
        categories.marketInsights.push(content);
      } else if (text.includes('news') || text.includes('update') || text.includes('breaking') || text.includes('announcement')) {
        categories.newsCommentary.push(content);
      } else {
        categories.communityUpdates.push(content);
      }
    });

    // Calculate performance for each category
    const categoryData = [
      { name: 'Memes', contents: categories.memes },
      { name: 'Tech Analysis', contents: categories.techAnalysis },
      { name: 'Market Insights', contents: categories.marketInsights },
      { name: 'News Commentary', contents: categories.newsCommentary },
      { name: 'Community Updates', contents: categories.communityUpdates }
    ];

    const categoryPerformance = categoryData
      .filter(({ contents }) => contents.length > 0)
      .map(({ name, contents }) => {
        // Calculate total bid count and revenue for this category
        let totalBidCount = 0;
        let totalRevenue = 0;
        
        contents.forEach((content: any) => {
          const bidStats = bidStatsMap[content.id];
          if (bidStats) {
            totalBidCount += parseInt(bidStats.bidCount) || 0;
            totalRevenue += parseFloat(bidStats.revenue) || 0;
          }
        });

        // Show actual average with 1 decimal place instead of rounding to integer
        const avgBids = contents.length > 0 ? parseFloat((totalBidCount / contents.length).toFixed(1)) : 0;

        return {
          category: name,
          count: contents.length,
          avgBids,
          revenue: Math.round(totalRevenue)
        };
      });

    return res.json({ data: categoryPerformance });
  } catch (error) {
    console.error('Error fetching content categories:', error);
    return res.status(500).json({ error: 'Failed to fetch content categories' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/financial/:walletAddress
 * Get comprehensive financial analytics for a yapper
 */
router.get('/analytics/yapper/financial/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    // Find user by wallet address
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get all bids by this yapper using raw SQL
    const financialData = await AppDataSource.query(`
      SELECT 
        COUNT(*) as "totalBids",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "wonBids",
        SUM(b."bidAmount") as "totalSpent",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "totalInvestment",
        AVG(b."bidAmount") as "avgBidAmount",
        MAX(b."bidAmount") as "maxBid",
        MIN(b."bidAmount") as "minBid"
      FROM bidding_system b 
      WHERE b."bidderId" = $1
    `, [user.id]);

    // Get spending trends over last 30 days
    const spendingTrends = await AppDataSource.query(`
      SELECT 
        DATE(b."createdAt") as date,
        COUNT(*) as "bidsPlaced",
        SUM(b."bidAmount") as "amountSpent",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "bidsWon"
      FROM bidding_system b 
      WHERE b."bidderId" = $1
        AND b."createdAt" >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(b."createdAt")
      ORDER BY date ASC
    `, [user.id]);

    // Calculate ROI and profit metrics
    const stats = financialData[0];
    const totalSpent = parseFloat(stats?.totalInvestment) || 0;
    
    // Simulate mindshare value earned (would come from platform APIs in production)
    const mindshareValue = totalSpent * (1.2 + Math.random() * 0.8); // 20-100% potential return
    const netProfit = mindshareValue - totalSpent;
    const roiPercentage = totalSpent > 0 ? (netProfit / totalSpent) * 100 : 0;

    return res.json({
      data: {
        overview: {
          totalSpent: parseFloat(stats?.totalSpent) || 0,
          totalInvestment: totalSpent,
          totalBids: parseInt(stats?.totalBids) || 0,
          wonBids: parseInt(stats?.wonBids) || 0,
          winRate: (stats?.totalBids && stats.totalBids > 0) ? (stats.wonBids / stats.totalBids * 100) : 0,
          avgBidAmount: parseFloat(stats?.avgBidAmount) || 0,
          maxBid: parseFloat(stats?.maxBid) || 0,
          minBid: parseFloat(stats?.minBid) || 0
        },
        profitability: {
          mindshareValue: Math.round(mindshareValue),
          netProfit: Math.round(netProfit),
          roiPercentage: parseFloat(roiPercentage.toFixed(1)),
          costPerMindshare: totalSpent > 0 ? (totalSpent / (mindshareValue - totalSpent + totalSpent)) : 0
        },
        trends: spendingTrends.map((trend: any) => ({
          date: trend.date,
          bidsPlaced: parseInt(trend.bidsPlaced),
          amountSpent: parseFloat(trend.amountSpent),
          bidsWon: parseInt(trend.bidsWon)
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching yapper financial analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch financial analytics' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/bidding/:walletAddress
 * Get bidding performance analytics for a yapper
 */
router.get('/analytics/yapper/bidding/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get bidding competition analysis
    const competitionData = await AppDataSource.query(`
      SELECT 
        b."contentId",
        b."bidAmount" as "myBid",
        MAX(other_bids."bidAmount") as "maxBid",
        COUNT(other_bids.id) as "totalBidders",
        b."hasWon"
      FROM bidding_system b
      LEFT JOIN bidding_system other_bids ON b."contentId" = other_bids."contentId" 
        AND other_bids."bidderId" != b."bidderId"
      WHERE b."bidderId" = $1
      GROUP BY b."contentId", b."bidAmount", b."hasWon", b.id
      ORDER BY b."createdAt" DESC
      LIMIT 50
    `, [user.id]);

    // Get bidding patterns by time
    const timePatterns = await AppDataSource.query(`
      SELECT 
        EXTRACT(hour FROM b."createdAt") as hour,
        COUNT(*) as "bidCount",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "winCount",
        AVG(b."bidAmount") as "avgBid"
      FROM bidding_system b 
      WHERE b."bidderId" = $1
      GROUP BY EXTRACT(hour FROM b."createdAt")
      ORDER BY hour
    `, [user.id]);

    // Analyze content category preferences
    const categoryPreferences = await AppDataSource.query(`
      SELECT 
        CASE 
          WHEN LOWER(c."contentText") LIKE '%meme%' OR LOWER(c."contentText") LIKE '%😂%' 
            OR LOWER(c."contentText") LIKE '%🔥%' THEN 'Memes'
          WHEN LOWER(c."contentText") LIKE '%analysis%' OR LOWER(c."contentText") LIKE '%technical%' 
            OR LOWER(c."contentText") LIKE '%data%' THEN 'Tech Analysis'
          WHEN LOWER(c."contentText") LIKE '%market%' OR LOWER(c."contentText") LIKE '%price%' 
            OR LOWER(c."contentText") LIKE '%trading%' THEN 'Market Insights'
          WHEN LOWER(c."contentText") LIKE '%news%' OR LOWER(c."contentText") LIKE '%update%' 
            OR LOWER(c."contentText") LIKE '%breaking%' THEN 'News Commentary'
          ELSE 'Community Updates'
        END as category,
        COUNT(*) as "bidCount",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "winCount",
        AVG(b."bidAmount") as "avgBid"
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id
      WHERE b."bidderId" = $1
      GROUP BY category
      ORDER BY "bidCount" DESC
    `, [user.id]);

    return res.json({
      data: {
        competition: competitionData.map((comp: any) => ({
          contentId: comp.contentId,
          myBid: parseFloat(comp.myBid),
          maxBid: parseFloat(comp.maxBid) || 0,
          totalBidders: parseInt(comp.totalBidders) || 0,
          hasWon: comp.hasWon,
          outbidBy: comp.hasWon ? 0 : Math.max(0, parseFloat(comp.maxBid) - parseFloat(comp.myBid))
        })),
        timePatterns: timePatterns.map((pattern: any) => ({
          hour: parseInt(pattern.hour),
          bidCount: parseInt(pattern.bidCount),
          winCount: parseInt(pattern.winCount),
          avgBid: parseFloat(pattern.avgBid),
          winRate: pattern.bidCount > 0 ? (pattern.winCount / pattern.bidCount * 100) : 0
        })),
        categoryPreferences: categoryPreferences.map((cat: any) => ({
          category: cat.category,
          bidCount: parseInt(cat.bidCount),
          winCount: parseInt(cat.winCount),
          avgBid: parseFloat(cat.avgBid),
          winRate: cat.bidCount > 0 ? (cat.winCount / cat.bidCount * 100) : 0
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching yapper bidding analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch bidding analytics' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/mindshare/:walletAddress
 * Get mindshare tracking and growth analytics for a yapper
 */
router.get('/analytics/yapper/mindshare/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get user's content portfolio for mindshare calculation base
    const portfolio = await AppDataSource.query(`
      SELECT COUNT(*) as "totalContent"
      FROM bidding_system b
      WHERE b."bidderId" = $1 AND b."hasWon" = true
    `, [user.id]);

    const contentCount = parseInt(portfolio[0]?.totalContent) || 0;
    
    // Simulate mindshare data (in production, this would come from platform APIs)
    const generateMindshareData = (platform: string, baseMultiplier: number) => {
      const data = [];
      const currentDate = new Date();
      let baseScore = 1000 + (contentCount * 50 * baseMultiplier);
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date(currentDate);
        date.setDate(date.getDate() - i);
        
        // Simulate realistic growth with some volatility
        const growth = (Math.random() - 0.3) * 20 + (contentCount > 0 ? 5 : 0);
        baseScore = Math.max(baseScore + growth, baseScore * 0.95);
        
        data.push({
          date: date.toISOString().split('T')[0],
          score: Math.round(baseScore),
          platform
        });
      }
      return data;
    };

    // Generate platform-specific mindshare data
    const cookieFunData = generateMindshareData('cookie.fun', 1.2);
    const kaitoData = generateMindshareData('yaps.kaito.ai', 0.8);
    const twitterData = generateMindshareData('twitter', 1.0);

    // Calculate current scores and growth
    const platforms = [
      {
        name: 'cookie.fun',
        currentScore: cookieFunData[29]?.score || 0,
        monthlyGrowth: cookieFunData[29] && cookieFunData[0] ? ((cookieFunData[29].score - cookieFunData[0].score) / cookieFunData[0].score * 100) : 0,
        data: cookieFunData,
        rewards: Math.floor((cookieFunData[29]?.score || 0) / 100),
        ranking: Math.max(1, Math.floor(5000 - (cookieFunData[29]?.score || 0) / 2))
      },
      {
        name: 'yaps.kaito.ai',
        currentScore: kaitoData[29]?.score || 0,
        monthlyGrowth: kaitoData[29] && kaitoData[0] ? ((kaitoData[29].score - kaitoData[0].score) / kaitoData[0].score * 100) : 0,
        data: kaitoData,
        rewards: Math.floor((kaitoData[29]?.score || 0) / 80),
        ranking: Math.max(1, Math.floor(3000 - (kaitoData[29]?.score || 0) / 3))
      },
      {
        name: 'twitter',
        currentScore: twitterData[29]?.score || 0,
        monthlyGrowth: twitterData[29] && twitterData[0] ? ((twitterData[29].score - twitterData[0].score) / twitterData[0].score * 100) : 0,
        data: twitterData,
        rewards: Math.floor((twitterData[29]?.score || 0) / 120),
        ranking: Math.max(1, Math.floor(10000 - (twitterData[29]?.score || 0) / 1.5))
      }
    ];

    // Generate heatmap data for calendar view
    const heatmapData = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const totalGrowth = platforms.reduce((sum, p) => {
        const dayData = p.data.find(d => d.date === date.toISOString().split('T')[0]);
        const dayIndex = p.data.indexOf(dayData!);
        const prevData = dayIndex > 0 ? p.data[dayIndex - 1] : null;
        return sum + (dayData && prevData ? ((dayData.score - prevData.score) / prevData.score * 100) : 0);
      }, 0);

      heatmapData.push({
        date: date.toISOString().split('T')[0],
        day: date.getDate(),
        growth: totalGrowth,
        intensity: Math.min(100, Math.max(0, totalGrowth + 50)) // Normalize for color intensity
      });
    }

    return res.json({
      data: {
        overview: {
          totalMindshare: platforms.reduce((sum, p) => sum + p.currentScore, 0),
          avgGrowth: platforms.length > 0 ? platforms.reduce((sum, p) => sum + p.monthlyGrowth, 0) / platforms.length : 0,
          totalRewards: platforms.reduce((sum, p) => sum + p.rewards, 0),
          bestPlatform: platforms.length > 0 ? 
            platforms.sort((a, b) => b.monthlyGrowth - a.monthlyGrowth)[0]?.name || 'none' : 'none'
        },
        platforms,
        heatmap: heatmapData,
        predictions: {
          nextWeekGrowth: (Math.random() * 10 + 2).toFixed(1),
          nextMonthTarget: Math.round(platforms.reduce((sum, p) => sum + p.currentScore, 0) * 1.15),
          optimalPostingTimes: ['09:00', '13:00', '18:00', '21:00']
        }
      }
    });
  } catch (error) {
    console.error('Error fetching yapper mindshare analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch mindshare analytics' });
  }
});

/**
 * @route GET /api/marketplace/free-content-limit/:walletAddress
 * @desc Check daily free content purchase limit for a wallet address
 */
router.get('/free-content-limit/:walletAddress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
      return;
    }

    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    // Get start and end of today in UTC
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    // Count free content purchases today (purchasePrice = 0)
    const freeContentPurchasesToday = await purchaseRepository.count({
      where: {
        buyerWalletAddress: walletAddress.toLowerCase(),
        purchasePrice: 0,
        paymentStatus: 'completed',
        purchasedAt: Between(startOfDay, endOfDay)
      }
    });

    const dailyLimit = 3;
    const remainingPurchases = Math.max(0, dailyLimit - freeContentPurchasesToday);
    const canPurchase = freeContentPurchasesToday < dailyLimit;

    logger.info(`🆓 Free content limit check for ${walletAddress.substring(0, 10)}... - Today: ${freeContentPurchasesToday}/${dailyLimit}, Can purchase: ${canPurchase}`);

    res.json({
      success: true,
      data: {
        dailyLimit,
        purchasedToday: freeContentPurchasesToday,
        remainingPurchases,
        canPurchase,
        resetTime: endOfDay.toISOString()
      }
    });

  } catch (error) {
    logger.error('❌ Error checking free content limit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check free content limit'
    });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/portfolio/:walletAddress
 * Get content portfolio and usage analytics for a yapper
 */
router.get('/analytics/yapper/portfolio/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get detailed portfolio information
    const portfolioData = await AppDataSource.query(`
      SELECT 
        c.id,
        c."contentText",
        c."contentImages",
        c."qualityScore",
        c."predictedMindshare",
        c."agentName",
        b."bidAmount",
        b."createdAt" as "purchaseDate",
        b."wonAt"
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id
      WHERE b."bidderId" = $1 AND b."hasWon" = true
      ORDER BY b."wonAt" DESC
    `, [user.id]);

    // Simulate usage tracking (in production, this would track actual posts)
    const portfolioWithUsage = portfolioData.map((item: any) => {
      const daysSincePurchase = Math.floor((new Date().getTime() - new Date(item.purchaseDate).getTime()) / (1000 * 3600 * 24));
      const hasBeenUsed = Math.random() > 0.3; // 70% usage rate
      const performance = hasBeenUsed ? {
        engagementRate: (Math.random() * 8 + 2).toFixed(1), // 2-10%
        mindshareGain: Math.round(parseFloat(item.predictedMindshare) * (0.8 + Math.random() * 0.4)),
        platformReach: Math.round(Math.random() * 50000 + 10000),
        posted: hasBeenUsed,
        postDate: hasBeenUsed ? new Date(Date.now() - Math.random() * daysSincePurchase * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null
      } : {
        engagementRate: '0.0',
        mindshareGain: 0,
        platformReach: 0,
        posted: false,
        postDate: null
      };

      return {
        id: item.id,
        title: item.contentText.slice(0, 50) + '...',
        fullContent: item.contentText,
        images: item.contentImages,
        qualityScore: parseFloat(item.qualityScore),
        predictedMindshare: parseFloat(item.predictedMindshare),
        agentName: item.agentName,
        purchasePrice: parseFloat(item.bidAmount),
        purchaseDate: item.purchaseDate,
        daysSincePurchase,
        ...performance
      };
    });

    // Calculate portfolio metrics
    const totalInvestment = portfolioWithUsage.reduce((sum: number, item: any) => sum + item.purchasePrice, 0);
    const totalMindshareGained = portfolioWithUsage.reduce((sum: number, item: any) => sum + item.mindshareGain, 0);
    const usedContent = portfolioWithUsage.filter((item: any) => item.posted);
    const unusedContent = portfolioWithUsage.filter((item: any) => !item.posted);

    // Content performance ranking
    const topPerformers = [...portfolioWithUsage]
      .filter((item: any) => item.posted)
      .sort((a, b) => b.mindshareGain - a.mindshareGain)
      .slice(0, 5);

    // Category analysis
    const categoryBreakdown = portfolioWithUsage.reduce((acc: any, item: any) => {
      const text = item.fullContent.toLowerCase();
      let category = 'Community Updates';
      
      if (text.includes('meme') || text.includes('😂') || text.includes('🔥')) {
        category = 'Memes';
      } else if (text.includes('analysis') || text.includes('technical') || text.includes('data')) {
        category = 'Tech Analysis';
      } else if (text.includes('market') || text.includes('price') || text.includes('trading')) {
        category = 'Market Insights';
      } else if (text.includes('news') || text.includes('update') || text.includes('breaking')) {
        category = 'News Commentary';
      }

      if (!acc[category]) {
        acc[category] = { count: 0, totalInvestment: 0, totalGain: 0, usageRate: 0 };
      }
      
      acc[category].count++;
      acc[category].totalInvestment += item.purchasePrice;
      acc[category].totalGain += item.mindshareGain;
      acc[category].usageRate += item.posted ? 1 : 0;
      
      return acc;
    }, {});

    // Finalize category metrics
    Object.keys(categoryBreakdown).forEach(category => {
      const data = categoryBreakdown[category];
      data.usageRate = (data.usageRate / data.count * 100).toFixed(1);
      data.avgROI = data.totalInvestment > 0 ? ((data.totalGain / data.totalInvestment - 1) * 100).toFixed(1) : '0.0';
    });

    return res.json({
      data: {
        overview: {
          totalContent: portfolioData.length,
          usedContent: usedContent.length,
          unusedContent: unusedContent.length,
          usageRate: portfolioData.length > 0 ? (usedContent.length / portfolioData.length * 100) : 0,
          totalInvestment: Math.round(totalInvestment),
          totalMindshareGained,
          avgContentValue: portfolioData.length > 0 ? totalInvestment / portfolioData.length : 0,
          portfolioROI: totalInvestment > 0 ? ((totalMindshareGained / totalInvestment - 1) * 100) : 0
        },
        content: portfolioWithUsage,
        topPerformers,
        categoryBreakdown,
        insights: {
          bestCategory: Object.entries(categoryBreakdown).reduce((best: any, [category, data]: [string, any]) => 
            parseFloat(data.avgROI) > parseFloat(best.avgROI || '0') ? { category, ...data } : best, {}),
          avgTimeToUse: usedContent.length > 0 ? 
            usedContent.reduce((sum: number, item: any) => sum + item.daysSincePurchase, 0) / usedContent.length : 0,
          contentVelocity: usedContent.length / Math.max(1, Math.ceil((Date.now() - new Date(portfolioData[0]?.purchaseDate || Date.now()).getTime()) / (1000 * 3600 * 24 * 7))) // content per week
        }
      }
    });
  } catch (error) {
    console.error('Error fetching yapper portfolio analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch portfolio analytics' });
  }
});

/**
 * GET /api/marketplace/analytics/miner/portfolio/:walletAddress
 * Get token portfolio and earnings analytics for a miner
 */
router.get('/analytics/miner/portfolio/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Get earnings by token from winning bids
    const tokenEarnings = await AppDataSource.query(`
      SELECT 
        b."bidCurrency" as token,
        COUNT(b.id) as totalSales,
        SUM(CAST(b."bidAmount" AS DECIMAL)) as totalAmount,
        AVG(CAST(b."bidAmount" AS DECIMAL)) as avgAmount,
        MAX(CAST(b."bidAmount" AS DECIMAL)) as maxAmount,
        MIN(CAST(b."bidAmount" AS DECIMAL)) as minAmount
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id 
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND b."hasWon" = true
      GROUP BY b."bidCurrency"
      ORDER BY totalAmount DESC
    `, [walletAddress]);

    // Get recent transactions
    const recentTransactions = await AppDataSource.query(`
      SELECT 
        b."bidCurrency" as token,
        CAST(b."bidAmount" AS DECIMAL) as amount,
        b."wonAt" as date,
        c."contentText",
        c."agentName",
        u."walletAddress" as buyerWallet
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id 
      JOIN users u ON b."bidderId" = u.id
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND b."hasWon" = true
      ORDER BY b."wonAt" DESC
      LIMIT 20
    `, [walletAddress]);

    // Get content performance by token
    const contentByToken = await AppDataSource.query(`
      SELECT 
        b."bidCurrency" as token,
        c.id as contentId,
        c."contentText",
        c."agentName",
        c."predictedMindshare",
        c."qualityScore",
        CAST(b."bidAmount" AS DECIMAL) as salePrice,
        b."wonAt" as saleDate,
        COUNT(allBids.id) as totalBids
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id 
      LEFT JOIN bidding_system allBids ON allBids."contentId" = c.id
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND b."hasWon" = true
      GROUP BY b."bidCurrency", c.id, c."contentText", c."agentName", c."predictedMindshare", 
               c."qualityScore", b."bidAmount", b."wonAt"
      ORDER BY b."wonAt" DESC
    `, [walletAddress]);

    // Calculate token rates (mock rates for now)
    const tokenRates = {
      ROAST: 0.1,
      USDC: 1.0,
      KAITO: 0.25,
      COOKIE: 0.15,
      AXR: 0.08,
      NYKO: 0.12,
    };

    // Process token earnings with USD values
    const processedEarnings = tokenEarnings.map((earning: any) => ({
      token: earning.token,
      amount: Number(earning.totalamount) || 0,
      totalSales: Number(earning.totalsales) || 0,
      avgSalePrice: Number(earning.avgamount) || 0,
      maxSalePrice: Number(earning.maxamount) || 0,
      minSalePrice: Number(earning.minamount) || 0,
      usdValue: (Number(earning.totalamount) || 0) * (tokenRates[earning.token as keyof typeof tokenRates] || 0),
      pricePerToken: tokenRates[earning.token as keyof typeof tokenRates] || 0,
    }));

    // Calculate portfolio metrics
    const totalUSDValue = processedEarnings.reduce((sum: number, earning: any) => sum + earning.usdValue, 0);
    const totalSales = processedEarnings.reduce((sum: number, earning: any) => sum + earning.totalSales, 0);
    const uniqueTokens = processedEarnings.length;

    // Get top performing token
    const topToken = processedEarnings.length > 0 ? 
      processedEarnings.reduce((top: any, current: any) => 
        current.usdValue > top.usdValue ? current : top
      ) : null;

    // Calculate portfolio distribution
    const distribution = processedEarnings.map((earning: any) => ({
      token: earning.token,
      percentage: totalUSDValue > 0 ? (earning.usdValue / totalUSDValue * 100) : 0,
      usdValue: earning.usdValue,
    }));

    // Process recent transactions
    const processedTransactions = recentTransactions.map((tx: any) => ({
      ...tx,
      amount: Number(tx.amount) || 0,
      usdValue: (Number(tx.amount) || 0) * (tokenRates[tx.token as keyof typeof tokenRates] || 0),
      contentPreview: tx.contentText ? tx.contentText.substring(0, 100) + '...' : '',
    }));

    // Group content by token
    const contentGroupedByToken = contentByToken.reduce((acc: any, content: any) => {
      if (!acc[content.token]) {
        acc[content.token] = [];
      }
      acc[content.token].push({
        ...content,
        saleprice: Number(content.saleprice) || 0,
        totalbids: Number(content.totalbids) || 0,
        usdValue: (Number(content.saleprice) || 0) * (tokenRates[content.token as keyof typeof tokenRates] || 0),
      });
      return acc;
    }, {});

    return res.json({
      portfolio: {
        totalUSDValue,
        totalSales,
        uniqueTokens,
        topToken: topToken ? {
          token: topToken.token,
          usdValue: topToken.usdValue,
          changePercent: 0, // TODO: Calculate actual change
        } : null,
      },
      earnings: processedEarnings,
      distribution,
      recentTransactions: processedTransactions,
      contentByToken: contentGroupedByToken,
      tokenRates,
    });

  } catch (error) {
    console.error('Error fetching miner portfolio analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch portfolio analytics' });
  }
});

// Add endpoint to refresh presigned URLs for purchased content
router.post('/content/:id/refresh-urls', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Content ID is required' });
    }
    
    const contentId = parseInt(id);
    if (isNaN(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID' });
    }
    
    // Get content item from database
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: contentId },
      relations: ['creator', 'campaign']
    });
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    logger.info(`🔄 Refreshing presigned URLs for content ${contentId}`);
    
    // Refresh expired URLs using the same logic as marketplace content fetch
    const refreshedContent = await refreshExpiredUrls(content);
    
    // Format the content for frontend (same as MarketplaceContentService)
    const formattedContent = {
      id: refreshedContent.id,
      content_text: refreshedContent.contentText,
      tweet_thread: refreshedContent.tweetThread,
      content_images: refreshedContent.contentImages,
      watermark_image: refreshedContent.watermarkImage || refreshedContent.watermark_image,
      predicted_mindshare: refreshedContent.predictedMindshare,
      quality_score: refreshedContent.qualityScore,
      asking_price: refreshedContent.askingPrice,
      bidding_ask_price: Number(refreshedContent.biddingAskPrice || refreshedContent.askingPrice || 0),
      creator: {
        id: refreshedContent.creator.id,
        username: refreshedContent.creator.username,
        reputation_score: refreshedContent.creator.reputationScore,
        wallet_address: refreshedContent.creator.walletAddress
      },
      campaign: {
        id: refreshedContent.campaign.id,
        title: refreshedContent.campaign.title,
        platform_source: refreshedContent.campaign.platformSource,
        project_name: refreshedContent.campaign.projectName,
        reward_token: refreshedContent.campaign.rewardToken
      },
      agent_name: refreshedContent.agentName,
      created_at: refreshedContent.createdAt,
      post_type: refreshedContent.postType,
      approved_at: refreshedContent.approvedAt,
      bidding_enabled_at: refreshedContent.biddingEnabledAt
    };
    
    logger.info(`✅ Successfully refreshed presigned URLs for content ${contentId}`);
    
    return res.json({
      success: true,
      data: formattedContent
    });
    
  } catch (error) {
    logger.error(`❌ Error refreshing presigned URLs for content:`, error);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh presigned URLs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add endpoint for pre-signed URL generation for marketplace content
router.post('/content/:id/presigned-url', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Content ID is required' });
    }
    
    const contentId = parseInt(id);
    if (isNaN(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID' });
    }
    
    // Get content item to extract S3 key
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: contentId }
    });
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Extract S3 key from content images or text
    let s3Key: string | null = null;
    
    // Try to extract S3 key from content_images first
    if (content.contentImages && Array.isArray(content.contentImages)) {
      for (const image of content.contentImages) {
        if (image && image.url && image.url.includes('ai-generated/')) {
          // Extract S3 key from URL
          const urlParts = image.url.split('/');
          const aiGeneratedIndex = urlParts.findIndex((part: string) => part === 'ai-generated');
          if (aiGeneratedIndex !== -1) {
            s3Key = urlParts.slice(aiGeneratedIndex).join('/').split('?')[0]; // Remove query params
            break;
          }
        }
      }
    }
    
    // If not found in contentImages, try to extract from contentText
    if (!s3Key && content.contentText) {
      const s3UrlMatch = content.contentText.match(/https?:\/\/[^\/]+\/([^?\s]+)/);
      if (s3UrlMatch && s3UrlMatch[1] && s3UrlMatch[1].includes('ai-generated/')) {
        s3Key = s3UrlMatch[1];
      }
    }
    
    if (!s3Key) {
      return res.status(400).json({ 
        error: 'No S3 content found for this item',
        message: 'This content does not contain S3-stored images'
      });
    }
    
    // Call Python AI backend to generate pre-signed URL
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL;
    if (!pythonBackendUrl) {
      logger.error('PYTHON_AI_BACKEND_URL environment variable is not set');
      return res.status(500).json({
        success: false,
        message: 'Python AI backend URL not configured'
      });
    }
    
    try {
      const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          s3_key: s3Key,
          expiration: 3600 // 1 hour
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Python backend responded with ${response.status}`);
      }
      
      const presignedResult = await response.json() as {
        status: string;
        presigned_url?: string;
        details?: {
          expires_at: string;
          expires_in_seconds: number;
        };
        error?: string;
      };
      
      if (presignedResult.status === 'success' && presignedResult.presigned_url) {
        return res.json({
          success: true,
          presigned_url: presignedResult.presigned_url,
          expires_at: presignedResult.details?.expires_at,
          expires_in_seconds: presignedResult.details?.expires_in_seconds,
          s3_key: s3Key,
          content_id: id
        });
      } else {
        return res.status(500).json({
          error: 'Failed to generate pre-signed URL',
          details: presignedResult.error
        });
      }
      
    } catch (fetchError) {
      console.error('Error calling Python backend for pre-signed URL:', fetchError);
      return res.status(503).json({
        error: 'Unable to generate pre-signed URL',
        message: 'Python AI backend is not available',
        fallback: 'Original URLs may be used as fallback'
      });
    }
    
  } catch (error) {
    console.error('Error generating pre-signed URL for content:', error);
    return res.status(500).json({ error: 'Failed to process pre-signed URL request' });
  }
});

/**
 * @route POST /api/marketplace/ensure-referral-registration
 * @desc Ensure buyer's referral is registered on Somnia blockchain before purchase
 */
router.post('/ensure-referral-registration', async (req: Request, res: Response): Promise<void> => {
  try {
    const { buyerWalletAddress } = req.body;

    if (!buyerWalletAddress) {
      res.status(400).json({
        success: false,
        message: 'Buyer wallet address is required'
      });
      return;
    }

    logger.info(`🔄 Ensuring referral registration for buyer: ${buyerWalletAddress}`);
    
    await ensureReferralRegisteredOnChain(buyerWalletAddress);

    res.json({
      success: true,
      message: 'Referral registration ensured'
    });
  } catch (error) {
    logger.error('❌ Error ensuring referral registration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to ensure referral registration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/purchase
 * @desc Create a direct content purchase record (new immediate purchase system)
 */
router.post('/purchase', async (req: Request, res: Response): Promise<void> => {
  try {
    const { contentId, buyerWalletAddress, purchasePrice, currency = 'ROAST', transactionHash, network = 'base' } = req.body;

    // Validate required fields - allow 0 as valid price for free content
    if (!contentId || !buyerWalletAddress || (purchasePrice === undefined || purchasePrice === null)) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: contentId, buyerWalletAddress, purchasePrice'
      });
      return;
    }

    // For Somnia network, transaction hash is required (on-chain purchase)
    if (network === 'somnia_testnet' && !transactionHash) {
      res.status(400).json({
        success: false,
        message: 'Transaction hash required for Somnia network purchases'
      });
      return;
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const userRepository = AppDataSource.getRepository(User);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Find the content
    const content = await contentRepository.findOne({
      where: { id: parseInt(contentId) },
      relations: ['creator']
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found'
      });
      return;
    }

    console.log('🔍 Content found for purchase:', {
      contentId: parseInt(contentId),
      isAvailable: content.isAvailable,
      isBiddable: content.isBiddable,
      approvalStatus: content.approvalStatus,
      createdAt: content.createdAt,
      approvedAt: content.approvedAt,
      biddingEnabledAt: content.biddingEnabledAt,
      walletAddress: content.walletAddress,
      creatorId: content.creatorId,
      askingPrice: content.askingPrice,
      biddingAskPrice: content.biddingAskPrice
    });

    // Check if content is available
    if (!content.isAvailable) {
      console.error('❌ Content availability check failed:', {
        contentId: parseInt(contentId),
        isAvailable: content.isAvailable,
        isBiddable: content.isBiddable,
        approvalStatus: content.approvalStatus,
        createdAt: content.createdAt,
        approvedAt: content.approvedAt,
        biddingEnabledAt: content.biddingEnabledAt,
        walletAddress: content.walletAddress,
        creatorId: content.creatorId
      });
      
      res.status(400).json({
        success: false,
        message: 'Content is no longer available for purchase'
      });
      return;
    }

    // Check if content has a creator with wallet address
    if (!content.creator || !content.creator.walletAddress) {
      res.status(400).json({
        success: false,
        message: 'Content creator information is incomplete'
      });
      return;
    }

    // Find buyer - create if doesn't exist (wallet-based auth)
    let buyer = await userRepository.findOne({
      where: { walletAddress: buyerWalletAddress.toLowerCase() }
    });

    if (!buyer) {
      // Auto-create user when they connect wallet (similar to other endpoints)
      buyer = userRepository.create({
        walletAddress: buyerWalletAddress.toLowerCase(),
        username: `User_${buyerWalletAddress.slice(0, 8)}`,
        roleType: UserRoleType.YAPPER,
        roastBalance: 0,
        usdcBalance: 0,
        reputationScore: 0,
        totalEarnings: 0,
        isVerified: false,
        isAdmin: false
      });
      
      await userRepository.save(buyer);
      console.log(`🆕 Auto-created new buyer: ${buyerWalletAddress}`);
    }

    // For Somnia purchases, ensure referral is registered on-chain (fallback if signup failed)
    let referralRegisteredOnChain = false;
    if (network === 'somnia_testnet') {
      try {
        await ensureReferralRegisteredOnChain(buyerWalletAddress);
        referralRegisteredOnChain = true;
        logger.info('✅ Referral registration on-chain successful');
      } catch (error) {
        logger.error('❌ Failed to register referral on-chain (non-blocking):', error);
        // Don't fail purchase - user can still complete purchase without referral registration
        // Referral payouts won't work but purchase flow continues
        referralRegisteredOnChain = false;
      }
    }

    // Check if this is free content (0 price)
    const isFreeContent = purchasePrice === 0;
    const isSyntheticTxHash = transactionHash && transactionHash.startsWith('FREE_CONTENT_');
    
    // Check daily free content limit for free content
    if (isFreeContent) {
      // Get start and end of today in UTC
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      // Count free content purchases today
      const freeContentPurchasesToday = await purchaseRepository.count({
        where: {
          buyerWalletAddress: buyerWalletAddress.toLowerCase(),
          purchasePrice: 0,
          paymentStatus: 'completed',
          purchasedAt: Between(startOfDay, endOfDay)
        }
      });

      const dailyLimit = 3;
      if (freeContentPurchasesToday >= dailyLimit) {
        logger.warn(`🚫 Daily free content limit exceeded for ${buyerWalletAddress.substring(0, 10)}... - ${freeContentPurchasesToday}/${dailyLimit}`);
        res.status(429).json({
          success: false,
          message: 'Daily free content limit exceeded',
          data: {
            dailyLimit,
            purchasedToday: freeContentPurchasesToday,
            resetTime: endOfDay.toISOString()
          }
        });
        return;
      }

      logger.info(`🆓 Free content purchase allowed for ${buyerWalletAddress.substring(0, 10)}... - ${freeContentPurchasesToday + 1}/${dailyLimit}`);
    }
    
    // Get current ROAST price for conversion tracking
    const roastPrice = await fetchROASTPrice();
    
    // The original asking price is always in ROAST (from content.biddingAskPrice)
    const originalRoastPrice = content.biddingAskPrice || 0;
    
    // Calculate normalized purchase price in ROAST based on payment currency
    let normalizedPurchasePriceROAST: number;
    let actualPurchasePriceInNativeCurrency: number; // The actual amount paid by buyer
    
    if (network === 'somnia_testnet') {
      // Somnia: Buyer pays in TOAST at 1:1 with content price
      // No conversion needed - TOAST = ROAST price (same value)
      normalizedPurchasePriceROAST = purchasePrice; // purchasePrice is already in TOAST
      actualPurchasePriceInNativeCurrency = purchasePrice; // TOAST amount
    } else if (currency === 'ROAST') {
      // Base: User paid in ROAST, so purchase price in ROAST is the same as what they paid
      normalizedPurchasePriceROAST = purchasePrice;
      actualPurchasePriceInNativeCurrency = purchasePrice; // ROAST amount
    } else {
      // Base: User paid in USDC, convert to ROAST using conversion rate
      // purchasePrice (USDC) / roastPrice (ROAST/USD) = ROAST amount
      normalizedPurchasePriceROAST = purchasePrice / roastPrice;
      actualPurchasePriceInNativeCurrency = purchasePrice; // USDC amount
    }
    
    // Calculate miner payout in ROAST (always 70% from Base treasury)
    // Note: ROAST payout is always 70% regardless of network (Base or Somnia)
    // On Somnia, miner gets 70% ROAST from Base treasury + 50% TOAST from smart contract
    // On Base, miner gets 70% ROAST from Base treasury only
    const minerPayoutRoast = isFreeContent ? 0 : (actualPurchasePriceInNativeCurrency * 0.70); // 70% ROAST payout
    
    // Calculate platform fee based on payment currency - set to 0 for free content
    // Platform fee is 30% (matching contract)
    let platformFee: number;
    if (isFreeContent) {
      platformFee = 0;
    } else if (network === 'somnia_testnet') {
      // Somnia: 30% of TOAST payment
      platformFee = actualPurchasePriceInNativeCurrency * 0.30;
    } else if (currency === 'ROAST') {
      // For ROAST payments: 30% of original asking price (matching contract)
      platformFee = actualPurchasePriceInNativeCurrency * 0.30;
    } else {
      // For USDC payments: 30% of asking price (converted to USDC) + 0.03 USDC fee
      const baseUsdcFee = actualPurchasePriceInNativeCurrency * 0.30;
      const extraUsdcFee = isFreeContent ? 0 : 0.03;
      platformFee = baseUsdcFee + extraUsdcFee;
    }

    // Extract miner wallet address (already validated above) and normalize case
    const minerWalletAddress = content.creator!.walletAddress.toLowerCase();
    
    // Determine the actual currency used for this purchase
    const actualCurrency = network === 'somnia_testnet' ? 'TOAST' : (currency === 'ROAST' ? 'ROAST' : 'USDC');
    
    // Log purchase processing details
    logger.info(`Purchase processing: ${isFreeContent ? 'FREE CONTENT' : 'PAID CONTENT'} - Price: ${actualPurchasePriceInNativeCurrency} ${actualCurrency}, Platform Fee: ${platformFee}, Miner Payout: ${minerPayoutRoast}, Synthetic TX: ${isSyntheticTxHash}, Network: ${network}`);

    // Create purchase record with correct pricing
    const purchase = purchaseRepository.create({
      contentId: parseInt(contentId),
      buyerWalletAddress: buyerWalletAddress.toLowerCase(), // ✅ Fix case sensitivity
      minerWalletAddress: minerWalletAddress.toLowerCase(), // ✅ Fix case sensitivity
      network: network === 'somnia_testnet' ? 'somnia_testnet' : 'base_mainnet', // ADD network
      blockchainContentId: network === 'somnia_testnet' ? parseInt(contentId) : null, // ADD blockchain content ID
      purchasePrice: actualPurchasePriceInNativeCurrency, // Actual amount paid by buyer in their payment currency
      currency: actualCurrency, // 'TOAST' for Somnia, 'ROAST' or 'USDC' for Base
      paymentCurrency: actualCurrency, // Currency actually paid by yapper (same as currency)
      conversionRate: roastPrice, // ROAST to USD rate at time of purchase
      originalRoastPrice, // Original asking price in ROAST (from content.biddingAskPrice)
      platformFee, // In payment currency (30%)
      minerPayout: minerPayoutRoast, // 70% ROAST payout from Base treasury
      minerPayoutRoast, // Explicit amount for clarity
      paymentStatus: transactionHash ? 'completed' : 'pending', // If transaction hash provided, mark as completed
      payoutStatus: isFreeContent ? 'not_applicable' : 'pending', // Set payout status for free content
      referralPayoutStatus: isFreeContent ? 'not_applicable' : (network === 'somnia_testnet' ? 'completed' : 'pending'), // Somnia referrals already paid
      transactionHash: transactionHash || null // Store transaction hash if provided
    });

    await purchaseRepository.save(purchase);

    // Handle Somnia network purchase - record blockchain transaction and referral payouts
    if (network === 'somnia_testnet' && transactionHash && !isFreeContent) {
      try {
        // Get buyer's referral info
        const buyer = await userRepository.findOne({
          where: { walletAddress: buyerWalletAddress.toLowerCase() }
        });

        const { UserReferral } = require('../models/UserReferral');
        const { ReferralPayout, PayoutType, PayoutStatus } = require('../models/ReferralPayout');
        const userReferralRepository = AppDataSource.getRepository(UserReferral);
        const referralPayoutRepository = AppDataSource.getRepository(ReferralPayout);

        let directReferrerAmount = 0;
        let grandReferrerAmount = 0;
        let tier = 'SILVER';
        let directReferrerAddress: string | null = null;
        let grandReferrerAddress: string | null = null;

        if (buyer) {
          const userReferral = await userReferralRepository.findOne({
            where: { userId: buyer.id },
            relations: ['referralCode', 'directReferrer', 'grandReferrer']
          });

          if (userReferral?.referralCode) {
            // Only calculate actual amounts if referral was successfully registered on-chain
            if (referralRegisteredOnChain) {
              // Calculate referral amounts (from purchase price, not platform fee)
              directReferrerAmount = purchasePrice * (userReferral.referralCode.getDirectReferrerRate() / 100);
              grandReferrerAmount = purchasePrice * (userReferral.referralCode.getGrandReferrerRate() / 100);
            } else {
              // Referral registration failed - no payouts will be made
              directReferrerAmount = 0;
              grandReferrerAmount = 0;
              logger.warn(`⚠️ Referral registration failed - setting payout amounts to 0`);
            }
            
            tier = userReferral.referralCode.tier;
            directReferrerAddress = userReferral.directReferrer?.walletAddress || null;
            grandReferrerAddress = userReferral.grandReferrer?.walletAddress || null;

            // Create referral payout records only if registration succeeded and amounts are >= 10
            if (referralRegisteredOnChain && userReferral.directReferrer && directReferrerAmount >= 10) {
              const directPayout = referralPayoutRepository.create({
                userReferralId: userReferral.id,
                contentPurchaseId: purchase.id,
                payoutWalletAddress: userReferral.directReferrer.walletAddress,
                payoutType: PayoutType.DIRECT_REFERRER,
                network: 'somnia_testnet',
                currency: 'TOAST',
                tokenAmount: directReferrerAmount,
                commissionRate: userReferral.referralCode.getDirectReferrerRate() / 100,
                transactionHash,
                status: PayoutStatus.PAID,
                paidAt: new Date()
              });
              await referralPayoutRepository.save(directPayout);

              purchase.directReferrerPayout = directReferrerAmount;
              purchase.directReferrerTxHash = transactionHash;
              logger.info(`✅ Recorded direct referrer payout: ${directReferrerAmount} TOAST`);
            } else if (!referralRegisteredOnChain && userReferral.directReferrer) {
              logger.warn(`⚠️ Skipping direct referrer payout record - registration failed`);
            }

            if (referralRegisteredOnChain && userReferral.grandReferrer && grandReferrerAmount >= 10) {
              const grandPayout = referralPayoutRepository.create({
                userReferralId: userReferral.id,
                contentPurchaseId: purchase.id,
                payoutWalletAddress: userReferral.grandReferrer.walletAddress,
                payoutType: PayoutType.GRAND_REFERRER,
                network: 'somnia_testnet',
                currency: 'TOAST',
                tokenAmount: grandReferrerAmount,
                commissionRate: userReferral.referralCode.getGrandReferrerRate() / 100,
                transactionHash,
                status: PayoutStatus.PAID,
                paidAt: new Date()
              });
              await referralPayoutRepository.save(grandPayout);

              purchase.grandReferrerPayout = grandReferrerAmount;
              purchase.grandReferrerTxHash = transactionHash;
              logger.info(`✅ Recorded grand referrer payout: ${grandReferrerAmount} TOAST`);
            } else if (!referralRegisteredOnChain && userReferral.grandReferrer) {
              logger.warn(`⚠️ Skipping grand referrer payout record - registration failed`);
            }

            purchase.referralPayoutStatus = referralRegisteredOnChain ? 'completed' : 'failed';
            await purchaseRepository.save(purchase);
          }
        }

        // Record blockchain purchase transaction with all reward details
        logger.info(`📝 Recording purchase transaction in content_blockchain_transactions table...`);
        const recordResult = await contentIntegrationService.recordPurchaseTransaction(
          parseInt(contentId),
          buyerWalletAddress,
          transactionHash,
          purchasePrice, // In TOAST
          {
            directReferrerAddress,
            grandReferrerAddress,
            directReferrerAmount,
            grandReferrerAmount,
            tier
          }
        );

        if (recordResult.success) {
          logger.info(`✅ Somnia purchase transaction recorded in DB: ${transactionHash}`);
        } else {
          logger.error(`❌ Failed to record purchase transaction: ${recordResult.error}`);
        }
      } catch (error) {
        logger.error(`❌ Failed to record Somnia purchase transaction:`, error);
      }
    }

    // Verify on-chain purchase for Somnia network
    if (network === 'somnia_testnet' && transactionHash) {
      logger.info(`🔗 Verifying on-chain purchase for content ${contentId} on Somnia`);
      const verification = await contentIntegrationService.verifyPurchaseOnChain(
        parseInt(contentId),
        buyerWalletAddress
      );
      
      if (!verification.success) {
        logger.warn(`⚠️ On-chain verification failed for content ${contentId}: ${verification.error}`);
      } else {
        logger.info(`✅ On-chain purchase verified for content ${contentId}`);
      }
    }

    // Only mark content as unavailable if we have a confirmed transaction hash
    // Otherwise, keep it available until payment is confirmed
    if (transactionHash) {
      logger.info(`Transaction hash provided: ${transactionHash}, marking content as unavailable`);
      content.isAvailable = false;
      await contentRepository.save(content);
    } else {
      logger.info(`No transaction hash provided, keeping content available until payment confirmation`);
    }

    logger.info(`Purchase record created: Content ${contentId} by ${buyerWalletAddress} - Paid: ${purchasePrice} ${currency}, Normalized: ${normalizedPurchasePriceROAST} ROAST, Network: ${network}`);

    res.json({
      success: true,
      message: 'Purchase record created successfully',
      data: {
        purchaseId: purchase.id,
        contentId: purchase.contentId,
        purchasePrice: purchase.purchasePrice, // Always in ROAST now
        currency: purchase.currency, // Always 'ROAST' now
        paymentCurrency: purchase.paymentCurrency, // What user actually paid with
        actualPaymentAmount: purchasePrice, // What user actually paid (original amount)
        originalRoastPrice: purchase.originalRoastPrice,
        conversionRate: purchase.conversionRate,
        platformFee: purchase.platformFee,
        minerPayoutRoast: purchase.minerPayoutRoast,
        treasuryAddress: process.env.TREASURY_WALLET_ADDRESS,
        roastTokenContract: process.env.CONTRACT_ROAST_TOKEN
      }
    });

  } catch (error) {
    logger.error('Error creating purchase record:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create purchase record',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/purchase/:id/confirm
 * @desc Confirm payment and trigger treasury-to-miner transfer
 */
router.post('/purchase/:id/confirm', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { transactionHash } = req.body;

    if (!id || !transactionHash) {
      res.status(400).json({
        success: false,
        message: 'Purchase ID and transaction hash are required'
      });
      return;
    }

    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    const purchase = await purchaseRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['content', 'miner']
    });

    if (!purchase) {
      res.status(404).json({
        success: false,
        message: 'Purchase not found'
      });
      return;
    }

    // Update purchase with transaction hash and mark as completed
    purchase.transactionHash = transactionHash;
    purchase.paymentStatus = 'completed';
    purchase.purchasedAt = new Date();

    await purchaseRepository.save(purchase);

    // Mark content as unavailable after successful purchase and clear purchase flow
    if (purchase.content) {
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);
      purchase.content.isAvailable = false;
      purchase.content.isBiddable = false;
      purchase.content.inPurchaseFlow = false;
      purchase.content.purchaseFlowInitiatedBy = null;
      purchase.content.purchaseFlowInitiatedAt = null;
      // purchaseFlowExpiresAt field removed - no longer needed
      await contentRepository.save(purchase.content);
      
      logger.info(`Content ${purchase.content.id} marked as unavailable and purchase flow cleared after successful purchase`);
    }

    // TODO: Trigger treasury-to-miner transfer using private key
    // This will be implemented in the wallet integration step

    logger.info(`Purchase confirmed: ${id} with transaction ${transactionHash}`);

    res.json({
      success: true,
      message: 'Purchase confirmed successfully',
      data: {
        purchaseId: purchase.id,
        paymentStatus: purchase.paymentStatus,
        purchasedAt: purchase.purchasedAt
      }
    });

  } catch (error) {
    logger.error('Error confirming purchase:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm purchase',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/purchase/:id/distribute
 * @desc Trigger treasury-to-miner ROAST token distribution (80/20 split)
 */
router.post('/purchase/:id/distribute', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Purchase ID is required'
      });
      return;
    }

    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    const purchase = await purchaseRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['content', 'content.creator']
    });

    if (!purchase) {
      res.status(404).json({
        success: false,
        message: 'Purchase not found'
      });
      return;
    }

    if (purchase.paymentStatus !== 'completed') {
      res.status(400).json({
        success: false,
        message: 'Purchase payment not completed yet'
      });
      return;
    }

    if (purchase.payoutStatus === 'completed') {
      res.status(400).json({
        success: false,
        message: 'Payout already completed'
      });
      return;
    }

    // Check if we have the required environment variables
    const treasuryPrivateKey = process.env.TREASURY_WALLET_PRIVATE_KEY;
    const roastTokenAddress = process.env.CONTRACT_ROAST_TOKEN;
    const treasuryAddress = process.env.TREASURY_WALLET_ADDRESS;

    if (!treasuryPrivateKey || !roastTokenAddress || !treasuryAddress) {
      logger.error('Missing treasury configuration');
      res.status(500).json({
        success: false,
        message: 'Treasury configuration incomplete'
      });
      return;
    }

    // Skip miner payouts for free content (0 price)
    const isFreeContent = purchase.purchasePrice === 0;
    const isSyntheticTxHash = purchase.transactionHash && purchase.transactionHash.startsWith('FREE_CONTENT_');
    
    if (isFreeContent || isSyntheticTxHash) {
      logger.info(`🆓 Skipping miner payout for FREE CONTENT - Purchase ${purchase.id}, Price: ${purchase.purchasePrice}, TX: ${purchase.transactionHash}`);
      purchase.payoutStatus = 'not_applicable';
      await purchaseRepository.save(purchase);
      
      res.json({
        success: true,
        message: 'Free content - miner payout not applicable',
        data: {
          purchaseId: purchase.id,
          minerAddress: purchase.minerWalletAddress,
          minerPayoutRoast: 0,
          payoutStatus: purchase.payoutStatus
        }
      });
      return;
    }

    const minerAddress = purchase.minerWalletAddress;
    // Always use ROAST payout amount (50% of original ROAST asking price)
    const minerPayoutRoast = purchase.minerPayoutRoast || purchase.minerPayout;

    // For Somnia purchases: Miner gets 50% TOAST on-chain (already paid by contract)
    // AND 50% ROAST off-chain from Base treasury (to compensate for content creation costs)
    const network = purchase.network || 'base_mainnet';
    
    logger.info(`🏦 Starting treasury distribution: ${minerPayoutRoast} ROAST to ${minerAddress} (Network: ${network})`);

    // Initialize treasury service
    const treasuryService = new TreasuryService();

    // Validate treasury has sufficient balance
    const hasSufficientBalance = await treasuryService.validateSufficientBalance(minerPayoutRoast);
    if (!hasSufficientBalance) {
      logger.error('❌ Insufficient treasury balance for payout');
      res.status(500).json({
        success: false,
        message: 'Insufficient treasury balance for payout'
      });
      return;
    }

    // Execute the distribution (ROAST from Base treasury for both Base and Somnia purchases)
    // For Somnia: This is the off-chain 50% ROAST payout (on-chain 50% TOAST already distributed by contract)
    // For Base: This is the standard 50% ROAST payout
    const distributionResult = await treasuryService.distributeToMiner(minerAddress, minerPayoutRoast);

    if (!distributionResult.success) {
      logger.error('❌ Treasury distribution failed:', distributionResult.error);
      res.status(500).json({
        success: false,
        message: 'Treasury distribution failed',
        error: distributionResult.error
      });
      return;
    }
    
    // Update purchase record
    purchase.treasuryTransactionHash = distributionResult.transactionHash!;
    purchase.payoutStatus = 'completed';
    
    await purchaseRepository.save(purchase);

    logger.info(`✅ Treasury distribution completed: ${distributionResult.transactionHash}`);
    if (network === 'somnia_testnet') {
      logger.info(`ℹ️ Somnia purchase: Miner receives 50% ROAST (Base treasury) + 50% TOAST (on-chain contract)`);
    }

    // Queue referral payouts for asynchronous processing (non-blocking)
    // Skip for Somnia network (referrals already paid via contract)
    if (network === 'somnia_testnet') {
      logger.info(`⏭️ Skipping referral payouts for Somnia purchase ${purchase.id} (already paid via contract)`);
    } else {
      logger.info(`🎯 Queuing referral payouts for purchase ${purchase.id}...`);
      AsyncReferralPayoutService.queueReferralPayouts(purchase.id);
    }

    res.json({
      success: true,
      message: network === 'somnia_testnet' 
        ? 'Dual payout completed: 50% ROAST (Base treasury) + 50% TOAST (on-chain contract)' 
        : 'Treasury distribution completed',
      data: {
        purchaseId: purchase.id,
        minerAddress,
        minerPayoutRoast,
        treasuryTransactionHash: distributionResult.transactionHash,
        payoutStatus: purchase.payoutStatus,
        network,
        payoutDetails: network === 'somnia_testnet' ? {
          roastPayout: `${minerPayoutRoast} ROAST (Base treasury)`,
          toastPayout: `50% TOAST (on-chain contract, already distributed)`,
          note: 'Dual payout: Miner receives compensation in both ROAST and TOAST'
        } : undefined,
        referralPayouts: {
          status: network === 'somnia_testnet' ? 'completed' : 'queued',
          message: network === 'somnia_testnet' ? 'Referral payouts already completed on-chain' : 'Referral payouts are being processed asynchronously'
        }
      }
    });

  } catch (error) {
    logger.error('Error processing treasury distribution:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process treasury distribution',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/purchase/:id/rollback
 * @desc Rollback a purchase to restore content availability
 */
router.post('/purchase/:id/rollback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { transactionHash, reason } = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Purchase ID is required'
      });
      return;
    }

    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const purchase = await purchaseRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['content']
    });

    if (!purchase) {
      res.status(404).json({
        success: false,
        message: 'Purchase not found'
      });
      return;
    }

    // Only allow rollback for purchases that are not completed
    if (purchase.paymentStatus === 'completed') {
      res.status(400).json({
        success: false,
        message: 'Cannot rollback completed purchases'
      });
      return;
    }

    logger.info(`🔄 Rolling back purchase ${id} to restore content availability`);

    // Restore content availability
    if (purchase.content) {
      purchase.content.isAvailable = true;
      purchase.content.isBiddable = true;
      await contentRepository.save(purchase.content);
      logger.info(`✅ Content ${purchase.content.id} restored to marketplace`);
    }

    // Mark purchase as rolled back
    purchase.paymentStatus = 'rolled_back';
    purchase.rollbackReason = reason || 'Purchase confirmation failed';
    purchase.rollbackTransactionHash = transactionHash;
    purchase.rolledBackAt = new Date();
    
    await purchaseRepository.save(purchase);

    logger.info(`✅ Purchase ${id} rolled back successfully`);

    res.json({
      success: true,
      data: {
        message: 'Purchase rolled back successfully',
        contentId: purchase.content?.id,
        purchaseId: purchase.id,
        rollbackReason: purchase.rollbackReason
      }
    });
  } catch (error) {
    logger.error('Error rolling back purchase:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to rollback purchase',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ==========================================
// NEW CONTENT PURCHASE ANALYTICS ENDPOINTS
// ==========================================

/**
 * GET /api/marketplace/analytics/purchase/content-stats/:walletAddress
 * Get comprehensive content statistics for a miner based on content purchases
 */
router.get('/analytics/purchase/content-stats/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);

    // Get miner's content
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    const contentIds = minerContent.map(c => c.id);
    
    // Calculate basic content stats
    const totalContent = minerContent.length;
    const avgQualityScore = minerContent.length > 0 
      ? minerContent.reduce((sum, c) => sum + (Number(c.qualityScore) || 0), 0) / minerContent.length 
      : 0;

    if (contentIds.length === 0) {
      return res.json({ 
        data: {
          totalContent: 0,
          totalPurchases: 0,
          totalRevenue: 0,
          contentReputation: Math.round(avgQualityScore),
          purchasableContent: 0,
          avgPurchasePrice: 0
        }
      });
    }

    // Get purchase statistics using raw SQL
    const purchaseStatsRaw = await AppDataSource.query(`
      SELECT 
        COUNT(p.id) as "totalPurchases",
        COUNT(DISTINCT p."buyer_wallet_address") as "uniqueBuyers",
        SUM(CAST(p."purchase_price" AS DECIMAL)) as "totalRevenue",
        AVG(CAST(p."purchase_price" AS DECIMAL)) as "avgPurchasePrice"
      FROM content_purchases p 
      WHERE p."content_id" = ANY($1)
        AND p."payment_status" = 'completed'
    `, [contentIds]);

    const purchaseStats = purchaseStatsRaw[0] || {};

    const data = {
      totalContent,
      totalPurchases: parseInt(purchaseStats.totalPurchases) || 0,
      totalRevenue: parseFloat(purchaseStats.totalRevenue) || 0,
      contentReputation: Math.round(avgQualityScore),
      purchasableContent: totalContent, // All approved content is purchasable
      avgPurchasePrice: parseFloat(purchaseStats.avgPurchasePrice) || 0
    };

    return res.json({ data });

  } catch (error) {
    console.error('Error fetching purchase content stats:', error);
    return res.status(500).json({ error: 'Failed to fetch content purchase statistics' });
  }
});

/**
 * GET /api/marketplace/analytics/purchase/trends/:walletAddress
 * Get real purchase trends for a miner's content over the last 30 days
 */
router.get('/analytics/purchase/trends/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get purchase trends for the last 30 days using raw SQL
    const rawData = await AppDataSource.query(`
      SELECT 
        TO_CHAR(DATE(p."purchased_at"), 'YYYY-MM-DD') as date,
        COUNT(*) as "purchaseCount",
        SUM(CAST(p."purchase_price" AS DECIMAL)) as "totalRevenue"
      FROM content_purchases p 
      WHERE p."content_id" = ANY($1)
        AND p."payment_status" = 'completed'
        AND p."purchased_at" >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(p."purchased_at")
      ORDER BY DATE(p."purchased_at") ASC
    `, [contentIds]);

    // Fill in missing days with zero values for the last 30 days
    const trends = [];
    const today = new Date();
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = rawData.find((d: any) => d.date === dateStr);
      
      trends.push({
        date: dateStr,
        bidCount: dayData ? parseInt(dayData.purchaseCount) : 0, // Keep same property name for frontend compatibility
        revenue: dayData ? parseFloat(dayData.totalRevenue) : 0
      });
    }

    return res.json({ data: trends });
  } catch (error) {
    console.error('Error fetching purchase trends:', error);
    return res.status(500).json({ error: 'Failed to fetch purchase trends' });
  }
});

/**
 * GET /api/marketplace/analytics/purchase/top-content/:walletAddress
 * Get top performing content with real purchase data
 */
router.get('/analytics/purchase/top-content/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get top content by purchase performance
    const topContentRaw = await AppDataSource.query(`
      SELECT 
        c.id,
        LEFT(c."contentText", 50) || '...' as title,
        COUNT(p.id) as "purchaseCount",
        MAX(CAST(p."purchase_price" AS DECIMAL)) as "maxPrice",
        SUM(CAST(p."purchase_price" AS DECIMAL)) as revenue,
        c."qualityScore" as quality_score
      FROM content_marketplace c
      LEFT JOIN content_purchases p ON c.id = p."content_id" 
        AND p."payment_status" = 'completed'
      WHERE c.id = ANY($1)
      GROUP BY c.id, c."contentText", c."qualityScore"
      ORDER BY revenue DESC NULLS LAST, "purchaseCount" DESC
      LIMIT 10
    `, [contentIds]);

    const topContent = topContentRaw.map((content: any) => ({
      id: content.id.toString(),
      title: content.title || 'Untitled Content',
      bidCount: parseInt(content.purchaseCount) || 0, // Keep same property for frontend compatibility
      maxBid: parseFloat(content.maxPrice) || 0, // Keep same property for frontend compatibility
      revenue: parseFloat(content.revenue) || 0,
      quality_score: parseFloat(content.quality_score) || 0
    }));

    return res.json({ data: topContent });
  } catch (error) {
    console.error('Error fetching top content by purchases:', error);
    return res.status(500).json({ error: 'Failed to fetch top content' });
  }
});

/**
 * GET /api/marketplace/analytics/purchase/yapper-engagement/:walletAddress
 * Get real yapper engagement data for a miner's content (purchase-based)
 */
router.get('/analytics/purchase/yapper-engagement/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get yapper engagement data using raw SQL
    const engagementRaw = await AppDataSource.query(`
      SELECT 
        u.id as "buyerId",
        u."walletAddress",
        u.username,
        COUNT(p.id) as "totalPurchases",
        SUM(CAST(p."purchase_price" AS DECIMAL)) as "totalAmount",
        COUNT(p.id) as "purchasedContent"
      FROM content_purchases p
      INNER JOIN users u ON p."buyer_wallet_address" = u."walletAddress"
      WHERE p."content_id" = ANY($1)
        AND p."payment_status" = 'completed'
      GROUP BY u.id, u."walletAddress", u.username
      ORDER BY "totalAmount" DESC
      LIMIT 10
    `, [contentIds]);

    const yappers = engagementRaw.map((data: any) => ({
      walletAddress: data.walletAddress || 'Unknown',
      username: data.username || `User${data.buyerId}`,
      totalBids: parseInt(data.totalPurchases) || 0, // Keep same property for frontend compatibility
      totalAmount: parseFloat(data.totalAmount) || 0,
      wonContent: parseInt(data.purchasedContent) || 0 // Keep same property for frontend compatibility
    }));

    return res.json({ data: yappers });
  } catch (error) {
    console.error('Error fetching yapper purchase engagement:', error);
    return res.status(500).json({ error: 'Failed to fetch yapper engagement' });
  }
});

/**
 * GET /api/marketplace/analytics/purchase/agent-performance/:walletAddress
 * Get real agent performance data for a miner based on purchases
 */
router.get('/analytics/purchase/agent-performance/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get agent performance based on purchases
    const agentPerformanceRaw = await AppDataSource.query(`
      SELECT 
        c."agentName",
        COUNT(c.id) as "contentCount",
        COUNT(p.id) as "purchaseCount",
        SUM(CAST(p."purchase_price" AS DECIMAL)) as revenue,
        AVG(c."qualityScore") as "avgQuality"
      FROM content_marketplace c
      LEFT JOIN content_purchases p ON c.id = p."content_id" 
        AND p."payment_status" = 'completed'
      WHERE c.id = ANY($1)
        AND c."agentName" IS NOT NULL
        AND c."agentName" != ''
      GROUP BY c."agentName"
      ORDER BY revenue DESC NULLS LAST
    `, [contentIds]);

    const agentPerformance = agentPerformanceRaw.map((agent: any) => ({
      agentName: agent.agentName || 'Unknown Agent',
      contentCount: parseInt(agent.contentCount) || 0,
      bidCount: parseInt(agent.purchaseCount) || 0, // Keep same property for frontend compatibility
      revenue: parseFloat(agent.revenue) || 0,
      avgQuality: Math.round(parseFloat(agent.avgQuality) || 0) // Round to whole number
    }));

    return res.json({ data: agentPerformance });
  } catch (error) {
    console.error('Error fetching agent purchase performance:', error);
    return res.status(500).json({ error: 'Failed to fetch agent performance' });
  }
});

/**
 * GET /api/marketplace/analytics/purchase/time-analysis/:walletAddress
 * Get purchase activity time analysis for a miner's content
 */
router.get('/analytics/purchase/time-analysis/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: { heatmap: [], peakTimes: [] } });
    }

    // Get time-based purchase patterns
    const heatmapRaw = await AppDataSource.query(`
      SELECT 
        EXTRACT(dow FROM p."purchased_at") as day,
        EXTRACT(hour FROM p."purchased_at") as hour,
        COUNT(*) as "purchaseCount"
      FROM content_purchases p 
      WHERE p."content_id" = ANY($1)
        AND p."payment_status" = 'completed'
        AND p."purchased_at" >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY EXTRACT(dow FROM p."purchased_at"), EXTRACT(hour FROM p."purchased_at")
      ORDER BY day, hour
    `, [contentIds]);

    // Calculate intensity and create heatmap
    const maxPurchases = Math.max(...heatmapRaw.map((h: any) => parseInt(h.purchaseCount)), 1);
    console.log('🔍 Heatmap Debug:', { 
      rawDataCount: heatmapRaw.length, 
      maxPurchases, 
      sampleData: heatmapRaw.slice(0, 3) 
    });
    
    const heatmap = heatmapRaw.map((h: any) => ({
      day: parseInt(h.day),
      hour: parseInt(h.hour),
      bidCount: parseInt(h.purchaseCount), // Keep same property for frontend compatibility
      intensity: parseInt(h.purchaseCount) / maxPurchases
    }));

    // Calculate peak times
    const hourlyTotals: Record<number, number> = {};
    heatmapRaw.forEach((h: any) => {
      const hour = parseInt(h.hour);
      hourlyTotals[hour] = (hourlyTotals[hour] || 0) + parseInt(h.purchaseCount);
    });

    const totalPurchases = Object.values(hourlyTotals).reduce((sum, count) => sum + count, 0);
    const peakTimes = Object.entries(hourlyTotals)
      .map(([hour, count]) => ({
        timeRange: `${hour}:00-${parseInt(hour) + 1}:00`,
        bidActivity: totalPurchases > 0 ? Math.round((count / totalPurchases) * 100) : 0 // Keep same property for frontend compatibility
      }))
      .sort((a, b) => b.bidActivity - a.bidActivity)
      .slice(0, 4);

    console.log('🔍 Final Result:', { 
      heatmapCount: heatmap.length, 
      peakTimesCount: peakTimes.length,
      totalPurchases 
    });

    return res.json({ 
      data: { 
        heatmap, 
        peakTimes 
      } 
    });
  } catch (error) {
    console.error('Error fetching purchase time analysis:', error);
    return res.status(500).json({ error: 'Failed to fetch time analysis' });
  }
});

/**
 * GET /api/marketplace/analytics/purchase/content-categories/:walletAddress
 * Get content categories performance based on purchases
 */
router.get('/analytics/purchase/content-categories/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Analyze content categories based on campaign platform
    const categoryPerformanceRaw = await AppDataSource.query(`
      SELECT 
        COALESCE(camp."platformSource", 'burnie') as category,
        COUNT(c.id) as count,
        COUNT(p.id) as "purchaseCount",
        SUM(CAST(p."purchase_price" AS DECIMAL)) as revenue
      FROM content_marketplace c
      LEFT JOIN campaigns camp ON c."campaignId" = camp.id
      LEFT JOIN content_purchases p ON c.id = p."content_id" 
        AND p."payment_status" = 'completed'
      WHERE c.id = ANY($1)
      GROUP BY COALESCE(camp."platformSource", 'burnie')
      ORDER BY revenue DESC NULLS LAST
    `, [contentIds]);

    const categoryPerformance = categoryPerformanceRaw.map((category: any) => ({
      category: category.category || 'burnie',
      count: parseInt(category.count) || 0,
      avgBids: parseFloat(category.purchaseCount) || 0, // Keep same property for frontend compatibility  
      revenue: parseFloat(category.revenue) || 0
    }));

    return res.json({ data: categoryPerformance });
  } catch (error) {
    console.error('Error fetching content categories by purchases:', error);
    return res.status(500).json({ error: 'Failed to fetch content categories' });
  }
});

/**
 * GET /api/marketplace/analytics/purchase/miner/portfolio/:walletAddress
 * Get token portfolio and earnings analytics for a miner based on content purchases
 */
router.get('/analytics/purchase/miner/portfolio/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Get earnings by token from content purchases
    const tokenEarnings = await AppDataSource.query(`
      SELECT 
        p."currency" as token,
        COUNT(p.id) as totalSales,
        SUM(CAST(p."purchase_price" AS DECIMAL)) as totalAmount,
        AVG(CAST(p."purchase_price" AS DECIMAL)) as avgAmount,
        MAX(CAST(p."purchase_price" AS DECIMAL)) as maxAmount,
        MIN(CAST(p."purchase_price" AS DECIMAL)) as minAmount
      FROM content_purchases p
      JOIN content_marketplace c ON p."content_id" = c.id 
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND p."payment_status" = 'completed'
      GROUP BY p."currency"
      ORDER BY totalAmount DESC
    `, [walletAddress]);

    // Get recent transactions
    const recentTransactions = await AppDataSource.query(`
      SELECT 
        p."currency" as token,
        CAST(p."purchase_price" AS DECIMAL) as amount,
        p."purchased_at" as date,
        c."contentText",
        c."agentName",
        p."buyer_wallet_address" as buyerWallet
      FROM content_purchases p
      JOIN content_marketplace c ON p."content_id" = c.id 
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND p."payment_status" = 'completed'
      ORDER BY p."purchased_at" DESC
      LIMIT 20
    `, [walletAddress]);

    // Get content performance by token
    const contentByToken = await AppDataSource.query(`
      SELECT 
        p."currency" as token,
        c.id as contentId,
        c."contentText",
        c."agentName",
        c."predictedMindshare",
        c."qualityScore",
        CAST(p."purchase_price" AS DECIMAL) as salePrice,
        p."purchased_at" as saleDate,
        1 as totalBids
      FROM content_purchases p
      JOIN content_marketplace c ON p."content_id" = c.id 
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND p."payment_status" = 'completed'
      ORDER BY p."purchased_at" DESC
    `, [walletAddress]);

    // Calculate token rates (mock rates for now)
    const tokenRates = {
      ROAST: 0.1,
      USDC: 1.0,
      KAITO: 0.25,
      COOKIE: 0.15,
      AXR: 0.08,
      NYKO: 0.12,
    };

    // Process token earnings with USD values
    const processedEarnings = tokenEarnings.map((earning: any) => ({
      token: earning.token,
      amount: Number(earning.totalamount) || 0,
      totalSales: Number(earning.totalsales) || 0,
      avgSalePrice: Number(earning.avgamount) || 0,
      maxSalePrice: Number(earning.maxamount) || 0,
      minSalePrice: Number(earning.minamount) || 0,
      usdValue: (Number(earning.totalamount) || 0) * (tokenRates[earning.token as keyof typeof tokenRates] || 0),
      pricePerToken: tokenRates[earning.token as keyof typeof tokenRates] || 0,
    }));

    // Calculate portfolio metrics
    const totalUSDValue = processedEarnings.reduce((sum: number, earning: any) => sum + earning.usdValue, 0);
    const totalSales = processedEarnings.reduce((sum: number, earning: any) => sum + earning.totalSales, 0);
    const uniqueTokens = processedEarnings.length;

    // Get top performing token
    const topToken = processedEarnings.length > 0 ? 
      processedEarnings.reduce((top: any, current: any) => 
        current.usdValue > top.usdValue ? current : top
      ) : null;

    // Calculate portfolio distribution
    const distribution = processedEarnings.map((earning: any) => ({
      token: earning.token,
      percentage: totalUSDValue > 0 ? (earning.usdValue / totalUSDValue * 100) : 0,
      usdValue: earning.usdValue,
    }));

    // Process recent transactions
    const processedTransactions = recentTransactions.map((tx: any) => ({
      ...tx,
      amount: Number(tx.amount) || 0,
      usdValue: (Number(tx.amount) || 0) * (tokenRates[tx.token as keyof typeof tokenRates] || 0),
      contentPreview: tx.contentText ? tx.contentText.substring(0, 100) + '...' : '',
    }));

    // Group content by token
    const contentGroupedByToken = contentByToken.reduce((acc: any, content: any) => {
      if (!acc[content.token]) {
        acc[content.token] = [];
      }
      acc[content.token].push({
        ...content,
        saleprice: Number(content.saleprice) || 0,
        totalbids: Number(content.totalbids) || 0,
        usdValue: (Number(content.saleprice) || 0) * (tokenRates[content.token as keyof typeof tokenRates] || 0),
      });
      return acc;
    }, {});

    return res.json({
      portfolio: {
        totalUSDValue,
        totalSales,
        uniqueTokens,
        topToken: topToken ? {
          token: topToken.token,
          usdValue: topToken.usdValue,
          changePercent: 0, // TODO: Calculate actual change
        } : null,
      },
      earnings: processedEarnings,
      distribution,
      recentTransactions: processedTransactions,
      contentByToken: contentGroupedByToken,
      tokenRates,
    });

  } catch (error) {
    console.error('Error fetching miner purchase portfolio analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch portfolio analytics' });
  }
});

/**
 * @route POST /api/marketplace/approve-content
 * @desc Approve existing pending content by ID
 */
router.post('/approve-content', async (req: Request, res: Response) => {
  try {
    const { contentId, walletAddress } = req.body;

    if (!contentId || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: contentId, walletAddress'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const userRepository = AppDataSource.getRepository(User);

    // Find user by wallet address to verify ownership
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Find the content and verify ownership
    const content = await contentRepository.findOne({
      where: { 
        id: contentId,
        creatorId: user.id,
        approvalStatus: 'pending'
      }
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        error: 'Pending content not found or not owned by user'
      });
    }

    // Enforce consistency: isVideo should match videoUrl presence (fix any legacy inconsistencies)
    // IMPORTANT: Validate that videoUrl is actually a video, not an image
    const hasVideoUrl = !!(content.videoUrl && content.videoUrl.trim() !== '');
    const isActuallyVideo = hasVideoUrl && content.videoUrl !== null && !content.videoUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    
    // If videoUrl contains an image extension, it's not a video - clear it
    if (hasVideoUrl && !isActuallyVideo && content.videoUrl) {
      console.log('⚠️ WARNING: video_url contains an image URL, clearing it for content', content.id, ':', {
        videoUrl: content.videoUrl.substring(0, 100),
        willClearVideoFields: true
      });
    }
    
    if (content.isVideo !== isActuallyVideo) {
      console.log('⚠️ Fixing video field inconsistency for content', content.id, ':', {
        wasIsVideo: content.isVideo,
        hasVideoUrl: hasVideoUrl,
        isActuallyVideo: isActuallyVideo,
        fixingTo: isActuallyVideo
      });
      content.isVideo = Boolean(isActuallyVideo);
      
      // If no actual video, clear all video-related fields
      if (!isActuallyVideo) {
        content.videoUrl = null;
        content.watermarkVideoUrl = null;
        content.videoDuration = null;
        content.subsequentFramePrompts = null;
        content.clipPrompts = null;
        content.audioPrompt = null;
        content.audioPrompts = null;
      }
    }
    
    // Generate watermarked image if content has images
    let watermarkImageUrl: string | null = null;
    if (content.contentImages) {
      try {
        console.log('🖼️ Starting image watermarking for content:', content.id, 'Images:', content.contentImages);
        const s3Bucket = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';
        watermarkImageUrl = await WatermarkService.createWatermarkForContent(content.contentImages, s3Bucket);
        console.log('✅ Watermarked image created:', watermarkImageUrl);
      } catch (error) {
        console.error('❌ Failed to create image watermark for content', content.id, ':', error);
      }
    }

    // Start background video watermarking if content has video (non-blocking)
    if (isActuallyVideo && content.videoUrl) {
      try {
        console.log('🎬 Starting background video watermarking for content:', content.id, 'Video URL:', content.videoUrl);
        const s3Bucket = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';
        // Start background task - don't wait for completion
        await VideoWatermarkService.createWatermarkForVideo(content.videoUrl, s3Bucket, content.id);
        console.log('✅ Video watermarking task queued in background for content:', content.id);
      } catch (error) {
        console.error('❌ Failed to start video watermarking task for content', content.id, ':', error);
        // Log the full error for debugging
        if (error instanceof Error) {
          console.error('❌ Video watermarking error details:', error.message, error.stack);
        }
      }
    } else {
      console.log('⏭️ Skipping video watermarking - no valid video URL present for content:', content.id);
    }

    // Update content to approved and set wallet address for ownership verification
    content.approvalStatus = 'approved';
    content.isAvailable = true;
    content.approvedAt = new Date();
    content.walletAddress = walletAddress; // Set wallet address for bidding authorization
    
    // Save watermark URLs if they were generated
    if (watermarkImageUrl) {
      content.watermarkImage = watermarkImageUrl;
      console.log('💾 Saving watermarked image URL for content', content.id, ':', watermarkImageUrl);
    } else if (content.contentImages) {
      console.log('⚠️ Content', content.id, 'has images but no watermarked image was created');
    }
    
    // Don't set watermarkVideoUrl here - it will be set later via callback
    if (isActuallyVideo) {
      content.watermarkVideoUrl = null; // Reset to null, will be updated by background task
      console.log('🎬 Video watermark URL will be set via callback for content', content.id);
    } else {
      content.watermarkVideoUrl = null; // Ensure it's null if no video or if image URL was in video_url
      console.log('⏭️ No valid video present, watermarkVideoUrl set to null for content', content.id);
    }

    const updatedContent = await contentRepository.save(content);

    // Approve on blockchain (async, non-blocking)
    const { contentIntegrationService } = require('../services/contentIntegrationService');
    const priceForBlockchain = updatedContent.biddingAskPrice || 0;
    contentIntegrationService.approveContentOnChain(updatedContent.id, priceForBlockchain).catch((error: any) => {
      console.error(`❌ Failed to approve content ${updatedContent.id} on blockchain:`, error);
    });

    console.log('✅ Content approved:', {
      id: updatedContent.id,
      creatorId: updatedContent.creatorId,
      approvedAt: updatedContent.approvedAt,
      hasOriginalImage: !!updatedContent.contentImages,
      hasWatermarkedImage: !!updatedContent.watermarkImage,
      hasOriginalVideo: !!updatedContent.videoUrl,
      hasWatermarkedVideo: !!updatedContent.watermarkVideoUrl
    });

    return res.json({
      success: true,
      data: {
        id: updatedContent.id,
        message: 'Content approved successfully',
        approvedAt: updatedContent.approvedAt
      }
    });

  } catch (error) {
    console.error('❌ Error approving content:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to approve content'
    });
  }
});

/**
 * @route POST /api/marketplace/video-watermark-complete
 * @desc Callback endpoint for Python backend to update watermarked video URL
 */
router.post('/video-watermark-complete', async (req: Request, res: Response) => {
  try {
    const { content_id, success, watermark_video_url, error } = req.body;

    console.log('📞 Received video watermark callback:', {
      content_id,
      success,
      watermark_video_url: watermark_video_url ? watermark_video_url.substring(0, 100) + '...' : null,
      error
    });

    if (!content_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: content_id'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Find the content
    const content = await contentRepository.findOne({
      where: { id: content_id }
    });

    if (!content) {
      console.error('❌ Content not found for watermark callback:', content_id);
      return res.status(404).json({
        success: false,
        error: 'Content not found'
      });
    }

    if (success && watermark_video_url) {
      // Update watermarked video URL
      content.watermarkVideoUrl = watermark_video_url;
      await contentRepository.save(content);
      
      console.log('✅ Video watermark URL updated for content:', {
        id: content.id,
        watermarkVideoUrl: watermark_video_url.substring(0, 100) + '...'
      });

      return res.json({
        success: true,
        message: 'Watermark video URL updated successfully'
      });
    } else {
      // Log error but don't fail - content is already approved
      console.error('❌ Video watermarking failed for content:', content_id, 'Error:', error);
      
      return res.json({
        success: true,
        message: 'Watermarking failed but content remains approved',
        error
      });
    }

  } catch (error) {
    console.error('❌ Error in video watermark callback:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process watermark callback'
    });
  }
});

/**
 * @route POST /api/marketplace/reject-content
 * @desc Reject existing pending content by ID
 */
router.post('/reject-content', async (req: Request, res: Response) => {
  try {
    const { contentId, walletAddress, reason = 'Content does not meet quality standards' } = req.body;

    if (!contentId || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: contentId, walletAddress'
      });
    }

    // Validate contentId is a valid number
    if (isNaN(Number(contentId)) || Number(contentId) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contentId: must be a positive number'
      });
    }

    // Log the rejection attempt for debugging
    console.log('🚀 Rejection attempt:', {
      contentId: Number(contentId),
      walletAddress,
      reason
    });

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const userRepository = AppDataSource.getRepository(User);

    // Find user by wallet address to verify ownership (case-insensitive)
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // First, check if content exists at all (for debugging)
    const contentExists = await contentRepository.findOne({
      where: { id: Number(contentId) }
    });

    if (!contentExists) {
      console.log('❌ Content does not exist in database:', { contentId: Number(contentId) });
      return res.status(404).json({
        success: false,
        error: 'Content not found'
      });
    }

    // Find the content and verify ownership using the same pattern as other endpoints
    // Allow rejection of both pending content AND approved content that is not biddable
    const content = await contentRepository
      .createQueryBuilder('content')
      .where('content.id = :contentId', { contentId: Number(contentId) })
      .andWhere('(LOWER(content.walletAddress) = LOWER(:walletAddress) OR (content.walletAddress IS NULL AND content.creatorId = :creatorId))', 
        { walletAddress, creatorId: user.id })
      .andWhere('content.approvalStatus IN (:...approvalStatuses)', 
        { approvalStatuses: ['pending', 'approved'] })
      .getOne();

    if (!content) {
      // Log detailed information for debugging
      console.log('❌ Content exists but ownership/status check failed:', {
        contentId: Number(contentId),
        walletAddress,
        userId: user.id,
        existingContent: {
          id: contentExists.id,
          creatorId: contentExists.creatorId,
          approvalStatus: contentExists.approvalStatus,
          walletAddress: contentExists.walletAddress,
          isBiddable: contentExists.isBiddable,
          isAvailable: contentExists.isAvailable
        },
        searchCriteria: {
          contentId: Number(contentId),
          walletAddress: walletAddress.toLowerCase(),
          creatorId: user.id,
          approvalStatuses: ['pending', 'approved']
        }
      });
      
      return res.status(404).json({
        success: false,
        error: 'Content not found or not owned by user'
      });
    }

    // Log content found for debugging
    console.log('✅ Content found for rejection:', {
      contentId: content.id,
      creatorId: content.creatorId,
      approvalStatus: content.approvalStatus,
      isBiddable: content.isBiddable,
      isAvailable: content.isAvailable,
      walletAddress: content.walletAddress,
      userWalletAddress: walletAddress.toLowerCase()
    });

    // Additional validation for approved content
    if (content.approvalStatus === 'approved') {
      // For approved content, only allow rejection if it's not biddable
      if (content.isBiddable) {
        return res.status(400).json({
          success: false,
          error: 'Cannot reject approved content that is currently biddable. Please disable bidding first.'
        });
      }
      
      // For approved content, only allow rejection if it's available
      if (!content.isAvailable) {
        return res.status(400).json({
          success: false,
          error: 'Cannot reject approved content that is not available'
        });
      }
    }

    // Update content to rejected
    content.approvalStatus = 'rejected';
    content.isAvailable = false;
    content.rejectedAt = new Date();

    const updatedContent = await contentRepository.save(content);

    console.log('✅ Content rejected:', {
      id: updatedContent.id,
      creatorId: updatedContent.creatorId,
      rejectedAt: updatedContent.rejectedAt,
      reason
    });

    return res.json({
      success: true,
      data: {
        id: updatedContent.id,
        message: 'Content rejected successfully',
        reason,
        rejectedAt: updatedContent.rejectedAt
      }
    });

  } catch (error) {
    console.error('❌ Error rejecting content:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reject content'
    });
  }
});

// ROAST Token ABI for balance checking
const ROAST_TOKEN_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

// USDC Token ABI (same structure)
const USDC_TOKEN_ABI = ROAST_TOKEN_ABI;

// Token contract addresses (using correct env variable names)
const ROAST_TOKEN_ADDRESS = process.env.CONTRACT_ROAST_TOKEN || '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4';
const USDC_TOKEN_ADDRESS = process.env.USDC_BASE_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Debug log to confirm addresses
console.log('🔧 Token Addresses Configuration:');
console.log('  ROAST:', ROAST_TOKEN_ADDRESS);
console.log('  USDC:', USDC_TOKEN_ADDRESS);

// Create viem client for Base network
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org')
});

/**
 * Check user's token balance (ROAST or USDC) - Backend endpoint to avoid wallet confirmations
 * POST /api/marketplace/check-balance
 */
router.post('/check-balance', async (req: Request, res: Response) => {
  try {
    const { walletAddress, tokenType, requiredAmount, network } = req.body;

    if (!walletAddress || !tokenType || requiredAmount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: walletAddress, tokenType, requiredAmount'
      });
    }

    logger.info(`🔍 Checking ${tokenType} balance for wallet: ${walletAddress}, required: ${requiredAmount}, network: ${network || 'base'}`);

    // Handle Somnia TOAST balance check
    if (network === 'somnia_testnet' && tokenType.toLowerCase() === 'toast') {
      try {
        const somniaService = new SomniaBlockchainService();
        const balanceFormatted = await somniaService.getToastBalance(walletAddress);
        const balance = parseFloat(balanceFormatted); // Already formatted by getToastBalance
        const required = parseFloat(requiredAmount.toString());
        const hasBalance = balance >= required;

        logger.info(`💰 Somnia TOAST balance check result:`, {
          wallet: walletAddress,
          token: 'TOAST',
          balance: balance,
          required: required,
          hasBalance: hasBalance
        });

        return res.json({
          success: true,
          data: {
            tokenType: 'TOAST',
            balance: balance,
            requiredAmount: required,
            hasBalance: hasBalance,
            shortfall: hasBalance ? 0 : (required - balance)
          }
        });
      } catch (error) {
        logger.error('❌ Error checking Somnia TOAST balance:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to check TOAST balance on Somnia'
        });
      }
    }

    // Handle Base Mainnet (ROAST/USDC) balance check
    let tokenAddress: string;
    let tokenName: string;

    if (tokenType.toLowerCase() === 'roast') {
      tokenAddress = ROAST_TOKEN_ADDRESS;
      tokenName = 'ROAST';
    } else if (tokenType.toLowerCase() === 'usdc') {
      tokenAddress = USDC_TOKEN_ADDRESS;
      tokenName = 'USDC';
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid tokenType. Must be "roast", "usdc", or "toast" (for Somnia)'
      });
    }

    // Get token decimals
    const decimals = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: tokenType.toLowerCase() === 'roast' ? ROAST_TOKEN_ABI : USDC_TOKEN_ABI,
      functionName: 'decimals',
    });

    // Get user's token balance
    const balanceWei = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: tokenType.toLowerCase() === 'roast' ? ROAST_TOKEN_ABI : USDC_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    });

    // Convert balance from wei to human readable
    const balance = parseFloat(formatUnits(balanceWei as bigint, decimals as number));
    const required = parseFloat(requiredAmount.toString());

    const hasBalance = balance >= required;

    logger.info(`💰 Balance check result:`, {
      wallet: walletAddress,
      token: tokenName,
      balance: balance,
      required: required,
      hasBalance: hasBalance
    });

    return res.json({
      success: true,
      data: {
        tokenType: tokenName,
        balance: balance,
        requiredAmount: required,
        hasBalance: hasBalance,
        shortfall: hasBalance ? 0 : (required - balance)
      }
    });

  } catch (error) {
    logger.error('❌ Error checking token balance:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check token balance'
    });
  }
});

/**
 * Get blockchain content ID for a content
 * GET /api/marketplace/content/:contentId/blockchain-id
 */
router.get('/content/:contentId/blockchain-id', async (req: Request, res: Response) => {
  try {
    const { contentId } = req.params;
    const { network } = req.query; // 'somnia_testnet' or 'base_mainnet'

    if (!contentId || !network || typeof network !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Content ID and network parameters are required'
      });
    }

    logger.info(`🔍 Getting blockchain content ID for content ${contentId} on network ${network}`);

    const { ContentBlockchainTransaction } = await import('../models/ContentBlockchainTransaction');
    const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);

    // Find the registration transaction for this content on the specified network
    const registrationTx = await blockchainTxRepository.findOne({
      where: {
        contentId: parseInt(contentId, 10),
        network: network,
        transactionType: 'registration'
      },
      order: {
        createdAt: 'DESC' // Get the most recent one
      }
    });

    if (!registrationTx || !registrationTx.blockchainContentId) {
      logger.warn(`⚠️ No blockchain content ID found for content ${contentId} on ${network}`);
      return res.status(404).json({
        success: false,
        error: 'Content not registered on blockchain'
      });
    }

    logger.info(`✅ Found blockchain content ID: ${registrationTx.blockchainContentId} for content ${contentId}`);

    return res.json({
      success: true,
      data: {
        contentId: parseInt(contentId, 10),
        blockchainContentId: registrationTx.blockchainContentId,
        network: registrationTx.network,
        transactionHash: registrationTx.transactionHash,
        creatorWalletAddress: registrationTx.creatorWalletAddress
      }
    });

  } catch (error) {
    logger.error('❌ Error getting blockchain content ID:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get blockchain content ID'
    });
  }
});

// GET /api/marketplace/user/:userId/profile - Get user profile with Twitter data
router.get('/user/:userId/profile', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Get user data
    const userRepository = AppDataSource.getRepository(User);
        const user = await userRepository.findOne({ 
      where: { id: parseInt(userId as string) } 
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get Twitter connection data
    const { TwitterUserConnection } = await import('../models/TwitterUserConnection');
    const twitterRepository = AppDataSource.getRepository(TwitterUserConnection);
    const twitterConnection = await twitterRepository.findOne({
      where: { userId: parseInt(userId as string), isConnected: true }
    });

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        walletAddress: user.walletAddress
      },
      twitterConnection: twitterConnection ? {
        twitterUsername: twitterConnection.twitterUsername,
        twitterDisplayName: twitterConnection.twitterDisplayName,
        profileImageUrl: twitterConnection.profileImageUrl
      } : null
    });

  } catch (error) {
    logger.error('❌ Error fetching user profile:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile'
    });
  }
});

/**
 * @route POST /api/marketplace/content/:id/check-availability
 * @desc Check if content is available for purchase and not in purchase flow
 */
router.post('/content/:id/check-availability', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.body;

    if (!id || !walletAddress) {
      res.status(400).json({
        success: false,
        message: 'Content ID and wallet address are required'
      });
      return;
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['creator']
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found'
      });
      return;
    }

    // Check if content is available for purchase
    if (!content.isAvailable || !content.isBiddable) {
      res.json({
        success: true,
        data: {
          available: false,
          inPurchaseFlow: false,
          purchaseState: 'unavailable',
          message: 'Content is not available for purchase'
        }
      });
      return;
    }

    // Check if content is currently in purchase flow
    if (content.inPurchaseFlow) {
      // Check if the purchase flow has expired
      const now = new Date();
      // Purchase flow expiry logic removed - no longer needed
      // Content is in active purchase flow
      const timeUntilExpiry = 5; // Default 5 minutes
          
      res.json({
        success: true,
        data: {
          available: false,
          inPurchaseFlow: true,
          purchaseState: 'in_purchase_flow',
          message: 'This content is being purchased by another user',
          estimatedWaitTime: `${timeUntilExpiry} minutes`,
          canRetry: true
        }
      });
      return;
    }

    // Content is available, reserve it for this user
    const PURCHASE_FLOW_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    
    content.inPurchaseFlow = true;
    content.purchaseFlowInitiatedBy = walletAddress;
    content.purchaseFlowInitiatedAt = new Date();
    
    await contentRepository.save(content);
    
    logger.info(`🔒 Content ${id} reserved for purchase by ${walletAddress}`);

    res.json({
      success: true,
      data: {
        available: true,
        inPurchaseFlow: false,
        purchaseState: 'reserved',
        message: 'Content reserved for purchase',
        expiresAt: new Date(Date.now() + PURCHASE_FLOW_TIMEOUT).toISOString(),
        timeoutMinutes: 5
      }
    });

  } catch (error) {
    logger.error('Error checking content availability:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check content availability',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/content/:id/release-purchase-flow
 * @desc Release content from purchase flow (when user cancels or fails)
 */
router.post('/content/:id/release-purchase-flow', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.body;

    if (!id || !walletAddress) {
      res.status(400).json({
        success: false,
        message: 'Content ID and wallet address are required'
      });
      return;
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) }
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found'
      });
      return;
    }

    // Only allow the user who initiated the purchase flow to release it
    if (content.inPurchaseFlow && content.purchaseFlowInitiatedBy === walletAddress) {
      content.inPurchaseFlow = false;
      content.purchaseFlowInitiatedBy = null;
      content.purchaseFlowInitiatedAt = null;
      
      await contentRepository.save(content);
      
      logger.info(`🔓 Content ${id} released from purchase flow by ${walletAddress}`);

      res.json({
        success: true,
        data: {
          message: 'Purchase flow released successfully',
          contentId: parseInt(id)
        }
      });
    } else {
      res.status(403).json({
        success: false,
        message: 'You can only release purchase flows you initiated'
      });
    }

  } catch (error) {
    logger.error('Error releasing purchase flow:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to release purchase flow',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/purchase/:id/process-referral-payouts
 * @desc Manually process referral payouts for a purchase (admin endpoint)
 */
router.post('/purchase/:id/process-referral-payouts', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Purchase ID is required'
      });
      return;
    }

    const result = await AsyncReferralPayoutService.processFailedReferralPayouts(parseInt(id));

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          purchaseId: parseInt(id),
          directReferrerPayout: result.directReferrerPayout || 0,
          grandReferrerPayout: result.grandReferrerPayout || 0
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message
      });
    }

  } catch (error) {
    logger.error('Error manually processing referral payouts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process referral payouts',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/purchase/:id/referral-payout-status
 * @desc Get referral payout status for a purchase
 */
router.get('/purchase/:id/referral-payout-status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Purchase ID is required'
      });
      return;
    }

    const status = await AsyncReferralPayoutService.getReferralPayoutStatus(parseInt(id));

    res.json({
      success: true,
      data: {
        purchaseId: parseInt(id),
        ...status
      }
    });

  } catch (error) {
    logger.error('Error getting referral payout status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get referral payout status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/referral-payouts/failed
 * @desc Get all purchases with failed referral payouts (admin endpoint)
 */
router.get('/referral-payouts/failed', async (req: Request, res: Response): Promise<void> => {
  try {
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    const failedPurchases = await purchaseRepository.find({
      where: {
        referralPayoutStatus: 'failed'
      },
      relations: ['content', 'buyer'],
      order: {
        createdAt: 'DESC'
      }
    });

    res.json({
      success: true,
      data: {
        failedPurchases: failedPurchases.map(purchase => ({
          id: purchase.id,
          contentId: purchase.contentId,
          buyerWalletAddress: purchase.buyerWalletAddress,
          purchasePrice: purchase.purchasePrice,
          currency: purchase.currency,
          referralPayoutStatus: purchase.referralPayoutStatus,
          createdAt: purchase.createdAt,
          content: purchase.content ? {
            id: purchase.content.id,
            title: purchase.content.campaign?.title || 'Unknown Content'
          } : null
        }))
      }
    });

  } catch (error) {
    logger.error('Error getting failed referral payouts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get failed referral payouts',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/retry-watermark
 * @desc Retry video watermarking for a content item
 */
router.post('/retry-watermark', async (req: Request, res: Response) => {
  try {
    const { contentId } = req.body;

    console.log('🔄 Retrying video watermarking for content:', contentId);

    if (!contentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: contentId'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Find the content
    const content = await contentRepository.findOne({
      where: { id: contentId }
    });

    if (!content) {
      console.error('❌ Content not found for watermark retry:', contentId);
      return res.status(404).json({
        success: false,
        error: 'Content not found'
      });
    }

    // Check if content has video
    if (!content.isVideo || !content.videoUrl) {
      console.error('❌ Content does not have a video:', contentId);
      return res.status(400).json({
        success: false,
        error: 'Content does not have a video'
      });
    }

    // Reset watermark URL to null to trigger retry
    content.watermarkVideoUrl = null;
    await contentRepository.save(content);

    console.log('🔄 Reset watermark URL for content:', contentId);

    // Trigger watermarking again
    const s3Bucket = process.env.S3_BUCKET_NAME || '';
    
    try {
      await VideoWatermarkService.createWatermarkForVideo(content.videoUrl, s3Bucket, content.id);
      
      console.log('✅ Watermarking retry initiated for content:', contentId);

      return res.json({
        success: true,
        message: 'Video watermarking retry initiated successfully'
      });
    } catch (watermarkError) {
      console.error('❌ Failed to initiate watermarking retry:', watermarkError);
      
      // Even if watermarking fails to start, return success since we reset the URL
      return res.json({
        success: true,
        message: 'Watermark URL reset, but failed to initiate retry',
        error: watermarkError instanceof Error ? watermarkError.message : 'Unknown error'
      });
    }

  } catch (error) {
    console.error('❌ Error in retry watermark endpoint:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

export default router; 