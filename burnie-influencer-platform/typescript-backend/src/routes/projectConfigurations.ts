import express, { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Web3ProjectConfiguration } from '../models/Web3ProjectConfiguration';
import { logger } from '../config/logger';
import { DateTime } from 'luxon';
import { projectAuthMiddleware } from '../middleware/projectAuthMiddleware';

const router = express.Router();

// Apply authorization middleware to all routes
router.use('/:id/*', projectAuthMiddleware);

/**
 * GET /api/projects/:id/configurations
 * Get project configuration by project ID
 */
router.get('/:id/configurations', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id as string, 10);
    
    if (isNaN(projectId)) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }

    const configRepo = AppDataSource.getRepository(Web3ProjectConfiguration);
    let config = await configRepo.findOne({ where: { project_id: projectId } });

    // If no config exists, create default one
    if (!config) {
      logger.info(`Creating default configuration for project ${projectId}`);
      config = configRepo.create({
        project_id: projectId,
        image_model: 'seedream',
        video_model: 'kling',
        clip_duration: 5,
        daily_posts_count: 10,
        content_mix: {
          shitpost: 4,
          threads: 4,
          longpost: 2
        },
        schedule_config: {
          frequency: 'daily',
          days: [0, 1, 2, 3, 4, 5, 6],
          time: '09:00'
        }
      });
      await configRepo.save(config);
    }

    // Convert schedule time to user timezone if requested (for display)
    const userTimezone = req.query.user_timezone as string;
    let responseConfig: any = { ...config };
    
    if (config.schedule_config && config.schedule_config.time && userTimezone) {
      try {
        const serverTimezone = process.env.TZ || 'UTC';
        // Create a date with today's date and the server time in server timezone
        const today = DateTime.now().setZone(serverTimezone);
        const [hours, minutes] = config.schedule_config.time.split(':').map(Number);
        const serverDateTime = today.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
        
        // Convert to user timezone
        const userDateTime = serverDateTime.setZone(userTimezone);
        const userTime = userDateTime.toFormat('HH:mm');
        
        // Return schedule config with time in user's timezone for display
        responseConfig.schedule_config = {
          ...config.schedule_config,
          time: userTime
        };
        responseConfig.server_timezone = serverTimezone;
        responseConfig.user_timezone = userTimezone;
      } catch (err) {
        logger.warn('Failed to convert schedule time to user timezone, returning server time:', err);
      }
    } else {
      // Include server timezone info
      responseConfig.server_timezone = process.env.TZ || 'UTC';
    }

    res.json(responseConfig);
  } catch (error) {
    logger.error('Error fetching project configuration:', error);
    res.status(500).json({ error: 'Failed to fetch project configuration' });
  }
});

/**
 * POST /api/projects/:id/configurations
 * Create project configuration
 */
