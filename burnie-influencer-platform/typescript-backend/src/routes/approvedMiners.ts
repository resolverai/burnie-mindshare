import { Router } from 'express';
import { ILike } from 'typeorm';
import { AppDataSource } from '../config/database';
import { ApprovedMiner } from '../models/ApprovedMiner';
import { logger } from '../config/logger';

const router = Router();

/**
 * GET /api/admin/approved-miners
 * Get all approved miners
 */
router.get('/admin/approved-miners', async (req, res) => {
  try {
    const approvedMinerRepository = AppDataSource.getRepository(ApprovedMiner);
    
    const approvedMiners = await approvedMinerRepository.find({
      order: { approvedAt: 'DESC' }
    });

    return res.json({
      success: true,
      data: approvedMiners
    });

  } catch (error) {
    logger.error('❌ Error fetching approved miners:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch approved miners',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/approved-miners
 * Add a new approved miner
 */
router.post('/admin/approved-miners', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress || typeof walletAddress !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    // Normalize wallet address to lowercase
    const normalizedWalletAddress = ApprovedMiner.normalizeWalletAddress(walletAddress);

    // Validate wallet address format (basic Ethereum address validation)
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedWalletAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address format'
      });
    }

    const approvedMinerRepository = AppDataSource.getRepository(ApprovedMiner);

    // Check if miner is already approved
    const existingMiner = await approvedMinerRepository.findOne({
      where: { walletAddress: ILike(normalizedWalletAddress) }
    });

    if (existingMiner) {
      return res.status(409).json({
        success: false,
        message: 'Miner is already approved'
      });
    }

    // Create new approved miner
    const approvedMiner = approvedMinerRepository.create({
      walletAddress: normalizedWalletAddress,
      approvedAt: new Date()
    });

    const savedMiner = await approvedMinerRepository.save(approvedMiner);

    logger.info(`✅ Miner approved: ${normalizedWalletAddress}`);

    return res.status(201).json({
      success: true,
      data: savedMiner,
      message: 'Miner approved successfully'
    });

  } catch (error) {
    logger.error('❌ Error approving miner:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve miner',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/admin/approved-miners/:id
 * Revoke miner approval
 */
router.delete('/admin/approved-miners/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Miner ID is required'
      });
    }

    const approvedMinerRepository = AppDataSource.getRepository(ApprovedMiner);

    // Find the approved miner
    const approvedMiner = await approvedMinerRepository.findOne({
      where: { id }
    });

    if (!approvedMiner) {
      return res.status(404).json({
        success: false,
        message: 'Approved miner not found'
      });
    }

    // Remove the approved miner
    await approvedMinerRepository.remove(approvedMiner);

    logger.info(`✅ Miner approval revoked: ${approvedMiner.walletAddress}`);

    return res.json({
      success: true,
      message: 'Miner approval revoked successfully'
    });

  } catch (error) {
    logger.error('❌ Error revoking miner approval:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to revoke miner approval',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/miner-approval/:walletAddress
 * Check if a miner is approved for automated mining
 */
router.get('/miner-approval/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    // Normalize wallet address to lowercase
    const normalizedWalletAddress = ApprovedMiner.normalizeWalletAddress(walletAddress);

    const approvedMinerRepository = AppDataSource.getRepository(ApprovedMiner);

    // Check if miner is approved
    const approvedMiner = await approvedMinerRepository.findOne({
      where: { walletAddress: ILike(normalizedWalletAddress) }
    });

    return res.json({
      success: true,
      data: {
        isApproved: !!approvedMiner,
        approvedAt: approvedMiner?.approvedAt || null,
        walletAddress: normalizedWalletAddress
      }
    });

  } catch (error) {
    logger.error('❌ Error checking miner approval:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check miner approval',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
