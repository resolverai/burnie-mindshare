/**
 * Script to re-register failed content on Somnia Testnet
 * 
 * This script:
 * 1. Finds all content with failed registration in content_blockchain_transactions
 * 2. Downloads images from S3 using fresh presigned URLs
 * 3. Uploads to IPFS
 * 4. Registers on Somnia blockchain
 * 5. Updates the existing failed transaction record
 * 
 * Usage:
 * npm run reregister-failed-content
 * 
 * Or with specific content IDs:
 * npm run reregister-failed-content -- --contentIds=8644,8716
 */

import { AppDataSource } from '../src/config/database';
import { ContentMarketplace } from '../src/models/ContentMarketplace';
import { ContentBlockchainTransaction } from '../src/models/ContentBlockchainTransaction';
import { User } from '../src/models/User';
import { ContentIntegrationService } from '../src/services/contentIntegrationService';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../src/config/logger';

// AWS S3 Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const S3_BUCKET = process.env.S3_BUCKET_NAME || 'burnie-mindshare-content';

interface ReregistrationResult {
  contentId: number;
  success: boolean;
  transactionHash?: string | undefined;
  error?: string | undefined;
}

/**
 * Extract S3 key from URL
 */
function extractS3KeyFromUrl(url: string): string | null {
  try {
    // Handle various S3 URL formats
    // Format 1: https://bucket.s3.region.amazonaws.com/key
    // Format 2: https://s3.region.amazonaws.com/bucket/key
    // Format 3: https://bucket.s3.amazonaws.com/key
    
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Remove leading slash
    let key = pathname.substring(1);
    
    // If URL format is s3.region.amazonaws.com/bucket/key, remove bucket name
    if (urlObj.hostname.includes('s3.amazonaws.com') && !urlObj.hostname.includes(S3_BUCKET)) {
      const parts = key.split('/');
      if (parts[0] === S3_BUCKET) {
        key = parts.slice(1).join('/');
      }
    }
    
    return key;
  } catch (error) {
    logger.error(`Failed to extract S3 key from URL: ${url}`, error);
    return null;
  }
}

/**
 * Get fresh presigned URL for S3 object
 */
async function getFreshPresignedUrl(s3Key: string): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    });
    
    // Generate presigned URL valid for 1 hour
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return presignedUrl;
  } catch (error) {
    logger.error(`Failed to generate presigned URL for ${s3Key}:`, error);
    throw error;
  }
}

/**
 * Download file from URL to temporary location
 */
async function downloadFileToTemp(url: string, contentId: number): Promise<string> {
  try {
    logger.info(`📥 Downloading file for content ${contentId} from ${url}`);
    
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout
    });
    
    // Determine file extension from URL or content type
    let extension = '.jpg'; // default
    const urlPath = new URL(url).pathname;
    const urlExtension = path.extname(urlPath);
    if (urlExtension) {
      extension = urlExtension;
    } else {
      const contentType = response.headers['content-type'];
      if (contentType?.includes('png')) extension = '.png';
      else if (contentType?.includes('gif')) extension = '.gif';
      else if (contentType?.includes('webp')) extension = '.webp';
      else if (contentType?.includes('mp4')) extension = '.mp4';
    }
    
    // Create temp file
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `content_${contentId}_${Date.now()}${extension}`);
    
    // Write to temp file
    fs.writeFileSync(tempFilePath, Buffer.from(response.data));
    
    logger.info(`✅ Downloaded file to ${tempFilePath}`);
    return tempFilePath;
  } catch (error) {
    logger.error(`Failed to download file for content ${contentId}:`, error);
    throw error;
  }
}

/**
 * Clean up temporary file
 */
function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`🗑️ Cleaned up temp file: ${filePath}`);
    }
  } catch (error) {
    logger.warn(`Failed to cleanup temp file ${filePath}:`, error);
  }
}

/**
 * Re-register a single piece of content
 */
