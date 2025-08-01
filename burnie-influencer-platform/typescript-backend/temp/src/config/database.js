"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDatabaseHealth = exports.closeDatabase = exports.initializeDatabase = exports.AppDataSource = void 0;
var typeorm_1 = require("typeorm");
var env_1 = require("./env");
var logger_1 = require("./logger");
// Import all entities
var User_1 = require("../models/User");
var Miner_1 = require("../models/Miner");
var Campaign_1 = require("../models/Campaign");
var Project_1 = require("../models/Project");
var Submission_1 = require("../models/Submission");
var Block_1 = require("../models/Block");
var Reward_1 = require("../models/Reward");
var SocialAccount_1 = require("../models/SocialAccount");
var Analytics_1 = require("../models/Analytics");
// Import new entities for multi-agentic system
var AgentConfiguration_1 = require("../models/AgentConfiguration");
var MindshareTrainingData_1 = require("../models/MindshareTrainingData");
var ContentMarketplace_1 = require("../models/ContentMarketplace");
var BiddingSystem_1 = require("../models/BiddingSystem");
var PaymentTransaction_1 = require("../models/PaymentTransaction");
var TwitterLearningData_1 = require("../models/TwitterLearningData");
var Admin_1 = require("../models/Admin");
var TwitterUserConnection_1 = require("../models/TwitterUserConnection");
// Import seed data functions
var seedData_1 = require("./seedData");
// Create TypeORM DataSource
exports.AppDataSource = new typeorm_1.DataSource({
    type: 'postgres',
    host: env_1.env.database.host,
    port: env_1.env.database.port,
    username: env_1.env.database.username,
    password: env_1.env.database.password,
    database: env_1.env.database.name,
    synchronize: env_1.env.database.synchronize, // Auto-create/update tables
    logging: env_1.env.database.logging,
    entities: [
        // Original entities
        User_1.User,
        Miner_1.Miner,
        Campaign_1.Campaign,
        Project_1.Project,
        Submission_1.Submission,
        Block_1.Block,
        Reward_1.Reward,
        SocialAccount_1.SocialAccount,
        Analytics_1.Analytics,
        // New multi-agentic system entities
        AgentConfiguration_1.AgentConfiguration,
        MindshareTrainingData_1.MindshareTrainingData,
        ContentMarketplace_1.ContentMarketplace,
        BiddingSystem_1.BiddingSystem,
        PaymentTransaction_1.PaymentTransaction,
        TwitterLearningData_1.TwitterLearningData,
        Admin_1.Admin,
        TwitterUserConnection_1.TwitterUserConnection,
    ],
    migrations: [],
    subscribers: [],
    cache: {
        duration: 30000, // 30 seconds
    },
    extra: {
        connectionLimit: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    },
});
// Initialize database connection
var initializeDatabase = function () { return __awaiter(void 0, void 0, void 0, function () {
    var entityCount, entityNames, tables, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 6, , 7]);
                logger_1.logger.info('🗄️ Initializing database connection...');
                logger_1.logger.info("\uD83D\uDCCD Connecting to: ".concat(env_1.env.database.host, ":").concat(env_1.env.database.port, "/").concat(env_1.env.database.name));
                logger_1.logger.info("\uD83D\uDC64 Using credentials: ".concat(env_1.env.database.username).concat(env_1.env.database.password ? ' (with password)' : ' (no password)'));
                // Check if DataSource is already initialized
                if (exports.AppDataSource.isInitialized) {
                    logger_1.logger.info('📋 Database already initialized, skipping...');
                    return [2 /*return*/];
                }
                return [4 /*yield*/, exports.AppDataSource.initialize()];
            case 1:
                _a.sent();
                logger_1.logger.info('✅ Database connection established successfully');
                entityCount = exports.AppDataSource.entityMetadatas.length;
                entityNames = exports.AppDataSource.entityMetadatas.map(function (meta) { return meta.name; });
                logger_1.logger.info("\uD83D\uDCCA Loaded ".concat(entityCount, " entities: ").concat(entityNames.join(', ')));
                if (!env_1.env.database.synchronize) return [3 /*break*/, 5];
                logger_1.logger.info('🔄 Running database schema synchronization...');
                return [4 /*yield*/, exports.AppDataSource.synchronize(false)];
            case 2:
                _a.sent(); // false = don't drop existing tables
                logger_1.logger.info('📋 Database tables synchronized');
                return [4 /*yield*/, exports.AppDataSource.query("\n        SELECT table_name \n        FROM information_schema.tables \n        WHERE table_schema = 'public' \n        ORDER BY table_name\n      ")];
            case 3:
                tables = _a.sent();
                logger_1.logger.info("\uD83D\uDCCB Database tables: ".concat(tables.map(function (t) { return t.table_name; }).join(', ')));
                // Seed database with mock data for development
                logger_1.logger.info('🌱 Seeding database with mock data...');
                return [4 /*yield*/, (0, seedData_1.seedDatabase)()];
            case 4:
                _a.sent();
                logger_1.logger.info('✅ Database seeded successfully');
                _a.label = 5;
            case 5: return [3 /*break*/, 7];
            case 6:
                error_1 = _a.sent();
                logger_1.logger.error('❌ Database connection failed:', error_1);
                // Log more specific error information
                if (error_1 instanceof Error) {
                    logger_1.logger.error("Error message: ".concat(error_1.message));
                    if (error_1.message.includes('ECONNREFUSED')) {
                        logger_1.logger.error('💡 Tip: Make sure PostgreSQL is running on the specified host and port');
                    }
                    else if (error_1.message.includes('authentication failed')) {
                        logger_1.logger.error('💡 Tip: Check your database username and password');
                    }
                    else if (error_1.message.includes('database') && error_1.message.includes('does not exist')) {
                        logger_1.logger.error('💡 Tip: Create the database manually or use a different database name');
                    }
                }
                logger_1.logger.warn('⚠️ Server will continue with mock data. Database features disabled.');
                // In development, continue without database
                // In production, you might want to fail hard
                if (process.env.NODE_ENV === 'production') {
                    throw error_1;
                }
                return [3 /*break*/, 7];
            case 7: return [2 /*return*/];
        }
    });
}); };
exports.initializeDatabase = initializeDatabase;
// Close database connection
var closeDatabase = function () { return __awaiter(void 0, void 0, void 0, function () {
    var error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, exports.AppDataSource.destroy()];
            case 1:
                _a.sent();
                logger_1.logger.info('📴 Database connection closed');
                return [3 /*break*/, 3];
            case 2:
                error_2 = _a.sent();
                logger_1.logger.error('❌ Error closing database connection:', error_2);
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); };
exports.closeDatabase = closeDatabase;
// Health check for database
var checkDatabaseHealth = function () { return __awaiter(void 0, void 0, void 0, function () {
    var error_3;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, exports.AppDataSource.query('SELECT 1')];
            case 1:
                _a.sent();
                return [2 /*return*/, true];
            case 2:
                error_3 = _a.sent();
                logger_1.logger.error('Database health check failed:', error_3);
                return [2 /*return*/, false];
            case 3: return [2 /*return*/];
        }
    });
}); };
exports.checkDatabaseHealth = checkDatabaseHealth;
