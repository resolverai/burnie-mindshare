import { createClient, RedisClientType } from 'redis';
import { env } from './env';
import { logger } from './logger';

// Create Redis client
export const redisClient: RedisClientType = createClient({
  socket: {
    host: env.redis.host,
    port: env.redis.port,
  },
  password: env.redis.password || undefined,
});

// Initialize Redis connection
export const initializeRedis = async (): Promise<void> => {
  try {
    await redisClient.connect();
    logger.info('✅ Redis connection established successfully');
  } catch (error) {
    logger.error('❌ Redis connection failed:', error);
    throw error;
  }
};

// Close Redis connection
export const closeRedis = async (): Promise<void> => {
  try {
    await redisClient.quit();
    logger.info('📴 Redis connection closed');
  } catch (error) {
    logger.error('❌ Error closing Redis connection:', error);
  }
};

// Health check for Redis
export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    await redisClient.ping();
    return true;
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return false;
  }
};

// Redis error handling
redisClient.on('error', (err) => {
  logger.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  logger.info('🔄 Redis client connected');
});

redisClient.on('reconnecting', () => {
  logger.warn('🔄 Redis client reconnecting');
});

redisClient.on('ready', () => {
  logger.info('✅ Redis client ready');
}); 