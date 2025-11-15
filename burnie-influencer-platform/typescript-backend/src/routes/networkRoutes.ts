// @ts-nocheck - Disable strict checks for network operations
import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { UserNetwork } from '../models/UserNetwork';
import { User } from '../models/User';
import { airdropService } from '../services/airdropService';
import { logger } from '../config/logger';

const router = Router();

/**
 * Helper function to get or create user by wallet address
 */
async function getUserByWallet(walletAddress: string): Promise<User | null> {
  const userRepository = AppDataSource.getRepository(User);
  
  // Try to find user by wallet address
  let user = await userRepository.findOne({
    where: { walletAddress: walletAddress.toLowerCase() }
  });

  // If user doesn't exist, create one
  if (!user) {
    logger.info(`Creating new user for wallet: ${walletAddress}`);
    user = userRepository.create({
      walletAddress: walletAddress.toLowerCase(),
      username: `user_${walletAddress.slice(0, 8)}`,
    });
    await userRepository.save(user);
  }

  return user;
}

/**
 * Get user's current network
 * GET /api/network/current
 */
router.get('/current', async (req: Request, res: Response) => {
  try {
    // Get wallet address from Authorization header
    const walletAddress = req.headers.authorization?.replace('Bearer ', '');
    
    if (!walletAddress) {
      return res.status(401).json({ error: 'Wallet address required' });
    }

    // Get or create user
    const user = await getUserByWallet(walletAddress);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }

    const userNetworkRepo = AppDataSource.getRepository(UserNetwork);
    let userNetwork = await userNetworkRepo.findOne({ where: { userId: user.id } });

    // If no network selected, default to 'base'
    if (!userNetwork) {
      userNetwork = userNetworkRepo.create({
        userId: user.id,
        currentNetwork: 'base',
        pastNetwork: null,
      });
      await userNetworkRepo.save(userNetwork);
      logger.info(`✅ Created initial network record for user ${user.id} (wallet: ${walletAddress})`);
    }

    res.json({
      currentNetwork: userNetwork.currentNetwork,
      pastNetwork: userNetwork.pastNetwork,
      updatedAt: userNetwork.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to get current network:', error);
    res.status(500).json({ error: 'Failed to get network preference' });
  }
});

/**
 * Switch network
 * POST /api/network/switch
 * Body: { network: 'base' | 'somnia_testnet', walletAddress: string }
 */
router.post('/switch', async (req: Request, res: Response) => {
  try {
    // Get wallet address from body or Authorization header
    let walletAddress = req.body.walletAddress;
    
    if (!walletAddress) {
      walletAddress = req.headers.authorization?.replace('Bearer ', '');
    }
    
    if (!walletAddress) {
      return res.status(401).json({ error: 'Wallet address required' });
    }

    // Get or create user
    const user = await getUserByWallet(walletAddress);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }

    const { network } = req.body;

    // Validate network
    if (!['base', 'somnia_testnet'].includes(network)) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    const userNetworkRepo = AppDataSource.getRepository(UserNetwork);
    let userNetwork = await userNetworkRepo.findOne({ where: { userId: user.id } });

    let previousNetwork = null;
    let airdropResult = null;

    if (userNetwork) {
      // Update existing network
      previousNetwork = userNetwork.currentNetwork;
      userNetwork.pastNetwork = previousNetwork;
      userNetwork.currentNetwork = network;
      logger.info(`📝 Updating network for user ${user.id}: ${previousNetwork} → ${network}`);
    } else {
      // Create new network preference
      userNetwork = userNetworkRepo.create({
        userId: user.id,
        currentNetwork: network,
        pastNetwork: null,
      });
      logger.info(`✅ Creating network record for user ${user.id}: ${network}`);
    }

    await userNetworkRepo.save(userNetwork);

    // Process airdrop if switching to Somnia Testnet
    if (network === 'somnia_testnet' && walletAddress) {
      const hasReceived = await airdropService.hasReceivedAirdrop(user.id, walletAddress, network);
      
      if (!hasReceived) {
        logger.info(`🎁 Processing airdrop for user ${user.id} (${walletAddress}) on network switch`);
        airdropResult = await airdropService.processAirdrop(user.id, walletAddress, network);
      } else {
        logger.info(`⏭️ User ${user.id} (${walletAddress}) already received airdrop, skipping`);
      }
    }

    res.json({
      success: true,
      currentNetwork: userNetwork.currentNetwork,
      pastNetwork: userNetwork.pastNetwork,
      previousNetwork,
      airdrop: airdropResult,
    });
  } catch (error) {
    logger.error('Failed to switch network:', error);
    res.status(500).json({ error: 'Failed to switch network' });
  }
});

/**
 * Get airdrop status
 * GET /api/network/airdrop-status
 */
router.get('/airdrop-status', async (req: Request, res: Response) => {
  try {
    // Get wallet address from Authorization header
    const walletAddress = req.headers.authorization?.replace('Bearer ', '');
    
    if (!walletAddress) {
      return res.status(401).json({ error: 'Wallet address required' });
    }

    // Get or create user
    const user = await getUserByWallet(walletAddress);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }

    const hasReceived = await airdropService.hasReceivedAirdrop(user.id, walletAddress, 'somnia_testnet');
    const airdrops = await airdropService.getUserAirdrops(user.id);

    res.json({
      hasReceived,
      airdrops,
      airdropAmount: process.env.SOMNIA_AIRDROP_AMOUNT || '50000',
    });
  } catch (error) {
    logger.error('Failed to get airdrop status:', error);
    res.status(500).json({ error: 'Failed to get airdrop status' });
  }
});

/**
 * Claim airdrop manually
 * POST /api/network/claim-airdrop
 * Body: { walletAddress: string }
 */
router.post('/claim-airdrop', async (req: Request, res: Response) => {
  try {
    // Get wallet address from body or Authorization header
    let walletAddress = req.body.walletAddress;
    
    if (!walletAddress) {
      walletAddress = req.headers.authorization?.replace('Bearer ', '');
    }
    
    if (!walletAddress) {
      return res.status(401).json({ error: 'Wallet address required' });
    }

    // Get or create user
    const user = await getUserByWallet(walletAddress);
    if (!user) {
      return res.status(500).json({ error: 'Failed to get user' });
    }

    // Check current network
    const userNetworkRepo = AppDataSource.getRepository(UserNetwork);
    const userNetwork = await userNetworkRepo.findOne({ where: { userId: user.id } });

    if (!userNetwork || userNetwork.currentNetwork !== 'somnia_testnet') {
      return res.status(400).json({ error: 'Must be on Somnia Testnet to claim airdrop' });
    }

    // Process airdrop
    const result = await airdropService.processAirdrop(user.id, walletAddress, 'somnia_testnet');

    if (result.success) {
      res.json({
        success: true,
        transactionHash: result.transactionHash,
        amount: result.amount,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Failed to claim airdrop:', error);
    res.status(500).json({ error: 'Failed to claim airdrop' });
  }
});

/**
 * Get airdrop statistics (admin only)
 * GET /api/network/airdrop-stats
 */
router.get('/airdrop-stats', async (req: Request, res: Response) => {
  try {
    // TODO: Add admin authentication check
    const stats = await airdropService.getAirdropStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get airdrop stats:', error);
    res.status(500).json({ error: 'Failed to get airdrop stats' });
  }
});

export default router;

