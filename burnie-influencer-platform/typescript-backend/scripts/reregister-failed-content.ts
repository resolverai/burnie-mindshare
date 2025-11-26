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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to extract S3 key from URL ${url}: ${errorMessage}`);
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as any).code || 'UNKNOWN';
    logger.error(`Failed to generate presigned URL for ${s3Key}: ${errorMessage} (Code: ${errorCode})`);
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
    // Extract safe error information without circular references
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as any).code || 'UNKNOWN';
    const errorStatus = (error as any).response?.status || 'N/A';
    
    logger.error(`Failed to download file for content ${contentId}: ${errorMessage} (Code: ${errorCode}, Status: ${errorStatus})`);
    throw new Error(`Download failed: ${errorMessage}`);
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
    
    // Check if content already has a confirmed registration
    const txRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
    const confirmedRegistration = await txRepository.findOne({
      where: {
        contentId: content.id,
        transactionType: 'registration',
        network: 'somnia_testnet',
        status: 'confirmed',
      },
    });
    
    if (confirmedRegistration) {
      logger.info(`⏭️ Content ${content.id} already has a confirmed registration (tx: ${confirmedRegistration.transactionHash}), skipping...`);
      return {
        contentId: content.id,
        success: true,
        transactionHash: confirmedRegistration.transactionHash || undefined,
        error: 'Already registered (skipped)',
      };
    }
    
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
    
    // Priority: videoUrl > contentImages (videos are the primary content if available)
    if (content.videoUrl) {
      fileUrl = content.videoUrl;
      logger.info(`📹 Using video for re-registration: ${fileUrl}`);
    } else if (content.contentImages && Array.isArray(content.contentImages) && content.contentImages.length > 0) {
      fileUrl = content.contentImages[0];
      logger.info(`🖼️ Using image for re-registration: ${fileUrl}`);
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
    
    // Upload to IPFS
    logger.info(`📤 Uploading content ${content.id} to IPFS...`);
    const ipfsResult = await contentIntegrationService['ipfsService'].uploadFile(tempFilePath, content.id);
    logger.info(`✅ Content ${content.id} uploaded to IPFS: ${ipfsResult.cid}`);
    
    // Register on blockchain
    logger.info(`⛓️ Registering content ${content.id} on Somnia blockchain...`);
    const receipt = await contentIntegrationService['somniaBlockchainService'].registerContent(
      content.id,
      creator.walletAddress,
      ipfsResult.cid,
      content.postType || 'thread'
    );
    
    if (!receipt) {
      return {
        contentId: content.id,
        success: false,
        error: 'Blockchain registration failed - no transaction hash returned',
      };
    }
    
    logger.info(`✅ Content ${content.id} registered successfully!`);
    logger.info(`   Transaction Hash: ${receipt}`);
    logger.info(`   IPFS CID: ${ipfsResult.cid}`);
    
    // Update transaction hash in IPFS record
    await contentIntegrationService['ipfsService'].updateTransactionHash(ipfsResult.uploadId, receipt);
    
    // Update the existing failed transaction record to mark it as confirmed
    if (failedTxRecord) {
      // Update the existing failed record
      failedTxRecord.status = 'confirmed';
      failedTxRecord.transactionHash = receipt;
      failedTxRecord.ipfsCid = ipfsResult.cid;
      failedTxRecord.blockchainContentId = content.id;
      failedTxRecord.contractAddress = process.env.CONTENT_REGISTRY_ADDRESS || null;
      failedTxRecord.currentOwnerWallet = creator.walletAddress.toLowerCase();
      failedTxRecord.contentType = content.postType || 'thread';
      failedTxRecord.confirmedAt = new Date();
      failedTxRecord.failedAt = null;
      failedTxRecord.errorMessage = null;
      
      await txRepository.save(failedTxRecord);
      logger.info(`✅ Updated existing transaction record (ID: ${failedTxRecord.id}) to confirmed status`);
    } else {
      // No existing failed record - create a new one (fallback scenario)
      logger.warn(`⚠️ No existing failed transaction record found, creating new confirmed record...`);
      const newTxRecord = txRepository.create({
        contentId: content.id,
        blockchainContentId: content.id,
        network: 'somnia_testnet',
        chainId: 50312,
        transactionType: 'registration',
        transactionHash: receipt,
        status: 'confirmed',
        contractAddress: process.env.CONTENT_REGISTRY_ADDRESS || null,
        creatorWalletAddress: creator.walletAddress.toLowerCase(),
        currentOwnerWallet: creator.walletAddress.toLowerCase(),
        ipfsCid: ipfsResult.cid,
        contentType: content.postType || 'thread',
        confirmedAt: new Date(),
      });
      await txRepository.save(newTxRecord);
    }
    
    return {
      contentId: content.id,
      success: true,
      transactionHash: receipt,
    };
    
  } catch (error) {
    // Extract safe error information without circular references
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`❌ Failed to re-register content ${content.id}: ${errorMessage}`);
    
    return {
      contentId: content.id,
      success: false,
      error: errorMessage,
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
    
    const newRegistrations = results.filter(r => r.success && r.error !== 'Already registered (skipped)');
    const skippedCount = results.filter(r => r.success && r.error === 'Already registered (skipped)').length;
    const failureCount = results.filter(r => !r.success).length;
    
    logger.info(`✅ Newly Registered: ${newRegistrations.length}`);
    logger.info(`⏭️ Skipped (Already Registered): ${skippedCount}`);
    logger.info(`❌ Failed: ${failureCount}`);
    logger.info(`📊 Total: ${results.length}\n`);
    
    if (newRegistrations.length > 0) {
      logger.info('✅ Newly registered content:');
      newRegistrations.forEach(r => {
        logger.info(`   - Content ${r.contentId}: ${r.transactionHash}`);
      });
      logger.info('');
    }
    
    if (skippedCount > 0) {
      logger.info('⏭️ Skipped content (already registered):');
      results.filter(r => r.success && r.error === 'Already registered (skipped)').forEach(r => {
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    logger.error(`❌ Script failed: ${errorMessage}`);
    if (errorStack) {
      logger.error(`Stack trace: ${errorStack}`);
    }
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

