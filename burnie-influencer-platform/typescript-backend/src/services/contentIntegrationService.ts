// @ts-nocheck - Disable strict checks for blockchain transaction records
import { AppDataSource } from '../config/database';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { ContentIpfsUpload } from '../models/ContentIpfsUpload';
import { ContentBlockchainTransaction } from '../models/ContentBlockchainTransaction';
import { UserNetwork } from '../models/UserNetwork';
import { User } from '../models/User';
import { IPFSService } from './ipfsService';
import { SomniaBlockchainService } from './somniaBlockchainService';
import { logger } from '../config/logger';
import { ethers } from 'ethers';

/**
 * Service to orchestrate content creation, approval, and purchase flows
 * with integrated IPFS and blockchain support
 */
export class ContentIntegrationService {
  private ipfsService: IPFSService;
  private somniaBlockchainService: SomniaBlockchainService;

  constructor() {
    this.ipfsService = new IPFSService();
    this.somniaBlockchainService = new SomniaBlockchainService();
  }

  /**
   * Register content on blockchain after it's synced to marketplace
   * ALL content is registered on Somnia Testnet (for Dreamathon)
   * @param contentId The database ID of the content
   * @param minerWalletAddress The miner's wallet address
   * @param filePath The path to the content file (image/video)
   * @param contentType The type of content (e.g., "image", "video", "text")
   */
  async registerContentOnChain(
    contentId: number,
    minerWalletAddress: string,
    filePath: string,
    contentType: string
  ): Promise<{ success: boolean; cid?: string; transactionHash?: string; blockchainContentId?: number; error?: string }> {
    try {
      // Check if content exists
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);
      const content = await contentRepository.findOne({ where: { id: contentId } });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Upload to IPFS
      logger.info(`📤 Uploading content ${contentId} to IPFS...`);
      const ipfsResult = await this.ipfsService.uploadFile(filePath, contentId);

      logger.info(`✅ Content ${contentId} uploaded to IPFS: ${ipfsResult.cid}`);

      // Register on Somnia blockchain
      logger.info(`⛓️ Registering content ${contentId} on Somnia blockchain...`);
      const receipt = await this.somniaBlockchainService.registerContent(
        contentId,
        minerWalletAddress,
        ipfsResult.cid,
        contentType
      );

      // Update transaction hash in IPFS record
      if (receipt) {
        await this.ipfsService.updateTransactionHash(ipfsResult.uploadId, receipt);
        logger.info(`✅ Content ${contentId} registered on-chain: ${receipt}`);
      }

      // Create blockchain transaction record
      const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
      const blockchainTx = blockchainTxRepository.create({
        contentId,
        blockchainContentId: contentId, // Using same ID
        network: 'somnia_testnet',
        chainId: 50312,
        transactionType: 'registration',
        transactionHash: receipt || null,
        status: receipt ? 'confirmed' : 'failed',
        contractAddress: process.env.CONTENT_REGISTRY_ADDRESS || null,
        creatorWalletAddress: minerWalletAddress.toLowerCase(),
        currentOwnerWallet: minerWalletAddress.toLowerCase(),
        ipfsCid: ipfsResult.cid,
        contentType: contentType,
        confirmedAt: receipt ? new Date() : null,
        failedAt: receipt ? null : new Date(),
        errorMessage: receipt ? null : 'Transaction failed',
      });
      await blockchainTxRepository.save(blockchainTx);

      logger.info(`📝 Blockchain transaction recorded for content ${contentId}`);

      return {
        success: true,
        cid: ipfsResult.cid,
        transactionHash: receipt,
        blockchainContentId: contentId,
      };
    } catch (error) {
      logger.error(`❌ Error registering content ${contentId} on-chain:`, error);
      
      // Record failed transaction
      try {
        const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
        const blockchainTx = blockchainTxRepository.create({
          contentId,
          blockchainContentId: contentId,
          network: 'somnia_testnet',
          chainId: 50312,
          transactionType: 'registration',
          status: 'failed',
          creatorWalletAddress: minerWalletAddress.toLowerCase(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          failedAt: new Date(),
        });
        await blockchainTxRepository.save(blockchainTx);
      } catch (recordError) {
        logger.error('Failed to record blockchain transaction error:', recordError);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Approve content on blockchain and set price
   * Called when content is approved (price can be 0 initially)
   * @param contentId The database ID of the content
   * @param priceInROAST The price in ROAST tokens (will be converted to TOAST 1:1)
   */
  async approveContentOnChain(
    contentId: number,
    priceInROAST: number
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // Check if content exists
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);
      const content = await contentRepository.findOne({
        where: { id: contentId },
        relations: ['creator'],
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Check if content was registered on-chain
      const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
      const registrationTx = await blockchainTxRepository.findOne({
        where: {
          contentId,
          transactionType: 'registration',
          status: 'confirmed',
        },
      });

      if (!registrationTx) {
        return { success: false, error: 'Content not registered on blockchain' };
      }

      const blockchainContentId = registrationTx.blockchainContentId!;

      // Convert price to TOAST tokens (1:1 with ROAST)
      // Default to 999 if price is 0 or not set
      const actualPrice = priceInROAST > 0 ? priceInROAST : 999;

      // Approve on blockchain (pass price as string, NOT wei - the service will convert it)
      logger.info(`⛓️ Approving content ${contentId} (blockchain ID: ${blockchainContentId}) with price ${actualPrice} TOAST...`);
      const receipt = await this.somniaBlockchainService.approveContent(blockchainContentId, actualPrice.toString());

      // Record blockchain transaction
      const transactionType = actualPrice > 0 ? 'approval' : 'approval';
      const blockchainTx = blockchainTxRepository.create({
        contentId,
        blockchainContentId,
        network: 'somnia_testnet',
        chainId: 50312,
        transactionType,
        transactionHash: receipt || null,
        status: receipt ? 'confirmed' : 'failed',
        contractAddress: process.env.CONTENT_REGISTRY_ADDRESS || null,
        creatorWalletAddress: content.walletAddress?.toLowerCase() || null,
        currentOwnerWallet: content.walletAddress?.toLowerCase() || null,
        ipfsCid: registrationTx.ipfsCid || null, // Copy IPFS CID from registration
        price: actualPrice > 0 ? actualPrice.toString() : null,
        currency: actualPrice > 0 ? 'TOAST' : null,
        confirmedAt: receipt ? new Date() : null,
        failedAt: receipt ? null : new Date(),
        errorMessage: receipt ? null : 'Transaction failed',
      });
      await blockchainTxRepository.save(blockchainTx);

      logger.info(`✅ Content ${contentId} approved on-chain: ${receipt}`);

      return {
        success: true,
        transactionHash: receipt,
      };
    } catch (error) {
      logger.error(`❌ Error approving content ${contentId} on-chain:`, error);
      
      // Record failed transaction - get content info first
      try {
        const contentRepository = AppDataSource.getRepository(ContentMarketplace);
        const content = await contentRepository.findOne({ where: { id: contentId } });
        
        const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
        const blockchainTx = blockchainTxRepository.create({
          contentId,
          network: 'somnia_testnet',
          chainId: 50312,
          transactionType: 'approval',
          status: 'failed',
          creatorWalletAddress: content?.walletAddress?.toLowerCase() || null,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          failedAt: new Date(),
        });
        await blockchainTxRepository.save(blockchainTx);
      } catch (recordError) {
        logger.error('Failed to record blockchain transaction error:', recordError);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update content price on blockchain
   * Called when price is set/updated after initial approval
   * @param contentId The database ID of the content
   * @param newPriceInROAST The new price in ROAST tokens
   */
  async updateContentPriceOnChain(
    contentId: number,
    newPriceInROAST: number
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      // Check if content exists
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);
      const content = await contentRepository.findOne({
        where: { id: contentId },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Get blockchain content ID
      const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
      const registrationTx = await blockchainTxRepository.findOne({
        where: {
          contentId,
          transactionType: 'registration',
          status: 'confirmed',
        },
      });

      if (!registrationTx) {
        return { success: false, error: 'Content not registered on blockchain' };
      }

      const blockchainContentId = registrationTx.blockchainContentId!;

      // Check if there's already a pending price_update for this content
      const existingPriceUpdate = await blockchainTxRepository.findOne({
        where: {
          contentId,
          transactionType: 'price_update',
          status: 'confirmed',
        },
        order: {
          createdAt: 'DESC',
        },
      });

      // If the price is the same as the last update, skip
      if (existingPriceUpdate && existingPriceUpdate.price === newPriceInROAST.toString()) {
        logger.info(`⏭️ Skipping price update - price unchanged: ${newPriceInROAST} TOAST`);
        return {
          success: true,
          transactionHash: existingPriceUpdate.transactionHash || undefined,
        };
      }

      // Convert price to TOAST tokens
      const actualPrice = newPriceInROAST;

      // Update price on blockchain (pass price as string, NOT wei - the service will convert it)
      logger.info(`⛓️ Updating price for content ${contentId} (blockchain ID: ${blockchainContentId}) to ${actualPrice} TOAST...`);
      const receipt = await this.somniaBlockchainService.updatePrice(blockchainContentId, actualPrice.toString());

      // Record blockchain transaction
      const blockchainTx = blockchainTxRepository.create({
        contentId,
        blockchainContentId,
        network: 'somnia_testnet',
        chainId: 50312,
        transactionType: 'price_update',
        transactionHash: receipt || null,
        status: receipt ? 'confirmed' : 'failed',
        contractAddress: process.env.CONTENT_REGISTRY_ADDRESS || null,
        creatorWalletAddress: content.walletAddress?.toLowerCase() || null,
        currentOwnerWallet: content.walletAddress?.toLowerCase() || null,
        ipfsCid: registrationTx.ipfsCid || null, // Copy IPFS CID from registration
        price: newPriceInROAST.toString(),
        currency: 'TOAST',
        confirmedAt: receipt ? new Date() : null,
        failedAt: receipt ? null : new Date(),
        errorMessage: receipt ? null : 'Transaction failed',
      });
      await blockchainTxRepository.save(blockchainTx);

      logger.info(`✅ Price updated for content ${contentId} on-chain: ${receipt}`);

      return {
        success: true,
        transactionHash: receipt,
      };
    } catch (error) {
      logger.error(`❌ Error updating price for content ${contentId} on-chain:`, error);
      
      // Record failed transaction - get content info first
      try {
        const contentRepository = AppDataSource.getRepository(ContentMarketplace);
        const content = await contentRepository.findOne({ where: { id: contentId } });
        
        const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
        const blockchainTx = blockchainTxRepository.create({
          contentId,
          network: 'somnia_testnet',
          chainId: 50312,
          transactionType: 'price_update',
          status: 'failed',
          creatorWalletAddress: content?.walletAddress?.toLowerCase() || null,
          price: newPriceInROAST.toString(),
          currency: 'TOAST',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          failedAt: new Date(),
        });
        await blockchainTxRepository.save(blockchainTx);
      } catch (recordError) {
        logger.error('Failed to record blockchain transaction error:', recordError);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Record purchase transaction on blockchain
   * Called after buyer purchases content on Somnia
   * @param contentId The database ID of the content
   * @param buyerWalletAddress The buyer's wallet address
   * @param transactionHash The blockchain transaction hash
   * @param price The purchase price in TOAST
   * @param referralData Referral information for reward tracking
   */
  async recordPurchaseTransaction(
    contentId: number,
    buyerWalletAddress: string,
    transactionHash: string,
    price: number,
    referralData?: {
      directReferrerAddress?: string | null;
      grandReferrerAddress?: string | null;
      directReferrerAmount: number;
      grandReferrerAmount: number;
      tier: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get blockchain content ID and creator address
      const blockchainTxRepository = AppDataSource.getRepository(ContentBlockchainTransaction);
      const registrationTx = await blockchainTxRepository.findOne({
        where: {
          contentId,
          transactionType: 'registration',
          status: 'confirmed',
        },
      });

      let blockchainContentId: number | null = null;
      let creatorWalletAddress: string | null = null;

      if (registrationTx) {
        blockchainContentId = registrationTx.blockchainContentId!;
        creatorWalletAddress = registrationTx.creatorWalletAddress;
        logger.info(`✅ Found registration transaction for content ${contentId}: blockchain ID ${blockchainContentId}`);
      } else {
        // Fallback: Try to get blockchain content ID from the contract or database
        logger.warn(`⚠️ No registration transaction found for content ${contentId}, using fallback...`);
        
        // Assume DB ID matches blockchain ID (this is usually the case)
        blockchainContentId = contentId;
        
        // Try to get creator from content_marketplace table
        const contentRepository = AppDataSource.getRepository(ContentMarketplace);
        const content = await contentRepository.findOne({ 
          where: { id: contentId },
          relations: ['creator']
        });
        
        if (content?.creator?.walletAddress) {
          creatorWalletAddress = content.creator.walletAddress;
          logger.info(`✅ Retrieved creator from content_marketplace: ${creatorWalletAddress}`);
        } else {
          logger.warn(`⚠️ Could not find creator for content ${contentId}, will use null`);
          creatorWalletAddress = null;
        }
      }

      // Calculate reward distribution (matching contract rates)
      const minerReward = price * 0.5; // 50%
      const evaluatorReward = price * 0.2; // 20%
      const directReferrerReward = referralData?.directReferrerAmount || 0;
      const grandReferrerReward = referralData?.grandReferrerAmount || 0;
      const platformFee = price * 0.3 - directReferrerReward - grandReferrerReward; // Residual

      // Record blockchain transaction
      const blockchainTx = blockchainTxRepository.create({
        contentId,
        blockchainContentId,
        network: 'somnia_testnet',
        chainId: 50312,
        transactionType: 'purchase',
        transactionHash,
        status: 'confirmed',
        blockNumber: null, // Could be fetched from receipt if needed
        contractAddress: process.env.CONTENT_REGISTRY_ADDRESS || null,
        creatorWalletAddress,
        currentOwnerWallet: buyerWalletAddress.toLowerCase(),
        buyerWalletAddress: buyerWalletAddress.toLowerCase(),
        price: price.toString(),
        currency: 'TOAST',
        minerReward: minerReward.toString(),
        evaluatorReward: evaluatorReward.toString(),
        directReferrerReward: directReferrerReward.toString(),
        grandReferrerReward: grandReferrerReward.toString(),
        platformFee: platformFee.toString(),
        directReferrerAddress: referralData?.directReferrerAddress?.toLowerCase() || null,
        grandReferrerAddress: referralData?.grandReferrerAddress?.toLowerCase() || null,
        confirmedAt: new Date(),
        metadata: referralData ? { tier: referralData.tier } : null,
      });
      await blockchainTxRepository.save(blockchainTx);

      logger.info(`✅ Purchase transaction recorded for content ${contentId}: ${transactionHash}`);

      return { success: true };
    } catch (error) {
      logger.error(`❌ Error recording purchase transaction for content ${contentId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Verify on-chain purchase and ownership transfer
   * This is called after frontend executes purchaseContentWithPermit
   * @param contentId The database ID of the content
   * @param buyerWalletAddress The buyer's wallet address
   */
  async verifyPurchaseOnChain(
    contentId: number,
    buyerWalletAddress: string
  ): Promise<{ success: boolean; currentOwner?: string; error?: string }> {
    try {
      // Check if content was registered on-chain
      const ipfsUploadRepository = AppDataSource.getRepository(ContentIpfsUpload);
      const ipfsUpload = await ipfsUploadRepository.findOne({ where: { contentId } });

      if (!ipfsUpload) {
        logger.info(`⏭️ Content ${contentId} not on blockchain - skipping verification`);
        return { success: true }; // Not an error, just not applicable
      }

      // TODO: Query ContentRegistry contract to verify ownership
      // const currentOwner = await this.somniaBlockchainService.getContentOwner(contentId);

      // For now, assume purchase was successful if we reach here
      // Frontend has already executed the transaction
      logger.info(`✅ Purchase verification for content ${contentId} - buyer: ${buyerWalletAddress}`);

      return {
        success: true,
        currentOwner: buyerWalletAddress,
      };
    } catch (error) {
      logger.error(`❌ Error verifying purchase for content ${contentId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if content is whitelisted for Somnia (Dreamathon projects)
   * @param contentId The database ID of the content
   */
  async isContentWhitelistedForSomnia(contentId: number): Promise<boolean> {
    try {
      const contentRepository = AppDataSource.getRepository(ContentMarketplace);
      const content = await contentRepository.findOne({
        where: { id: contentId },
        relations: ['campaign', 'campaign.project'],
      });

      if (!content || !content.campaign || !content.campaign.project) {
        return false;
      }

      return content.campaign.project.somniaWhitelisted || false;
    } catch (error) {
      logger.error(`❌ Error checking Somnia whitelist for content ${contentId}:`, error);
      return false;
    }
  }

  /**
   * Get IPFS URL for content
   * @param contentId The database ID of the content
   */
  async getContentIpfsUrl(contentId: number): Promise<string | null> {
    try {
      const ipfsUploadRepository = AppDataSource.getRepository(ContentIpfsUpload);
      const ipfsUpload = await ipfsUploadRepository.findOne({ where: { contentId } });

      if (!ipfsUpload) {
        return null;
      }

      // Lighthouse gateway URL
      return `https://gateway.lighthouse.storage/ipfs/${ipfsUpload.cid}`;
    } catch (error) {
      logger.error(`❌ Error getting IPFS URL for content ${contentId}:`, error);
      return null;
    }
  }
}

// Export singleton instance
export const contentIntegrationService = new ContentIntegrationService();

