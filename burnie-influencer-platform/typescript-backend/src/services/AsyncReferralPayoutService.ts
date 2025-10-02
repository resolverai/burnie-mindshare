import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { ContentPurchase } from '../models/ContentPurchase';
import { UserReferral } from '../models/UserReferral';
import { ReferralPayout, PayoutType, PayoutStatus } from '../models/ReferralPayout';
import { ReferralCode } from '../models/ReferralCode';
import { User } from '../models/User';
import { TreasuryService } from './TreasuryService';

export class AsyncReferralPayoutService {
  
  /**
   * Queue referral payouts for asynchronous processing
   * This method is called immediately after purchase confirmation
   * but doesn't block the main purchase flow
   */
  static async queueReferralPayouts(purchaseId: number): Promise<void> {
    try {
      logger.info(`🎯 Queuing referral payouts for purchase ${purchaseId}...`);
      
      // Mark the purchase as having referral payouts queued
      const contentPurchaseRepository = AppDataSource.getRepository(ContentPurchase);
      const purchase = await contentPurchaseRepository.findOne({
        where: { id: purchaseId }
      });

      if (!purchase) {
        logger.error(`❌ Purchase ${purchaseId} not found for referral payout queuing`);
        return;
      }

      // Set referral payout status to queued
      purchase.referralPayoutStatus = 'queued';
      await contentPurchaseRepository.save(purchase);

      // Process referral payouts asynchronously (non-blocking)
      this.processReferralPayoutsAsync(purchaseId).catch(error => {
        logger.error(`❌ Async referral payout processing failed for purchase ${purchaseId}:`, error);
        
        // Update purchase status to failed
        purchase.referralPayoutStatus = 'failed';
        contentPurchaseRepository.save(purchase).catch(saveError => {
          logger.error(`❌ Failed to update purchase referral status:`, saveError);
        });
      });

      logger.info(`✅ Referral payouts queued for purchase ${purchaseId}`);
      
    } catch (error) {
      logger.error(`❌ Error queuing referral payouts for purchase ${purchaseId}:`, error);
    }
  }

