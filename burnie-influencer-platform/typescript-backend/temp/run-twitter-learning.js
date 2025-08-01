#!/usr/bin/env ts-node
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
var database_1 = require("./src/config/database");
var TwitterLearningService_1 = require("./src/services/TwitterLearningService");
var User_1 = require("./src/models/User");
var TwitterLearningData_1 = require("./src/models/TwitterLearningData");
var TwitterUserConnection_1 = require("./src/models/TwitterUserConnection");
var fs_1 = require("fs");
var path_1 = require("path");
function runTwitterLearning() {
    return __awaiter(this, void 0, void 0, function () {
        var userRepository, twitterRepository, learningRepository, usersWithTwitter, _i, usersWithTwitter_1, user, twitterConn, learningService, learningResults, _a, usersWithTwitter_2, user, twitterConn, userResult, learningData, recentInsights, error_1, outputPath, _b, _c, userResult, error_2;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 17, 18, 21]);
                    console.log('🧠 Starting Twitter Learning Process...\n');
                    if (!!database_1.AppDataSource.isInitialized) return [3 /*break*/, 2];
                    return [4 /*yield*/, database_1.AppDataSource.initialize()];
                case 1:
                    _d.sent();
                    console.log('✅ Database connected');
                    _d.label = 2;
                case 2:
                    userRepository = database_1.AppDataSource.getRepository(User_1.User);
                    twitterRepository = database_1.AppDataSource.getRepository(TwitterUserConnection_1.TwitterUserConnection);
                    learningRepository = database_1.AppDataSource.getRepository(TwitterLearningData_1.TwitterLearningData);
                    return [4 /*yield*/, userRepository
                            .createQueryBuilder('user')
                            .innerJoin('user.id', 'twitter', 'twitter.userId = user.id')
                            .where('twitter.isConnected = :connected', { connected: true })
                            .getMany()];
                case 3:
                    usersWithTwitter = _d.sent();
                    if (usersWithTwitter.length === 0) {
                        console.log('❌ No users with connected Twitter accounts found');
                        return [2 /*return*/];
                    }
                    console.log("\uD83D\uDCCA Found ".concat(usersWithTwitter.length, " users with Twitter connections:"));
                    _i = 0, usersWithTwitter_1 = usersWithTwitter;
                    _d.label = 4;
                case 4:
                    if (!(_i < usersWithTwitter_1.length)) return [3 /*break*/, 7];
                    user = usersWithTwitter_1[_i];
                    return [4 /*yield*/, twitterRepository.findOne({
                            where: { userId: user.id, isConnected: true }
                        })];
                case 5:
                    twitterConn = _d.sent();
                    console.log("   - ".concat(user.walletAddress, " (@").concat(twitterConn === null || twitterConn === void 0 ? void 0 : twitterConn.twitterUsername, ")"));
                    _d.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 4];
                case 7:
                    learningService = new TwitterLearningService_1.TwitterLearningService();
                    learningResults = {
                        timestamp: new Date().toISOString(),
                        totalUsers: usersWithTwitter.length,
                        users: []
                    };
                    _a = 0, usersWithTwitter_2 = usersWithTwitter;
                    _d.label = 8;
                case 8:
                    if (!(_a < usersWithTwitter_2.length)) return [3 /*break*/, 16];
                    user = usersWithTwitter_2[_a];
                    console.log("\n\uD83D\uDD04 Processing Twitter data for user ".concat(user.id, "..."));
                    return [4 /*yield*/, twitterRepository.findOne({
                            where: { userId: user.id, isConnected: true }
                        })];
                case 9:
                    twitterConn = _d.sent();
                    userResult = {
                        userId: user.id,
                        walletAddress: user.walletAddress,
                        twitterUsername: (twitterConn === null || twitterConn === void 0 ? void 0 : twitterConn.twitterUsername) || undefined,
                        twitterDisplayName: (twitterConn === null || twitterConn === void 0 ? void 0 : twitterConn.twitterDisplayName) || undefined,
                        processingStarted: new Date().toISOString(),
                        tweets: {
                            fetched: 0,
                            analyzed: 0,
                            newlyStored: 0
                        },
                        insights: {},
                        errors: []
                    };
                    _d.label = 10;
                case 10:
                    _d.trys.push([10, 13, , 14]);
                    // Run learning for this user
                    return [4 /*yield*/, learningService.runContinuousLearning()];
                case 11:
                    // Run learning for this user
                    _d.sent();
                    return [4 /*yield*/, learningRepository.find({
                            where: { userId: user.id },
                            order: { processedAt: 'DESC' },
                            take: 10 // Get latest 10 analyzed tweets
                        })];
                case 12:
                    learningData = _d.sent();
                    userResult.tweets.analyzed = learningData.length;
                    // Extract insights summary
                    if (learningData.length > 0) {
                        recentInsights = learningData.map(function (data) {
                            var _a;
                            return ({
                                tweetId: data.tweetId,
                                tweetText: ((_a = data.tweetText) === null || _a === void 0 ? void 0 : _a.substring(0, 100)) + '...',
                                postingTime: data.postingTime,
                                engagementMetrics: data.engagementMetrics,
                                analyzedFeatures: data.analyzedFeatures,
                                learningInsights: data.learningInsights,
                                processedAt: data.processedAt
                            });
                        });
                        userResult.insights = {
                            totalTweetsAnalyzed: learningData.length,
                            recentAnalysis: recentInsights,
                            summary: generateInsightsSummary(learningData)
                        };
                    }
                    console.log("   \u2705 Processed ".concat(userResult.tweets.analyzed, " tweets"));
                    return [3 /*break*/, 14];
                case 13:
                    error_1 = _d.sent();
                    console.error("   \u274C Error processing user ".concat(user.id, ":"), error_1.message);
                    userResult.errors.push(error_1.message);
                    return [3 /*break*/, 14];
                case 14:
                    userResult.processingCompleted = new Date().toISOString();
                    learningResults.users.push(userResult);
                    _d.label = 15;
                case 15:
                    _a++;
                    return [3 /*break*/, 8];
                case 16:
                    outputPath = (0, path_1.join)(__dirname, 'twitter-learning-results.json');
                    (0, fs_1.writeFileSync)(outputPath, JSON.stringify(learningResults, null, 2));
                    console.log("\n\uD83D\uDCC1 Results saved to: ".concat(outputPath));
                    console.log('\n🎯 Summary:');
                    console.log("   Users processed: ".concat(learningResults.users.length));
                    for (_b = 0, _c = learningResults.users; _b < _c.length; _b++) {
                        userResult = _c[_b];
                        console.log("   @".concat(userResult.twitterUsername, ": ").concat(userResult.tweets.analyzed, " tweets analyzed"));
                        if (userResult.errors.length > 0) {
                            console.log("     Errors: ".concat(userResult.errors.join(', ')));
                        }
                    }
                    console.log('\n✅ Twitter learning process completed!');
                    return [3 /*break*/, 21];
                case 17:
                    error_2 = _d.sent();
                    console.error('❌ Fatal error:', error_2);
                    return [3 /*break*/, 21];
                case 18:
                    if (!database_1.AppDataSource.isInitialized) return [3 /*break*/, 20];
                    return [4 /*yield*/, database_1.AppDataSource.destroy()];
                case 19:
                    _d.sent();
                    _d.label = 20;
                case 20: return [7 /*endfinally*/];
                case 21: return [2 /*return*/];
            }
        });
    });
}
function generateInsightsSummary(learningData) {
    if (learningData.length === 0)
        return {};
    var features = learningData.map(function (d) { return d.analyzedFeatures; }).filter(Boolean);
    var insights = learningData.map(function (d) { return d.learningInsights; }).filter(Boolean);
    return {
        averageTextLength: features.reduce(function (sum, f) { return sum + (f.textLength || 0); }, 0) / features.length,
        averageWordCount: features.reduce(function (sum, f) { return sum + (f.wordCount || 0); }, 0) / features.length,
        hashtagUsageRate: features.filter(function (f) { return f.hashtagCount > 0; }).length / features.length,
        emojiUsageRate: features.filter(function (f) { return f.hasEmojis; }).length / features.length,
        mediaUsageRate: features.filter(function (f) { return f.hasMedia; }).length / features.length,
        commonCryptoKeywords: extractCommonKeywords(features),
        postingTimePatterns: analyzePostingTimes(features),
        engagementPatterns: analyzeEngagementPatterns(learningData),
        contentTypes: analyzeContentTypes(insights),
        toneAnalysis: analyzeTonePatterns(insights)
    };
}
function extractCommonKeywords(features) {
    var allKeywords = features.flatMap(function (f) { return f.cryptoKeywords || []; });
    var keywordCounts = allKeywords.reduce(function (acc, keyword) {
        acc[keyword] = (acc[keyword] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(keywordCounts)
        .sort(function (_a, _b) {
        var a = _a[1];
        var b = _b[1];
        return b - a;
    })
        .slice(0, 10)
        .map(function (_a) {
        var keyword = _a[0];
        return keyword;
    });
}
function analyzePostingTimes(features) {
    var hours = features.map(function (f) { return f.postingHour; }).filter(function (h) { return h !== undefined; });
    var days = features.map(function (f) { return f.dayOfWeek; }).filter(function (d) { return d !== undefined; });
    return {
        mostActiveHours: getMostFrequent(hours),
        mostActiveDays: getMostFrequent(days),
        totalPosts: features.length
    };
}
function analyzeEngagementPatterns(learningData) {
    var metrics = learningData.map(function (d) { return d.engagementMetrics; }).filter(Boolean);
    if (metrics.length === 0)
        return {};
    return {
        averageLikes: metrics.reduce(function (sum, m) { return sum + (m.like_count || 0); }, 0) / metrics.length,
        averageRetweets: metrics.reduce(function (sum, m) { return sum + (m.retweet_count || 0); }, 0) / metrics.length,
        averageReplies: metrics.reduce(function (sum, m) { return sum + (m.reply_count || 0); }, 0) / metrics.length,
        totalEngagement: metrics.reduce(function (sum, m) {
            return sum + (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0);
        }, 0),
        bestPerformingTweet: metrics.reduce(function (best, current) {
            var currentTotal = (current.like_count || 0) + (current.retweet_count || 0) + (current.reply_count || 0);
            var bestTotal = (best.like_count || 0) + (best.retweet_count || 0) + (best.reply_count || 0);
            return currentTotal > bestTotal ? current : best;
        }, metrics[0])
    };
}
function analyzeContentTypes(insights) {
    var types = insights.map(function (i) { return i.contentType; }).filter(Boolean);
    return getMostFrequent(types);
}
function analyzeTonePatterns(insights) {
    var tones = insights.map(function (i) { return i.toneAnalysis; }).filter(Boolean);
    return getMostFrequent(tones);
}
function getMostFrequent(arr) {
    var counts = arr.reduce(function (acc, item) {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .sort(function (_a, _b) {
        var a = _a[1];
        var b = _b[1];
        return b - a;
    })
        .reduce(function (acc, _a) {
        var key = _a[0], value = _a[1];
        acc[key] = value;
        return acc;
    }, {});
}
// Run the script
if (require.main === module) {
    runTwitterLearning();
}
