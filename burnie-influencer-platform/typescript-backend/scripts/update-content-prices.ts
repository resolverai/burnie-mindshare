/**
 * Script to update content prices on Somnia Testnet
 * 
 * This script:
 * 1. Finds all content created after Nov 16, 2024 that meets criteria:
 *    - Registered on Somnia (has confirmed registration in content_blockchain_transactions)
 *    - isAvailable: true, isBiddable: true, approvalStatus: 'approved'
 * 2. Doubles the price if:
 *    a) biddingAskPrice is 999 -> update to 1998
 *    b) biddingAskPrice is 1999 -> double it
 *    c) Content is a video (is_video: true, video_url not null) -> double it
 * 3. Updates both content_marketplace table AND blockchain
 * 4. Handles cases where content doesn't exist on blockchain
 * 
 * Usage:
 * npm run update-prices
 * 
 * Or with specific content IDs:
 * npm run update-prices -- --contentIds=558,559,560
 */

import { AppDataSource } from '../src/config/database';
import { ContentMarketplace } from '../src/models/ContentMarketplace';
import { ContentBlockchainTransaction } from '../src/models/ContentBlockchainTransaction';
import { SomniaBlockchainService } from '../src/services/somniaBlockchainService';
import { logger } from '../src/config/logger';
import { MoreThan } from 'typeorm';

interface PriceUpdateResult {
  contentId: number;
  success: boolean;
  oldPrice: number;
  newPrice?: number;
  reason?: string;
  blockchainUpdated?: boolean;
  error?: string;
}

/**
 * Calculate new price based on conditions
 */
function calculateNewPrice(content: ContentMarketplace): { shouldUpdate: boolean; newPrice: number; reason: string } {
  const currentPrice = parseFloat(content.biddingAskPrice || '0');
  
  // Condition A: biddingAskPrice is 999
  if (currentPrice === 999) {
    return {
      shouldUpdate: true,
      newPrice: 1998,
      reason: 'Price was 999 TOAST',
    };
  }
  
  // Condition B: biddingAskPrice is 1999
  if (currentPrice === 1999) {
    return {
      shouldUpdate: true,
      newPrice: currentPrice * 2,
      reason: 'Price was 1999 TOAST',
    };
  }
  
  // Condition C removed: Do NOT update video prices
  
  return {
    shouldUpdate: false,
    newPrice: currentPrice,
    reason: 'Does not meet price update criteria',
  };
}

/**
 * Update price for a single piece of content
 */
