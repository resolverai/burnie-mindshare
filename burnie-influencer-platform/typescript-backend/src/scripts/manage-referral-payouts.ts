#!/usr/bin/env ts-node

/**
 * Referral Payout Management Script
 * 
 * This script provides utilities to manage referral payouts manually
 * Usage:
 *   npm run manage-referral-payouts -- --help
 *   npm run manage-referral-payouts -- --status <purchase-id>
 *   npm run manage-referral-payouts -- --process <purchase-id>
 *   npm run manage-referral-payouts -- --list-failed
 *   npm run manage-referral-payouts -- --process-all-failed
 */

import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import AsyncReferralPayoutService from '../services/AsyncReferralPayoutService';
import { ContentPurchase } from '../models/ContentPurchase';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    // Initialize database connection
    await AppDataSource.initialize();
    logger.info('✅ Database connection initialized');

    switch (command) {
      case '--help':
        showHelp();
        break;

      case '--status':
        const purchaseId = parseInt(args[1] || '0');
        if (!purchaseId) {
          console.error('❌ Purchase ID is required for --status command');
          process.exit(1);
        }
        await showReferralPayoutStatus(purchaseId);
        break;

      case '--process':
        const processPurchaseId = parseInt(args[1] || '0');
        if (!processPurchaseId) {
          console.error('❌ Purchase ID is required for --process command');
          process.exit(1);
        }
        await processReferralPayouts(processPurchaseId);
        break;

      case '--list-failed':
        await listFailedReferralPayouts();
        break;

      case '--process-all-failed':
        await processAllFailedReferralPayouts();
        break;

      default:
        console.error('❌ Unknown command. Use --help for usage information.');
        process.exit(1);
    }

  } catch (error) {
    logger.error('❌ Script execution failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      logger.info('✅ Database connection closed');
    }
  }
}

function showHelp() {
  console.log(`
📋 Referral Payout Management Script

Usage:
  npm run manage-referral-payouts -- <command> [options]

Commands:
  --help                    Show this help message
  --status <purchase-id>    Show referral payout status for a purchase
  --process <purchase-id>   Manually process referral payouts for a purchase
  --list-failed            List all purchases with failed referral payouts
  --process-all-failed     Process all failed referral payouts

Examples:
  npm run manage-referral-payouts -- --status 123
  npm run manage-referral-payouts -- --process 123
  npm run manage-referral-payouts -- --list-failed
  npm run manage-referral-payouts -- --process-all-failed
`);
}

async function showReferralPayoutStatus(purchaseId: number) {
  try {
    console.log(`🔍 Checking referral payout status for purchase ${purchaseId}...`);
    
    const status = await AsyncReferralPayoutService.getReferralPayoutStatus(purchaseId);
    
    console.log(`
📊 Referral Payout Status for Purchase ${purchaseId}:
  Status: ${status.status}
  Direct Referrer Payout: ${status.directReferrerPayout || 0} ROAST
  Grand Referrer Payout: ${status.grandReferrerPayout || 0} ROAST
  Direct Referrer TX Hash: ${status.directReferrerTxHash || 'N/A'}
  Grand Referrer TX Hash: ${status.grandReferrerTxHash || 'N/A'}
`);
  } catch (error) {
    console.error(`❌ Error getting referral payout status:`, error);
  }
}

async function processReferralPayouts(purchaseId: number) {
  try {
    console.log(`🔄 Processing referral payouts for purchase ${purchaseId}...`);
    
    const result = await AsyncReferralPayoutService.processFailedReferralPayouts(purchaseId);
    
    if (result.success) {
      console.log(`
✅ Referral payouts processed successfully for purchase ${purchaseId}:
  Direct Referrer Payout: ${result.directReferrerPayout || 0} ROAST
  Grand Referrer Payout: ${result.grandReferrerPayout || 0} ROAST
`);
    } else {
      console.error(`❌ Failed to process referral payouts: ${result.message}`);
    }
  } catch (error) {
    console.error(`❌ Error processing referral payouts:`, error);
  }
}

async function listFailedReferralPayouts() {
  try {
    console.log('🔍 Listing all purchases with failed referral payouts...');
    
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

    if (failedPurchases.length === 0) {
      console.log('✅ No failed referral payouts found.');
      return;
    }

    console.log(`
❌ Found ${failedPurchases.length} purchases with failed referral payouts:

${failedPurchases.map(purchase => `
  Purchase ID: ${purchase.id}
  Content ID: ${purchase.contentId}
  Buyer: ${purchase.buyerWalletAddress}
  Amount: ${purchase.purchasePrice} ${purchase.currency}
  Created: ${purchase.createdAt}
  Content: ${purchase.content?.campaign?.title || 'Unknown Content'}
`).join('')}

To process a specific purchase, run:
  npm run manage-referral-payouts -- --process <purchase-id>

To process all failed purchases, run:
  npm run manage-referral-payouts -- --process-all-failed
`);
  } catch (error) {
    console.error(`❌ Error listing failed referral payouts:`, error);
  }
}

async function processAllFailedReferralPayouts() {
  try {
    console.log('🔄 Processing all failed referral payouts...');
    
    const purchaseRepository = AppDataSource.getRepository(ContentPurchase);
    
    const failedPurchases = await purchaseRepository.find({
      where: {
        referralPayoutStatus: 'failed'
      },
      order: {
        createdAt: 'ASC'
      }
    });

    if (failedPurchases.length === 0) {
      console.log('✅ No failed referral payouts to process.');
      return;
    }

    console.log(`📋 Found ${failedPurchases.length} failed referral payouts to process...`);

    let successCount = 0;
    let failureCount = 0;

    for (const purchase of failedPurchases) {
      try {
        console.log(`🔄 Processing purchase ${purchase.id}...`);
        
        const result = await AsyncReferralPayoutService.processFailedReferralPayouts(purchase.id);
        
        if (result.success) {
          console.log(`✅ Purchase ${purchase.id} processed successfully`);
          successCount++;
        } else {
          console.log(`❌ Purchase ${purchase.id} failed: ${result.message}`);
          failureCount++;
        }
      } catch (error) {
        console.log(`❌ Purchase ${purchase.id} failed with error:`, error);
        failureCount++;
      }
    }

    console.log(`
📊 Processing Summary:
  Total: ${failedPurchases.length}
  Successful: ${successCount}
  Failed: ${failureCount}
`);
  } catch (error) {
    console.error(`❌ Error processing all failed referral payouts:`, error);
  }
}

// Run the script
main().catch(console.error);
