"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
var dotenv_1 = __importDefault(require("dotenv"));
var joi_1 = __importDefault(require("joi"));
// Load environment variables
dotenv_1.default.config();
// Define environment schema
var envSchema = joi_1.default.object({
    // Database
    DB_HOST: joi_1.default.string().default('localhost'),
    DB_PORT: joi_1.default.number().default(5432),
    DB_NAME: joi_1.default.string().default('roastpower'),
    DB_USERNAME: joi_1.default.string().default('postgres'),
    DB_PASSWORD: joi_1.default.string().allow('').default(''),
    DB_SYNCHRONIZE: joi_1.default.boolean().default(true),
    DB_LOGGING: joi_1.default.boolean().default(false),
    // Redis
    REDIS_HOST: joi_1.default.string().default('localhost'),
    REDIS_PORT: joi_1.default.number().default(6379),
    REDIS_PASSWORD: joi_1.default.string().allow('').default(''),
    // API
    API_HOST: joi_1.default.string().default('0.0.0.0'),
    API_PORT: joi_1.default.number().default(8000),
    NODE_ENV: joi_1.default.string().valid('development', 'production', 'test').default('development'),
    // JWT
    JWT_SECRET: joi_1.default.string().min(8).default('dev-jwt-secret-change-in-production'),
    JWT_EXPIRES_IN: joi_1.default.string().default('7d'),
    JWT_REFRESH_EXPIRES_IN: joi_1.default.string().default('30d'),
    // CORS
    ALLOWED_ORIGINS: joi_1.default.string().default('http://localhost:3000,http://localhost:3004'),
    // Blockchain - MVP Base Network Only
    BASE_RPC_URL: joi_1.default.string().uri().default('https://mainnet.base.org'),
    BASE_PRIVATE_KEY: joi_1.default.string().default('0x0000000000000000000000000000000000000000000000000000000000000000'),
    ROAST_TOKEN_ADDRESS: joi_1.default.string().default('0x0000000000000000000000000000000000000000'), // Existing deployed ROAST token
    ROAST_STAKING_ADDRESS: joi_1.default.string().default('0x0000000000000000000000000000000000000000'), // Existing deployed staking
    USDC_BASE_ADDRESS: joi_1.default.string().default('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), // USDC on Base mainnet
    // Advanced Blockchain (Dormant for future phases)
    ADVANCED_CAMPAIGN_FACTORY: joi_1.default.string().default('0x0000000000000000000000000000000000000000'),
    ADVANCED_MINING_POOL: joi_1.default.string().default('0x0000000000000000000000000000000000000000'),
    // Social Media
    TWITTER_API_KEY: joi_1.default.string().allow('').default(''),
    TWITTER_API_SECRET: joi_1.default.string().allow('').default(''),
    TWITTER_BEARER_TOKEN: joi_1.default.string().allow('').default(''),
    FARCASTER_API_KEY: joi_1.default.string().allow('').default(''),
    // AI
    OPENAI_API_KEY: joi_1.default.string().allow('').default(''),
    ANTHROPIC_API_KEY: joi_1.default.string().allow('').default(''),
    PYTHON_AI_BACKEND_URL: joi_1.default.string().uri().default('http://localhost:8000'),
    // File Storage
    UPLOAD_PATH: joi_1.default.string().default('./uploads'),
    MAX_FILE_SIZE: joi_1.default.number().default(10485760),
    // Logging
    LOG_LEVEL: joi_1.default.string().valid('error', 'warn', 'info', 'debug').default('info'),
    LOG_FILE: joi_1.default.string().default('./logs/app.log'),
    // Mining
    DEFAULT_BLOCK_TIME: joi_1.default.number().default(300),
    MIN_MINERS_FOR_BLOCK: joi_1.default.number().default(2),
    MAX_SUBMISSIONS_PER_CAMPAIGN: joi_1.default.number().default(1500),
    BLOCK_REWARD_AMOUNT: joi_1.default.number().default(1000),
    CAMPAIGN_REWARD_AMOUNT: joi_1.default.number().default(100000),
    // Mining Block Configuration
    MINING_BLOCK_INTERVAL: joi_1.default.number().default(120000), // 2 minutes
    MINING_MIN_MINERS: joi_1.default.number().default(2),
    MINING_MAX_SUBMISSIONS_PER_CAMPAIGN: joi_1.default.number().default(1500),
    MINING_TOP_MINERS_PER_BLOCK: joi_1.default.number().default(50),
    // Redis Mining Configuration
    REDIS_MINING_PREFIX: joi_1.default.string().default('mining:'),
    REDIS_SUBMISSIONS_KEY: joi_1.default.string().default('submissions'),
    REDIS_ACTIVE_MINERS_KEY: joi_1.default.string().default('active_miners'),
    // MVP Platform Configuration
    ENABLE_CONTENT_MARKETPLACE: joi_1.default.boolean().default(true),
    ENABLE_BIDDING_SYSTEM: joi_1.default.boolean().default(true),
    ENABLE_MANUAL_CAMPAIGN_AGGREGATION: joi_1.default.boolean().default(true),
    PLATFORM_FEE_PERCENTAGE: joi_1.default.number().min(0).max(10).default(2.5), // 2.5% platform fee
    MINIMUM_BID_AMOUNT: joi_1.default.number().min(1).default(10), // 10 ROAST minimum bid
    MAX_BID_DURATION_HOURS: joi_1.default.number().default(48), // 48 hours max bidding
    // External Platform Aggregation
    COOKIE_FUN_API_URL: joi_1.default.string().uri().default('https://api.cookie.fun'),
    YAPS_KAITO_API_URL: joi_1.default.string().uri().default('https://api.yaps.kaito.ai'),
    YAP_MARKET_API_URL: joi_1.default.string().uri().default('https://api.yap.market'),
    // Content Scoring
    HUMOR_WEIGHT: joi_1.default.number().min(0).max(1).default(0.35),
    ENGAGEMENT_WEIGHT: joi_1.default.number().min(0).max(1).default(0.25),
    ORIGINALITY_WEIGHT: joi_1.default.number().min(0).max(1).default(0.20),
    RELEVANCE_WEIGHT: joi_1.default.number().min(0).max(1).default(0.15),
    PERSONALITY_WEIGHT: joi_1.default.number().min(0).max(1).default(0.05),
}).unknown();
// Validate environment variables
var _a = envSchema.validate(process.env), error = _a.error, envVars = _a.value;
if (error) {
    throw new Error("Config validation error: ".concat(error.message));
}
// Export typed environment configuration
exports.env = {
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
        allowedOrigins: envVars.ALLOWED_ORIGINS.split(',').map(function (origin) { return origin.trim(); }),
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
    // Content Scoring
    scoring: {
        humorWeight: envVars.HUMOR_WEIGHT,
        engagementWeight: envVars.ENGAGEMENT_WEIGHT,
        originalityWeight: envVars.ORIGINALITY_WEIGHT,
        relevanceWeight: envVars.RELEVANCE_WEIGHT,
        personalityWeight: envVars.PERSONALITY_WEIGHT,
    },
};
