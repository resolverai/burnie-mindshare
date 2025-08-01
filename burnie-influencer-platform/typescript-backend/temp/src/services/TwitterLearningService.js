"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwitterLearningService = void 0;
var typeorm_1 = require("typeorm");
var database_1 = require("../config/database");
var User_1 = require("../models/User");
var TwitterLearningData_1 = require("../models/TwitterLearningData");
var TwitterUserConnection_1 = require("../models/TwitterUserConnection");
var AgentConfiguration_1 = require("../models/AgentConfiguration");
var logger_1 = require("../config/logger");
var TwitterLearningService = /** @class */ (function () {
    function TwitterLearningService() {
        this.userRepository = database_1.AppDataSource.getRepository(User_1.User);
        this.twitterLearningRepository = database_1.AppDataSource.getRepository(TwitterLearningData_1.TwitterLearningData);
        this.agentConfigRepository = database_1.AppDataSource.getRepository(AgentConfiguration_1.AgentConfiguration);
    }
    /**
     * Main method to run continuous Twitter learning for all connected users
     */
    TwitterLearningService.prototype.runContinuousLearning = function () {
        return __awaiter(this, void 0, void 0, function () {
            var usersWithTwitter, _i, usersWithTwitter_1, user, error_1, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 9, , 10]);
                        logger_1.logger.info('🧠 Starting continuous Twitter learning process...');
                        return [4 /*yield*/, this.userRepository.find({
                                where: {
                                    twitterHandle: (0, typeorm_1.Not)((0, typeorm_1.IsNull)()),
                                    twitterUserId: (0, typeorm_1.Not)((0, typeorm_1.IsNull)()),
                                },
                                select: ['id', 'walletAddress', 'twitterHandle', 'twitterUserId', 'twitterOauthToken'],
                            })];
                    case 1:
                        usersWithTwitter = _a.sent();
                        if (usersWithTwitter.length === 0) {
                            logger_1.logger.info('📭 No users with connected Twitter accounts found');
                            return [2 /*return*/];
                        }
                        logger_1.logger.info("\uD83D\uDD0D Found ".concat(usersWithTwitter.length, " users with connected Twitter accounts"));
                        _i = 0, usersWithTwitter_1 = usersWithTwitter;
                        _a.label = 2;
                    case 2:
                        if (!(_i < usersWithTwitter_1.length)) return [3 /*break*/, 8];
                        user = usersWithTwitter_1[_i];
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 6, , 7]);
                        return [4 /*yield*/, this.processUserTwitterData(user)];
                    case 4:
                        _a.sent();
                        // Add delay between users to respect rate limits
                        return [4 /*yield*/, this.delay(2000)];
                    case 5:
                        // Add delay between users to respect rate limits
                        _a.sent();
                        return [3 /*break*/, 7];
                    case 6:
                        error_1 = _a.sent();
                        logger_1.logger.error("\u274C Error processing Twitter data for user ".concat(user.id, ":"), error_1);
                        return [3 /*break*/, 7];
                    case 7:
                        _i++;
                        return [3 /*break*/, 2];
                    case 8:
                        logger_1.logger.info('✅ Continuous Twitter learning process completed');
                        return [3 /*break*/, 10];
                    case 9:
                        error_2 = _a.sent();
                        logger_1.logger.error('❌ Error in continuous Twitter learning:', error_2);
                        throw error_2;
                    case 10: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Process individual user's Twitter data
     */
    TwitterLearningService.prototype.processUserTwitterData = function (user) {
        return __awaiter(this, void 0, void 0, function () {
            var tweets, analyzedTweets, _i, tweets_1, tweet, existingTweet, learningData, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 10, , 11]);
                        logger_1.logger.info("\uD83D\uDD04 Processing Twitter data for user ".concat(user.id, " (@").concat(user.twitterHandle, ")"));
                        return [4 /*yield*/, this.fetchUserTweets(user)];
                    case 1:
                        tweets = _a.sent();
                        if (!tweets || tweets.length === 0) {
                            logger_1.logger.info("\uD83D\uDCED No new tweets found for user ".concat(user.id));
                            return [2 /*return*/];
                        }
                        analyzedTweets = [];
                        _i = 0, tweets_1 = tweets;
                        _a.label = 2;
                    case 2:
                        if (!(_i < tweets_1.length)) return [3 /*break*/, 6];
                        tweet = tweets_1[_i];
                        return [4 /*yield*/, this.twitterLearningRepository.findOne({
                                where: { tweetId: tweet.id }
                            })];
                    case 3:
                        existingTweet = _a.sent();
                        if (!!existingTweet) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.analyzeTweet(user, tweet)];
                    case 4:
                        learningData = _a.sent();
                        analyzedTweets.push(learningData);
                        _a.label = 5;
                    case 5:
                        _i++;
                        return [3 /*break*/, 2];
                    case 6:
                        if (!(analyzedTweets.length > 0)) return [3 /*break*/, 9];
                        return [4 /*yield*/, this.twitterLearningRepository.save(analyzedTweets)];
                    case 7:
                        _a.sent();
                        logger_1.logger.info("\uD83D\uDCBE Stored ".concat(analyzedTweets.length, " new tweets for user ").concat(user.id));
                        // Update user's agent configurations with new insights
                        return [4 /*yield*/, this.updateAgentConfigurations(user)];
                    case 8:
                        // Update user's agent configurations with new insights
                        _a.sent();
                        _a.label = 9;
                    case 9: return [3 /*break*/, 11];
                    case 10:
                        error_3 = _a.sent();
                        logger_1.logger.error("\u274C Error processing Twitter data for user ".concat(user.id, ":"), error_3);
                        return [3 /*break*/, 11];
                    case 11: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Fetch tweets from a user's timeline using Twitter API v2
     */
    TwitterLearningService.prototype.fetchUserTweets = function (user) {
        return __awaiter(this, void 0, void 0, function () {
            var twitterConnection, url, params, response, errorData, data, tweets, error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 6, , 7]);
                        logger_1.logger.info("\uD83D\uDCE1 Fetching real tweets for user ".concat(user.id, " (@").concat(user.twitterHandle, ")"));
                        return [4 /*yield*/, database_1.AppDataSource.getRepository(TwitterUserConnection_1.TwitterUserConnection).findOne({
                                where: { userId: user.id, isConnected: true }
                            })];
                    case 1:
                        twitterConnection = _a.sent();
                        if (!twitterConnection || !twitterConnection.accessToken) {
                            logger_1.logger.error("\u274C No valid Twitter access token for user ".concat(user.id));
                            return [2 /*return*/, []];
                        }
                        url = "https://api.twitter.com/2/users/".concat(twitterConnection.twitterUserId, "/tweets");
                        params = new URLSearchParams({
                            'max_results': '100', // Get last 100 tweets
                            'tweet.fields': 'created_at,public_metrics,context_annotations,entities,attachments',
                            'exclude': 'retweets,replies' // Focus on original content
                        });
                        return [4 /*yield*/, fetch("".concat(url, "?").concat(params), {
                                headers: {
                                    'Authorization': "Bearer ".concat(twitterConnection.accessToken),
                                    'Content-Type': 'application/json',
                                },
                            })];
                    case 2:
                        response = _a.sent();
                        if (!!response.ok) return [3 /*break*/, 4];
                        return [4 /*yield*/, response.json()];
                    case 3:
                        errorData = _a.sent();
                        logger_1.logger.error("\u274C Twitter API error for user ".concat(user.id, ":"), errorData);
                        return [2 /*return*/, []];
                    case 4: return [4 /*yield*/, response.json()];
                    case 5:
                        data = _a.sent();
                        tweets = data.data || [];
                        logger_1.logger.info("\u2705 Fetched ".concat(tweets.length, " real tweets for user ").concat(user.id));
                        return [2 /*return*/, tweets];
                    case 6:
                        error_4 = _a.sent();
                        logger_1.logger.error("\u274C Error fetching real tweets for user ".concat(user.id, ":"), error_4);
                        return [2 /*return*/, []];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Analyze individual tweet and extract learning data
     */
    TwitterLearningService.prototype.analyzeTweet = function (user, tweet) {
        return __awaiter(this, void 0, void 0, function () {
            var features, insights, learningData;
            return __generator(this, function (_a) {
                features = this.extractTweetFeatures(tweet);
                insights = this.generateLearningInsights(tweet, features);
                learningData = new TwitterLearningData_1.TwitterLearningData();
                learningData.userId = user.id;
                learningData.tweetId = tweet.id;
                learningData.tweetText = tweet.text;
                learningData.engagementMetrics = tweet.public_metrics;
                learningData.postingTime = new Date(tweet.created_at);
                learningData.analyzedFeatures = features;
                learningData.learningInsights = insights;
                return [2 /*return*/, learningData];
            });
        });
    };
    /**
     * Extract features from a tweet for analysis
     */
    TwitterLearningService.prototype.extractTweetFeatures = function (tweet) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        var text = tweet.text;
        var metrics = tweet.public_metrics || {};
        return {
            textLength: text.length,
            wordCount: text.split(/\s+/).length,
            hashtagCount: (((_b = (_a = tweet.entities) === null || _a === void 0 ? void 0 : _a.hashtags) === null || _b === void 0 ? void 0 : _b.length) || 0),
            mentionCount: (((_d = (_c = tweet.entities) === null || _c === void 0 ? void 0 : _c.mentions) === null || _d === void 0 ? void 0 : _d.length) || 0),
            urlCount: (((_f = (_e = tweet.entities) === null || _e === void 0 ? void 0 : _e.urls) === null || _f === void 0 ? void 0 : _f.length) || 0),
            hasEmojis: /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/u.test(text),
            hasMedia: !!((_h = (_g = tweet.attachments) === null || _g === void 0 ? void 0 : _g.media_keys) === null || _h === void 0 ? void 0 : _h.length),
            engagementRate: this.calculateEngagementRate(metrics),
            sentiment: this.analyzeSentiment(text),
            cryptoKeywords: this.extractCryptoKeywords(text),
            postingHour: new Date(tweet.created_at).getHours(),
            dayOfWeek: new Date(tweet.created_at).getDay(),
        };
    };
    /**
     * Generate learning insights from tweet analysis
     */
    TwitterLearningService.prototype.generateLearningInsights = function (tweet, features) {
        return {
            contentType: this.classifyContentType(tweet.text),
            engagementQuality: this.assessEngagementQuality(tweet.public_metrics || {}),
            optimalCharacteristics: this.identifyOptimalCharacteristics(features),
            toneAnalysis: this.analyzeTone(tweet.text),
            topicRelevance: this.analyzeTopicRelevance(tweet.text),
            viralPotential: this.assessViralPotential(tweet.public_metrics || {}, features),
        };
    };
    /**
     * Update user's agent configurations based on learning insights
     */
    TwitterLearningService.prototype.updateAgentConfigurations = function (user) {
        return __awaiter(this, void 0, void 0, function () {
            var recentLearningData, insights, _i, _a, agentType, error_5;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 6, , 7]);
                        return [4 /*yield*/, this.twitterLearningRepository.find({
                                where: { userId: user.id },
                                order: { processedAt: 'DESC' },
                                take: 100, // Analyze last 100 tweets
                            })];
                    case 1:
                        recentLearningData = _b.sent();
                        if (recentLearningData.length === 0)
                            return [2 /*return*/];
                        insights = this.generateComprehensiveInsights(recentLearningData);
                        _i = 0, _a = Object.values(AgentConfiguration_1.AgentType);
                        _b.label = 2;
                    case 2:
                        if (!(_i < _a.length)) return [3 /*break*/, 5];
                        agentType = _a[_i];
                        return [4 /*yield*/, this.updateAgentConfiguration(user.id, agentType, insights)];
                    case 3:
                        _b.sent();
                        _b.label = 4;
                    case 4:
                        _i++;
                        return [3 /*break*/, 2];
                    case 5:
                        logger_1.logger.info("\uD83D\uDD04 Updated agent configurations for user ".concat(user.id));
                        return [3 /*break*/, 7];
                    case 6:
                        error_5 = _b.sent();
                        logger_1.logger.error("\u274C Error updating agent configurations for user ".concat(user.id, ":"), error_5);
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Update specific agent configuration with insights
     */
    TwitterLearningService.prototype.updateAgentConfiguration = function (userId, agentType, insights) {
        return __awaiter(this, void 0, void 0, function () {
            var agentConfig, updatedConfig;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.agentConfigRepository.findOne({
                            where: { userId: userId, agentType: agentType }
                        })];
                    case 1:
                        agentConfig = _a.sent();
                        if (!agentConfig) {
                            // Create new agent configuration
                            agentConfig = new AgentConfiguration_1.AgentConfiguration();
                            agentConfig.userId = userId;
                            agentConfig.agentType = agentType;
                            agentConfig.configuration = this.getDefaultAgentConfiguration(agentType);
                        }
                        updatedConfig = this.generateAgentSpecificConfiguration(agentType, insights);
                        agentConfig.configuration = __assign(__assign({}, agentConfig.configuration), updatedConfig);
                        // Update performance metrics
                        agentConfig.performanceMetrics = __assign(__assign({}, agentConfig.performanceMetrics), { lastUpdated: new Date(), insightsVersion: insights.contentThemes.frequentTopics.length, learningAccuracy: this.calculateLearningAccuracy(insights) });
                        return [4 /*yield*/, this.agentConfigRepository.save(agentConfig)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Generate comprehensive insights from multiple tweets
     */
    TwitterLearningService.prototype.generateComprehensiveInsights = function (learningData) {
        var allFeatures = learningData.map(function (data) { return data.getAnalyzedFeatures(); });
        var allInsights = learningData.map(function (data) { return data.getLearningInsights(); });
        var insights = {
            writingStyle: {
                averageLength: this.calculateAverage(allFeatures.map(function (f) { return f.textLength; })),
                hashtagUsage: this.calculateAverage(allFeatures.map(function (f) { return f.hashtagCount; })),
                mentionUsage: this.calculateAverage(allFeatures.map(function (f) { return f.mentionCount; })),
                emojiUsage: allFeatures.filter(function (f) { return f.hasEmojis; }).length / allFeatures.length,
                urlUsage: this.calculateAverage(allFeatures.map(function (f) { return f.urlCount; })),
            },
            engagementPatterns: {
                bestPerformingLength: this.findBestPerformingLength(learningData),
                optimalPostingTimes: this.findOptimalPostingTimes(learningData),
                topHashtags: this.extractTopHashtags(learningData),
                averageEngagementRate: this.calculateAverage(learningData.map(function (d) { return d.getEngagementRate(); })),
            },
            contentThemes: {
                cryptoKeywords: this.extractTopCryptoKeywords(allFeatures),
                frequentTopics: this.extractFrequentTopics(allInsights),
                sentimentPattern: this.determineSentimentPattern(allFeatures),
            },
            personalityTraits: {
                tone: this.determineTone(allInsights),
                formality: this.determineFormality(allFeatures),
                engagement_style: this.determineEngagementStyle(allInsights),
            },
        };
        return insights;
    };
    // Helper methods for analysis
    TwitterLearningService.prototype.calculateEngagementRate = function (metrics) {
        var impressions = metrics.impression_count || 0;
        var engagements = (metrics.like_count || 0) + (metrics.retweet_count || 0) + (metrics.reply_count || 0);
        return impressions > 0 ? (engagements / impressions) * 100 : 0;
    };
    TwitterLearningService.prototype.analyzeSentiment = function (text) {
        // Simple sentiment analysis - in production, use a proper NLP library
        var positiveWords = ['great', 'amazing', 'excellent', 'love', 'awesome', 'bullish', 'moon'];
        var negativeWords = ['bad', 'terrible', 'hate', 'awful', 'bearish', 'dump', 'crash'];
        var positiveCount = positiveWords.filter(function (word) { return text.toLowerCase().includes(word); }).length;
        var negativeCount = negativeWords.filter(function (word) { return text.toLowerCase().includes(word); }).length;
        if (positiveCount > negativeCount)
            return 'positive';
        if (negativeCount > positiveCount)
            return 'negative';
        return 'neutral';
    };
    TwitterLearningService.prototype.extractCryptoKeywords = function (text) {
        var cryptoKeywords = [
            'bitcoin', 'btc', 'ethereum', 'eth', 'defi', 'nft', 'blockchain', 'crypto',
            'web3', 'dao', 'degen', 'yield', 'liquidity', 'staking', 'mining', 'hodl'
        ];
        return cryptoKeywords.filter(function (keyword) {
            return text.toLowerCase().includes(keyword);
        });
    };
    TwitterLearningService.prototype.classifyContentType = function (text) {
        if (text.includes('?'))
            return 'question';
        if (text.includes('GM') || text.includes('GN'))
            return 'greeting';
        if (text.includes('🧵') || text.includes('1/'))
            return 'thread';
        if (text.includes('#'))
            return 'informational';
        return 'general';
    };
    TwitterLearningService.prototype.assessEngagementQuality = function (metrics) {
        var engagementRate = this.calculateEngagementRate(metrics);
        if (engagementRate > 3)
            return 'high';
        if (engagementRate > 1)
            return 'medium';
        return 'low';
    };
    TwitterLearningService.prototype.identifyOptimalCharacteristics = function (features) {
        return {
            hasOptimalLength: features.textLength >= 100 && features.textLength <= 280,
            usesHashtags: features.hashtagCount > 0 && features.hashtagCount <= 3,
            hasEmojis: features.hasEmojis,
            includesCrypto: features.cryptoKeywords.length > 0,
        };
    };
    TwitterLearningService.prototype.analyzeTone = function (text) {
        if (/[!]{2,}/.test(text) || /[🚀🔥💎]/.test(text))
            return 'enthusiastic';
        if (/\?/.test(text))
            return 'inquisitive';
        if (/\d+%|\$|\bprice\b/.test(text))
            return 'analytical';
        return 'neutral';
    };
    TwitterLearningService.prototype.analyzeTopicRelevance = function (text) {
        var cryptoTerms = this.extractCryptoKeywords(text);
        return Math.min(cryptoTerms.length / 3, 1); // Max relevance score of 1
    };
    TwitterLearningService.prototype.assessViralPotential = function (metrics, features) {
        var score = 0;
        if (features.hasEmojis)
            score += 0.2;
        if (features.hashtagCount > 0)
            score += 0.2;
        if (features.textLength < 200)
            score += 0.2;
        if (this.calculateEngagementRate(metrics) > 2)
            score += 0.4;
        return Math.min(score, 1);
    };
    TwitterLearningService.prototype.calculateAverage = function (numbers) {
        return numbers.length > 0 ? numbers.reduce(function (a, b) { return a + b; }, 0) / numbers.length : 0;
    };
    TwitterLearningService.prototype.findBestPerformingLength = function (data) {
        var _a;
        // Find length that correlates with highest engagement
        var lengthEngagement = data.map(function (d) { return ({
            length: d.getContentLength(),
            engagement: d.getEngagementRate(),
        }); });
        lengthEngagement.sort(function (a, b) { return b.engagement - a.engagement; });
        return ((_a = lengthEngagement[0]) === null || _a === void 0 ? void 0 : _a.length) || 150;
    };
    TwitterLearningService.prototype.findOptimalPostingTimes = function (data) {
        var _this = this;
        var hourEngagement = new Map();
        data.forEach(function (d) {
            var _a;
            var hour = ((_a = d.postingTime) === null || _a === void 0 ? void 0 : _a.getHours()) || 0;
            var engagement = d.getEngagementRate();
            if (!hourEngagement.has(hour)) {
                hourEngagement.set(hour, []);
            }
            hourEngagement.get(hour).push(engagement);
        });
        var avgByHour = Array.from(hourEngagement.entries()).map(function (_a) {
            var hour = _a[0], engagements = _a[1];
            return ({
                hour: hour,
                avgEngagement: _this.calculateAverage(engagements),
            });
        });
        avgByHour.sort(function (a, b) { return b.avgEngagement - a.avgEngagement; });
        return avgByHour.slice(0, 3).map(function (h) { return h.hour; });
    };
    TwitterLearningService.prototype.extractTopHashtags = function (data) {
        // Extract most frequently used hashtags
        var hashtagCount = new Map();
        data.forEach(function (d) {
            var text = d.tweetText || '';
            var hashtags = text.match(/#\w+/g) || [];
            hashtags.forEach(function (tag) {
                var cleanTag = tag.toLowerCase();
                hashtagCount.set(cleanTag, (hashtagCount.get(cleanTag) || 0) + 1);
            });
        });
        return Array.from(hashtagCount.entries())
            .sort(function (a, b) { return b[1] - a[1]; })
            .slice(0, 5)
            .map(function (_a) {
            var tag = _a[0];
            return tag;
        });
    };
    TwitterLearningService.prototype.extractTopCryptoKeywords = function (features) {
        var keywordCount = new Map();
        features.forEach(function (f) {
            f.cryptoKeywords.forEach(function (keyword) {
                keywordCount.set(keyword, (keywordCount.get(keyword) || 0) + 1);
            });
        });
        return Array.from(keywordCount.entries())
            .sort(function (a, b) { return b[1] - a[1]; })
            .slice(0, 10)
            .map(function (_a) {
            var keyword = _a[0];
            return keyword;
        });
    };
    TwitterLearningService.prototype.extractFrequentTopics = function (insights) {
        var topics = insights.flatMap(function (i) { return i.topicRelevance || []; });
        return __spreadArray([], new Set(topics), true).slice(0, 5);
    };
    TwitterLearningService.prototype.determineSentimentPattern = function (features) {
        var sentiments = features.map(function (f) { return f.sentiment; });
        var positive = sentiments.filter(function (s) { return s === 'positive'; }).length;
        var negative = sentiments.filter(function (s) { return s === 'negative'; }).length;
        if (positive > negative * 2)
            return 'predominantly_positive';
        if (negative > positive * 2)
            return 'predominantly_negative';
        return 'balanced';
    };
    TwitterLearningService.prototype.determineTone = function (insights) {
        // Analyze tone patterns from insights
        var tones = insights.map(function (i) { return i.toneAnalysis; });
        var enthusiastic = tones.filter(function (t) { return t === 'enthusiastic'; }).length;
        var analytical = tones.filter(function (t) { return t === 'analytical'; }).length;
        if (analytical > enthusiastic)
            return 'technical';
        if (enthusiastic > analytical)
            return 'casual';
        return 'professional';
    };
    TwitterLearningService.prototype.determineFormality = function (features) {
        var hasEmojis = features.filter(function (f) { return f.hasEmojis; }).length;
        var formalityRatio = hasEmojis / features.length;
        if (formalityRatio > 0.7)
            return 'informal';
        if (formalityRatio < 0.3)
            return 'formal';
        return 'mixed';
    };
    TwitterLearningService.prototype.determineEngagementStyle = function (insights) {
        var questions = insights.filter(function (i) { return i.contentType === 'question'; }).length;
        var informational = insights.filter(function (i) { return i.contentType === 'informational'; }).length;
        if (questions > informational)
            return 'conversational';
        if (informational > questions)
            return 'informative';
        return 'promotional';
    };
    TwitterLearningService.prototype.getDefaultAgentConfiguration = function (agentType) {
        var _a;
        var defaultConfigs = (_a = {},
            _a[AgentConfiguration_1.AgentType.DATA_ANALYST] = {
                analysisDepth: 'medium',
                focusAreas: ['engagement', 'timing', 'content_patterns'],
                updateFrequency: 'daily',
            },
            _a[AgentConfiguration_1.AgentType.CONTENT_STRATEGIST] = {
                strategyType: 'balanced',
                optimizationGoals: ['engagement', 'reach', 'relevance'],
                adaptationSpeed: 'medium',
            },
            _a[AgentConfiguration_1.AgentType.TEXT_CONTENT] = {
                tonePreference: 'adaptive',
                lengthOptimization: true,
                hashtagStrategy: 'moderate',
            },
            _a[AgentConfiguration_1.AgentType.VISUAL_CREATOR] = {
                visualStyle: 'modern',
                brandAlignment: 'high',
                creativityLevel: 'medium',
            },
            _a[AgentConfiguration_1.AgentType.ORCHESTRATOR] = {
                coordinationStyle: 'collaborative',
                qualityThreshold: 0.8,
                performanceTracking: true,
            },
            _a);
        return defaultConfigs[agentType] || {};
    };
    TwitterLearningService.prototype.generateAgentSpecificConfiguration = function (agentType, insights) {
        switch (agentType) {
            case AgentConfiguration_1.AgentType.DATA_ANALYST:
                return {
                    optimalPostingTimes: insights.engagementPatterns.optimalPostingTimes,
                    averageEngagementRate: insights.engagementPatterns.averageEngagementRate,
                    topPerformingLength: insights.engagementPatterns.bestPerformingLength,
                    keywordPreferences: insights.contentThemes.cryptoKeywords,
                };
            case AgentConfiguration_1.AgentType.CONTENT_STRATEGIST:
                return {
                    personalityTone: insights.personalityTraits.tone,
                    engagementStyle: insights.personalityTraits.engagement_style,
                    topHashtags: insights.engagementPatterns.topHashtags,
                    sentimentPattern: insights.contentThemes.sentimentPattern,
                };
            case AgentConfiguration_1.AgentType.TEXT_CONTENT:
                return {
                    averageLength: insights.writingStyle.averageLength,
                    hashtagUsage: insights.writingStyle.hashtagUsage,
                    emojiUsage: insights.writingStyle.emojiUsage,
                    tone: insights.personalityTraits.tone,
                    formality: insights.personalityTraits.formality,
                };
            case AgentConfiguration_1.AgentType.VISUAL_CREATOR:
                return {
                    brandThemes: insights.contentThemes.frequentTopics,
                    visualStyle: insights.personalityTraits.tone,
                    engagementOptimization: insights.engagementPatterns.averageEngagementRate > 2,
                };
            case AgentConfiguration_1.AgentType.ORCHESTRATOR:
                return {
                    qualityBenchmark: insights.engagementPatterns.averageEngagementRate,
                    coordinationStrategy: insights.personalityTraits.engagement_style,
                    performanceGoals: {
                        engagementRate: insights.engagementPatterns.averageEngagementRate * 1.1, // 10% improvement target
                        optimalLength: insights.engagementPatterns.bestPerformingLength,
                    },
                };
            default:
                return {};
        }
    };
    TwitterLearningService.prototype.calculateLearningAccuracy = function (insights) {
        // Calculate accuracy based on data completeness and consistency
        var score = 0;
        if (insights.engagementPatterns.averageEngagementRate > 0)
            score += 0.25;
        if (insights.contentThemes.cryptoKeywords.length > 0)
            score += 0.25;
        if (insights.personalityTraits.tone !== 'professional')
            score += 0.25; // Has distinctive style
        if (insights.engagementPatterns.optimalPostingTimes.length > 0)
            score += 0.25;
        return score;
    };
    TwitterLearningService.prototype.delay = function (ms) {
        return new Promise(function (resolve) { return setTimeout(resolve, ms); });
    };
    /**
     * Public method to manually trigger learning for a specific user
     */
    TwitterLearningService.prototype.learnFromUser = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            var user;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.userRepository.findOne({ where: { id: userId } })];
                    case 1:
                        user = _a.sent();
                        if (!user) {
                            throw new Error("User with ID ".concat(userId, " not found"));
                        }
                        if (!user.hasTwitterConnected()) {
                            throw new Error("User ".concat(userId, " does not have Twitter connected"));
                        }
                        return [4 /*yield*/, this.processUserTwitterData(user)];
                    case 2:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get learning insights for a specific user
     */
    TwitterLearningService.prototype.getUserLearningInsights = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            var recentLearningData;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.twitterLearningRepository.find({
                            where: { userId: userId },
                            order: { processedAt: 'DESC' },
                            take: 50,
                        })];
                    case 1:
                        recentLearningData = _a.sent();
                        if (recentLearningData.length === 0) {
                            return [2 /*return*/, null];
                        }
                        return [2 /*return*/, this.generateComprehensiveInsights(recentLearningData)];
                }
            });
        });
    };
    /**
     * Get agent configurations for a user
     */
    TwitterLearningService.prototype.getUserAgentConfigurations = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.agentConfigRepository.find({
                        where: { userId: userId, isActive: true }
                    })];
            });
        });
    };
    return TwitterLearningService;
}());
exports.TwitterLearningService = TwitterLearningService;