  /**
   * Process referral payouts asynchronously
   * This runs in the background and doesn't affect the main purchase flow
   */
  private static async processReferralPayoutsAsync(purchaseId: number): Promise<void> {
    const contentPurchaseRepository = AppDataSource.getRepository(ContentPurchase);
    const userReferralRepository = AppDataSource.getRepository(UserReferral);
    const referralPayoutRepository = AppDataSource.getRepository(ReferralPayout);
    const userRepository = AppDataSource.getRepository(User);

    try {
      logger.info(`🔄 Processing async referral payouts for purchase ${purchaseId}...`);

      // Get the purchase
      const purchase = await contentPurchaseRepository.findOne({
        where: { id: purchaseId },
        relations: ['buyer']
      });

      if (!purchase) {
        throw new Error('Purchase not found');
      }

      // Skip referral payouts for free content (0 price)
      const isFreeContent = purchase.purchasePrice === 0;
      const isSyntheticTxHash = purchase.transactionHash && purchase.transactionHash.startsWith('FREE_CONTENT_');
      
      if (isFreeContent || isSyntheticTxHash) {
        logger.info(`🆓 Skipping referral payouts for FREE CONTENT - Purchase ${purchaseId}, Price: ${purchase.purchasePrice}, TX: ${purchase.transactionHash}`);
        purchase.referralPayoutStatus = 'not_applicable';
        await contentPurchaseRepository.save(purchase);
        return;
      }

      // Get buyer's referral information
      const buyer = await userRepository.findOne({
        where: { walletAddress: purchase.buyerWalletAddress }
      });

      if (!buyer || !buyer.referralCode) {
        logger.info(`👤 No referral code for buyer ${purchase.buyerWalletAddress}, skipping referral payouts`);
        purchase.referralPayoutStatus = 'not_applicable';
        await contentPurchaseRepository.save(purchase);
        return;
      }

      // Get user referral record
      const userReferral = await userReferralRepository.findOne({
        where: { userId: buyer.id },
        relations: ['referralCode', 'directReferrer', 'grandReferrer']
      });

      if (!userReferral) {
        logger.warn(`⚠️ No referral record found for user ${buyer.id}`);
        purchase.referralPayoutStatus = 'not_applicable';
        await contentPurchaseRepository.save(purchase);
        return;
      }

      // Validate referral code leader exists
      const leaderUser = await userRepository.findOne({
        where: { walletAddress: userReferral.referralCode.leaderWalletAddress }
      });

      if (!leaderUser) {
        logger.warn(`⚠️ Referral code leader not found: ${userReferral.referralCode.leaderWalletAddress}`);
        purchase.referralPayoutStatus = 'not_applicable';
        await contentPurchaseRepository.save(purchase);
        return;
      }

      // Calculate payout amounts
      const payoutAmounts = this.calculatePayoutAmounts(purchase, userReferral.referralCode);

      let directReferrerPayout = 0;
      let grandReferrerPayout = 0;

      // Process direct referrer payout
      if (userReferral.directReferrer && payoutAmounts.directReferrerAmount >= 10) {
        const directPayout = await this.createPayout(
          userReferral,
          purchase,
          PayoutType.DIRECT_REFERRER,
          userReferral.directReferrer.walletAddress,
          payoutAmounts.directReferrerAmount,
          userReferral.referralCode.getCommissionRate()
        );

        if (directPayout) {
          directReferrerPayout = payoutAmounts.directReferrerAmount;
          purchase.directReferrerPayout = directReferrerPayout;
          
          // Execute blockchain transaction for direct referrer
          const txHash = await this.executePayment(
            userReferral.directReferrer.walletAddress,
            payoutAmounts.directReferrerAmount
          );
          
          if (txHash) {
            directPayout.transactionHash = txHash;
            directPayout.status = PayoutStatus.PAID;
            directPayout.paidAt = new Date();
            purchase.directReferrerTxHash = txHash;
            
            // Update referrer's total earnings
            userReferral.directReferrer.totalReferralEarnings = 
              Number(userReferral.directReferrer.totalReferralEarnings) + directReferrerPayout;
            await userRepository.save(userReferral.directReferrer);
          } else {
            directPayout.status = PayoutStatus.FAILED;
            directPayout.errorMessage = 'Blockchain transaction failed';
          }

          await referralPayoutRepository.save(directPayout);
        }
      }

      // Process grand referrer payout
      if (userReferral.grandReferrer && payoutAmounts.grandReferrerAmount >= 10) {
        const grandPayout = await this.createPayout(
          userReferral,
          purchase,
          PayoutType.GRAND_REFERRER,
          userReferral.grandReferrer.walletAddress,
          payoutAmounts.grandReferrerAmount,
          userReferral.referralCode.getGrandReferrerRate()
        );

        if (grandPayout) {
          grandReferrerPayout = payoutAmounts.grandReferrerAmount;
          purchase.grandReferrerPayout = grandReferrerPayout;
          
          // Execute blockchain transaction for grand referrer
          const txHash = await this.executePayment(
            userReferral.grandReferrer.walletAddress,
            payoutAmounts.grandReferrerAmount
          );
          
          if (txHash) {
            grandPayout.transactionHash = txHash;
            grandPayout.status = PayoutStatus.PAID;
            grandPayout.paidAt = new Date();
            purchase.grandReferrerTxHash = txHash;
            
            // Update grand referrer's total earnings
            userReferral.grandReferrer.totalReferralEarnings = 
              Number(userReferral.grandReferrer.totalReferralEarnings) + grandReferrerPayout;
            await userRepository.save(userReferral.grandReferrer);
          } else {
            grandPayout.status = PayoutStatus.FAILED;
            grandPayout.errorMessage = 'Blockchain transaction failed';
          }

          await referralPayoutRepository.save(grandPayout);
        }
      }

      // Update purchase status
      if (directReferrerPayout > 0 || grandReferrerPayout > 0) {
        purchase.referralPayoutStatus = 'completed';
      } else {
        purchase.referralPayoutStatus = 'not_applicable';
      }
      
      await contentPurchaseRepository.save(purchase);

      // Update referral code metrics
      await this.updateReferralCodeMetrics(userReferral.referralCode, purchase);

      logger.info(`✅ Async referral payouts completed for purchase ${purchaseId}: Direct: ${directReferrerPayout} ROAST, Grand: ${grandReferrerPayout} ROAST`);

    } catch (error) {
      logger.error(`❌ Error processing async referral payouts for purchase ${purchaseId}:`, error);
      
      // Update purchase status to failed
      const purchase = await contentPurchaseRepository.findOne({
        where: { id: purchaseId }
      });
      
      if (purchase) {
        purchase.referralPayoutStatus = 'failed';
        await contentPurchaseRepository.save(purchase);
      }
      
      throw error;
    }
  }

