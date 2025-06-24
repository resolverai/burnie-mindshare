import dotenv from 'dotenv';
import Joi from 'joi';

// Load environment variables
dotenv.config();

// Define environment schema
const envSchema = Joi.object({
  // Database
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_NAME: Joi.string().default('roastpower'),
  DB_USERNAME: Joi.string().default('postgres'),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_SYNCHRONIZE: Joi.boolean().default(true),
  DB_LOGGING: Joi.boolean().default(false),

  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // API
  API_HOST: Joi.string().default('0.0.0.0'),
  API_PORT: Joi.number().default(8000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // JWT
  JWT_SECRET: Joi.string().min(8).default('dev-jwt-secret-change-in-production'),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // CORS
  ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000,http://localhost:3004'),

  // Blockchain
  ETH_RPC_URL: Joi.string().uri().default('https://mainnet.infura.io/v3/demo'),
  ETH_PRIVATE_KEY: Joi.string().default('0x0000000000000000000000000000000000000000000000000000000000000000'),
  CONTRACT_ROAST_TOKEN: Joi.string().default('0x0000000000000000000000000000000000000000'),
  CONTRACT_MINING_POOL: Joi.string().default('0x0000000000000000000000000000000000000000'),
  CONTRACT_CAMPAIGN_FACTORY: Joi.string().default('0x0000000000000000000000000000000000000000'),

  // Social Media
  TWITTER_API_KEY: Joi.string().allow('').default(''),
  TWITTER_API_SECRET: Joi.string().allow('').default(''),
  TWITTER_BEARER_TOKEN: Joi.string().allow('').default(''),
  FARCASTER_API_KEY: Joi.string().allow('').default(''),

  // AI
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  PYTHON_AI_SERVICE_URL: Joi.string().uri().default('http://localhost:5000'),

  // File Storage
  UPLOAD_PATH: Joi.string().default('./uploads'),
  MAX_FILE_SIZE: Joi.number().default(10485760),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE: Joi.string().default('./logs/app.log'),

  // Mining
  DEFAULT_BLOCK_TIME: Joi.number().default(300),
  MIN_MINERS_FOR_BLOCK: Joi.number().default(2),
  MAX_SUBMISSIONS_PER_CAMPAIGN: Joi.number().default(1500),
  BLOCK_REWARD_AMOUNT: Joi.number().default(1000),
  CAMPAIGN_REWARD_AMOUNT: Joi.number().default(100000),
  
  // Mining Block Configuration
  MINING_BLOCK_INTERVAL: Joi.number().default(120000), // 2 minutes
  MINING_MIN_MINERS: Joi.number().default(2),
  MINING_MAX_SUBMISSIONS_PER_CAMPAIGN: Joi.number().default(1500),
  MINING_TOP_MINERS_PER_BLOCK: Joi.number().default(50),
  
  // Redis Mining Configuration
  REDIS_MINING_PREFIX: Joi.string().default('mining:'),
  REDIS_SUBMISSIONS_KEY: Joi.string().default('submissions'),
  REDIS_ACTIVE_MINERS_KEY: Joi.string().default('active_miners'),

  // Content Scoring
  HUMOR_WEIGHT: Joi.number().min(0).max(1).default(0.35),
  ENGAGEMENT_WEIGHT: Joi.number().min(0).max(1).default(0.25),
  ORIGINALITY_WEIGHT: Joi.number().min(0).max(1).default(0.20),
  RELEVANCE_WEIGHT: Joi.number().min(0).max(1).default(0.15),
  PERSONALITY_WEIGHT: Joi.number().min(0).max(1).default(0.05),
}).unknown();

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Export typed environment configuration
export const env = {
  // Database
  database: {
    host: envVars.DB_HOST,
    port: envVars.DB_PORT,
    name: envVars.DB_NAME,
    username: envVars.DB_USERNAME,
    password: envVars.DB_PASSWORD,
    synchronize: envVars.DB_SYNCHRONIZE,
    logging: envVars.DB_LOGGING,
  },

  // Redis
  redis: {
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT,
    password: envVars.REDIS_PASSWORD,
  },

  // API
  api: {
    host: envVars.API_HOST,
    port: envVars.API_PORT,
    nodeEnv: envVars.NODE_ENV,
  },

  // JWT
  jwt: {
    secret: envVars.JWT_SECRET,
    expiresIn: envVars.JWT_EXPIRES_IN,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
  },

  // CORS
  cors: {
    allowedOrigins: envVars.ALLOWED_ORIGINS.split(',').map((origin: string) => origin.trim()),
  },

  // Blockchain
  blockchain: {
    rpcUrl: envVars.ETH_RPC_URL,
    privateKey: envVars.ETH_PRIVATE_KEY,
    contracts: {
      roastToken: envVars.CONTRACT_ROAST_TOKEN,
      miningPool: envVars.CONTRACT_MINING_POOL,
      campaignFactory: envVars.CONTRACT_CAMPAIGN_FACTORY,
    },
  },

  // Social Media
  social: {
    twitter: {
      apiKey: envVars.TWITTER_API_KEY,
      apiSecret: envVars.TWITTER_API_SECRET,
      bearerToken: envVars.TWITTER_BEARER_TOKEN,
    },
    farcaster: {
      apiKey: envVars.FARCASTER_API_KEY,
    },
  },

  // AI
  ai: {
    openaiApiKey: envVars.OPENAI_API_KEY,
    anthropicApiKey: envVars.ANTHROPIC_API_KEY,
    pythonServiceUrl: envVars.PYTHON_AI_SERVICE_URL,
  },

  // File Storage
  storage: {
    uploadPath: envVars.UPLOAD_PATH,
    maxFileSize: envVars.MAX_FILE_SIZE,
  },

  // Logging
  logging: {
    level: envVars.LOG_LEVEL,
    file: envVars.LOG_FILE,
  },

  // Mining
  mining: {
    defaultBlockTime: envVars.DEFAULT_BLOCK_TIME,
    minMinersForBlock: envVars.MIN_MINERS_FOR_BLOCK,
    maxSubmissionsPerCampaign: envVars.MINING_MAX_SUBMISSIONS_PER_CAMPAIGN,
    blockRewardAmount: envVars.BLOCK_REWARD_AMOUNT,
    campaignRewardAmount: envVars.CAMPAIGN_REWARD_AMOUNT,
    // New mining block configuration
    blockInterval: envVars.MINING_BLOCK_INTERVAL,
    minMiners: envVars.MINING_MIN_MINERS,
    topMinersPerBlock: envVars.MINING_TOP_MINERS_PER_BLOCK,
    // Redis configuration
    redisPrefix: envVars.REDIS_MINING_PREFIX,
    submissionsKey: envVars.REDIS_SUBMISSIONS_KEY,
    activeMinersKey: envVars.REDIS_ACTIVE_MINERS_KEY,
  },

  // Content Scoring
  scoring: {
    humorWeight: envVars.HUMOR_WEIGHT,
    engagementWeight: envVars.ENGAGEMENT_WEIGHT,
    originalityWeight: envVars.ORIGINALITY_WEIGHT,
    relevanceWeight: envVars.RELEVANCE_WEIGHT,
    personalityWeight: envVars.PERSONALITY_WEIGHT,
  },
} as const; 