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
exports.ContentMarketplace = void 0;
var typeorm_1 = require("typeorm");
var User_1 = require("./User");
var Campaign_1 = require("./Campaign");
var ContentMarketplace = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('content_marketplace'), (0, typeorm_1.Index)(['isAvailable', 'predictedMindshare']), (0, typeorm_1.Index)(['creatorId']), (0, typeorm_1.Index)(['campaignId'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _creatorId_decorators;
    var _creatorId_initializers = [];
    var _creatorId_extraInitializers = [];
    var _campaignId_decorators;
    var _campaignId_initializers = [];
    var _campaignId_extraInitializers = [];
    var _contentText_decorators;
    var _contentText_initializers = [];
    var _contentText_extraInitializers = [];
    var _contentImages_decorators;
    var _contentImages_initializers = [];
    var _contentImages_extraInitializers = [];
    var _predictedMindshare_decorators;
    var _predictedMindshare_initializers = [];
    var _predictedMindshare_extraInitializers = [];
    var _qualityScore_decorators;
    var _qualityScore_initializers = [];
    var _qualityScore_extraInitializers = [];
    var _askingPrice_decorators;
    var _askingPrice_initializers = [];
    var _askingPrice_extraInitializers = [];
    var _isAvailable_decorators;
    var _isAvailable_initializers = [];
    var _isAvailable_extraInitializers = [];
    var _generationMetadata_decorators;
    var _generationMetadata_initializers = [];
    var _generationMetadata_extraInitializers = [];
    var _creator_decorators;
    var _creator_initializers = [];
    var _creator_extraInitializers = [];
    var _campaign_decorators;
    var _campaign_initializers = [];
    var _campaign_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var ContentMarketplace = _classThis = /** @class */ (function () {
        function ContentMarketplace_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.creatorId = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _creatorId_initializers, void 0));
            this.campaignId = (__runInitializers(this, _creatorId_extraInitializers), __runInitializers(this, _campaignId_initializers, void 0));
            this.contentText = (__runInitializers(this, _campaignId_extraInitializers), __runInitializers(this, _contentText_initializers, void 0));
            this.contentImages = (__runInitializers(this, _contentText_extraInitializers), __runInitializers(this, _contentImages_initializers, void 0));
            this.predictedMindshare = (__runInitializers(this, _contentImages_extraInitializers), __runInitializers(this, _predictedMindshare_initializers, void 0));
            this.qualityScore = (__runInitializers(this, _predictedMindshare_extraInitializers), __runInitializers(this, _qualityScore_initializers, void 0));
            this.askingPrice = (__runInitializers(this, _qualityScore_extraInitializers), __runInitializers(this, _askingPrice_initializers, void 0));
            this.isAvailable = (__runInitializers(this, _askingPrice_extraInitializers), __runInitializers(this, _isAvailable_initializers, void 0));
            this.generationMetadata = (__runInitializers(this, _isAvailable_extraInitializers), __runInitializers(this, _generationMetadata_initializers, void 0));
            // Relations
            this.creator = (__runInitializers(this, _generationMetadata_extraInitializers), __runInitializers(this, _creator_initializers, void 0));
            this.campaign = (__runInitializers(this, _creator_extraInitializers), __runInitializers(this, _campaign_initializers, void 0));
            this.createdAt = (__runInitializers(this, _campaign_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            __runInitializers(this, _createdAt_extraInitializers);
        }
        // Helper methods
        ContentMarketplace_1.prototype.getPredictedMindshare = function () {
            return Number(this.predictedMindshare);
        };
        ContentMarketplace_1.prototype.getQualityScore = function () {
            return Number(this.qualityScore);
        };
        ContentMarketplace_1.prototype.getAskingPrice = function () {
            return Number(this.askingPrice);
        };
        ContentMarketplace_1.prototype.getPerformanceScore = function () {
            // Combine mindshare and quality for overall performance score
            return (this.getPredictedMindshare() * 0.6) + (this.getQualityScore() * 4); // Scale quality to 40
        };
        ContentMarketplace_1.prototype.isHighQuality = function (threshold) {
            if (threshold === void 0) { threshold = 85; }
            return this.getQualityScore() >= threshold;
        };
        ContentMarketplace_1.prototype.isHighMindshare = function (threshold) {
            if (threshold === void 0) { threshold = 80; }
            return this.getPredictedMindshare() >= threshold;
        };
        ContentMarketplace_1.prototype.markAsSold = function () {
            this.isAvailable = false;
        };
        ContentMarketplace_1.prototype.getGenerationDetails = function () {
            return this.generationMetadata || {};
        };
        ContentMarketplace_1.prototype.getContentPreview = function (maxLength) {
            if (maxLength === void 0) { maxLength = 100; }
            return this.contentText.length > maxLength
                ? this.contentText.substring(0, maxLength) + '...'
                : this.contentText;
        };
        ContentMarketplace_1.prototype.getValueScore = function () {
            // Calculate value score based on predicted performance vs asking price
            var performanceScore = this.getPerformanceScore();
            var price = this.getAskingPrice();
            return price > 0 ? performanceScore / price : performanceScore;
        };
        return ContentMarketplace_1;
    }());
    __setFunctionName(_classThis, "ContentMarketplace");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _creatorId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _campaignId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _contentText_decorators = [(0, typeorm_1.Column)({ type: 'text' })];
        _contentImages_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _predictedMindshare_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 4 })];
        _qualityScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2 })];
        _askingPrice_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 8 })];
        _isAvailable_decorators = [(0, typeorm_1.Column)({ type: 'boolean', default: true })];
        _generationMetadata_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _creator_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.id; }), (0, typeorm_1.JoinColumn)({ name: 'creatorId' })];
        _campaign_decorators = [(0, typeorm_1.ManyToOne)(function () { return Campaign_1.Campaign; }, function (campaign) { return campaign.id; }), (0, typeorm_1.JoinColumn)({ name: 'campaignId' })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _creatorId_decorators, { kind: "field", name: "creatorId", static: false, private: false, access: { has: function (obj) { return "creatorId" in obj; }, get: function (obj) { return obj.creatorId; }, set: function (obj, value) { obj.creatorId = value; } }, metadata: _metadata }, _creatorId_initializers, _creatorId_extraInitializers);
        __esDecorate(null, null, _campaignId_decorators, { kind: "field", name: "campaignId", static: false, private: false, access: { has: function (obj) { return "campaignId" in obj; }, get: function (obj) { return obj.campaignId; }, set: function (obj, value) { obj.campaignId = value; } }, metadata: _metadata }, _campaignId_initializers, _campaignId_extraInitializers);
        __esDecorate(null, null, _contentText_decorators, { kind: "field", name: "contentText", static: false, private: false, access: { has: function (obj) { return "contentText" in obj; }, get: function (obj) { return obj.contentText; }, set: function (obj, value) { obj.contentText = value; } }, metadata: _metadata }, _contentText_initializers, _contentText_extraInitializers);
        __esDecorate(null, null, _contentImages_decorators, { kind: "field", name: "contentImages", static: false, private: false, access: { has: function (obj) { return "contentImages" in obj; }, get: function (obj) { return obj.contentImages; }, set: function (obj, value) { obj.contentImages = value; } }, metadata: _metadata }, _contentImages_initializers, _contentImages_extraInitializers);
        __esDecorate(null, null, _predictedMindshare_decorators, { kind: "field", name: "predictedMindshare", static: false, private: false, access: { has: function (obj) { return "predictedMindshare" in obj; }, get: function (obj) { return obj.predictedMindshare; }, set: function (obj, value) { obj.predictedMindshare = value; } }, metadata: _metadata }, _predictedMindshare_initializers, _predictedMindshare_extraInitializers);
        __esDecorate(null, null, _qualityScore_decorators, { kind: "field", name: "qualityScore", static: false, private: false, access: { has: function (obj) { return "qualityScore" in obj; }, get: function (obj) { return obj.qualityScore; }, set: function (obj, value) { obj.qualityScore = value; } }, metadata: _metadata }, _qualityScore_initializers, _qualityScore_extraInitializers);
        __esDecorate(null, null, _askingPrice_decorators, { kind: "field", name: "askingPrice", static: false, private: false, access: { has: function (obj) { return "askingPrice" in obj; }, get: function (obj) { return obj.askingPrice; }, set: function (obj, value) { obj.askingPrice = value; } }, metadata: _metadata }, _askingPrice_initializers, _askingPrice_extraInitializers);
        __esDecorate(null, null, _isAvailable_decorators, { kind: "field", name: "isAvailable", static: false, private: false, access: { has: function (obj) { return "isAvailable" in obj; }, get: function (obj) { return obj.isAvailable; }, set: function (obj, value) { obj.isAvailable = value; } }, metadata: _metadata }, _isAvailable_initializers, _isAvailable_extraInitializers);
        __esDecorate(null, null, _generationMetadata_decorators, { kind: "field", name: "generationMetadata", static: false, private: false, access: { has: function (obj) { return "generationMetadata" in obj; }, get: function (obj) { return obj.generationMetadata; }, set: function (obj, value) { obj.generationMetadata = value; } }, metadata: _metadata }, _generationMetadata_initializers, _generationMetadata_extraInitializers);
        __esDecorate(null, null, _creator_decorators, { kind: "field", name: "creator", static: false, private: false, access: { has: function (obj) { return "creator" in obj; }, get: function (obj) { return obj.creator; }, set: function (obj, value) { obj.creator = value; } }, metadata: _metadata }, _creator_initializers, _creator_extraInitializers);
        __esDecorate(null, null, _campaign_decorators, { kind: "field", name: "campaign", static: false, private: false, access: { has: function (obj) { return "campaign" in obj; }, get: function (obj) { return obj.campaign; }, set: function (obj, value) { obj.campaign = value; } }, metadata: _metadata }, _campaign_initializers, _campaign_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        ContentMarketplace = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return ContentMarketplace = _classThis;
}();
exports.ContentMarketplace = ContentMarketplace;