async function updateContentPrice(
  content: ContentMarketplace,
  somniaBlockchainService: SomniaBlockchainService
): Promise<PriceUpdateResult> {
  try {
    logger.info(`\n🔄 Processing content ${content.id}...`);
    
    const oldPrice = parseFloat(content.biddingAskPrice || '0');
    
    // Calculate new price
    const { shouldUpdate, newPrice, reason } = calculateNewPrice(content);
    
    if (!shouldUpdate) {
      logger.info(`⏭️ Content ${content.id}: ${reason} (current: ${oldPrice} TOAST)`);
      return {
        contentId: content.id,
        success: true,
        oldPrice,
        reason: `Skipped - ${reason}`,
      };
    }
    
    logger.info(`💰 Content ${content.id}: Updating price ${oldPrice} -> ${newPrice} TOAST`);
    logger.info(`   Reason: ${reason}`);
    
    // Check if content has confirmed approval in database
    const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
    const approvalTx = await blockchainTxRepository.findOne({
      where: {
        contentId: content.id,
        transactionType: 'approval',
        network: 'somnia_testnet',
        status: 'confirmed',
      },
    });
    
    if (!approvalTx) {
      logger.warn(`⚠️ Content ${content.id} has no confirmed approval transaction in database - skipping blockchain update`);
      
      // Still update database
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);
      content.biddingAskPrice = newPrice.toString();
      await contentRepository.save(content);
      logger.info(`✅ Updated price in database only: ${oldPrice} -> ${newPrice} TOAST`);
      
      return {
        contentId: content.id,
        success: true,
        oldPrice,
        newPrice,
        reason: `${reason} - DB updated, blockchain skipped (not approved)`,
        blockchainUpdated: false,
      };
    }
    
    logger.info(`✅ Content ${content.id} has confirmed approval (tx: ${approvalTx.transactionHash})`);
    
    // Update database
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    content.biddingAskPrice = newPrice.toString();
    await contentRepository.save(content);
    logger.info(`✅ Updated price in database: ${oldPrice} -> ${newPrice} TOAST`);
    
    // Update blockchain (only if approved in database)
    let blockchainUpdated = false;
    
    try {
      logger.info(`⛓️ Updating price on blockchain for content ${content.id}...`);
      
      // Queue the price update transaction
      const txHash = await somniaBlockchainService.updatePrice(
        content.id,
        newPrice.toString()
      );
      
      logger.info(`✅ Price updated on blockchain: ${txHash}`);
      
      // Record the transaction
      const priceTx = blockchainTxRepository.create({
        contentId: content.id,
        blockchainContentId: content.id,
        network: 'somnia_testnet',
        chainId: 50312,
        transactionType: 'price_update',
        transactionHash: txHash,
        status: 'confirmed',
        contractAddress: process.env.CONTENT_REGISTRY_ADDRESS || null,
        confirmedAt: new Date(),
      });
      await blockchainTxRepository.save(priceTx);
      
      blockchainUpdated = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = (error as any).code || 'UNKNOWN';
      logger.error(`❌ Failed to update price on blockchain for content ${content.id}: ${errorMessage} (Code: ${errorCode})`);
      
      // Don't fail the entire operation if blockchain update fails
      // Database is already updated, which is the source of truth
      return {
        contentId: content.id,
        success: true,
        oldPrice,
        newPrice,
        reason: `${reason} - DB updated, blockchain failed: ${errorMessage}`,
        blockchainUpdated: false,
      };
    }
    
    return {
      contentId: content.id,
      success: true,
      oldPrice,
      newPrice,
      reason,
      blockchainUpdated,
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`❌ Failed to update price for content ${content.id}: ${errorMessage}`);
    
    return {
      contentId: content.id,
      success: false,
      oldPrice: parseFloat(content.biddingAskPrice || '0'),
      error: errorMessage,
    };
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    logger.info('🚀 Starting content price update script...\n');
    
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
    const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
    const somniaBlockchainService = new SomniaBlockchainService();
    
    // Define the date filter (November 16, 2024)
    const cutoffDate = new Date('2024-11-16T00:00:00.000Z');
    logger.info(`📅 Filtering content created after: ${cutoffDate.toISOString()}\n`);
    
    // Build query for eligible content
    let eligibleContent: ContentMarketplace[];
    
    if (specificContentIds.length > 0) {
      logger.info(`🔍 Searching for specific content IDs: ${specificContentIds.join(', ')}\n`);
      
      eligibleContent = await contentRepository
        .createQueryBuilder('content')
        .where('content.id IN (:...ids)', { ids: specificContentIds })
        .andWhere('content.createdAt > :cutoffDate', { cutoffDate })
        .andWhere('content.isAvailable = :isAvailable', { isAvailable: true })
        .andWhere('content.isBiddable = :isBiddable', { isBiddable: true })
        .andWhere('content.approvalStatus = :approvalStatus', { approvalStatus: 'approved' })
        .getMany();
    } else {
      logger.info('🔍 Searching for all eligible content...\n');
      
      eligibleContent = await contentRepository.find({
        where: {
          createdAt: MoreThan(cutoffDate),
          isAvailable: true,
          isBiddable: true,
          approvalStatus: 'approved',
        },
        order: {
          createdAt: 'DESC',
        },
      });
    }
    
    logger.info(`📊 Found ${eligibleContent.length} content items matching criteria\n`);
    
    if (eligibleContent.length === 0) {
      logger.info('✅ No content to process. Exiting.');
      return;
    }
    
    // Check registration status for each content (but don't filter out)
    const contentRegistrationStatus = new Map<number, boolean>();
    
    for (const content of eligibleContent) {
      const registrationTx = await blockchainTxRepository.findOne({
        where: {
          contentId: content.id,
          transactionType: 'registration',
          network: 'somnia_testnet',
          status: 'confirmed',
        },
      });
      
      contentRegistrationStatus.set(content.id, !!registrationTx);
    }
    
    const registeredCount = Array.from(contentRegistrationStatus.values()).filter(v => v).length;
    const unregisteredCount = eligibleContent.length - registeredCount;
    
    logger.info(`📋 Processing ${eligibleContent.length} content items...`);
    logger.info(`   ✅ Registered on Somnia: ${registeredCount}`);
    logger.info(`   ⚠️ Not registered on Somnia: ${unregisteredCount}\n`);
    
    const results: PriceUpdateResult[] = [];
    
    // Process each content
    for (let i = 0; i < eligibleContent.length; i++) {
      const content = eligibleContent[i];
      const isRegistered = contentRegistrationStatus.get(content.id) || false;
      
      if (!isRegistered) {
        logger.info(`\n[${i + 1}/${eligibleContent.length}] ⚠️ Content ${content.id} is NOT registered on Somnia Testnet`);
      }
      
      logger.info(`\n[${i + 1}/${eligibleContent.length}] Processing content ${content.id}...`);
      
      const result = await updateContentPrice(content, somniaBlockchainService);
      results.push(result);
      
      // Small delay between updates to avoid rate limiting
      if (i < eligibleContent.length - 1) {
        logger.info('⏳ Waiting 3 seconds before next update...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    // Print summary
    logger.info('\n' + '='.repeat(80));
    logger.info('📊 PRICE UPDATE SUMMARY');
    logger.info('='.repeat(80) + '\n');
    
    const updated = results.filter(r => r.success && r.newPrice && r.newPrice !== r.oldPrice);
    const blockchainUpdated = results.filter(r => r.blockchainUpdated === true);
    const skipped = results.filter(r => r.success && (!r.newPrice || r.newPrice === r.oldPrice));
    const failed = results.filter(r => !r.success);
    
    logger.info(`✅ Successfully Updated (DB): ${updated.length}`);
    logger.info(`⛓️ Successfully Updated (Blockchain): ${blockchainUpdated.length}`);
    logger.info(`⏭️ Skipped (No Change): ${skipped.length}`);
    logger.info(`❌ Failed: ${failed.length}`);
    logger.info(`📊 Total: ${results.length}\n`);
    
    if (updated.length > 0) {
      logger.info('✅ Updated content:');
      updated.forEach(r => {
        const blockchainStatus = r.blockchainUpdated ? '✅ Blockchain updated' : '⚠️ DB only';
        logger.info(`   - Content ${r.contentId}: ${r.oldPrice} -> ${r.newPrice} TOAST (${r.reason}) [${blockchainStatus}]`);
      });
      logger.info('');
    }
    
    if (skipped.length > 0) {
      logger.info('⏭️ Skipped content:');
      skipped.forEach(r => {
        logger.info(`   - Content ${r.contentId}: ${r.reason}`);
      });
      logger.info('');
    }
    
    if (failed.length > 0) {
      logger.info('❌ Failed updates:');
      failed.forEach(r => {
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

