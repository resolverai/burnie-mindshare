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
exports.Miner = void 0;
var typeorm_1 = require("typeorm");
var User_1 = require("./User");
var Submission_1 = require("./Submission");
var Reward_1 = require("./Reward");
var SocialAccount_1 = require("./SocialAccount");
var index_1 = require("../types/index");
var Miner = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('miners')];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _walletAddress_decorators;
    var _walletAddress_initializers = [];
    var _walletAddress_extraInitializers = [];
    var _username_decorators;
    var _username_initializers = [];
    var _username_extraInitializers = [];
    var _nickname_decorators;
    var _nickname_initializers = [];
    var _nickname_extraInitializers = [];
    var _agentName_decorators;
    var _agentName_initializers = [];
    var _agentName_extraInitializers = [];
    var _agentPersonality_decorators;
    var _agentPersonality_initializers = [];
    var _agentPersonality_extraInitializers = [];
    var _llmProvider_decorators;
    var _llmProvider_initializers = [];
    var _llmProvider_extraInitializers = [];
    var _llmModel_decorators;
    var _llmModel_initializers = [];
    var _llmModel_extraInitializers = [];
    var _status_decorators;
    var _status_initializers = [];
    var _status_extraInitializers = [];
    var _isAvailable_decorators;
    var _isAvailable_initializers = [];
    var _isAvailable_extraInitializers = [];
    var _roastBalance_decorators;
    var _roastBalance_initializers = [];
    var _roastBalance_extraInitializers = [];
    var _totalEarnings_decorators;
    var _totalEarnings_initializers = [];
    var _totalEarnings_extraInitializers = [];
    var _submissionCount_decorators;
    var _submissionCount_initializers = [];
    var _submissionCount_extraInitializers = [];
    var _approvedSubmissionCount_decorators;
    var _approvedSubmissionCount_initializers = [];
    var _approvedSubmissionCount_extraInitializers = [];
    var _averageScore_decorators;
    var _averageScore_initializers = [];
    var _averageScore_extraInitializers = [];
    var _approvalRate_decorators;
    var _approvalRate_initializers = [];
    var _approvalRate_extraInitializers = [];
    var _configuration_decorators;
    var _configuration_initializers = [];
    var _configuration_extraInitializers = [];
    var _statistics_decorators;
    var _statistics_initializers = [];
    var _statistics_extraInitializers = [];
    var _ipAddress_decorators;
    var _ipAddress_initializers = [];
    var _ipAddress_extraInitializers = [];
    var _userAgent_decorators;
    var _userAgent_initializers = [];
    var _userAgent_extraInitializers = [];
    var _lastHeartbeatAt_decorators;
    var _lastHeartbeatAt_initializers = [];
    var _lastHeartbeatAt_extraInitializers = [];
    var _lastActiveAt_decorators;
    var _lastActiveAt_initializers = [];
    var _lastActiveAt_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var _user_decorators;
    var _user_initializers = [];
    var _user_extraInitializers = [];
    var _userId_decorators;
    var _userId_initializers = [];
    var _userId_extraInitializers = [];
    var _submissions_decorators;
    var _submissions_initializers = [];
    var _submissions_extraInitializers = [];
    var _rewards_decorators;
    var _rewards_initializers = [];
    var _rewards_extraInitializers = [];
    var _socialAccounts_decorators;
    var _socialAccounts_initializers = [];
    var _socialAccounts_extraInitializers = [];
    var Miner = _classThis = /** @class */ (function () {
        function Miner_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.walletAddress = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _walletAddress_initializers, void 0));
            this.username = (__runInitializers(this, _walletAddress_extraInitializers), __runInitializers(this, _username_initializers, void 0));
            this.nickname = (__runInitializers(this, _username_extraInitializers), __runInitializers(this, _nickname_initializers, void 0));
            this.agentName = (__runInitializers(this, _nickname_extraInitializers), __runInitializers(this, _agentName_initializers, void 0));
            this.agentPersonality = (__runInitializers(this, _agentName_extraInitializers), __runInitializers(this, _agentPersonality_initializers, void 0));
            this.llmProvider = (__runInitializers(this, _agentPersonality_extraInitializers), __runInitializers(this, _llmProvider_initializers, void 0));
            this.llmModel = (__runInitializers(this, _llmProvider_extraInitializers), __runInitializers(this, _llmModel_initializers, void 0));
            this.status = (__runInitializers(this, _llmModel_extraInitializers), __runInitializers(this, _status_initializers, void 0));
            this.isAvailable = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _isAvailable_initializers, void 0));
            this.roastBalance = (__runInitializers(this, _isAvailable_extraInitializers), __runInitializers(this, _roastBalance_initializers, void 0));
            this.totalEarnings = (__runInitializers(this, _roastBalance_extraInitializers), __runInitializers(this, _totalEarnings_initializers, void 0));
            this.submissionCount = (__runInitializers(this, _totalEarnings_extraInitializers), __runInitializers(this, _submissionCount_initializers, void 0));
            this.approvedSubmissionCount = (__runInitializers(this, _submissionCount_extraInitializers), __runInitializers(this, _approvedSubmissionCount_initializers, void 0));
            this.averageScore = (__runInitializers(this, _approvedSubmissionCount_extraInitializers), __runInitializers(this, _averageScore_initializers, void 0));
            this.approvalRate = (__runInitializers(this, _averageScore_extraInitializers), __runInitializers(this, _approvalRate_initializers, void 0));
            this.configuration = (__runInitializers(this, _approvalRate_extraInitializers), __runInitializers(this, _configuration_initializers, void 0));
            this.statistics = (__runInitializers(this, _configuration_extraInitializers), __runInitializers(this, _statistics_initializers, void 0));
            this.ipAddress = (__runInitializers(this, _statistics_extraInitializers), __runInitializers(this, _ipAddress_initializers, void 0));
            this.userAgent = (__runInitializers(this, _ipAddress_extraInitializers), __runInitializers(this, _userAgent_initializers, void 0));
            this.lastHeartbeatAt = (__runInitializers(this, _userAgent_extraInitializers), __runInitializers(this, _lastHeartbeatAt_initializers, void 0));
            this.lastActiveAt = (__runInitializers(this, _lastHeartbeatAt_extraInitializers), __runInitializers(this, _lastActiveAt_initializers, void 0));
            this.createdAt = (__runInitializers(this, _lastActiveAt_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            // Relations
            this.user = (__runInitializers(this, _updatedAt_extraInitializers), __runInitializers(this, _user_initializers, void 0));
            this.userId = (__runInitializers(this, _user_extraInitializers), __runInitializers(this, _userId_initializers, void 0));
            this.submissions = (__runInitializers(this, _userId_extraInitializers), __runInitializers(this, _submissions_initializers, void 0));
            this.rewards = (__runInitializers(this, _submissions_extraInitializers), __runInitializers(this, _rewards_initializers, void 0));
            this.socialAccounts = (__runInitializers(this, _rewards_extraInitializers), __runInitializers(this, _socialAccounts_initializers, void 0));
            __runInitializers(this, _socialAccounts_extraInitializers);
        }
        return Miner_1;
    }());
    __setFunctionName(_classThis, "Miner");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _walletAddress_decorators = [(0, typeorm_1.Column)({ unique: true }), (0, typeorm_1.Index)()];
        _username_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _nickname_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _agentName_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _agentPersonality_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.AgentPersonality,
                default: index_1.AgentPersonality.WITTY,
            })];
        _llmProvider_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.LLMProvider,
                default: index_1.LLMProvider.OPENAI,
            })];
        _llmModel_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _status_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.MinerStatus,
                default: index_1.MinerStatus.OFFLINE,
            }), (0, typeorm_1.Index)()];
        _isAvailable_decorators = [(0, typeorm_1.Column)({ default: true })];
        _roastBalance_decorators = [(0, typeorm_1.Column)({ type: 'bigint', default: 0 })];
        _totalEarnings_decorators = [(0, typeorm_1.Column)({ type: 'bigint', default: 0 })];
        _submissionCount_decorators = [(0, typeorm_1.Column)({ default: 0 })];
        _approvedSubmissionCount_decorators = [(0, typeorm_1.Column)({ default: 0 })];
        _averageScore_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, default: 0 })];
        _approvalRate_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 5, scale: 2, default: 0 })];
        _configuration_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _statistics_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _ipAddress_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _userAgent_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _lastHeartbeatAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _lastActiveAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        _user_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.miners; }), (0, typeorm_1.JoinColumn)({ name: 'userId' })];
        _userId_decorators = [(0, typeorm_1.Column)()];
        _submissions_decorators = [(0, typeorm_1.OneToMany)(function () { return Submission_1.Submission; }, function (submission) { return submission.miner; })];
        _rewards_decorators = [(0, typeorm_1.OneToMany)(function () { return Reward_1.Reward; }, function (reward) { return reward.miner; })];
        _socialAccounts_decorators = [(0, typeorm_1.OneToMany)(function () { return SocialAccount_1.SocialAccount; }, function (socialAccount) { return socialAccount.miner; })];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _walletAddress_decorators, { kind: "field", name: "walletAddress", static: false, private: false, access: { has: function (obj) { return "walletAddress" in obj; }, get: function (obj) { return obj.walletAddress; }, set: function (obj, value) { obj.walletAddress = value; } }, metadata: _metadata }, _walletAddress_initializers, _walletAddress_extraInitializers);
        __esDecorate(null, null, _username_decorators, { kind: "field", name: "username", static: false, private: false, access: { has: function (obj) { return "username" in obj; }, get: function (obj) { return obj.username; }, set: function (obj, value) { obj.username = value; } }, metadata: _metadata }, _username_initializers, _username_extraInitializers);
        __esDecorate(null, null, _nickname_decorators, { kind: "field", name: "nickname", static: false, private: false, access: { has: function (obj) { return "nickname" in obj; }, get: function (obj) { return obj.nickname; }, set: function (obj, value) { obj.nickname = value; } }, metadata: _metadata }, _nickname_initializers, _nickname_extraInitializers);
        __esDecorate(null, null, _agentName_decorators, { kind: "field", name: "agentName", static: false, private: false, access: { has: function (obj) { return "agentName" in obj; }, get: function (obj) { return obj.agentName; }, set: function (obj, value) { obj.agentName = value; } }, metadata: _metadata }, _agentName_initializers, _agentName_extraInitializers);
        __esDecorate(null, null, _agentPersonality_decorators, { kind: "field", name: "agentPersonality", static: false, private: false, access: { has: function (obj) { return "agentPersonality" in obj; }, get: function (obj) { return obj.agentPersonality; }, set: function (obj, value) { obj.agentPersonality = value; } }, metadata: _metadata }, _agentPersonality_initializers, _agentPersonality_extraInitializers);
        __esDecorate(null, null, _llmProvider_decorators, { kind: "field", name: "llmProvider", static: false, private: false, access: { has: function (obj) { return "llmProvider" in obj; }, get: function (obj) { return obj.llmProvider; }, set: function (obj, value) { obj.llmProvider = value; } }, metadata: _metadata }, _llmProvider_initializers, _llmProvider_extraInitializers);
        __esDecorate(null, null, _llmModel_decorators, { kind: "field", name: "llmModel", static: false, private: false, access: { has: function (obj) { return "llmModel" in obj; }, get: function (obj) { return obj.llmModel; }, set: function (obj, value) { obj.llmModel = value; } }, metadata: _metadata }, _llmModel_initializers, _llmModel_extraInitializers);
        __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: function (obj) { return "status" in obj; }, get: function (obj) { return obj.status; }, set: function (obj, value) { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
        __esDecorate(null, null, _isAvailable_decorators, { kind: "field", name: "isAvailable", static: false, private: false, access: { has: function (obj) { return "isAvailable" in obj; }, get: function (obj) { return obj.isAvailable; }, set: function (obj, value) { obj.isAvailable = value; } }, metadata: _metadata }, _isAvailable_initializers, _isAvailable_extraInitializers);
        __esDecorate(null, null, _roastBalance_decorators, { kind: "field", name: "roastBalance", static: false, private: false, access: { has: function (obj) { return "roastBalance" in obj; }, get: function (obj) { return obj.roastBalance; }, set: function (obj, value) { obj.roastBalance = value; } }, metadata: _metadata }, _roastBalance_initializers, _roastBalance_extraInitializers);
        __esDecorate(null, null, _totalEarnings_decorators, { kind: "field", name: "totalEarnings", static: false, private: false, access: { has: function (obj) { return "totalEarnings" in obj; }, get: function (obj) { return obj.totalEarnings; }, set: function (obj, value) { obj.totalEarnings = value; } }, metadata: _metadata }, _totalEarnings_initializers, _totalEarnings_extraInitializers);
        __esDecorate(null, null, _submissionCount_decorators, { kind: "field", name: "submissionCount", static: false, private: false, access: { has: function (obj) { return "submissionCount" in obj; }, get: function (obj) { return obj.submissionCount; }, set: function (obj, value) { obj.submissionCount = value; } }, metadata: _metadata }, _submissionCount_initializers, _submissionCount_extraInitializers);
        __esDecorate(null, null, _approvedSubmissionCount_decorators, { kind: "field", name: "approvedSubmissionCount", static: false, private: false, access: { has: function (obj) { return "approvedSubmissionCount" in obj; }, get: function (obj) { return obj.approvedSubmissionCount; }, set: function (obj, value) { obj.approvedSubmissionCount = value; } }, metadata: _metadata }, _approvedSubmissionCount_initializers, _approvedSubmissionCount_extraInitializers);
        __esDecorate(null, null, _averageScore_decorators, { kind: "field", name: "averageScore", static: false, private: false, access: { has: function (obj) { return "averageScore" in obj; }, get: function (obj) { return obj.averageScore; }, set: function (obj, value) { obj.averageScore = value; } }, metadata: _metadata }, _averageScore_initializers, _averageScore_extraInitializers);
        __esDecorate(null, null, _approvalRate_decorators, { kind: "field", name: "approvalRate", static: false, private: false, access: { has: function (obj) { return "approvalRate" in obj; }, get: function (obj) { return obj.approvalRate; }, set: function (obj, value) { obj.approvalRate = value; } }, metadata: _metadata }, _approvalRate_initializers, _approvalRate_extraInitializers);
        __esDecorate(null, null, _configuration_decorators, { kind: "field", name: "configuration", static: false, private: false, access: { has: function (obj) { return "configuration" in obj; }, get: function (obj) { return obj.configuration; }, set: function (obj, value) { obj.configuration = value; } }, metadata: _metadata }, _configuration_initializers, _configuration_extraInitializers);
        __esDecorate(null, null, _statistics_decorators, { kind: "field", name: "statistics", static: false, private: false, access: { has: function (obj) { return "statistics" in obj; }, get: function (obj) { return obj.statistics; }, set: function (obj, value) { obj.statistics = value; } }, metadata: _metadata }, _statistics_initializers, _statistics_extraInitializers);
        __esDecorate(null, null, _ipAddress_decorators, { kind: "field", name: "ipAddress", static: false, private: false, access: { has: function (obj) { return "ipAddress" in obj; }, get: function (obj) { return obj.ipAddress; }, set: function (obj, value) { obj.ipAddress = value; } }, metadata: _metadata }, _ipAddress_initializers, _ipAddress_extraInitializers);
        __esDecorate(null, null, _userAgent_decorators, { kind: "field", name: "userAgent", static: false, private: false, access: { has: function (obj) { return "userAgent" in obj; }, get: function (obj) { return obj.userAgent; }, set: function (obj, value) { obj.userAgent = value; } }, metadata: _metadata }, _userAgent_initializers, _userAgent_extraInitializers);
        __esDecorate(null, null, _lastHeartbeatAt_decorators, { kind: "field", name: "lastHeartbeatAt", static: false, private: false, access: { has: function (obj) { return "lastHeartbeatAt" in obj; }, get: function (obj) { return obj.lastHeartbeatAt; }, set: function (obj, value) { obj.lastHeartbeatAt = value; } }, metadata: _metadata }, _lastHeartbeatAt_initializers, _lastHeartbeatAt_extraInitializers);
        __esDecorate(null, null, _lastActiveAt_decorators, { kind: "field", name: "lastActiveAt", static: false, private: false, access: { has: function (obj) { return "lastActiveAt" in obj; }, get: function (obj) { return obj.lastActiveAt; }, set: function (obj, value) { obj.lastActiveAt = value; } }, metadata: _metadata }, _lastActiveAt_initializers, _lastActiveAt_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, null, _user_decorators, { kind: "field", name: "user", static: false, private: false, access: { has: function (obj) { return "user" in obj; }, get: function (obj) { return obj.user; }, set: function (obj, value) { obj.user = value; } }, metadata: _metadata }, _user_initializers, _user_extraInitializers);
        __esDecorate(null, null, _userId_decorators, { kind: "field", name: "userId", static: false, private: false, access: { has: function (obj) { return "userId" in obj; }, get: function (obj) { return obj.userId; }, set: function (obj, value) { obj.userId = value; } }, metadata: _metadata }, _userId_initializers, _userId_extraInitializers);
        __esDecorate(null, null, _submissions_decorators, { kind: "field", name: "submissions", static: false, private: false, access: { has: function (obj) { return "submissions" in obj; }, get: function (obj) { return obj.submissions; }, set: function (obj, value) { obj.submissions = value; } }, metadata: _metadata }, _submissions_initializers, _submissions_extraInitializers);
        __esDecorate(null, null, _rewards_decorators, { kind: "field", name: "rewards", static: false, private: false, access: { has: function (obj) { return "rewards" in obj; }, get: function (obj) { return obj.rewards; }, set: function (obj, value) { obj.rewards = value; } }, metadata: _metadata }, _rewards_initializers, _rewards_extraInitializers);
        __esDecorate(null, null, _socialAccounts_decorators, { kind: "field", name: "socialAccounts", static: false, private: false, access: { has: function (obj) { return "socialAccounts" in obj; }, get: function (obj) { return obj.socialAccounts; }, set: function (obj, value) { obj.socialAccounts = value; } }, metadata: _metadata }, _socialAccounts_initializers, _socialAccounts_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        Miner = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return Miner = _classThis;
}();
exports.Miner = Miner;
