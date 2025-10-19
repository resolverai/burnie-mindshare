import express, { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { AccountConfiguration } from '../models/AccountConfiguration';
import { logger } from '../config/logger';

const router = express.Router();

/**
 * GET /api/web2-account-configurations/:accountId
 * Get account configuration by account ID
 */
router.get('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const accountId = parseInt(req.params.accountId as string, 10);
    
    if (isNaN(accountId)) {
      res.status(400).json({ error: 'Invalid account ID' });
      return;
    }

    const configRepo = AppDataSource.getRepository(AccountConfiguration);
    let config = await configRepo.findOne({ where: { account_id: accountId } });

    // If no config exists, create default one
    if (!config) {
      logger.info(`Creating default configuration for account ${accountId}`);
      config = configRepo.create({
        account_id: accountId,
        image_model: 'seedream',
        video_model: 'kling',
        clip_duration: 5
      });
      await configRepo.save(config);
    }

    res.json(config);
  } catch (error) {
    logger.error('Error fetching account configuration:', error);
    res.status(500).json({ error: 'Failed to fetch account configuration' });
  }
});

/**
 * POST /api/web2-account-configurations/:accountId
 * Create account configuration
 */
router.post('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const accountId = parseInt(req.params.accountId as string, 10);
    
    if (isNaN(accountId)) {
      res.status(400).json({ error: 'Invalid account ID' });
      return;
    }

    const { image_model, video_model, clip_duration } = req.body;

    // Validate image model
    if (image_model && !['flux-pro-kontext', 'seedream', 'nano-banana'].includes(image_model)) {
      res.status(400).json({ error: 'Invalid image_model. Must be "flux-pro-kontext", "seedream", or "nano-banana"' });
      return;
    }

    // Validate video model
    if (video_model && !['pixverse', 'sora', 'kling'].includes(video_model)) {
      res.status(400).json({ error: 'Invalid video_model. Must be "pixverse", "sora", or "kling"' });
      return;
    }

    // Validate clip duration based on video model
    if (clip_duration && video_model) {
      if (video_model === 'pixverse' && ![5, 8].includes(clip_duration)) {
        res.status(400).json({ error: 'Pixverse only supports clip durations of 5 or 8 seconds' });
        return;
      }
      if (video_model === 'sora' && ![4, 8, 12].includes(clip_duration)) {
        res.status(400).json({ error: 'Sora only supports clip durations of 4, 8, or 12 seconds' });
        return;
      }
      if (video_model === 'kling' && ![5, 10].includes(clip_duration)) {
        res.status(400).json({ error: 'Kling only supports clip durations of 5 or 10 seconds' });
        return;
      }
    }

    const configRepo = AppDataSource.getRepository(AccountConfiguration);

    // Check if config already exists
    const existingConfig = await configRepo.findOne({ where: { account_id: accountId } });
    if (existingConfig) {
      res.status(400).json({ error: 'Account configuration already exists. Use PUT to update.' });
      return;
    }

    const config = configRepo.create({
      account_id: accountId,
      image_model: image_model || 'seedream',
      video_model: video_model || 'kling',
      clip_duration: clip_duration || 5
    });

    await configRepo.save(config);
    logger.info(`Created account configuration for account ${accountId}`);

    res.status(201).json(config);
  } catch (error) {
    logger.error('Error creating account configuration:', error);
    res.status(500).json({ error: 'Failed to create account configuration' });
  }
});

/**
 * PUT /api/web2-account-configurations/:accountId
 * Update account configuration
 */
router.put('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const accountId = parseInt(req.params.accountId as string, 10);
    
    if (isNaN(accountId)) {
      res.status(400).json({ error: 'Invalid account ID' });
      return;
    }

    const { image_model, video_model, clip_duration } = req.body;

    // Validate image model
    if (image_model && !['flux-pro-kontext', 'seedream', 'nano-banana'].includes(image_model)) {
      res.status(400).json({ error: 'Invalid image_model. Must be "flux-pro-kontext", "seedream", or "nano-banana"' });
      return;
    }

    // Validate video model
    if (video_model && !['pixverse', 'sora', 'kling'].includes(video_model)) {
      res.status(400).json({ error: 'Invalid video_model. Must be "pixverse", "sora", or "kling"' });
      return;
    }

    // Validate clip duration based on video model
    if (clip_duration !== undefined && video_model) {
      if (video_model === 'pixverse' && ![5, 8].includes(clip_duration)) {
        res.status(400).json({ error: 'Pixverse only supports clip durations of 5 or 8 seconds' });
        return;
      }
      if (video_model === 'sora' && ![4, 8, 12].includes(clip_duration)) {
        res.status(400).json({ error: 'Sora only supports clip durations of 4, 8, or 12 seconds' });
        return;
      }
      if (video_model === 'kling' && ![5, 10].includes(clip_duration)) {
        res.status(400).json({ error: 'Kling only supports clip durations of 5 or 10 seconds' });
        return;
      }
    }

    const configRepo = AppDataSource.getRepository(AccountConfiguration);
    let config = await configRepo.findOne({ where: { account_id: accountId } });

    if (!config) {
      // Create if doesn't exist
      config = configRepo.create({
        account_id: accountId,
        image_model: image_model || 'seedream',
        video_model: video_model || 'kling',
        clip_duration: clip_duration || 5
      });
    } else {
      // Update existing
      if (image_model !== undefined) {
        config.image_model = image_model;
      }
      if (video_model !== undefined) {
        config.video_model = video_model;
        // Reset clip_duration to default if model changes and no explicit duration provided
        if (clip_duration === undefined) {
          if (video_model === 'pixverse' || video_model === 'kling') {
            config.clip_duration = 5;
          } else if (video_model === 'sora') {
            config.clip_duration = 4;
          }
        }
      }
      if (clip_duration !== undefined) {
        config.clip_duration = clip_duration;
      }
    }

    await configRepo.save(config);
    logger.info(`Updated account configuration for account ${accountId}`);

    res.json(config);
  } catch (error) {
    logger.error('Error updating account configuration:', error);
    res.status(500).json({ error: 'Failed to update account configuration' });
  }
});

/**
 * DELETE /api/web2-account-configurations/:accountId
 * Delete account configuration (reset to defaults)
 */
router.delete('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const accountId = parseInt(req.params.accountId as string, 10);
    
    if (isNaN(accountId)) {
      res.status(400).json({ error: 'Invalid account ID' });
      return;
    }

    const configRepo = AppDataSource.getRepository(AccountConfiguration);
    const config = await configRepo.findOne({ where: { account_id: accountId } });

    if (!config) {
      res.status(404).json({ error: 'Account configuration not found' });
      return;
    }

    await configRepo.remove(config);
    logger.info(`Deleted account configuration for account ${accountId}`);

    res.json({ message: 'Account configuration deleted successfully' });
  } catch (error) {
    logger.error('Error deleting account configuration:', error);
    res.status(500).json({ error: 'Failed to delete account configuration' });
  }
});

export default router;

