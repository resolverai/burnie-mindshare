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

  // CORS Configuration - MUST be explicitly set in environment
  ALLOWED_ORIGINS: Joi.string().required(),

  // Blockchain - MVP Base Network Only
  BASE_RPC_URL: Joi.string().uri().default('https://mainnet.base.org'),
  BASE_PRIVATE_KEY: Joi.string().default('0x0000000000000000000000000000000000000000000000000000000000000000'),
  ROAST_TOKEN_ADDRESS: Joi.string().default('0x0000000000000000000000000000000000000000'), // Existing deployed ROAST token
  ROAST_STAKING_ADDRESS: Joi.string().default('0x0000000000000000000000000000000000000000'), // Existing deployed staking
  USDC_BASE_ADDRESS: Joi.string().default('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), // USDC on Base mainnet
  
  // Advanced Blockchain (Dormant for future phases)
  ADVANCED_CAMPAIGN_FACTORY: Joi.string().default('0x0000000000000000000000000000000000000000'),
  ADVANCED_MINING_POOL: Joi.string().default('0x0000000000000000000000000000000000000000'),

  // Social Media
  TWITTER_API_KEY: Joi.string().allow('').default(''),
  TWITTER_API_SECRET: Joi.string().allow('').default(''),
  TWITTER_BEARER_TOKEN: Joi.string().allow('').default(''),
  FARCASTER_API_KEY: Joi.string().allow('').default(''),

  // AI
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  ANTHROPIC_API_KEY: Joi.string().allow('').default(''),
  PYTHON_AI_BACKEND_URL: Joi.string().uri().required(),

  // File Storage
  UPLOAD_PATH: Joi.string().default('./uploads'),
  MAX_FILE_SIZE: Joi.number().default(10485760),
  
  // AWS S3 Configuration
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  AWS_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET_NAME: Joi.string().default('burnie-mindshare-content-staging'),

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

  // MVP Platform Configuration
  ENABLE_CONTENT_MARKETPLACE: Joi.boolean().default(true),
  ENABLE_BIDDING_SYSTEM: Joi.boolean().default(true),
  ENABLE_MANUAL_CAMPAIGN_AGGREGATION: Joi.boolean().default(true),
  PLATFORM_FEE_PERCENTAGE: Joi.number().min(0).max(10).default(2.5), // 2.5% platform fee
  MINIMUM_BID_AMOUNT: Joi.number().min(1).default(10), // 10 ROAST minimum bid
  MAX_BID_DURATION_HOURS: Joi.number().default(48), // 48 hours max bidding
  
  // External Platform Aggregation
  COOKIE_FUN_API_URL: Joi.string().uri().default('https://api.cookie.fun'),
  YAPS_KAITO_API_URL: Joi.string().uri().default('https://api.yaps.kaito.ai'),
  
  // Yapper Interface Configuration
  YAPPER_INTERFACE_EXTRA_PRICE: Joi.number().min(0).default(0), // Extra ROAST amount for yapper interface content
  YAPPER_INTERFACE_CREATOR_WALLET: Joi.string().required(), // Wallet address for yapper interface content creation
  
  // Text-Only Regeneration Configuration
  YAPPER_TEXT_ONLY_MODE: Joi.string().valid('true', 'false').default('false'), // Toggle between text-only and full regeneration
  TEXT_ONLY_REGENERATION_COST: Joi.number().min(0).default(50), // Cost for text-only regeneration in ROAST
  
  YAP_MARKET_API_URL: Joi.string().uri().default('https://api.yap.market'),
  
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

// Debug logging for environment variables
console.log('🔍 Environment variable debug:');
console.log('  - YAPPER_TEXT_ONLY_MODE raw:', process.env.YAPPER_TEXT_ONLY_MODE);
console.log('  - YAPPER_TEXT_ONLY_MODE parsed:', envVars.YAPPER_TEXT_ONLY_MODE);
console.log('  - YAPPER_TEXT_ONLY_MODE type:', typeof envVars.YAPPER_TEXT_ONLY_MODE);

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

  // Blockchain - MVP Base Network Only
  blockchain: {
    network: 'base',
    rpcUrl: envVars.BASE_RPC_URL,
    privateKey: envVars.BASE_PRIVATE_KEY,
    contracts: {
      roastToken: envVars.ROAST_TOKEN_ADDRESS,
      stakingContract: envVars.ROAST_STAKING_ADDRESS,
      usdcToken: envVars.USDC_BASE_ADDRESS,
    },
  },

  // Advanced Blockchain Features (Dormant)
  advancedBlockchain: {
    campaignFactory: envVars.ADVANCED_CAMPAIGN_FACTORY,
    miningPool: envVars.ADVANCED_MINING_POOL,
    enabled: false, // Dormant for MVP
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
    pythonBackendUrl: envVars.PYTHON_AI_BACKEND_URL,
  },

  // File Storage
  storage: {
    uploadPath: envVars.UPLOAD_PATH,
    maxFileSize: envVars.MAX_FILE_SIZE,
  },
  
  // AWS S3
  aws: {
    accessKeyId: envVars.AWS_ACCESS_KEY_ID,
    secretAccessKey: envVars.AWS_SECRET_ACCESS_KEY,
    region: envVars.AWS_REGION,
    s3BucketName: envVars.S3_BUCKET_NAME,
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

  // MVP Platform Configuration
  platform: {
    enableContentMarketplace: envVars.ENABLE_CONTENT_MARKETPLACE,
    enableBiddingSystem: envVars.ENABLE_BIDDING_SYSTEM,
    enableManualCampaignAggregation: envVars.ENABLE_MANUAL_CAMPAIGN_AGGREGATION,
    platformFeePercentage: envVars.PLATFORM_FEE_PERCENTAGE,
    minimumBidAmount: envVars.MINIMUM_BID_AMOUNT,
    maxBidDurationHours: envVars.MAX_BID_DURATION_HOURS,
  },

  // External Platform APIs
  externalPlatforms: {
    cookieFun: { apiUrl: envVars.COOKIE_FUN_API_URL },
    yapsKaito: { apiUrl: envVars.YAPS_KAITO_API_URL },
    yapMarket: { apiUrl: envVars.YAP_MARKET_API_URL },
  },

  // Yapper Interface Configuration
  yapperInterface: {
    extraPrice: envVars.YAPPER_INTERFACE_EXTRA_PRICE,
    creatorWallet: envVars.YAPPER_INTERFACE_CREATOR_WALLET,
    textOnlyMode: envVars.YAPPER_TEXT_ONLY_MODE,
    textOnlyRegenerationCost: envVars.TEXT_ONLY_REGENERATION_COST,
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