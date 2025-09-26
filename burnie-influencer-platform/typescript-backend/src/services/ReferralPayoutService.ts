import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { ContentPurchase } from '../models/ContentPurchase';
import { UserReferral } from '../models/UserReferral';
import { ReferralPayout, PayoutType, PayoutStatus } from '../models/ReferralPayout';
import { ReferralCode } from '../models/ReferralCode';
import { User } from '../models/User';
import { TreasuryService } from './TreasuryService';

export class ReferralPayoutService {
  
  /**
   * Process referral payouts for a content purchase
   */
  static async processReferralPayouts(purchaseId: number): Promise<{
    success: boolean;
    directReferrerPayout?: number;
    grandReferrerPayout?: number;
    message: string;
  }> {
    try {
      const contentPurchaseRepository = AppDataSource.getRepository(ContentPurchase);
      const userReferralRepository = AppDataSource.getRepository(UserReferral);
      const referralPayoutRepository = AppDataSource.getRepository(ReferralPayout);
      const userRepository = AppDataSource.getRepository(User);

      // Get the purchase
      const purchase = await contentPurchaseRepository.findOne({
        where: { id: purchaseId },
        relations: ['buyer']
      });

      if (!purchase) {
        return { success: false, message: 'Purchase not found' };
      }

      // Get buyer's referral information
      const buyer = await userRepository.findOne({
        where: { walletAddress: purchase.buyerWalletAddress }
      });

      if (!buyer || !buyer.referralCode) {
        logger.info(`👤 No referral code for buyer ${purchase.buyerWalletAddress}, skipping referral payouts`);
        purchase.referralPayoutStatus = 'not_applicable';
        await contentPurchaseRepository.save(purchase);
        return { success: true, message: 'No referral code, payouts not applicable' };
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
        return { success: true, message: 'No referral record found' };
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

      logger.info(`✅ Processed referral payouts for purchase ${purchaseId}: Direct: ${directReferrerPayout} ROAST, Grand: ${grandReferrerPayout} ROAST`);

      return {
        success: true,
        directReferrerPayout,
        grandReferrerPayout,
        message: 'Referral payouts processed successfully'
      };

    } catch (error) {
      logger.error(`❌ Error processing referral payouts for purchase ${purchaseId}:`, error);
      return { success: false, message: 'Failed to process referral payouts' };
    }
  }

  /**
   * Calculate payout amounts based on purchase and referral code
   * NEW: Based on full transaction value instead of platform fee
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
        payoutWalletAddress: walletAddress,
        payoutType,
        roastAmount: amount,
        commissionRate: rate,
        status: PayoutStatus.PENDING
      });

      return await referralPayoutRepository.save(payout);
    } catch (error) {
      logger.error('❌ Error creating payout record:', error);
      return null;
    }
  }

  /**
   * Execute payment via treasury wallet
   * Integrates with the existing treasury wallet system
   */
  private static async executePayment(walletAddress: string, amount: number): Promise<string | null> {
    try {
      logger.info(`💰 Processing referral payment: ${amount} ROAST to ${walletAddress}`);
      
      // Use the existing treasury service for referral payouts
      const treasuryService = new TreasuryService();
      
      // Validate treasury has sufficient balance
      const hasSufficientBalance = await treasuryService.validateSufficientBalance(amount);
      if (!hasSufficientBalance) {
        logger.error('❌ Insufficient treasury balance for referral payout');
        return null;
      }
      
      // Execute the distribution using the same system as miner payouts
      const distributionResult = await treasuryService.distributeToMiner(walletAddress, amount);
      
      if (distributionResult.success && distributionResult.transactionHash) {
        logger.info(`✅ Referral payment sent: ${distributionResult.transactionHash}`);
        return distributionResult.transactionHash;
      } else {
        logger.error('❌ Treasury distribution failed for referral:', distributionResult.error);
        return null;
      }
    } catch (error) {
      logger.error('❌ Error executing referral payment:', error);
      return null;
    }
  }

  /**
   * Update referral code metrics
   */
  private static async updateReferralCodeMetrics(referralCode: ReferralCode, purchase: ContentPurchase): Promise<void> {
    try {
      const referralCodeRepository = AppDataSource.getRepository(ReferralCode);

      // Update volume and commission metrics
      referralCode.totalVolumeGenerated = Number(referralCode.totalVolumeGenerated) + Number(purchase.purchasePrice);
      
      const commissionAmount = this.calculatePayoutAmounts(purchase, referralCode);
      referralCode.totalCommissionsEarned = Number(referralCode.totalCommissionsEarned) + 
        commissionAmount.directReferrerAmount + commissionAmount.grandReferrerAmount;

      await referralCodeRepository.save(referralCode);
    } catch (error) {
      logger.error('❌ Error updating referral code metrics:', error);
    }
  }

  /**
   * Get pending payouts that meet minimum threshold
   */
  static async getPendingPayouts(): Promise<ReferralPayout[]> {
    try {
      const referralPayoutRepository = AppDataSource.getRepository(ReferralPayout);

      return await referralPayoutRepository.find({
        where: {
          status: PayoutStatus.PENDING,
          roastAmount: 10 // Minimum 10 ROAST threshold
        },
        relations: ['userReferral', 'contentPurchase']
      });
    } catch (error) {
      logger.error('❌ Error getting pending payouts:', error);
      return [];
    }
  }
}

export default ReferralPayoutService;