router.post('/:id/configurations', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id as string, 10);
    
    if (isNaN(projectId)) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }

    const { 
      image_model, 
      video_model, 
      clip_duration,
      daily_posts_count,
      content_mix,
      schedule_config,
      user_timezone
    } = req.body;

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

    // Validate daily_posts_count
    if (daily_posts_count !== undefined && (daily_posts_count < 1 || daily_posts_count > 50)) {
      res.status(400).json({ error: 'daily_posts_count must be between 1 and 50' });
      return;
    }

    // Validate content_mix
    if (content_mix) {
      if (typeof content_mix !== 'object' || !content_mix.shitpost || !content_mix.threads || !content_mix.longpost) {
        res.status(400).json({ error: 'content_mix must be an object with shitpost, threads, and longpost numbers' });
        return;
      }
      const total = content_mix.shitpost + content_mix.threads + content_mix.longpost;
      if (total !== daily_posts_count) {
        res.status(400).json({ error: `content_mix totals (${total}) must equal daily_posts_count (${daily_posts_count || 10})` });
        return;
      }
    }

    // Handle schedule_config timezone conversion
    let serverScheduleConfig: any = null;
    
    if (schedule_config !== undefined && schedule_config !== null) {
      // Validate schedule_config structure
      if (!schedule_config.frequency || !schedule_config.days || !schedule_config.time) {
        res.status(400).json({ error: 'schedule_config must have frequency, days, and time fields' });
        return;
      }
      
      if (!['daily', 'weekly', 'thrice_week', 'custom'].includes(schedule_config.frequency)) {
        res.status(400).json({ error: 'schedule_config.frequency must be daily, weekly, thrice_week, or custom' });
        return;
      }
      
      if (!Array.isArray(schedule_config.days) || schedule_config.days.length === 0) {
        res.status(400).json({ error: 'schedule_config.days must be a non-empty array' });
        return;
      }
      
      // Convert time from user timezone to server timezone
      if (user_timezone && schedule_config.time) {
        try {
          const serverTimezone = process.env.TZ || 'UTC';
          // Create a date with today's date and the user's time in their timezone
          const today = DateTime.now().setZone(user_timezone);
          const [hours, minutes] = schedule_config.time.split(':').map(Number);
          const userDateTime = today.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
          
          // Convert to server timezone
          const serverDateTime = userDateTime.setZone(serverTimezone);
          const serverTime = serverDateTime.toFormat('HH:mm');
          
          serverScheduleConfig = {
            frequency: schedule_config.frequency,
            days: schedule_config.days,
            time: serverTime
          };
          
          logger.info(`Timezone conversion (POST): ${schedule_config.time} (${user_timezone}) -> ${serverTime} (${serverTimezone})`);
        } catch (err) {
          logger.warn('Timezone conversion failed (POST), using provided time as-is:', err);
          // Fallback: validate and use the provided time
          const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
          if (timeRegex.test(schedule_config.time)) {
            serverScheduleConfig = schedule_config;
          } else {
            res.status(400).json({ error: 'Invalid schedule_config.time format or timezone conversion failed' });
            return;
          }
        }
      } else {
        // No timezone info provided, validate format and use as-is
        const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(schedule_config.time)) {
          res.status(400).json({ error: 'schedule_config.time must be in HH:mm format (24-hour)' });
          return;
        }
        serverScheduleConfig = schedule_config;
      }
    }

    const configRepo = AppDataSource.getRepository(Web3ProjectConfiguration);

    // Check if config already exists
    const existingConfig = await configRepo.findOne({ where: { project_id: projectId } });
    if (existingConfig) {
      res.status(400).json({ error: 'Project configuration already exists. Use PUT to update.' });
      return;
    }

    const config = configRepo.create({
      project_id: projectId,
      image_model: image_model || 'seedream',
      video_model: video_model || 'kling',
      clip_duration: clip_duration || 5,
      daily_posts_count: daily_posts_count || 10,
      content_mix: content_mix || {
        shitpost: 4,
        threads: 4,
        longpost: 2
      },
      schedule_config: serverScheduleConfig || {
        frequency: 'daily',
        days: [0, 1, 2, 3, 4, 5, 6],
        time: '09:00'
      }
    });

    await configRepo.save(config);
    logger.info(`Created project configuration for project ${projectId}`);

    res.status(201).json(config);
  } catch (error) {
    logger.error('Error creating project configuration:', error);
    res.status(500).json({ error: 'Failed to create project configuration' });
  }
});

/**
 * PUT /api/projects/:id/configurations
 * Update project configuration
 */