  /**
   * Calculate payout amounts for direct and grand referrers
   * NEW: Based on full transaction value with proper currency conversion
   */
  private static calculatePayoutAmounts(purchase: ContentPurchase, referralCode: ReferralCode): {
    directReferrerAmount: number;
    grandReferrerAmount: number;
  } {
    let purchasePriceInRoast = 0;

    if (purchase.paymentCurrency === 'ROAST') {
      // For ROAST transactions: Use full purchase price
      purchasePriceInRoast = Number(purchase.purchasePrice);
    } else if (purchase.paymentCurrency === 'USDC') {
      // For USDC transactions: Convert full purchase price to ROAST
      purchasePriceInRoast = Number(purchase.purchasePrice) * Number(purchase.conversionRate);
    }

    const directReferrerAmount = purchasePriceInRoast * referralCode.getCommissionRate();
    const grandReferrerAmount = purchasePriceInRoast * referralCode.getGrandReferrerRate();

    return {
      directReferrerAmount: Math.floor(directReferrerAmount * 100) / 100, // Round down to 2 decimals
      grandReferrerAmount: Math.floor(grandReferrerAmount * 100) / 100
    };
  }

  /**
   * Create a referral payout record
   */
  private static async createPayout(
    userReferral: UserReferral,
    purchase: ContentPurchase,
    payoutType: PayoutType,
    walletAddress: string,
    amount: number,
    rate: number
  ): Promise<ReferralPayout | null> {
    try {
      const referralPayoutRepository = AppDataSource.getRepository(ReferralPayout);
      
      const payout = referralPayoutRepository.create({
        userReferralId: userReferral.id,
        contentPurchaseId: purchase.id,
        payoutWalletAddress: walletAddress.toLowerCase(),
        payoutType,
        roastAmount: amount,
        commissionRate: rate,
        status: PayoutStatus.PENDING
      });

      return await referralPayoutRepository.save(payout);
    } catch (error) {
      logger.error(`❌ Error creating referral payout:`, error);
      return null;
    }
  }

  /**
   * Execute blockchain payment for referral payout
   */
  private static async executePayment(walletAddress: string, amount: number): Promise<string | null> {
    try {
      // Use TreasuryService to execute the payment
      const treasuryService = new TreasuryService();
      const result = await treasuryService.distributeToMiner(walletAddress, amount);
      return result.transactionHash || null;
    } catch (error) {
      logger.error(`❌ Error executing referral payout payment:`, error);
      return null;
    }
  }

  /**
   * Update referral code metrics
   */
  private static async updateReferralCodeMetrics(referralCode: ReferralCode, purchase: ContentPurchase): Promise<void> {
    try {
      referralCode.totalVolumeGenerated = Number(referralCode.totalVolumeGenerated) + Number(purchase.purchasePrice);
      referralCode.currentUses = referralCode.currentUses + 1;
      
      await AppDataSource.getRepository(ReferralCode).save(referralCode);
    } catch (error) {
      logger.error(`❌ Error updating referral code metrics:`, error);
    }
  }

  /**
   * Manual referral payout processing endpoint
   * This can be called manually to process failed referral payouts
   */
  static async processFailedReferralPayouts(purchaseId: number): Promise<{
    success: boolean;
    message: string;
    directReferrerPayout?: number;
    grandReferrerPayout?: number;
  }> {
    try {
      logger.info(`🔧 Manually processing referral payouts for purchase ${purchaseId}...`);
      
      await this.processReferralPayoutsAsync(purchaseId);
      
      const contentPurchaseRepository = AppDataSource.getRepository(ContentPurchase);
      const purchase = await contentPurchaseRepository.findOne({
        where: { id: purchaseId }
      });

      if (!purchase) {
        return { success: false, message: 'Purchase not found' };
      }

      return {
        success: true,
        message: 'Referral payouts processed successfully',
        directReferrerPayout: purchase.directReferrerPayout || 0,
        grandReferrerPayout: purchase.grandReferrerPayout || 0
      };

    } catch (error) {
      logger.error(`❌ Error in manual referral payout processing:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get referral payout status for a purchase
   */
  static async getReferralPayoutStatus(purchaseId: number): Promise<{
    status: string;
    directReferrerPayout?: number;
    grandReferrerPayout?: number;
    directReferrerTxHash?: string;
    grandReferrerTxHash?: string;
  }> {
    const contentPurchaseRepository = AppDataSource.getRepository(ContentPurchase);
    const purchase = await contentPurchaseRepository.findOne({
      where: { id: purchaseId }
    });

    if (!purchase) {
      throw new Error('Purchase not found');
    }

    const result: {
      status: string;
      directReferrerPayout?: number;
      grandReferrerPayout?: number;
      directReferrerTxHash?: string;
      grandReferrerTxHash?: string;
    } = {
      status: purchase.referralPayoutStatus || 'not_applicable',
      directReferrerPayout: purchase.directReferrerPayout || 0,
      grandReferrerPayout: purchase.grandReferrerPayout || 0
    };

    if (purchase.directReferrerTxHash) {
      result.directReferrerTxHash = purchase.directReferrerTxHash;
    }

    if (purchase.grandReferrerTxHash) {
      result.grandReferrerTxHash = purchase.grandReferrerTxHash;
    }

    return result;
  }
}

export default AsyncReferralPayoutService;
