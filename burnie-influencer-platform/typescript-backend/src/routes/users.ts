import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import { logger } from '../config/logger';

const router = Router();

/**
 * @route GET /api/users/profile/:walletAddress
 * @desc Get user profile by wallet address
 */
router.get('/profile/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ 
      where: { walletAddress: walletAddress.toLowerCase() } 
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        walletAddress: user.walletAddress,
        email: user.email,
        roleType: user.roleType,
        reputationScore: user.reputationScore,
        isVerified: user.isVerified,
        profile: user.profile
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching user profile:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile'
    });
  }
});

export default router;
