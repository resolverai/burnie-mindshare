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
exports.Submission = void 0;
var typeorm_1 = require("typeorm");
var Miner_1 = require("./Miner");
var Campaign_1 = require("./Campaign");
var Block_1 = require("./Block");
var index_1 = require("../types/index");
var Submission = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('submissions')];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _content_decorators;
    var _content_initializers = [];
    var _content_extraInitializers = [];
    var _status_decorators;
    var _status_initializers = [];
    var _status_extraInitializers = [];
    var _tokensSpent_decorators;
    var _tokensSpent_initializers = [];
    var _tokensSpent_extraInitializers = [];
    var _transactionHash_decorators;
    var _transactionHash_initializers = [];
    var _transactionHash_extraInitializers = [];
    var _humorScore_decorators;
    var _humorScore_initializers = [];
    var _humorScore_extraInitializers = [];
    var _engagementScore_decorators;
    var _engagementScore_initializers = [];
    var _engagementScore_extraInitializers = [];
    var _originalityScore_decorators;
    var _originalityScore_initializers = [];
    var _originalityScore_extraInitializers = [];
    var _relevanceScore_decorators;
    var _relevanceScore_initializers = [];
    var _relevanceScore_extraInitializers = [];
    var _personalityScore_decorators;
    var _personalityScore_initializers = [];
    var _personalityScore_extraInitializers = [];
    var _totalScore_decorators;
    var _totalScore_initializers = [];
    var _totalScore_extraInitializers = [];
    var _aiAnalysis_decorators;
    var _aiAnalysis_initializers = [];
    var _aiAnalysis_extraInitializers = [];
    var _metadata_decorators;
    var _metadata_initializers = [];
    var _metadata_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var _miner_decorators;
    var _miner_initializers = [];
    var _miner_extraInitializers = [];
    var _minerId_decorators;
    var _minerId_initializers = [];
    var _minerId_extraInitializers = [];
    var _campaign_decorators;
    var _campaign_initializers = [];
    var _campaign_extraInitializers = [];
    var _campaignId_decorators;
    var _campaignId_initializers = [];
    var _campaignId_extraInitializers = [];
    var _block_decorators;
    var _block_initializers = [];
    var _block_extraInitializers = [];
    var _blockId_decorators;
    var _blockId_initializers = [];
    var _blockId_extraInitializers = [];
    var Submission = _classThis = /** @class */ (function () {
        function Submission_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.content = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _content_initializers, void 0));
            this.status = (__runInitializers(this, _content_extraInitializers), __runInitializers(this, _status_initializers, void 0));
            this.tokensSpent = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _tokensSpent_initializers, void 0));
            this.transactionHash = (__runInitializers(this, _tokensSpent_extraInitializers), __runInitializers(this, _transactionHash_initializers, void 0));
            this.humorScore = (__runInitializers(this, _transactionHash_extraInitializers), __runInitializers(this, _humorScore_initializers, void 0));
            this.engagementScore = (__runInitializers(this, _humorScore_extraInitializers), __runInitializers(this, _engagementScore_initializers, void 0));
            this.originalityScore = (__runInitializers(this, _engagementScore_extraInitializers), __runInitializers(this, _originalityScore_initializers, void 0));
            this.relevanceScore = (__runInitializers(this, _originalityScore_extraInitializers), __runInitializers(this, _relevanceScore_initializers, void 0));
            this.personalityScore = (__runInitializers(this, _relevanceScore_extraInitializers), __runInitializers(this, _personalityScore_initializers, void 0));
            this.totalScore = (__runInitializers(this, _personalityScore_extraInitializers), __runInitializers(this, _totalScore_initializers, void 0));
            this.aiAnalysis = (__runInitializers(this, _totalScore_extraInitializers), __runInitializers(this, _aiAnalysis_initializers, void 0));
            this.metadata = (__runInitializers(this, _aiAnalysis_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
            this.createdAt = (__runInitializers(this, _metadata_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            // Relations
            this.miner = (__runInitializers(this, _updatedAt_extraInitializers), __runInitializers(this, _miner_initializers, void 0));
            this.minerId = (__runInitializers(this, _miner_extraInitializers), __runInitializers(this, _minerId_initializers, void 0));
            this.campaign = (__runInitializers(this, _minerId_extraInitializers), __runInitializers(this, _campaign_initializers, void 0));
            this.campaignId = (__runInitializers(this, _campaign_extraInitializers), __runInitializers(this, _campaignId_initializers, void 0));
            this.block = (__runInitializers(this, _campaignId_extraInitializers), __runInitializers(this, _block_initializers, void 0));
            this.blockId = (__runInitializers(this, _block_extraInitializers), __runInitializers(this, _blockId_initializers, void 0));
            __runInitializers(this, _blockId_extraInitializers);
        }
        return Submission_1;
    }());
    __setFunctionName(_classThis, "Submission");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _content_decorators = [(0, typeorm_1.Column)({ type: 'text' })];
        _status_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.SubmissionStatus,
                default: index_1.SubmissionStatus.PENDING,
            }), (0, typeorm_1.Index)()];
        _tokensSpent_decorators = [(0, typeorm_1.Column)({ type: 'bigint' })];
        _transactionHash_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _humorScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, nullable: true })];
        _engagementScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, nullable: true })];
        _originalityScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, nullable: true })];
        _relevanceScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, nullable: true })];
        _personalityScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, nullable: true })];
        _totalScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, nullable: true })];
        _aiAnalysis_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _metadata_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        _miner_decorators = [(0, typeorm_1.ManyToOne)(function () { return Miner_1.Miner; }, function (miner) { return miner.submissions; }), (0, typeorm_1.JoinColumn)({ name: 'minerId' })];
        _minerId_decorators = [(0, typeorm_1.Column)()];
        _campaign_decorators = [(0, typeorm_1.ManyToOne)(function () { return Campaign_1.Campaign; }, function (campaign) { return campaign.submissions; }), (0, typeorm_1.JoinColumn)({ name: 'campaignId' })];
        _campaignId_decorators = [(0, typeorm_1.Column)()];
        _block_decorators = [(0, typeorm_1.ManyToOne)(function () { return Block_1.Block; }, function (block) { return block.submissions; }, { nullable: true }), (0, typeorm_1.JoinColumn)({ name: 'blockId' })];
        _blockId_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _content_decorators, { kind: "field", name: "content", static: false, private: false, access: { has: function (obj) { return "content" in obj; }, get: function (obj) { return obj.content; }, set: function (obj, value) { obj.content = value; } }, metadata: _metadata }, _content_initializers, _content_extraInitializers);
        __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: function (obj) { return "status" in obj; }, get: function (obj) { return obj.status; }, set: function (obj, value) { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
        __esDecorate(null, null, _tokensSpent_decorators, { kind: "field", name: "tokensSpent", static: false, private: false, access: { has: function (obj) { return "tokensSpent" in obj; }, get: function (obj) { return obj.tokensSpent; }, set: function (obj, value) { obj.tokensSpent = value; } }, metadata: _metadata }, _tokensSpent_initializers, _tokensSpent_extraInitializers);
        __esDecorate(null, null, _transactionHash_decorators, { kind: "field", name: "transactionHash", static: false, private: false, access: { has: function (obj) { return "transactionHash" in obj; }, get: function (obj) { return obj.transactionHash; }, set: function (obj, value) { obj.transactionHash = value; } }, metadata: _metadata }, _transactionHash_initializers, _transactionHash_extraInitializers);
        __esDecorate(null, null, _humorScore_decorators, { kind: "field", name: "humorScore", static: false, private: false, access: { has: function (obj) { return "humorScore" in obj; }, get: function (obj) { return obj.humorScore; }, set: function (obj, value) { obj.humorScore = value; } }, metadata: _metadata }, _humorScore_initializers, _humorScore_extraInitializers);
        __esDecorate(null, null, _engagementScore_decorators, { kind: "field", name: "engagementScore", static: false, private: false, access: { has: function (obj) { return "engagementScore" in obj; }, get: function (obj) { return obj.engagementScore; }, set: function (obj, value) { obj.engagementScore = value; } }, metadata: _metadata }, _engagementScore_initializers, _engagementScore_extraInitializers);
        __esDecorate(null, null, _originalityScore_decorators, { kind: "field", name: "originalityScore", static: false, private: false, access: { has: function (obj) { return "originalityScore" in obj; }, get: function (obj) { return obj.originalityScore; }, set: function (obj, value) { obj.originalityScore = value; } }, metadata: _metadata }, _originalityScore_initializers, _originalityScore_extraInitializers);
        __esDecorate(null, null, _relevanceScore_decorators, { kind: "field", name: "relevanceScore", static: false, private: false, access: { has: function (obj) { return "relevanceScore" in obj; }, get: function (obj) { return obj.relevanceScore; }, set: function (obj, value) { obj.relevanceScore = value; } }, metadata: _metadata }, _relevanceScore_initializers, _relevanceScore_extraInitializers);
        __esDecorate(null, null, _personalityScore_decorators, { kind: "field", name: "personalityScore", static: false, private: false, access: { has: function (obj) { return "personalityScore" in obj; }, get: function (obj) { return obj.personalityScore; }, set: function (obj, value) { obj.personalityScore = value; } }, metadata: _metadata }, _personalityScore_initializers, _personalityScore_extraInitializers);
        __esDecorate(null, null, _totalScore_decorators, { kind: "field", name: "totalScore", static: false, private: false, access: { has: function (obj) { return "totalScore" in obj; }, get: function (obj) { return obj.totalScore; }, set: function (obj, value) { obj.totalScore = value; } }, metadata: _metadata }, _totalScore_initializers, _totalScore_extraInitializers);
        __esDecorate(null, null, _aiAnalysis_decorators, { kind: "field", name: "aiAnalysis", static: false, private: false, access: { has: function (obj) { return "aiAnalysis" in obj; }, get: function (obj) { return obj.aiAnalysis; }, set: function (obj, value) { obj.aiAnalysis = value; } }, metadata: _metadata }, _aiAnalysis_initializers, _aiAnalysis_extraInitializers);
        __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: function (obj) { return "metadata" in obj; }, get: function (obj) { return obj.metadata; }, set: function (obj, value) { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, null, _miner_decorators, { kind: "field", name: "miner", static: false, private: false, access: { has: function (obj) { return "miner" in obj; }, get: function (obj) { return obj.miner; }, set: function (obj, value) { obj.miner = value; } }, metadata: _metadata }, _miner_initializers, _miner_extraInitializers);
        __esDecorate(null, null, _minerId_decorators, { kind: "field", name: "minerId", static: false, private: false, access: { has: function (obj) { return "minerId" in obj; }, get: function (obj) { return obj.minerId; }, set: function (obj, value) { obj.minerId = value; } }, metadata: _metadata }, _minerId_initializers, _minerId_extraInitializers);
        __esDecorate(null, null, _campaign_decorators, { kind: "field", name: "campaign", static: false, private: false, access: { has: function (obj) { return "campaign" in obj; }, get: function (obj) { return obj.campaign; }, set: function (obj, value) { obj.campaign = value; } }, metadata: _metadata }, _campaign_initializers, _campaign_extraInitializers);
        __esDecorate(null, null, _campaignId_decorators, { kind: "field", name: "campaignId", static: false, private: false, access: { has: function (obj) { return "campaignId" in obj; }, get: function (obj) { return obj.campaignId; }, set: function (obj, value) { obj.campaignId = value; } }, metadata: _metadata }, _campaignId_initializers, _campaignId_extraInitializers);
        __esDecorate(null, null, _block_decorators, { kind: "field", name: "block", static: false, private: false, access: { has: function (obj) { return "block" in obj; }, get: function (obj) { return obj.block; }, set: function (obj, value) { obj.block = value; } }, metadata: _metadata }, _block_initializers, _block_extraInitializers);
        __esDecorate(null, null, _blockId_decorators, { kind: "field", name: "blockId", static: false, private: false, access: { has: function (obj) { return "blockId" in obj; }, get: function (obj) { return obj.blockId; }, set: function (obj, value) { obj.blockId = value; } }, metadata: _metadata }, _blockId_initializers, _blockId_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        Submission = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return Submission = _classThis;
}();
exports.Submission = Submission;
