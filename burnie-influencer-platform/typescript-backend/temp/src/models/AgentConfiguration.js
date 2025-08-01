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
exports.AgentConfiguration = exports.PersonalityType = exports.AgentType = void 0;
var typeorm_1 = require("typeorm");
var User_1 = require("./User");
var AgentType;
(function (AgentType) {
    AgentType["DATA_ANALYST"] = "data_analyst";
    AgentType["CONTENT_STRATEGIST"] = "content_strategist";
    AgentType["TEXT_CONTENT"] = "text_content";
    AgentType["VISUAL_CREATOR"] = "visual_creator";
    AgentType["ORCHESTRATOR"] = "orchestrator";
})(AgentType || (exports.AgentType = AgentType = {}));
var PersonalityType;
(function (PersonalityType) {
    PersonalityType["WITTY"] = "WITTY";
    PersonalityType["SAVAGE"] = "SAVAGE";
    PersonalityType["CHAOTIC"] = "CHAOTIC";
    PersonalityType["LEGENDARY"] = "LEGENDARY";
})(PersonalityType || (exports.PersonalityType = PersonalityType = {}));
var AgentConfiguration = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('agent_configurations'), (0, typeorm_1.Index)(['userId', 'agentType'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _userId_decorators;
    var _userId_initializers = [];
    var _userId_extraInitializers = [];
    var _agentName_decorators;
    var _agentName_initializers = [];
    var _agentName_extraInitializers = [];
    var _agentType_decorators;
    var _agentType_initializers = [];
    var _agentType_extraInitializers = [];
    var _personalityType_decorators;
    var _personalityType_initializers = [];
    var _personalityType_extraInitializers = [];
    var _systemMessage_decorators;
    var _systemMessage_initializers = [];
    var _systemMessage_extraInitializers = [];
    var _configuration_decorators;
    var _configuration_initializers = [];
    var _configuration_extraInitializers = [];
    var _aiProviders_decorators;
    var _aiProviders_initializers = [];
    var _aiProviders_extraInitializers = [];
    var _toneSettings_decorators;
    var _toneSettings_initializers = [];
    var _toneSettings_extraInitializers = [];
    var _creativitySettings_decorators;
    var _creativitySettings_initializers = [];
    var _creativitySettings_extraInitializers = [];
    var _behavioralPatterns_decorators;
    var _behavioralPatterns_initializers = [];
    var _behavioralPatterns_extraInitializers = [];
    var _twitterConfig_decorators;
    var _twitterConfig_initializers = [];
    var _twitterConfig_extraInitializers = [];
    var _personalitySettings_decorators;
    var _personalitySettings_initializers = [];
    var _personalitySettings_extraInitializers = [];
    var _learningData_decorators;
    var _learningData_initializers = [];
    var _learningData_extraInitializers = [];
    var _performanceMetrics_decorators;
    var _performanceMetrics_initializers = [];
    var _performanceMetrics_extraInitializers = [];
    var _isActive_decorators;
    var _isActive_initializers = [];
    var _isActive_extraInitializers = [];
    var _user_decorators;
    var _user_initializers = [];
    var _user_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var AgentConfiguration = _classThis = /** @class */ (function () {
        function AgentConfiguration_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.userId = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _userId_initializers, void 0));
            this.agentName = (__runInitializers(this, _userId_extraInitializers), __runInitializers(this, _agentName_initializers, void 0));
            this.agentType = (__runInitializers(this, _agentName_extraInitializers), __runInitializers(this, _agentType_initializers, void 0));
            this.personalityType = (__runInitializers(this, _agentType_extraInitializers), __runInitializers(this, _personalityType_initializers, void 0));
            this.systemMessage = (__runInitializers(this, _personalityType_extraInitializers), __runInitializers(this, _systemMessage_initializers, void 0));
            this.configuration = (__runInitializers(this, _systemMessage_extraInitializers), __runInitializers(this, _configuration_initializers, void 0));
            this.aiProviders = (__runInitializers(this, _configuration_extraInitializers), __runInitializers(this, _aiProviders_initializers, void 0));
            this.toneSettings = (__runInitializers(this, _aiProviders_extraInitializers), __runInitializers(this, _toneSettings_initializers, void 0));
            this.creativitySettings = (__runInitializers(this, _toneSettings_extraInitializers), __runInitializers(this, _creativitySettings_initializers, void 0));
            this.behavioralPatterns = (__runInitializers(this, _creativitySettings_extraInitializers), __runInitializers(this, _behavioralPatterns_initializers, void 0));
            this.twitterConfig = (__runInitializers(this, _behavioralPatterns_extraInitializers), __runInitializers(this, _twitterConfig_initializers, void 0));
            this.personalitySettings = (__runInitializers(this, _twitterConfig_extraInitializers), __runInitializers(this, _personalitySettings_initializers, void 0));
            this.learningData = (__runInitializers(this, _personalitySettings_extraInitializers), __runInitializers(this, _learningData_initializers, void 0));
            this.performanceMetrics = (__runInitializers(this, _learningData_extraInitializers), __runInitializers(this, _performanceMetrics_initializers, void 0));
            this.isActive = (__runInitializers(this, _performanceMetrics_extraInitializers), __runInitializers(this, _isActive_initializers, void 0));
            // Relations
            this.user = (__runInitializers(this, _isActive_extraInitializers), __runInitializers(this, _user_initializers, void 0));
            this.createdAt = (__runInitializers(this, _user_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            __runInitializers(this, _updatedAt_extraInitializers);
        }
        // Helper methods
        AgentConfiguration_1.prototype.isReady = function () {
            return this.isActive && !!this.systemMessage;
        };
        AgentConfiguration_1.prototype.updatePerformanceMetrics = function (metrics) {
            this.performanceMetrics = __assign(__assign(__assign({}, this.performanceMetrics), metrics), { lastUpdated: new Date() });
        };
        return AgentConfiguration_1;
    }());
    __setFunctionName(_classThis, "AgentConfiguration");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _userId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _agentName_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 100 })];
        _agentType_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: AgentType,
                default: AgentType.TEXT_CONTENT,
            })];
        _personalityType_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: PersonalityType,
                default: PersonalityType.WITTY,
            })];
        _systemMessage_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _configuration_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _aiProviders_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _toneSettings_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _creativitySettings_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _behavioralPatterns_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _twitterConfig_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _personalitySettings_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _learningData_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _performanceMetrics_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _isActive_decorators = [(0, typeorm_1.Column)({ type: 'boolean', default: true })];
        _user_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.id; }), (0, typeorm_1.JoinColumn)({ name: 'userId' })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _userId_decorators, { kind: "field", name: "userId", static: false, private: false, access: { has: function (obj) { return "userId" in obj; }, get: function (obj) { return obj.userId; }, set: function (obj, value) { obj.userId = value; } }, metadata: _metadata }, _userId_initializers, _userId_extraInitializers);
        __esDecorate(null, null, _agentName_decorators, { kind: "field", name: "agentName", static: false, private: false, access: { has: function (obj) { return "agentName" in obj; }, get: function (obj) { return obj.agentName; }, set: function (obj, value) { obj.agentName = value; } }, metadata: _metadata }, _agentName_initializers, _agentName_extraInitializers);
        __esDecorate(null, null, _agentType_decorators, { kind: "field", name: "agentType", static: false, private: false, access: { has: function (obj) { return "agentType" in obj; }, get: function (obj) { return obj.agentType; }, set: function (obj, value) { obj.agentType = value; } }, metadata: _metadata }, _agentType_initializers, _agentType_extraInitializers);
        __esDecorate(null, null, _personalityType_decorators, { kind: "field", name: "personalityType", static: false, private: false, access: { has: function (obj) { return "personalityType" in obj; }, get: function (obj) { return obj.personalityType; }, set: function (obj, value) { obj.personalityType = value; } }, metadata: _metadata }, _personalityType_initializers, _personalityType_extraInitializers);
        __esDecorate(null, null, _systemMessage_decorators, { kind: "field", name: "systemMessage", static: false, private: false, access: { has: function (obj) { return "systemMessage" in obj; }, get: function (obj) { return obj.systemMessage; }, set: function (obj, value) { obj.systemMessage = value; } }, metadata: _metadata }, _systemMessage_initializers, _systemMessage_extraInitializers);
        __esDecorate(null, null, _configuration_decorators, { kind: "field", name: "configuration", static: false, private: false, access: { has: function (obj) { return "configuration" in obj; }, get: function (obj) { return obj.configuration; }, set: function (obj, value) { obj.configuration = value; } }, metadata: _metadata }, _configuration_initializers, _configuration_extraInitializers);
        __esDecorate(null, null, _aiProviders_decorators, { kind: "field", name: "aiProviders", static: false, private: false, access: { has: function (obj) { return "aiProviders" in obj; }, get: function (obj) { return obj.aiProviders; }, set: function (obj, value) { obj.aiProviders = value; } }, metadata: _metadata }, _aiProviders_initializers, _aiProviders_extraInitializers);
        __esDecorate(null, null, _toneSettings_decorators, { kind: "field", name: "toneSettings", static: false, private: false, access: { has: function (obj) { return "toneSettings" in obj; }, get: function (obj) { return obj.toneSettings; }, set: function (obj, value) { obj.toneSettings = value; } }, metadata: _metadata }, _toneSettings_initializers, _toneSettings_extraInitializers);
        __esDecorate(null, null, _creativitySettings_decorators, { kind: "field", name: "creativitySettings", static: false, private: false, access: { has: function (obj) { return "creativitySettings" in obj; }, get: function (obj) { return obj.creativitySettings; }, set: function (obj, value) { obj.creativitySettings = value; } }, metadata: _metadata }, _creativitySettings_initializers, _creativitySettings_extraInitializers);
        __esDecorate(null, null, _behavioralPatterns_decorators, { kind: "field", name: "behavioralPatterns", static: false, private: false, access: { has: function (obj) { return "behavioralPatterns" in obj; }, get: function (obj) { return obj.behavioralPatterns; }, set: function (obj, value) { obj.behavioralPatterns = value; } }, metadata: _metadata }, _behavioralPatterns_initializers, _behavioralPatterns_extraInitializers);
        __esDecorate(null, null, _twitterConfig_decorators, { kind: "field", name: "twitterConfig", static: false, private: false, access: { has: function (obj) { return "twitterConfig" in obj; }, get: function (obj) { return obj.twitterConfig; }, set: function (obj, value) { obj.twitterConfig = value; } }, metadata: _metadata }, _twitterConfig_initializers, _twitterConfig_extraInitializers);
        __esDecorate(null, null, _personalitySettings_decorators, { kind: "field", name: "personalitySettings", static: false, private: false, access: { has: function (obj) { return "personalitySettings" in obj; }, get: function (obj) { return obj.personalitySettings; }, set: function (obj, value) { obj.personalitySettings = value; } }, metadata: _metadata }, _personalitySettings_initializers, _personalitySettings_extraInitializers);
        __esDecorate(null, null, _learningData_decorators, { kind: "field", name: "learningData", static: false, private: false, access: { has: function (obj) { return "learningData" in obj; }, get: function (obj) { return obj.learningData; }, set: function (obj, value) { obj.learningData = value; } }, metadata: _metadata }, _learningData_initializers, _learningData_extraInitializers);
        __esDecorate(null, null, _performanceMetrics_decorators, { kind: "field", name: "performanceMetrics", static: false, private: false, access: { has: function (obj) { return "performanceMetrics" in obj; }, get: function (obj) { return obj.performanceMetrics; }, set: function (obj, value) { obj.performanceMetrics = value; } }, metadata: _metadata }, _performanceMetrics_initializers, _performanceMetrics_extraInitializers);
        __esDecorate(null, null, _isActive_decorators, { kind: "field", name: "isActive", static: false, private: false, access: { has: function (obj) { return "isActive" in obj; }, get: function (obj) { return obj.isActive; }, set: function (obj, value) { obj.isActive = value; } }, metadata: _metadata }, _isActive_initializers, _isActive_extraInitializers);
        __esDecorate(null, null, _user_decorators, { kind: "field", name: "user", static: false, private: false, access: { has: function (obj) { return "user" in obj; }, get: function (obj) { return obj.user; }, set: function (obj, value) { obj.user = value; } }, metadata: _metadata }, _user_initializers, _user_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        AgentConfiguration = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return AgentConfiguration = _classThis;
}();
exports.AgentConfiguration = AgentConfiguration;