router.put('/:id/configurations', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = parseInt(req.params.id as string, 10);
    
    if (isNaN(projectId)) {
      res.status(400).json({ error: 'Invalid project ID' });
      return;
    }

    const { 
      image_model, 
      video_model, 
      clip_duration,
      daily_posts_count,
      content_mix,
      schedule_config,
      user_timezone
    } = req.body;

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

    // Validate daily_posts_count
    if (daily_posts_count !== undefined && (daily_posts_count < 1 || daily_posts_count > 50)) {
      res.status(400).json({ error: 'daily_posts_count must be between 1 and 50' });
      return;
    }

    // Validate content_mix
    if (content_mix) {
      if (typeof content_mix !== 'object' || typeof content_mix.shitpost !== 'number' || 
          typeof content_mix.threads !== 'number' || typeof content_mix.longpost !== 'number') {
        res.status(400).json({ error: 'content_mix must be an object with shitpost, threads, and longpost numbers' });
        return;
      }
      const total = content_mix.shitpost + content_mix.threads + content_mix.longpost;
      const expectedTotal = daily_posts_count !== undefined ? daily_posts_count : (await AppDataSource.getRepository(Web3ProjectConfiguration).findOne({ where: { project_id: projectId } }))?.daily_posts_count || 10;
      if (total !== expectedTotal) {
        res.status(400).json({ error: `content_mix totals (${total}) must equal daily_posts_count (${expectedTotal})` });
        return;
      }
    }

    // Handle schedule_config timezone conversion
    let serverScheduleConfig: any = null;
    
    if (schedule_config !== undefined && schedule_config !== null) {
      // Validate schedule_config structure
      if (!schedule_config.frequency || !schedule_config.days || !schedule_config.time) {
        res.status(400).json({ error: 'schedule_config must have frequency, days, and time fields' });
        return;
      }
      
      if (!['daily', 'weekly', 'thrice_week', 'custom'].includes(schedule_config.frequency)) {
        res.status(400).json({ error: 'schedule_config.frequency must be daily, weekly, thrice_week, or custom' });
        return;
      }
      
      if (!Array.isArray(schedule_config.days) || schedule_config.days.length === 0) {
        res.status(400).json({ error: 'schedule_config.days must be a non-empty array' });
        return;
      }
      
      // Convert time from user timezone to server timezone
      if (user_timezone && schedule_config.time) {
        try {
          const serverTimezone = process.env.TZ || 'UTC';
          // Create a date with today's date and the user's time in their timezone
          const today = DateTime.now().setZone(user_timezone);
          const [hours, minutes] = schedule_config.time.split(':').map(Number);
          const userDateTime = today.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
          
          // Convert to server timezone
          const serverDateTime = userDateTime.setZone(serverTimezone);
          const serverTime = serverDateTime.toFormat('HH:mm');
          
          serverScheduleConfig = {
            frequency: schedule_config.frequency,
            days: schedule_config.days,
            time: serverTime
          };
          
          logger.info(`Timezone conversion (PUT): ${schedule_config.time} (${user_timezone}) -> ${serverTime} (${serverTimezone})`);
        } catch (err) {
          logger.warn('Timezone conversion failed (PUT), using provided time as-is:', err);
          // Fallback: validate and use the provided time
          const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
          if (timeRegex.test(schedule_config.time)) {
            serverScheduleConfig = schedule_config;
          } else {
            res.status(400).json({ error: 'Invalid schedule_config.time format or timezone conversion failed' });
            return;
          }
        }
      } else {
        // No timezone info provided, validate format and use as-is
        const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(schedule_config.time)) {
          res.status(400).json({ error: 'schedule_config.time must be in HH:mm format (24-hour)' });
          return;
        }
        serverScheduleConfig = schedule_config;
      }
    }

    const configRepo = AppDataSource.getRepository(Web3ProjectConfiguration);
    let config = await configRepo.findOne({ where: { project_id: projectId } });

    if (!config) {
      // Create if doesn't exist
      config = configRepo.create({
        project_id: projectId,
        image_model: image_model || 'seedream',
        video_model: video_model || 'kling',
        clip_duration: clip_duration || 5,
        daily_posts_count: daily_posts_count || 10,
        content_mix: content_mix || {
          shitpost: 4,
          threads: 4,
          longpost: 2
        },
        schedule_config: serverScheduleConfig || {
          frequency: 'daily',
          days: [0, 1, 2, 3, 4, 5, 6],
          time: '09:00'
        }
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
      if (daily_posts_count !== undefined) {
        config.daily_posts_count = daily_posts_count;
      }
      if (content_mix !== undefined) {
        config.content_mix = content_mix;
      }
      if (schedule_config !== undefined) {
        config.schedule_config = serverScheduleConfig;
        logger.info(`Setting schedule_config for project ${projectId}: ${JSON.stringify(serverScheduleConfig)} (server timezone: ${process.env.TZ || 'system default'})`);
      }
    }

    await configRepo.save(config);
    logger.info(`Updated project configuration for project ${projectId}`);

    res.json(config);
  } catch (error) {
    logger.error('Error updating project configuration:', error);
    res.status(500).json({ error: 'Failed to update project configuration' });
  }
});

export { router as projectConfigurationsRoutes };

