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
  contentIntegrationService: ContentIntegrationService
): Promise<ApprovalResult> {
  try {
    logger.info(`\n🔄 Approving content ${content.id}...`);
    
    // Check if content already has a confirmed approval
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
      logger.info(`⏭️ Content ${content.id} already has a confirmed approval (tx: ${confirmedApproval.transactionHash}), skipping...`);
      return {
        contentId: content.id,
        success: true,
        transactionHash: confirmedApproval.transactionHash || undefined,
        error: 'Already approved (skipped)',
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
    
    // Always use 999 TOAST as the price for re-registered content
    const priceInROAST = 999;
    logger.info(`💰 Content ${content.id} price: ${priceInROAST} TOAST (fixed price for re-registered content)`);
    
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
    
    // Initialize database
    await AppDataSource.initialize();
    logger.info('✅ Database connected\n');
    
    // Initialize services
    const contentIntegrationService = new ContentIntegrationService();
    
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
      logger.info(`   - Content ID: ${content.id} | Price: 999 TOAST (fixed)`);
    });
    logger.info('');
    
    // Process each content
    const results: ApprovalResult[] = [];
    
    for (const content of contentNeedingApproval) {
      const result = await approveContent(content, contentIntegrationService);
      results.push(result);
      
      // Add a small delay between approvals to avoid nonce issues
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary
    logger.info('\n' + '='.repeat(80));
    logger.info('📊 APPROVAL SUMMARY');
    logger.info('='.repeat(80));
    
    const successful = results.filter(r => r.success && !r.error?.includes('skipped'));
    const skipped = results.filter(r => r.success && r.error?.includes('skipped'));
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
        logger.info(`   - Content ${r.contentId}: ${r.transactionHash || 'N/A'}`);
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

