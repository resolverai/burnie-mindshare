import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { AccountSocialMediaConnection } from '../models/AccountSocialMediaConnection';
import { logger } from '../config/logger';

const router = Router();

/**
 * @route   GET /api/web2-account-connections/:account_id
 * @desc    Get all social media connections for an account
 * @access  Private
 */
router.get('/:account_id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { account_id } = req.params;

    if (!account_id) {
      res.status(400).json({
        error: 'Account ID is required'
      });
      return;
    }

    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    
    const connections = await connectionRepo.find({
      where: {
        account_id: parseInt(account_id, 10)
      },
      order: {
        connected_at: 'DESC'
      }
    });

    res.json(connections);
  } catch (error) {
    logger.error('Error fetching connections:', error);
    res.status(500).json({
      error: 'Failed to fetch social media connections'
    });
  }
});

/**
 * @route   DELETE /api/web2-account-connections/:account_id/:platform
 * @desc    Delete a social media connection
 * @access  Private
 */
router.delete('/:account_id/:platform', async (req: Request, res: Response): Promise<void> => {
  try {
    const { account_id, platform } = req.params;

    if (!account_id || !platform) {
      res.status(400).json({
        error: 'Account ID and platform are required'
      });
      return;
    }

    const connectionRepo = AppDataSource.getRepository(AccountSocialMediaConnection);
    
    const connection = await connectionRepo.findOne({
      where: {
        account_id: parseInt(account_id, 10),
        platform: platform as 'twitter' | 'linkedin' | 'youtube' | 'instagram'
      }
    });

    if (!connection) {
      res.status(404).json({
        error: 'Connection not found'
      });
      return;
    }

    await connectionRepo.remove(connection);
    
    logger.info(`Deleted ${platform} connection for account ${account_id}`);

    res.json({
      success: true,
      message: `${platform} connection deleted successfully`
    });
  } catch (error) {
    logger.error('Error deleting connection:', error);
    res.status(500).json({
      error: 'Failed to delete social media connection'
    });
  }
});

export default router;