async function reregisterContent(
  content: ContentMarketplace,
  failedTxRecord: ContentBlockchainTransaction | null,
  contentIntegrationService: ContentIntegrationService
): Promise<ReregistrationResult> {
  let tempFilePath: string | null = null;
  
  try {
    logger.info(`\n🔄 Processing content ${content.id}...`);
    
    // Get creator wallet address
    const creator = content.creator;
    if (!creator || !creator.walletAddress) {
      return {
        contentId: content.id,
        success: false,
        error: 'Creator or wallet address not found',
      };
    }
    
    // Determine file URL to use
    let fileUrl: string | null = null;
    let s3Key: string | null = null;
    
    // Priority: contentImages > videoUrl
    if (content.contentImages && Array.isArray(content.contentImages) && content.contentImages.length > 0) {
      fileUrl = content.contentImages[0];
    } else if (content.videoUrl) {
      fileUrl = content.videoUrl;
    }
    
    if (!fileUrl) {
      return {
        contentId: content.id,
        success: false,
        error: 'No image or video URL found',
      };
    }
    
    // Extract S3 key from URL
    s3Key = extractS3KeyFromUrl(fileUrl);
    if (!s3Key) {
      return {
        contentId: content.id,
        success: false,
        error: 'Failed to extract S3 key from URL',
      };
    }
    
    logger.info(`📦 S3 Key: ${s3Key}`);
    
    // Get fresh presigned URL
    const freshPresignedUrl = await getFreshPresignedUrl(s3Key);
    logger.info(`🔗 Fresh presigned URL generated`);
    
    // Download file to temp location
    tempFilePath = await downloadFileToTemp(freshPresignedUrl, content.id);
    
    // Register on blockchain (this will upload to IPFS internally)
    logger.info(`⛓️ Registering content ${content.id} on Somnia blockchain...`);
    const result = await contentIntegrationService.registerContentOnChain(
      content.id,
      creator.walletAddress,
      tempFilePath,
      content.postType || 'thread'
    );
    
    if (!result.success) {
      return {
        contentId: content.id,
        success: false,
        error: result.error || 'Registration failed',
      };
    }
    
    logger.info(`✅ Content ${content.id} registered successfully!`);
    logger.info(`   Transaction Hash: ${result.transactionHash}`);
    logger.info(`   IPFS CID: ${result.cid}`);
    
    // Note: The transaction record is automatically created/updated by registerContentOnChain
    
    return {
      contentId: content.id,
      success: true,
      transactionHash: result.transactionHash,
    };
    
  } catch (error) {
    logger.error(`❌ Failed to re-register content ${content.id}:`, error);
    return {
      contentId: content.id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    // Cleanup temp file
    if (tempFilePath) {
      cleanupTempFile(tempFilePath);
    }
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    logger.info('🚀 Starting content re-registration script...\n');
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    let specificContentIds: number[] = [];
    
    for (const arg of args) {
      if (arg.startsWith('--contentIds=')) {
        const idsString = arg.split('=')[1];
        if (idsString) {
          specificContentIds = idsString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        }
      }
    }
    
    // Initialize database
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      logger.info('✅ Database connection initialized\n');
    }
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const txRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
    const contentIntegrationService = new ContentIntegrationService();
    
    // Find all content with failed registration
    let failedTxRecords: ContentBlockchainTransaction[];
    
    if (specificContentIds.length > 0) {
      logger.info(`🔍 Searching for specific content IDs: ${specificContentIds.join(', ')}\n`);
      failedTxRecords = await txRepository.find({
        where: specificContentIds.map(id => ({
          contentId: id,
          transactionType: 'registration',
          network: 'somnia_testnet',
          status: 'failed',
        })),
      });
    } else {
      logger.info('🔍 Searching for all content with failed registration...\n');
      failedTxRecords = await txRepository.find({
        where: {
          transactionType: 'registration',
          network: 'somnia_testnet',
          status: 'failed',
        },
        order: {
          createdAt: 'DESC',
        },
      });
    }
    
    logger.info(`📊 Found ${failedTxRecords.length} failed registration records\n`);
    
    if (failedTxRecords.length === 0) {
      logger.info('✅ No failed registrations to process. Exiting.');
      return;
    }
    
    // Get unique content IDs
    const contentIds = [...new Set(failedTxRecords.map(tx => tx.contentId))];
    logger.info(`📋 Processing ${contentIds.length} unique content items...\n`);
    
    // Fetch content with creators
    const contents = await contentRepository.find({
      where: contentIds.map(id => ({ id })),
      relations: ['creator'],
    });
    
    const results: ReregistrationResult[] = [];
    
    // Process each content
    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      if (!content) continue; // Skip if undefined
      
      const failedTxRecord = failedTxRecords.find(tx => tx.contentId === content.id) || null;
      
      logger.info(`\n[${i + 1}/${contents.length}] Processing content ${content.id}...`);
      
      const result = await reregisterContent(content, failedTxRecord, contentIntegrationService);
      results.push(result);
      
      // Small delay between registrations to avoid rate limiting
      if (i < contents.length - 1) {
        logger.info('⏳ Waiting 2 seconds before next registration...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Print summary
    logger.info('\n' + '='.repeat(80));
    logger.info('📊 RE-REGISTRATION SUMMARY');
    logger.info('='.repeat(80) + '\n');
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    logger.info(`✅ Successful: ${successCount}`);
    logger.info(`❌ Failed: ${failureCount}`);
    logger.info(`📊 Total: ${results.length}\n`);
    
    if (successCount > 0) {
      logger.info('✅ Successfully re-registered content:');
      results.filter(r => r.success).forEach(r => {
        logger.info(`   - Content ${r.contentId}: ${r.transactionHash}`);
      });
      logger.info('');
    }
    
    if (failureCount > 0) {
      logger.info('❌ Failed re-registrations:');
      results.filter(r => !r.success).forEach(r => {
        logger.info(`   - Content ${r.contentId}: ${r.error}`);
      });
      logger.info('');
    }
    
    logger.info('✅ Script completed successfully!\n');
    
  } catch (error) {
    logger.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      logger.info('🔌 Database connection closed');
    }
  }
}

// Run the script
main();

