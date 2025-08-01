"use strict";
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwitterLearningData = void 0;
var typeorm_1 = require("typeorm");
var User_1 = require("./User");
var TwitterLearningData = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('twitter_learning_data'), (0, typeorm_1.Index)(['userId', 'processedAt']), (0, typeorm_1.Unique)(['tweetId'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _userId_decorators;
    var _userId_initializers = [];
    var _userId_extraInitializers = [];
    var _tweetId_decorators;
    var _tweetId_initializers = [];
    var _tweetId_extraInitializers = [];
    var _tweetText_decorators;
    var _tweetText_initializers = [];
    var _tweetText_extraInitializers = [];
    var _engagementMetrics_decorators;
    var _engagementMetrics_initializers = [];
    var _engagementMetrics_extraInitializers = [];
    var _postingTime_decorators;
    var _postingTime_initializers = [];
    var _postingTime_extraInitializers = [];
    var _analyzedFeatures_decorators;
    var _analyzedFeatures_initializers = [];
    var _analyzedFeatures_extraInitializers = [];
    var _learningInsights_decorators;
    var _learningInsights_initializers = [];
    var _learningInsights_extraInitializers = [];
    var _user_decorators;
    var _user_initializers = [];
    var _user_extraInitializers = [];
    var _processedAt_decorators;
    var _processedAt_initializers = [];
    var _processedAt_extraInitializers = [];
    var TwitterLearningData = _classThis = /** @class */ (function () {
        function TwitterLearningData_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.userId = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _userId_initializers, void 0));
            this.tweetId = (__runInitializers(this, _userId_extraInitializers), __runInitializers(this, _tweetId_initializers, void 0));
            this.tweetText = (__runInitializers(this, _tweetId_extraInitializers), __runInitializers(this, _tweetText_initializers, void 0));
            this.engagementMetrics = (__runInitializers(this, _tweetText_extraInitializers), __runInitializers(this, _engagementMetrics_initializers, void 0));
            this.postingTime = (__runInitializers(this, _engagementMetrics_extraInitializers), __runInitializers(this, _postingTime_initializers, void 0));
            this.analyzedFeatures = (__runInitializers(this, _postingTime_extraInitializers), __runInitializers(this, _analyzedFeatures_initializers, void 0));
            this.learningInsights = (__runInitializers(this, _analyzedFeatures_extraInitializers), __runInitializers(this, _learningInsights_initializers, void 0));
            // Relations
            this.user = (__runInitializers(this, _learningInsights_extraInitializers), __runInitializers(this, _user_initializers, void 0));
            this.processedAt = (__runInitializers(this, _user_extraInitializers), __runInitializers(this, _processedAt_initializers, void 0));
            __runInitializers(this, _processedAt_extraInitializers);
        }
        // Helper methods
        TwitterLearningData_1.prototype.getEngagementMetrics = function () {
            return this.engagementMetrics || {};
        };
        TwitterLearningData_1.prototype.getEngagementRate = function () {
            var metrics = this.getEngagementMetrics();
            var impressions = metrics.impressions || 0;
            var totalEngagements = (metrics.likes || 0) + (metrics.retweets || 0) + (metrics.replies || 0);
            return impressions > 0 ? (totalEngagements / impressions) * 100 : 0;
        };
        TwitterLearningData_1.prototype.getLearningInsights = function () {
            return this.learningInsights || {};
        };
        TwitterLearningData_1.prototype.addLearningInsight = function (key, value) {
            if (!this.learningInsights) {
                this.learningInsights = {};
            }
            this.learningInsights[key] = value;
        };
        TwitterLearningData_1.prototype.getAnalyzedFeatures = function () {
            return this.analyzedFeatures || {};
        };
        TwitterLearningData_1.prototype.addAnalyzedFeature = function (feature, value) {
            if (!this.analyzedFeatures) {
                this.analyzedFeatures = {};
            }
            this.analyzedFeatures[feature] = value;
        };
        TwitterLearningData_1.prototype.isHighPerformance = function (threshold) {
            if (threshold === void 0) { threshold = 2.0; }
            return this.getEngagementRate() >= threshold;
        };
        TwitterLearningData_1.prototype.getContentLength = function () {
            var _a;
            return ((_a = this.tweetText) === null || _a === void 0 ? void 0 : _a.length) || 0;
        };
        TwitterLearningData_1.prototype.hasHashtags = function () {
            return !!(this.tweetText && this.tweetText.includes('#'));
        };
        TwitterLearningData_1.prototype.hasMentions = function () {
            return !!(this.tweetText && this.tweetText.includes('@'));
        };
        TwitterLearningData_1.prototype.hasMedia = function () {
            var features = this.getAnalyzedFeatures();
            return features.hasImages || features.hasVideo || false;
        };
        TwitterLearningData_1.prototype.getTweetAge = function () {
            if (!this.postingTime)
                return 0;
            return Date.now() - this.postingTime.getTime();
        };
        TwitterLearningData_1.prototype.getProcessingAge = function () {
            return Date.now() - this.processedAt.getTime();
        };
        TwitterLearningData_1.prototype.extractContentFeatures = function () {
            var text = this.tweetText || '';
            var engagement = this.getEngagementMetrics();
            return {
                textLength: text.length,
                wordCount: text.split(/\s+/).length,
                hashtagCount: (text.match(/#\w+/g) || []).length,
                mentionCount: (text.match(/@\w+/g) || []).length,
                urlCount: (text.match(/https?:\/\/\S+/g) || []).length,
                hasEmojis: /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/u.test(text),
                engagementRate: this.getEngagementRate(),
                totalLikes: engagement.likes || 0,
                totalRetweets: engagement.retweets || 0,
                totalReplies: engagement.replies || 0,
                postingHour: this.postingTime ? this.postingTime.getHours() : null,
                dayOfWeek: this.postingTime ? this.postingTime.getDay() : null,
            };
        };
        return TwitterLearningData_1;
    }());
    __setFunctionName(_classThis, "TwitterLearningData");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _userId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _tweetId_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 50 })];
        _tweetText_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _engagementMetrics_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _postingTime_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _analyzedFeatures_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _learningInsights_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _user_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.id; }), (0, typeorm_1.JoinColumn)({ name: 'userId' })];
        _processedAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _userId_decorators, { kind: "field", name: "userId", static: false, private: false, access: { has: function (obj) { return "userId" in obj; }, get: function (obj) { return obj.userId; }, set: function (obj, value) { obj.userId = value; } }, metadata: _metadata }, _userId_initializers, _userId_extraInitializers);
        __esDecorate(null, null, _tweetId_decorators, { kind: "field", name: "tweetId", static: false, private: false, access: { has: function (obj) { return "tweetId" in obj; }, get: function (obj) { return obj.tweetId; }, set: function (obj, value) { obj.tweetId = value; } }, metadata: _metadata }, _tweetId_initializers, _tweetId_extraInitializers);
        __esDecorate(null, null, _tweetText_decorators, { kind: "field", name: "tweetText", static: false, private: false, access: { has: function (obj) { return "tweetText" in obj; }, get: function (obj) { return obj.tweetText; }, set: function (obj, value) { obj.tweetText = value; } }, metadata: _metadata }, _tweetText_initializers, _tweetText_extraInitializers);
        __esDecorate(null, null, _engagementMetrics_decorators, { kind: "field", name: "engagementMetrics", static: false, private: false, access: { has: function (obj) { return "engagementMetrics" in obj; }, get: function (obj) { return obj.engagementMetrics; }, set: function (obj, value) { obj.engagementMetrics = value; } }, metadata: _metadata }, _engagementMetrics_initializers, _engagementMetrics_extraInitializers);
        __esDecorate(null, null, _postingTime_decorators, { kind: "field", name: "postingTime", static: false, private: false, access: { has: function (obj) { return "postingTime" in obj; }, get: function (obj) { return obj.postingTime; }, set: function (obj, value) { obj.postingTime = value; } }, metadata: _metadata }, _postingTime_initializers, _postingTime_extraInitializers);
        __esDecorate(null, null, _analyzedFeatures_decorators, { kind: "field", name: "analyzedFeatures", static: false, private: false, access: { has: function (obj) { return "analyzedFeatures" in obj; }, get: function (obj) { return obj.analyzedFeatures; }, set: function (obj, value) { obj.analyzedFeatures = value; } }, metadata: _metadata }, _analyzedFeatures_initializers, _analyzedFeatures_extraInitializers);
        __esDecorate(null, null, _learningInsights_decorators, { kind: "field", name: "learningInsights", static: false, private: false, access: { has: function (obj) { return "learningInsights" in obj; }, get: function (obj) { return obj.learningInsights; }, set: function (obj, value) { obj.learningInsights = value; } }, metadata: _metadata }, _learningInsights_initializers, _learningInsights_extraInitializers);
        __esDecorate(null, null, _user_decorators, { kind: "field", name: "user", static: false, private: false, access: { has: function (obj) { return "user" in obj; }, get: function (obj) { return obj.user; }, set: function (obj, value) { obj.user = value; } }, metadata: _metadata }, _user_initializers, _user_extraInitializers);
        __esDecorate(null, null, _processedAt_decorators, { kind: "field", name: "processedAt", static: false, private: false, access: { has: function (obj) { return "processedAt" in obj; }, get: function (obj) { return obj.processedAt; }, set: function (obj, value) { obj.processedAt = value; } }, metadata: _metadata }, _processedAt_initializers, _processedAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        TwitterLearningData = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return TwitterLearningData = _classThis;
}();
exports.TwitterLearningData = TwitterLearningData;
