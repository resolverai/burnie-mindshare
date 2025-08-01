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
exports.Campaign = exports.CampaignType = exports.CampaignStatus = void 0;
var typeorm_1 = require("typeorm");
var Project_1 = require("./Project");
var Submission_1 = require("./Submission");
var Block_1 = require("./Block");
var CampaignStatus;
(function (CampaignStatus) {
    CampaignStatus["DRAFT"] = "DRAFT";
    CampaignStatus["PENDING_APPROVAL"] = "pending_approval";
    CampaignStatus["ACTIVE"] = "ACTIVE";
    CampaignStatus["PAUSED"] = "paused";
    CampaignStatus["COMPLETED"] = "COMPLETED";
    CampaignStatus["CANCELLED"] = "cancelled";
})(CampaignStatus || (exports.CampaignStatus = CampaignStatus = {}));
var CampaignType;
(function (CampaignType) {
    CampaignType["ROAST"] = "roast";
    CampaignType["MEME"] = "meme";
    CampaignType["CREATIVE"] = "creative";
    CampaignType["VIRAL"] = "viral";
    CampaignType["SOCIAL"] = "social";
    CampaignType["EDUCATIONAL"] = "educational";
    CampaignType["TECHNICAL"] = "technical";
})(CampaignType || (exports.CampaignType = CampaignType = {}));
var Campaign = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('campaigns'), (0, typeorm_1.Index)(['status']), (0, typeorm_1.Index)(['campaignType']), (0, typeorm_1.Index)(['platformSource', 'isActive']), (0, typeorm_1.Index)(['externalCampaignId'], { unique: true })];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _title_decorators;
    var _title_initializers = [];
    var _title_extraInitializers = [];
    var _description_decorators;
    var _description_initializers = [];
    var _description_extraInitializers = [];
    var _category_decorators;
    var _category_initializers = [];
    var _category_extraInitializers = [];
    var _platformSource_decorators;
    var _platformSource_initializers = [];
    var _platformSource_extraInitializers = [];
    var _externalCampaignId_decorators;
    var _externalCampaignId_initializers = [];
    var _externalCampaignId_extraInitializers = [];
    var _rewardToken_decorators;
    var _rewardToken_initializers = [];
    var _rewardToken_extraInitializers = [];
    var _targetAudience_decorators;
    var _targetAudience_initializers = [];
    var _targetAudience_extraInitializers = [];
    var _brandGuidelines_decorators;
    var _brandGuidelines_initializers = [];
    var _brandGuidelines_extraInitializers = [];
    var _predictedMindshare_decorators;
    var _predictedMindshare_initializers = [];
    var _predictedMindshare_extraInitializers = [];
    var _mindshareRequirements_decorators;
    var _mindshareRequirements_initializers = [];
    var _mindshareRequirements_extraInitializers = [];
    var _isActive_decorators;
    var _isActive_initializers = [];
    var _isActive_extraInitializers = [];
    var _campaignType_decorators;
    var _campaignType_initializers = [];
    var _campaignType_extraInitializers = [];
    var _status_decorators;
    var _status_initializers = [];
    var _status_extraInitializers = [];
    var _rewardPool_decorators;
    var _rewardPool_initializers = [];
    var _rewardPool_extraInitializers = [];
    var _entryFee_decorators;
    var _entryFee_initializers = [];
    var _entryFee_extraInitializers = [];
    var _maxSubmissions_decorators;
    var _maxSubmissions_initializers = [];
    var _maxSubmissions_extraInitializers = [];
    var _currentSubmissions_decorators;
    var _currentSubmissions_initializers = [];
    var _currentSubmissions_extraInitializers = [];
    var _startDate_decorators;
    var _startDate_initializers = [];
    var _startDate_extraInitializers = [];
    var _endDate_decorators;
    var _endDate_initializers = [];
    var _endDate_extraInitializers = [];
    var _requirements_decorators;
    var _requirements_initializers = [];
    var _requirements_extraInitializers = [];
    var _metadata_decorators;
    var _metadata_initializers = [];
    var _metadata_extraInitializers = [];
    var _creatorId_decorators;
    var _creatorId_initializers = [];
    var _creatorId_extraInitializers = [];
    var _projectId_decorators;
    var _projectId_initializers = [];
    var _projectId_extraInitializers = [];
    var _project_decorators;
    var _project_initializers = [];
    var _project_extraInitializers = [];
    var _submissions_decorators;
    var _submissions_initializers = [];
    var _submissions_extraInitializers = [];
    var _blocks_decorators;
    var _blocks_initializers = [];
    var _blocks_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var Campaign = _classThis = /** @class */ (function () {
        function Campaign_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.title = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _title_initializers, void 0));
            this.description = (__runInitializers(this, _title_extraInitializers), __runInitializers(this, _description_initializers, void 0));
            this.category = (__runInitializers(this, _description_extraInitializers), __runInitializers(this, _category_initializers, void 0));
            // New fields for aggregated campaigns
            this.platformSource = (__runInitializers(this, _category_extraInitializers), __runInitializers(this, _platformSource_initializers, void 0)); // 'cookie.fun', 'yaps.kaito.ai', 'yap.market', etc.
            this.externalCampaignId = (__runInitializers(this, _platformSource_extraInitializers), __runInitializers(this, _externalCampaignId_initializers, void 0)); // ID from external platform
            this.rewardToken = (__runInitializers(this, _externalCampaignId_extraInitializers), __runInitializers(this, _rewardToken_initializers, void 0)); // 'KAITO', 'SNAP', 'BURNIE', 'ROAST'
            this.targetAudience = (__runInitializers(this, _rewardToken_extraInitializers), __runInitializers(this, _targetAudience_initializers, void 0));
            this.brandGuidelines = (__runInitializers(this, _targetAudience_extraInitializers), __runInitializers(this, _brandGuidelines_initializers, void 0));
            this.predictedMindshare = (__runInitializers(this, _brandGuidelines_extraInitializers), __runInitializers(this, _predictedMindshare_initializers, void 0));
            this.mindshareRequirements = (__runInitializers(this, _predictedMindshare_extraInitializers), __runInitializers(this, _mindshareRequirements_initializers, void 0));
            this.isActive = (__runInitializers(this, _mindshareRequirements_extraInitializers), __runInitializers(this, _isActive_initializers, void 0));
            this.campaignType = (__runInitializers(this, _isActive_extraInitializers), __runInitializers(this, _campaignType_initializers, void 0));
            this.status = (__runInitializers(this, _campaignType_extraInitializers), __runInitializers(this, _status_initializers, void 0));
            this.rewardPool = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _rewardPool_initializers, void 0));
            this.entryFee = (__runInitializers(this, _rewardPool_extraInitializers), __runInitializers(this, _entryFee_initializers, void 0));
            this.maxSubmissions = (__runInitializers(this, _entryFee_extraInitializers), __runInitializers(this, _maxSubmissions_initializers, void 0));
            this.currentSubmissions = (__runInitializers(this, _maxSubmissions_extraInitializers), __runInitializers(this, _currentSubmissions_initializers, void 0));
            this.startDate = (__runInitializers(this, _currentSubmissions_extraInitializers), __runInitializers(this, _startDate_initializers, void 0));
            this.endDate = (__runInitializers(this, _startDate_extraInitializers), __runInitializers(this, _endDate_initializers, void 0));
            this.requirements = (__runInitializers(this, _endDate_extraInitializers), __runInitializers(this, _requirements_initializers, void 0));
            this.metadata = (__runInitializers(this, _requirements_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
            this.creatorId = (__runInitializers(this, _metadata_extraInitializers), __runInitializers(this, _creatorId_initializers, void 0));
            this.projectId = (__runInitializers(this, _creatorId_extraInitializers), __runInitializers(this, _projectId_initializers, void 0));
            // Project relationship
            this.project = (__runInitializers(this, _projectId_extraInitializers), __runInitializers(this, _project_initializers, void 0));
            // Relationships
            this.submissions = (__runInitializers(this, _project_extraInitializers), __runInitializers(this, _submissions_initializers, void 0));
            this.blocks = (__runInitializers(this, _submissions_extraInitializers), __runInitializers(this, _blocks_initializers, void 0));
            this.createdAt = (__runInitializers(this, _blocks_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            __runInitializers(this, _updatedAt_extraInitializers);
        }
        // Helper methods
        Campaign_1.prototype.isActiveCampaign = function () {
            var now = new Date();
            return (this.isActive &&
                this.status === CampaignStatus.ACTIVE &&
                this.startDate <= now &&
                this.endDate > now &&
                this.currentSubmissions < this.maxSubmissions);
        };
        Campaign_1.prototype.canAcceptSubmissions = function () {
            return (this.isActiveCampaign() &&
                this.currentSubmissions < this.maxSubmissions);
        };
        Campaign_1.prototype.getRemainingSubmissions = function () {
            return Math.max(0, this.maxSubmissions - this.currentSubmissions);
        };
        Campaign_1.prototype.getCompletionPercentage = function () {
            if (this.maxSubmissions === 0)
                return 0;
            return Math.min(100, (this.currentSubmissions / this.maxSubmissions) * 100);
        };
        Campaign_1.prototype.getTimeRemaining = function () {
            return Math.max(0, this.endDate.getTime() - Date.now());
        };
        Campaign_1.prototype.getDaysRemaining = function () {
            return Math.ceil(this.getTimeRemaining() / (1000 * 60 * 60 * 24));
        };
        // New methods for aggregated campaigns
        Campaign_1.prototype.isAggregatedCampaign = function () {
            return !!this.platformSource && !!this.externalCampaignId;
        };
        Campaign_1.prototype.getMindshareScore = function () {
            return this.predictedMindshare || 0;
        };
        return Campaign_1;
    }());
    __setFunctionName(_classThis, "Campaign");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _title_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 255 })];
        _description_decorators = [(0, typeorm_1.Column)({ type: 'text' })];
        _category_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 255 })];
        _platformSource_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 50, nullable: true })];
        _externalCampaignId_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 255, nullable: true, unique: true })];
        _rewardToken_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 10, nullable: true })];
        _targetAudience_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _brandGuidelines_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _predictedMindshare_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 4, nullable: true })];
        _mindshareRequirements_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _isActive_decorators = [(0, typeorm_1.Column)({ type: 'boolean', default: true })];
        _campaignType_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: CampaignType,
                default: CampaignType.ROAST,
            })];
        _status_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: CampaignStatus,
                default: CampaignStatus.DRAFT,
            })];
        _rewardPool_decorators = [(0, typeorm_1.Column)({ type: 'bigint' })];
        _entryFee_decorators = [(0, typeorm_1.Column)({ type: 'bigint' })];
        _maxSubmissions_decorators = [(0, typeorm_1.Column)({ type: 'integer', default: 1500 })];
        _currentSubmissions_decorators = [(0, typeorm_1.Column)({ type: 'integer', default: 0 })];
        _startDate_decorators = [(0, typeorm_1.Column)({ type: 'timestamp' })];
        _endDate_decorators = [(0, typeorm_1.Column)({ type: 'timestamp' })];
        _requirements_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _metadata_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _creatorId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _projectId_decorators = [(0, typeorm_1.Column)({ type: 'integer', nullable: true })];
        _project_decorators = [(0, typeorm_1.ManyToOne)(function () { return Project_1.Project; }, function (project) { return project.campaigns; }), (0, typeorm_1.JoinColumn)({ name: 'projectId' })];
        _submissions_decorators = [(0, typeorm_1.OneToMany)(function () { return Submission_1.Submission; }, function (submission) { return submission.campaign; })];
        _blocks_decorators = [(0, typeorm_1.OneToMany)(function () { return Block_1.Block; }, function (block) { return block.campaign; })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _title_decorators, { kind: "field", name: "title", static: false, private: false, access: { has: function (obj) { return "title" in obj; }, get: function (obj) { return obj.title; }, set: function (obj, value) { obj.title = value; } }, metadata: _metadata }, _title_initializers, _title_extraInitializers);
        __esDecorate(null, null, _description_decorators, { kind: "field", name: "description", static: false, private: false, access: { has: function (obj) { return "description" in obj; }, get: function (obj) { return obj.description; }, set: function (obj, value) { obj.description = value; } }, metadata: _metadata }, _description_initializers, _description_extraInitializers);
        __esDecorate(null, null, _category_decorators, { kind: "field", name: "category", static: false, private: false, access: { has: function (obj) { return "category" in obj; }, get: function (obj) { return obj.category; }, set: function (obj, value) { obj.category = value; } }, metadata: _metadata }, _category_initializers, _category_extraInitializers);
        __esDecorate(null, null, _platformSource_decorators, { kind: "field", name: "platformSource", static: false, private: false, access: { has: function (obj) { return "platformSource" in obj; }, get: function (obj) { return obj.platformSource; }, set: function (obj, value) { obj.platformSource = value; } }, metadata: _metadata }, _platformSource_initializers, _platformSource_extraInitializers);
        __esDecorate(null, null, _externalCampaignId_decorators, { kind: "field", name: "externalCampaignId", static: false, private: false, access: { has: function (obj) { return "externalCampaignId" in obj; }, get: function (obj) { return obj.externalCampaignId; }, set: function (obj, value) { obj.externalCampaignId = value; } }, metadata: _metadata }, _externalCampaignId_initializers, _externalCampaignId_extraInitializers);
        __esDecorate(null, null, _rewardToken_decorators, { kind: "field", name: "rewardToken", static: false, private: false, access: { has: function (obj) { return "rewardToken" in obj; }, get: function (obj) { return obj.rewardToken; }, set: function (obj, value) { obj.rewardToken = value; } }, metadata: _metadata }, _rewardToken_initializers, _rewardToken_extraInitializers);
        __esDecorate(null, null, _targetAudience_decorators, { kind: "field", name: "targetAudience", static: false, private: false, access: { has: function (obj) { return "targetAudience" in obj; }, get: function (obj) { return obj.targetAudience; }, set: function (obj, value) { obj.targetAudience = value; } }, metadata: _metadata }, _targetAudience_initializers, _targetAudience_extraInitializers);
        __esDecorate(null, null, _brandGuidelines_decorators, { kind: "field", name: "brandGuidelines", static: false, private: false, access: { has: function (obj) { return "brandGuidelines" in obj; }, get: function (obj) { return obj.brandGuidelines; }, set: function (obj, value) { obj.brandGuidelines = value; } }, metadata: _metadata }, _brandGuidelines_initializers, _brandGuidelines_extraInitializers);
        __esDecorate(null, null, _predictedMindshare_decorators, { kind: "field", name: "predictedMindshare", static: false, private: false, access: { has: function (obj) { return "predictedMindshare" in obj; }, get: function (obj) { return obj.predictedMindshare; }, set: function (obj, value) { obj.predictedMindshare = value; } }, metadata: _metadata }, _predictedMindshare_initializers, _predictedMindshare_extraInitializers);
        __esDecorate(null, null, _mindshareRequirements_decorators, { kind: "field", name: "mindshareRequirements", static: false, private: false, access: { has: function (obj) { return "mindshareRequirements" in obj; }, get: function (obj) { return obj.mindshareRequirements; }, set: function (obj, value) { obj.mindshareRequirements = value; } }, metadata: _metadata }, _mindshareRequirements_initializers, _mindshareRequirements_extraInitializers);
        __esDecorate(null, null, _isActive_decorators, { kind: "field", name: "isActive", static: false, private: false, access: { has: function (obj) { return "isActive" in obj; }, get: function (obj) { return obj.isActive; }, set: function (obj, value) { obj.isActive = value; } }, metadata: _metadata }, _isActive_initializers, _isActive_extraInitializers);
        __esDecorate(null, null, _campaignType_decorators, { kind: "field", name: "campaignType", static: false, private: false, access: { has: function (obj) { return "campaignType" in obj; }, get: function (obj) { return obj.campaignType; }, set: function (obj, value) { obj.campaignType = value; } }, metadata: _metadata }, _campaignType_initializers, _campaignType_extraInitializers);
        __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: function (obj) { return "status" in obj; }, get: function (obj) { return obj.status; }, set: function (obj, value) { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
        __esDecorate(null, null, _rewardPool_decorators, { kind: "field", name: "rewardPool", static: false, private: false, access: { has: function (obj) { return "rewardPool" in obj; }, get: function (obj) { return obj.rewardPool; }, set: function (obj, value) { obj.rewardPool = value; } }, metadata: _metadata }, _rewardPool_initializers, _rewardPool_extraInitializers);
        __esDecorate(null, null, _entryFee_decorators, { kind: "field", name: "entryFee", static: false, private: false, access: { has: function (obj) { return "entryFee" in obj; }, get: function (obj) { return obj.entryFee; }, set: function (obj, value) { obj.entryFee = value; } }, metadata: _metadata }, _entryFee_initializers, _entryFee_extraInitializers);
        __esDecorate(null, null, _maxSubmissions_decorators, { kind: "field", name: "maxSubmissions", static: false, private: false, access: { has: function (obj) { return "maxSubmissions" in obj; }, get: function (obj) { return obj.maxSubmissions; }, set: function (obj, value) { obj.maxSubmissions = value; } }, metadata: _metadata }, _maxSubmissions_initializers, _maxSubmissions_extraInitializers);
        __esDecorate(null, null, _currentSubmissions_decorators, { kind: "field", name: "currentSubmissions", static: false, private: false, access: { has: function (obj) { return "currentSubmissions" in obj; }, get: function (obj) { return obj.currentSubmissions; }, set: function (obj, value) { obj.currentSubmissions = value; } }, metadata: _metadata }, _currentSubmissions_initializers, _currentSubmissions_extraInitializers);
        __esDecorate(null, null, _startDate_decorators, { kind: "field", name: "startDate", static: false, private: false, access: { has: function (obj) { return "startDate" in obj; }, get: function (obj) { return obj.startDate; }, set: function (obj, value) { obj.startDate = value; } }, metadata: _metadata }, _startDate_initializers, _startDate_extraInitializers);
        __esDecorate(null, null, _endDate_decorators, { kind: "field", name: "endDate", static: false, private: false, access: { has: function (obj) { return "endDate" in obj; }, get: function (obj) { return obj.endDate; }, set: function (obj, value) { obj.endDate = value; } }, metadata: _metadata }, _endDate_initializers, _endDate_extraInitializers);
        __esDecorate(null, null, _requirements_decorators, { kind: "field", name: "requirements", static: false, private: false, access: { has: function (obj) { return "requirements" in obj; }, get: function (obj) { return obj.requirements; }, set: function (obj, value) { obj.requirements = value; } }, metadata: _metadata }, _requirements_initializers, _requirements_extraInitializers);
        __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: function (obj) { return "metadata" in obj; }, get: function (obj) { return obj.metadata; }, set: function (obj, value) { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
        __esDecorate(null, null, _creatorId_decorators, { kind: "field", name: "creatorId", static: false, private: false, access: { has: function (obj) { return "creatorId" in obj; }, get: function (obj) { return obj.creatorId; }, set: function (obj, value) { obj.creatorId = value; } }, metadata: _metadata }, _creatorId_initializers, _creatorId_extraInitializers);
        __esDecorate(null, null, _projectId_decorators, { kind: "field", name: "projectId", static: false, private: false, access: { has: function (obj) { return "projectId" in obj; }, get: function (obj) { return obj.projectId; }, set: function (obj, value) { obj.projectId = value; } }, metadata: _metadata }, _projectId_initializers, _projectId_extraInitializers);
        __esDecorate(null, null, _project_decorators, { kind: "field", name: "project", static: false, private: false, access: { has: function (obj) { return "project" in obj; }, get: function (obj) { return obj.project; }, set: function (obj, value) { obj.project = value; } }, metadata: _metadata }, _project_initializers, _project_extraInitializers);
        __esDecorate(null, null, _submissions_decorators, { kind: "field", name: "submissions", static: false, private: false, access: { has: function (obj) { return "submissions" in obj; }, get: function (obj) { return obj.submissions; }, set: function (obj, value) { obj.submissions = value; } }, metadata: _metadata }, _submissions_initializers, _submissions_extraInitializers);
        __esDecorate(null, null, _blocks_decorators, { kind: "field", name: "blocks", static: false, private: false, access: { has: function (obj) { return "blocks" in obj; }, get: function (obj) { return obj.blocks; }, set: function (obj, value) { obj.blocks = value; } }, metadata: _metadata }, _blocks_initializers, _blocks_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        Campaign = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return Campaign = _classThis;
}();
exports.Campaign = Campaign;
