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
exports.Block = void 0;
var typeorm_1 = require("typeorm");
var Submission_1 = require("./Submission");
var Reward_1 = require("./Reward");
var Campaign_1 = require("./Campaign");
var index_1 = require("../types/index");
var Block = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('blocks')];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _blockNumber_decorators;
    var _blockNumber_initializers = [];
    var _blockNumber_extraInitializers = [];
    var _hash_decorators;
    var _hash_initializers = [];
    var _hash_extraInitializers = [];
    var _status_decorators;
    var _status_initializers = [];
    var _status_extraInitializers = [];
    var _minerIds_decorators;
    var _minerIds_initializers = [];
    var _minerIds_extraInitializers = [];
    var _submissionCount_decorators;
    var _submissionCount_initializers = [];
    var _submissionCount_extraInitializers = [];
    var _totalRewards_decorators;
    var _totalRewards_initializers = [];
    var _totalRewards_extraInitializers = [];
    var _minedAt_decorators;
    var _minedAt_initializers = [];
    var _minedAt_extraInitializers = [];
    var _confirmedAt_decorators;
    var _confirmedAt_initializers = [];
    var _confirmedAt_extraInitializers = [];
    var _campaign_id_decorators;
    var _campaign_id_initializers = [];
    var _campaign_id_extraInitializers = [];
    var _metadata_decorators;
    var _metadata_initializers = [];
    var _metadata_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var _campaign_decorators;
    var _campaign_initializers = [];
    var _campaign_extraInitializers = [];
    var _submissions_decorators;
    var _submissions_initializers = [];
    var _submissions_extraInitializers = [];
    var _rewards_decorators;
    var _rewards_initializers = [];
    var _rewards_extraInitializers = [];
    var Block = _classThis = /** @class */ (function () {
        function Block_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.blockNumber = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _blockNumber_initializers, void 0));
            this.hash = (__runInitializers(this, _blockNumber_extraInitializers), __runInitializers(this, _hash_initializers, void 0));
            this.status = (__runInitializers(this, _hash_extraInitializers), __runInitializers(this, _status_initializers, void 0));
            this.minerIds = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _minerIds_initializers, void 0));
            this.submissionCount = (__runInitializers(this, _minerIds_extraInitializers), __runInitializers(this, _submissionCount_initializers, void 0));
            this.totalRewards = (__runInitializers(this, _submissionCount_extraInitializers), __runInitializers(this, _totalRewards_initializers, void 0));
            this.minedAt = (__runInitializers(this, _totalRewards_extraInitializers), __runInitializers(this, _minedAt_initializers, void 0));
            this.confirmedAt = (__runInitializers(this, _minedAt_extraInitializers), __runInitializers(this, _confirmedAt_initializers, void 0));
            this.campaign_id = (__runInitializers(this, _confirmedAt_extraInitializers), __runInitializers(this, _campaign_id_initializers, void 0));
            this.metadata = (__runInitializers(this, _campaign_id_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
            this.createdAt = (__runInitializers(this, _metadata_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            // Relations
            this.campaign = (__runInitializers(this, _updatedAt_extraInitializers), __runInitializers(this, _campaign_initializers, void 0));
            this.submissions = (__runInitializers(this, _campaign_extraInitializers), __runInitializers(this, _submissions_initializers, void 0));
            this.rewards = (__runInitializers(this, _submissions_extraInitializers), __runInitializers(this, _rewards_initializers, void 0));
            __runInitializers(this, _rewards_extraInitializers);
        }
        return Block_1;
    }());
    __setFunctionName(_classThis, "Block");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _blockNumber_decorators = [(0, typeorm_1.Column)({ unique: true }), (0, typeorm_1.Index)()];
        _hash_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _status_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.BlockStatus,
                default: index_1.BlockStatus.PENDING,
            }), (0, typeorm_1.Index)()];
        _minerIds_decorators = [(0, typeorm_1.Column)({ type: 'jsonb' })];
        _submissionCount_decorators = [(0, typeorm_1.Column)({ default: 0 })];
        _totalRewards_decorators = [(0, typeorm_1.Column)({ type: 'bigint' })];
        _minedAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp' })];
        _confirmedAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _campaign_id_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _metadata_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        _campaign_decorators = [(0, typeorm_1.ManyToOne)(function () { return Campaign_1.Campaign; }, function (campaign) { return campaign.blocks; }), (0, typeorm_1.JoinColumn)({ name: 'campaign_id' })];
        _submissions_decorators = [(0, typeorm_1.OneToMany)(function () { return Submission_1.Submission; }, function (submission) { return submission.block; })];
        _rewards_decorators = [(0, typeorm_1.OneToMany)(function () { return Reward_1.Reward; }, function (reward) { return reward.block; })];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _blockNumber_decorators, { kind: "field", name: "blockNumber", static: false, private: false, access: { has: function (obj) { return "blockNumber" in obj; }, get: function (obj) { return obj.blockNumber; }, set: function (obj, value) { obj.blockNumber = value; } }, metadata: _metadata }, _blockNumber_initializers, _blockNumber_extraInitializers);
        __esDecorate(null, null, _hash_decorators, { kind: "field", name: "hash", static: false, private: false, access: { has: function (obj) { return "hash" in obj; }, get: function (obj) { return obj.hash; }, set: function (obj, value) { obj.hash = value; } }, metadata: _metadata }, _hash_initializers, _hash_extraInitializers);
        __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: function (obj) { return "status" in obj; }, get: function (obj) { return obj.status; }, set: function (obj, value) { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
        __esDecorate(null, null, _minerIds_decorators, { kind: "field", name: "minerIds", static: false, private: false, access: { has: function (obj) { return "minerIds" in obj; }, get: function (obj) { return obj.minerIds; }, set: function (obj, value) { obj.minerIds = value; } }, metadata: _metadata }, _minerIds_initializers, _minerIds_extraInitializers);
        __esDecorate(null, null, _submissionCount_decorators, { kind: "field", name: "submissionCount", static: false, private: false, access: { has: function (obj) { return "submissionCount" in obj; }, get: function (obj) { return obj.submissionCount; }, set: function (obj, value) { obj.submissionCount = value; } }, metadata: _metadata }, _submissionCount_initializers, _submissionCount_extraInitializers);
        __esDecorate(null, null, _totalRewards_decorators, { kind: "field", name: "totalRewards", static: false, private: false, access: { has: function (obj) { return "totalRewards" in obj; }, get: function (obj) { return obj.totalRewards; }, set: function (obj, value) { obj.totalRewards = value; } }, metadata: _metadata }, _totalRewards_initializers, _totalRewards_extraInitializers);
        __esDecorate(null, null, _minedAt_decorators, { kind: "field", name: "minedAt", static: false, private: false, access: { has: function (obj) { return "minedAt" in obj; }, get: function (obj) { return obj.minedAt; }, set: function (obj, value) { obj.minedAt = value; } }, metadata: _metadata }, _minedAt_initializers, _minedAt_extraInitializers);
        __esDecorate(null, null, _confirmedAt_decorators, { kind: "field", name: "confirmedAt", static: false, private: false, access: { has: function (obj) { return "confirmedAt" in obj; }, get: function (obj) { return obj.confirmedAt; }, set: function (obj, value) { obj.confirmedAt = value; } }, metadata: _metadata }, _confirmedAt_initializers, _confirmedAt_extraInitializers);
        __esDecorate(null, null, _campaign_id_decorators, { kind: "field", name: "campaign_id", static: false, private: false, access: { has: function (obj) { return "campaign_id" in obj; }, get: function (obj) { return obj.campaign_id; }, set: function (obj, value) { obj.campaign_id = value; } }, metadata: _metadata }, _campaign_id_initializers, _campaign_id_extraInitializers);
        __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: function (obj) { return "metadata" in obj; }, get: function (obj) { return obj.metadata; }, set: function (obj, value) { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, null, _campaign_decorators, { kind: "field", name: "campaign", static: false, private: false, access: { has: function (obj) { return "campaign" in obj; }, get: function (obj) { return obj.campaign; }, set: function (obj, value) { obj.campaign = value; } }, metadata: _metadata }, _campaign_initializers, _campaign_extraInitializers);
        __esDecorate(null, null, _submissions_decorators, { kind: "field", name: "submissions", static: false, private: false, access: { has: function (obj) { return "submissions" in obj; }, get: function (obj) { return obj.submissions; }, set: function (obj, value) { obj.submissions = value; } }, metadata: _metadata }, _submissions_initializers, _submissions_extraInitializers);
        __esDecorate(null, null, _rewards_decorators, { kind: "field", name: "rewards", static: false, private: false, access: { has: function (obj) { return "rewards" in obj; }, get: function (obj) { return obj.rewards; }, set: function (obj, value) { obj.rewards = value; } }, metadata: _metadata }, _rewards_initializers, _rewards_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        Block = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return Block = _classThis;
}();
exports.Block = Block;
