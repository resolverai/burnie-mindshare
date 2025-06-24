import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';

const router = Router();

// Basic health check
router.get('/', async (req: Request, res: Response) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      memory: process.memoryUsage(),
      version: '1.0.0',
    };

    res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Health check failed',
    });
  }
});

export { router as healthRoutes }; 