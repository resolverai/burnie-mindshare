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
exports.User = exports.UserRoleType = void 0;
var typeorm_1 = require("typeorm");
var Miner_1 = require("./Miner");
var Project_1 = require("./Project");
var UserRoleType;
(function (UserRoleType) {
    UserRoleType["MINER"] = "miner";
    UserRoleType["YAPPER"] = "yapper";
    UserRoleType["BOTH"] = "both";
})(UserRoleType || (exports.UserRoleType = UserRoleType = {}));
var User = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('users')];
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
    var _email_decorators;
    var _email_initializers = [];
    var _email_extraInitializers = [];
    var _twitterHandle_decorators;
    var _twitterHandle_initializers = [];
    var _twitterHandle_extraInitializers = [];
    var _twitterUserId_decorators;
    var _twitterUserId_initializers = [];
    var _twitterUserId_extraInitializers = [];
    var _twitterOauthToken_decorators;
    var _twitterOauthToken_initializers = [];
    var _twitterOauthToken_extraInitializers = [];
    var _roleType_decorators;
    var _roleType_initializers = [];
    var _roleType_extraInitializers = [];
    var _roastBalance_decorators;
    var _roastBalance_initializers = [];
    var _roastBalance_extraInitializers = [];
    var _usdcBalance_decorators;
    var _usdcBalance_initializers = [];
    var _usdcBalance_extraInitializers = [];
    var _reputationScore_decorators;
    var _reputationScore_initializers = [];
    var _reputationScore_extraInitializers = [];
    var _totalEarnings_decorators;
    var _totalEarnings_initializers = [];
    var _totalEarnings_extraInitializers = [];
    var _isVerified_decorators;
    var _isVerified_initializers = [];
    var _isVerified_extraInitializers = [];
    var _isAdmin_decorators;
    var _isAdmin_initializers = [];
    var _isAdmin_extraInitializers = [];
    var _profile_decorators;
    var _profile_initializers = [];
    var _profile_extraInitializers = [];
    var _preferences_decorators;
    var _preferences_initializers = [];
    var _preferences_extraInitializers = [];
    var _lastActiveAt_decorators;
    var _lastActiveAt_initializers = [];
    var _lastActiveAt_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var _miners_decorators;
    var _miners_initializers = [];
    var _miners_extraInitializers = [];
    var _projects_decorators;
    var _projects_initializers = [];
    var _projects_extraInitializers = [];
    var User = _classThis = /** @class */ (function () {
        function User_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.walletAddress = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _walletAddress_initializers, void 0));
            this.username = (__runInitializers(this, _walletAddress_extraInitializers), __runInitializers(this, _username_initializers, void 0));
            this.email = (__runInitializers(this, _username_extraInitializers), __runInitializers(this, _email_initializers, void 0));
            // Twitter Integration
            this.twitterHandle = (__runInitializers(this, _email_extraInitializers), __runInitializers(this, _twitterHandle_initializers, void 0));
            this.twitterUserId = (__runInitializers(this, _twitterHandle_extraInitializers), __runInitializers(this, _twitterUserId_initializers, void 0));
            this.twitterOauthToken = (__runInitializers(this, _twitterUserId_extraInitializers), __runInitializers(this, _twitterOauthToken_initializers, void 0));
            // Role Management
            this.roleType = (__runInitializers(this, _twitterOauthToken_extraInitializers), __runInitializers(this, _roleType_initializers, void 0));
            // Balance Management
            this.roastBalance = (__runInitializers(this, _roleType_extraInitializers), __runInitializers(this, _roastBalance_initializers, void 0));
            this.usdcBalance = (__runInitializers(this, _roastBalance_extraInitializers), __runInitializers(this, _usdcBalance_initializers, void 0));
            this.reputationScore = (__runInitializers(this, _usdcBalance_extraInitializers), __runInitializers(this, _reputationScore_initializers, void 0));
            this.totalEarnings = (__runInitializers(this, _reputationScore_extraInitializers), __runInitializers(this, _totalEarnings_initializers, void 0));
            this.isVerified = (__runInitializers(this, _totalEarnings_extraInitializers), __runInitializers(this, _isVerified_initializers, void 0));
            this.isAdmin = (__runInitializers(this, _isVerified_extraInitializers), __runInitializers(this, _isAdmin_initializers, void 0));
            this.profile = (__runInitializers(this, _isAdmin_extraInitializers), __runInitializers(this, _profile_initializers, void 0));
            this.preferences = (__runInitializers(this, _profile_extraInitializers), __runInitializers(this, _preferences_initializers, void 0));
            this.lastActiveAt = (__runInitializers(this, _preferences_extraInitializers), __runInitializers(this, _lastActiveAt_initializers, void 0));
            this.createdAt = (__runInitializers(this, _lastActiveAt_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            // Relations
            this.miners = (__runInitializers(this, _updatedAt_extraInitializers), __runInitializers(this, _miners_initializers, void 0));
            this.projects = (__runInitializers(this, _miners_extraInitializers), __runInitializers(this, _projects_initializers, void 0));
            __runInitializers(this, _projects_extraInitializers);
        }
        // Helper methods
        User_1.prototype.isMiner = function () {
            return this.roleType === UserRoleType.MINER || this.roleType === UserRoleType.BOTH;
        };
        User_1.prototype.isYapper = function () {
            return this.roleType === UserRoleType.YAPPER || this.roleType === UserRoleType.BOTH;
        };
        User_1.prototype.hasTwitterConnected = function () {
            return !!this.twitterHandle && !!this.twitterUserId;
        };
        User_1.prototype.canAfford = function (amount, currency) {
            var balance = currency === 'ROAST' ? this.roastBalance : this.usdcBalance;
            return Number(balance) >= amount;
        };
        User_1.prototype.getTotalBalance = function () {
            return {
                roast: Number(this.roastBalance),
                usdc: Number(this.usdcBalance),
            };
        };
        return User_1;
    }());
    __setFunctionName(_classThis, "User");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _walletAddress_decorators = [(0, typeorm_1.Column)({ unique: true, length: 42 }), (0, typeorm_1.Index)()];
        _username_decorators = [(0, typeorm_1.Column)({ unique: true, nullable: true })];
        _email_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _twitterHandle_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 50, nullable: true })];
        _twitterUserId_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 50, nullable: true })];
        _twitterOauthToken_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _roleType_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: UserRoleType,
                default: UserRoleType.BOTH,
            })];
        _roastBalance_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 8, default: 0 })];
        _usdcBalance_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 8, default: 0 })];
        _reputationScore_decorators = [(0, typeorm_1.Column)({ type: 'integer', default: 0 })];
        _totalEarnings_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 8, default: 0 })];
        _isVerified_decorators = [(0, typeorm_1.Column)({ default: false })];
        _isAdmin_decorators = [(0, typeorm_1.Column)({ default: false })];
        _profile_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _preferences_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _lastActiveAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        _miners_decorators = [(0, typeorm_1.OneToMany)(function () { return Miner_1.Miner; }, function (miner) { return miner.user; })];
        _projects_decorators = [(0, typeorm_1.OneToMany)(function () { return Project_1.Project; }, function (project) { return project.owner; })];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _walletAddress_decorators, { kind: "field", name: "walletAddress", static: false, private: false, access: { has: function (obj) { return "walletAddress" in obj; }, get: function (obj) { return obj.walletAddress; }, set: function (obj, value) { obj.walletAddress = value; } }, metadata: _metadata }, _walletAddress_initializers, _walletAddress_extraInitializers);
        __esDecorate(null, null, _username_decorators, { kind: "field", name: "username", static: false, private: false, access: { has: function (obj) { return "username" in obj; }, get: function (obj) { return obj.username; }, set: function (obj, value) { obj.username = value; } }, metadata: _metadata }, _username_initializers, _username_extraInitializers);
        __esDecorate(null, null, _email_decorators, { kind: "field", name: "email", static: false, private: false, access: { has: function (obj) { return "email" in obj; }, get: function (obj) { return obj.email; }, set: function (obj, value) { obj.email = value; } }, metadata: _metadata }, _email_initializers, _email_extraInitializers);
        __esDecorate(null, null, _twitterHandle_decorators, { kind: "field", name: "twitterHandle", static: false, private: false, access: { has: function (obj) { return "twitterHandle" in obj; }, get: function (obj) { return obj.twitterHandle; }, set: function (obj, value) { obj.twitterHandle = value; } }, metadata: _metadata }, _twitterHandle_initializers, _twitterHandle_extraInitializers);
        __esDecorate(null, null, _twitterUserId_decorators, { kind: "field", name: "twitterUserId", static: false, private: false, access: { has: function (obj) { return "twitterUserId" in obj; }, get: function (obj) { return obj.twitterUserId; }, set: function (obj, value) { obj.twitterUserId = value; } }, metadata: _metadata }, _twitterUserId_initializers, _twitterUserId_extraInitializers);
        __esDecorate(null, null, _twitterOauthToken_decorators, { kind: "field", name: "twitterOauthToken", static: false, private: false, access: { has: function (obj) { return "twitterOauthToken" in obj; }, get: function (obj) { return obj.twitterOauthToken; }, set: function (obj, value) { obj.twitterOauthToken = value; } }, metadata: _metadata }, _twitterOauthToken_initializers, _twitterOauthToken_extraInitializers);
        __esDecorate(null, null, _roleType_decorators, { kind: "field", name: "roleType", static: false, private: false, access: { has: function (obj) { return "roleType" in obj; }, get: function (obj) { return obj.roleType; }, set: function (obj, value) { obj.roleType = value; } }, metadata: _metadata }, _roleType_initializers, _roleType_extraInitializers);
        __esDecorate(null, null, _roastBalance_decorators, { kind: "field", name: "roastBalance", static: false, private: false, access: { has: function (obj) { return "roastBalance" in obj; }, get: function (obj) { return obj.roastBalance; }, set: function (obj, value) { obj.roastBalance = value; } }, metadata: _metadata }, _roastBalance_initializers, _roastBalance_extraInitializers);
        __esDecorate(null, null, _usdcBalance_decorators, { kind: "field", name: "usdcBalance", static: false, private: false, access: { has: function (obj) { return "usdcBalance" in obj; }, get: function (obj) { return obj.usdcBalance; }, set: function (obj, value) { obj.usdcBalance = value; } }, metadata: _metadata }, _usdcBalance_initializers, _usdcBalance_extraInitializers);
        __esDecorate(null, null, _reputationScore_decorators, { kind: "field", name: "reputationScore", static: false, private: false, access: { has: function (obj) { return "reputationScore" in obj; }, get: function (obj) { return obj.reputationScore; }, set: function (obj, value) { obj.reputationScore = value; } }, metadata: _metadata }, _reputationScore_initializers, _reputationScore_extraInitializers);
        __esDecorate(null, null, _totalEarnings_decorators, { kind: "field", name: "totalEarnings", static: false, private: false, access: { has: function (obj) { return "totalEarnings" in obj; }, get: function (obj) { return obj.totalEarnings; }, set: function (obj, value) { obj.totalEarnings = value; } }, metadata: _metadata }, _totalEarnings_initializers, _totalEarnings_extraInitializers);
        __esDecorate(null, null, _isVerified_decorators, { kind: "field", name: "isVerified", static: false, private: false, access: { has: function (obj) { return "isVerified" in obj; }, get: function (obj) { return obj.isVerified; }, set: function (obj, value) { obj.isVerified = value; } }, metadata: _metadata }, _isVerified_initializers, _isVerified_extraInitializers);
        __esDecorate(null, null, _isAdmin_decorators, { kind: "field", name: "isAdmin", static: false, private: false, access: { has: function (obj) { return "isAdmin" in obj; }, get: function (obj) { return obj.isAdmin; }, set: function (obj, value) { obj.isAdmin = value; } }, metadata: _metadata }, _isAdmin_initializers, _isAdmin_extraInitializers);
        __esDecorate(null, null, _profile_decorators, { kind: "field", name: "profile", static: false, private: false, access: { has: function (obj) { return "profile" in obj; }, get: function (obj) { return obj.profile; }, set: function (obj, value) { obj.profile = value; } }, metadata: _metadata }, _profile_initializers, _profile_extraInitializers);
        __esDecorate(null, null, _preferences_decorators, { kind: "field", name: "preferences", static: false, private: false, access: { has: function (obj) { return "preferences" in obj; }, get: function (obj) { return obj.preferences; }, set: function (obj, value) { obj.preferences = value; } }, metadata: _metadata }, _preferences_initializers, _preferences_extraInitializers);
        __esDecorate(null, null, _lastActiveAt_decorators, { kind: "field", name: "lastActiveAt", static: false, private: false, access: { has: function (obj) { return "lastActiveAt" in obj; }, get: function (obj) { return obj.lastActiveAt; }, set: function (obj, value) { obj.lastActiveAt = value; } }, metadata: _metadata }, _lastActiveAt_initializers, _lastActiveAt_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, null, _miners_decorators, { kind: "field", name: "miners", static: false, private: false, access: { has: function (obj) { return "miners" in obj; }, get: function (obj) { return obj.miners; }, set: function (obj, value) { obj.miners = value; } }, metadata: _metadata }, _miners_initializers, _miners_extraInitializers);
        __esDecorate(null, null, _projects_decorators, { kind: "field", name: "projects", static: false, private: false, access: { has: function (obj) { return "projects" in obj; }, get: function (obj) { return obj.projects; }, set: function (obj, value) { obj.projects = value; } }, metadata: _metadata }, _projects_initializers, _projects_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        User = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return User = _classThis;
}();
exports.User = User;
