// @ts-nocheck
/**
 * Script to approve re-registered content on Somnia blockchain
 * 
 * This script:
 * 1. Finds content that has been registered but not approved on blockchain
 * 2. Approves each content on-chain with appropriate price
 * 3. Creates 'approval' transaction records in content_blockchain_transactions
 * 
 * Usage:
 *   npm run approve-reregistered-content
 *   npm run approve-reregistered-content -- --contentIds=8644,8716
 */

import 'reflect-metadata';
import { AppDataSource } from '../src/config/database';
import { ContentMarketplace } from '../src/models/ContentMarketplace';
import { ContentBlockchainTransaction } from '../src/models/ContentBlockchainTransaction';
import { ContentIntegrationService } from '../src/services/contentIntegrationService';
import { SomniaBlockchainService } from '../src/services/somniaBlockchainService';
import { logger } from '../src/config/logger';

interface ApprovalResult {
  contentId: number;
  success: boolean;
  transactionHash?: string;
  error?: string;
}

/**
 * Approve a single content on blockchain
 */
async function approveContent(
  content: ContentMarketplace,
  contentIntegrationService: ContentIntegrationService,
  somniaBlockchainService: SomniaBlockchainService
): Promise<ApprovalResult> {
  try {
    logger.info(`\n🔄 Approving content ${content.id}...`);
    
    // Check if content already has a confirmed approval in DB
    const txRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
    const confirmedApproval = await txRepository.findOne({
      where: {
        contentId: content.id,
        transactionType: 'approval',
        network: 'somnia_testnet',
        status: 'confirmed',
      },
    });
    
    if (confirmedApproval) {
      logger.info(`⏭️ Content ${content.id} already has a confirmed approval in DB (tx: ${confirmedApproval.transactionHash}), skipping...`);
      return {
        contentId: content.id,
        success: true,
        transactionHash: confirmedApproval.transactionHash || undefined,
        error: 'Already approved in DB (skipped)',
      };
    }
    
    // Check if content has a confirmed registration
    const confirmedRegistration = await txRepository.findOne({
      where: {
        contentId: content.id,
        transactionType: 'registration',
        network: 'somnia_testnet',
        status: 'confirmed',
      },
    });
    
    if (!confirmedRegistration) {
      logger.warn(`⚠️ Content ${content.id} has no confirmed registration, skipping approval...`);
      return {
        contentId: content.id,
        success: false,
        error: 'No confirmed registration found',
      };
    }
    
    // Check blockchain state BEFORE attempting approval
    try {
      logger.info(`🔍 Checking blockchain state for content ${content.id}...`);
      const blockchainContent = await somniaBlockchainService.getContent(content.id);
      
      if (blockchainContent.isApproved) {
        logger.info(`⏭️ Content ${content.id} is already approved on blockchain (isApproved=true), skipping...`);
        return {
          contentId: content.id,
          success: true,
          error: 'Already approved on blockchain (skipped)',
        };
      }
      
      logger.info(`✅ Content ${content.id} is registered but not yet approved (isApproved=false), proceeding...`);
    } catch (blockchainError) {
      // If we can't check blockchain state, log warning but continue
      logger.warn(`⚠️ Could not check blockchain state for content ${content.id}, will attempt approval anyway`);
    }
    
    // Ensure content has walletAddress set (required for approval)
    // Get it from the registration transaction if not set
    if (!content.walletAddress && confirmedRegistration.creatorWalletAddress) {
      logger.info(`📝 Setting wallet address for content ${content.id} from registration: ${confirmedRegistration.creatorWalletAddress}`);
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);
      content.walletAddress = confirmedRegistration.creatorWalletAddress;
      await contentRepository.save(content);
    }
    
    if (!content.walletAddress) {
      logger.error(`❌ Content ${content.id} has no wallet address and none found in registration transaction`);
      return {
        contentId: content.id,
        success: false,
        error: 'No wallet address found for content',
      };
    }
    
    // Determine price: use biddingAskPrice if available, otherwise default to 999
    // NEVER use askingPrice (which can be 100 or other low values)
    const priceInROAST = content.biddingAskPrice && content.biddingAskPrice > 0 
      ? content.biddingAskPrice 
      : 999;
    
    logger.info(`💰 Content ${content.id} price: ${priceInROAST} TOAST (${content.biddingAskPrice ? 'from biddingAskPrice' : 'default fixed price'})`);
    
    // Call the content integration service to approve on-chain
    const result = await contentIntegrationService.approveContentOnChain(
      content.id,
      priceInROAST
    );
    
    if (result.success) {
      logger.info(`✅ Content ${content.id} approved successfully!`);
      logger.info(`   Transaction Hash: ${result.transactionHash}`);
      
      return {
        contentId: content.id,
        success: true,
        transactionHash: result.transactionHash,
      };
    } else {
      logger.error(`❌ Content ${content.id} approval failed: ${result.error}`);
      return {
        contentId: content.id,
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as any).code : undefined;
    
    logger.error(`❌ Failed to approve content ${content.id}: ${errorMessage}`, {
      code: errorCode,
    });
    
    return {
      contentId: content.id,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Main function
 */
async function main() {
  try {
    logger.info('🚀 Starting content approval process...\n');
    logger.info('⚠️  IMPORTANT: Stop the TypeScript backend server before running this script to avoid nonce conflicts!\n');
    
    // Initialize database
    await AppDataSource.initialize();
    logger.info('✅ Database connected\n');
    
    // Initialize services
    const contentIntegrationService = new ContentIntegrationService();
    const somniaBlockchainService = new SomniaBlockchainService();
    
    // Get command line arguments
    const args = process.argv.slice(2);
    const contentIdsArg = args.find(arg => arg.startsWith('--contentIds='));
    
    let contentIds: number[] | null = null;
    if (contentIdsArg) {
      const idsString = contentIdsArg.split('=')[1];
      if (idsString) {
        contentIds = idsString.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
        logger.info(`🎯 Processing specific content IDs: ${contentIds.join(', ')}\n`);
      }
    }
    
    // Fetch content that needs approval
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const txRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
    
    // Find content that:
    // 1. Has a confirmed registration on Somnia
    // 2. Does NOT have a confirmed approval on Somnia
    const confirmedRegistrations = await txRepository.find({
      where: {
        transactionType: 'registration',
        network: 'somnia_testnet',
        status: 'confirmed',
      },
    });
    
    logger.info(`📊 Found ${confirmedRegistrations.length} confirmed registrations\n`);
    
    const contentIdsWithRegistration = confirmedRegistrations.map(tx => tx.contentId);
    
    // Filter to only those without confirmed approval
    const contentNeedingApproval: ContentMarketplace[] = [];
    
    for (const contentId of contentIdsWithRegistration) {
      // Skip if specific IDs provided and this isn't one of them
      if (contentIds && !contentIds.includes(contentId)) {
        continue;
      }
      
      const confirmedApproval = await txRepository.findOne({
        where: {
          contentId,
          transactionType: 'approval',
          network: 'somnia_testnet',
          status: 'confirmed',
        },
      });
      
      if (!confirmedApproval) {
        const content = await contentRepository.findOne({
          where: { id: contentId },
          relations: ['creator'],
        });
        
        if (content) {
          contentNeedingApproval.push(content);
        }
      }
    }
    
    if (contentNeedingApproval.length === 0) {
      logger.info('✅ No content needs approval. All registered content is already approved.\n');
      return;
    }
    
    logger.info(`📋 Found ${contentNeedingApproval.length} content items needing approval:\n`);
    contentNeedingApproval.forEach(content => {
      const price = content.biddingAskPrice && content.biddingAskPrice > 0 ? content.biddingAskPrice : 999;
      const priceSource = content.biddingAskPrice ? 'biddingAskPrice' : 'default';
      logger.info(`   - Content ID: ${content.id} | Price: ${price} TOAST (${priceSource})`);
    });
    logger.info('');
    
    // Process each content
    const results: ApprovalResult[] = [];
    
    for (const content of contentNeedingApproval) {
      const result = await approveContent(content, contentIntegrationService, somniaBlockchainService);
      results.push(result);
      
      // Add a delay between approvals to avoid nonce issues (increased to 5 seconds)
      if (content !== contentNeedingApproval[contentNeedingApproval.length - 1]) {
        logger.info('⏳ Waiting 5 seconds before next approval...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // Summary
    logger.info('\n' + '='.repeat(80));
    logger.info('📊 APPROVAL SUMMARY');
    logger.info('='.repeat(80));
    
    // Successful approvals (new transactions)
    const successful = results.filter(r => r.success && !r.error);
    
    // Skipped items (already approved in DB or on blockchain)
    const skipped = results.filter(r => r.success && r.error && 
      (r.error.includes('skipped') || r.error.includes('Already approved')));
    
    // Failed approvals (real errors)
    const failed = results.filter(r => !r.success);
    
    logger.info(`✅ Successfully approved: ${successful.length}`);
    if (successful.length > 0) {
      successful.forEach(r => {
        logger.info(`   - Content ${r.contentId}: ${r.transactionHash}`);
      });
    }
    
    logger.info(`⏭️ Skipped (already approved): ${skipped.length}`);
    if (skipped.length > 0) {
      skipped.forEach(r => {
        logger.info(`   - Content ${r.contentId}: ${r.error}`);
      });
    }
    
    logger.info(`❌ Failed: ${failed.length}`);
    if (failed.length > 0) {
      failed.forEach(r => {
        logger.info(`   - Content ${r.contentId}: ${r.error}`);
      });
    }
    
    logger.info('='.repeat(80) + '\n');
    
    logger.info('✅ Content approval process completed!\n');
    
  } catch (error) {
    logger.error('❌ Fatal error:', error);
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

