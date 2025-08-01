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
exports.MindshareTrainingData = void 0;
var typeorm_1 = require("typeorm");
var MindshareTrainingData = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('mindshare_training_data'), (0, typeorm_1.Index)(['platformSource', 'scrapedAt']), (0, typeorm_1.Unique)(['platformSource', 'contentHash'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _platformSource_decorators;
    var _platformSource_initializers = [];
    var _platformSource_extraInitializers = [];
    var _contentHash_decorators;
    var _contentHash_initializers = [];
    var _contentHash_extraInitializers = [];
    var _contentText_decorators;
    var _contentText_initializers = [];
    var _contentText_extraInitializers = [];
    var _contentImages_decorators;
    var _contentImages_initializers = [];
    var _contentImages_extraInitializers = [];
    var _engagementMetrics_decorators;
    var _engagementMetrics_initializers = [];
    var _engagementMetrics_extraInitializers = [];
    var _mindshareScore_decorators;
    var _mindshareScore_initializers = [];
    var _mindshareScore_extraInitializers = [];
    var _timestampPosted_decorators;
    var _timestampPosted_initializers = [];
    var _timestampPosted_extraInitializers = [];
    var _campaignContext_decorators;
    var _campaignContext_initializers = [];
    var _campaignContext_extraInitializers = [];
    var _scrapedAt_decorators;
    var _scrapedAt_initializers = [];
    var _scrapedAt_extraInitializers = [];
    var MindshareTrainingData = _classThis = /** @class */ (function () {
        function MindshareTrainingData_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.platformSource = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _platformSource_initializers, void 0)); // 'cookie.fun', 'yaps.kaito.ai', etc.
            this.contentHash = (__runInitializers(this, _platformSource_extraInitializers), __runInitializers(this, _contentHash_initializers, void 0)); // Unique hash of content
            this.contentText = (__runInitializers(this, _contentHash_extraInitializers), __runInitializers(this, _contentText_initializers, void 0));
            this.contentImages = (__runInitializers(this, _contentText_extraInitializers), __runInitializers(this, _contentImages_initializers, void 0));
            this.engagementMetrics = (__runInitializers(this, _contentImages_extraInitializers), __runInitializers(this, _engagementMetrics_initializers, void 0));
            this.mindshareScore = (__runInitializers(this, _engagementMetrics_extraInitializers), __runInitializers(this, _mindshareScore_initializers, void 0));
            this.timestampPosted = (__runInitializers(this, _mindshareScore_extraInitializers), __runInitializers(this, _timestampPosted_initializers, void 0));
            this.campaignContext = (__runInitializers(this, _timestampPosted_extraInitializers), __runInitializers(this, _campaignContext_initializers, void 0));
            this.scrapedAt = (__runInitializers(this, _campaignContext_extraInitializers), __runInitializers(this, _scrapedAt_initializers, void 0));
            __runInitializers(this, _scrapedAt_extraInitializers);
        }
        // Helper methods
        MindshareTrainingData_1.prototype.getEngagementMetrics = function () {
            return this.engagementMetrics || {};
        };
        MindshareTrainingData_1.prototype.getMindshareScore = function () {
            return Number(this.mindshareScore) || 0;
        };
        MindshareTrainingData_1.prototype.addCampaignContext = function (context) {
            this.campaignContext = __assign(__assign({}, this.campaignContext), context);
        };
        MindshareTrainingData_1.prototype.hasHighMindshare = function (threshold) {
            if (threshold === void 0) { threshold = 80; }
            return this.getMindshareScore() >= threshold;
        };
        MindshareTrainingData_1.prototype.getContentFeatures = function () {
            var _a, _b;
            var features = {
                textLength: ((_a = this.contentText) === null || _a === void 0 ? void 0 : _a.length) || 0,
                hasImages: !!(this.contentImages && Object.keys(this.contentImages).length > 0),
                engagementRate: ((_b = this.engagementMetrics) === null || _b === void 0 ? void 0 : _b.engagementRate) || 0,
                mindshareScore: this.getMindshareScore(),
                platform: this.platformSource,
                timePosted: this.timestampPosted,
            };
            return features;
        };
        return MindshareTrainingData_1;
    }());
    __setFunctionName(_classThis, "MindshareTrainingData");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _platformSource_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 50 })];
        _contentHash_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 64 })];
        _contentText_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _contentImages_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _engagementMetrics_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _mindshareScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 4, nullable: true })];
        _timestampPosted_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _campaignContext_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _scrapedAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _platformSource_decorators, { kind: "field", name: "platformSource", static: false, private: false, access: { has: function (obj) { return "platformSource" in obj; }, get: function (obj) { return obj.platformSource; }, set: function (obj, value) { obj.platformSource = value; } }, metadata: _metadata }, _platformSource_initializers, _platformSource_extraInitializers);
        __esDecorate(null, null, _contentHash_decorators, { kind: "field", name: "contentHash", static: false, private: false, access: { has: function (obj) { return "contentHash" in obj; }, get: function (obj) { return obj.contentHash; }, set: function (obj, value) { obj.contentHash = value; } }, metadata: _metadata }, _contentHash_initializers, _contentHash_extraInitializers);
        __esDecorate(null, null, _contentText_decorators, { kind: "field", name: "contentText", static: false, private: false, access: { has: function (obj) { return "contentText" in obj; }, get: function (obj) { return obj.contentText; }, set: function (obj, value) { obj.contentText = value; } }, metadata: _metadata }, _contentText_initializers, _contentText_extraInitializers);
        __esDecorate(null, null, _contentImages_decorators, { kind: "field", name: "contentImages", static: false, private: false, access: { has: function (obj) { return "contentImages" in obj; }, get: function (obj) { return obj.contentImages; }, set: function (obj, value) { obj.contentImages = value; } }, metadata: _metadata }, _contentImages_initializers, _contentImages_extraInitializers);
        __esDecorate(null, null, _engagementMetrics_decorators, { kind: "field", name: "engagementMetrics", static: false, private: false, access: { has: function (obj) { return "engagementMetrics" in obj; }, get: function (obj) { return obj.engagementMetrics; }, set: function (obj, value) { obj.engagementMetrics = value; } }, metadata: _metadata }, _engagementMetrics_initializers, _engagementMetrics_extraInitializers);
        __esDecorate(null, null, _mindshareScore_decorators, { kind: "field", name: "mindshareScore", static: false, private: false, access: { has: function (obj) { return "mindshareScore" in obj; }, get: function (obj) { return obj.mindshareScore; }, set: function (obj, value) { obj.mindshareScore = value; } }, metadata: _metadata }, _mindshareScore_initializers, _mindshareScore_extraInitializers);
        __esDecorate(null, null, _timestampPosted_decorators, { kind: "field", name: "timestampPosted", static: false, private: false, access: { has: function (obj) { return "timestampPosted" in obj; }, get: function (obj) { return obj.timestampPosted; }, set: function (obj, value) { obj.timestampPosted = value; } }, metadata: _metadata }, _timestampPosted_initializers, _timestampPosted_extraInitializers);
        __esDecorate(null, null, _campaignContext_decorators, { kind: "field", name: "campaignContext", static: false, private: false, access: { has: function (obj) { return "campaignContext" in obj; }, get: function (obj) { return obj.campaignContext; }, set: function (obj, value) { obj.campaignContext = value; } }, metadata: _metadata }, _campaignContext_initializers, _campaignContext_extraInitializers);
        __esDecorate(null, null, _scrapedAt_decorators, { kind: "field", name: "scrapedAt", static: false, private: false, access: { has: function (obj) { return "scrapedAt" in obj; }, get: function (obj) { return obj.scrapedAt; }, set: function (obj, value) { obj.scrapedAt = value; } }, metadata: _metadata }, _scrapedAt_initializers, _scrapedAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        MindshareTrainingData = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return MindshareTrainingData = _classThis;
}();
exports.MindshareTrainingData = MindshareTrainingData;
