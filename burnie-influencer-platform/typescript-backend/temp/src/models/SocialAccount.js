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
exports.SocialAccount = void 0;
var typeorm_1 = require("typeorm");
var Miner_1 = require("./Miner");
var index_1 = require("../types/index");
var SocialAccount = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('social_accounts')];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _platform_decorators;
    var _platform_initializers = [];
    var _platform_extraInitializers = [];
    var _username_decorators;
    var _username_initializers = [];
    var _username_extraInitializers = [];
    var _displayName_decorators;
    var _displayName_initializers = [];
    var _displayName_extraInitializers = [];
    var _profileUrl_decorators;
    var _profileUrl_initializers = [];
    var _profileUrl_extraInitializers = [];
    var _avatarUrl_decorators;
    var _avatarUrl_initializers = [];
    var _avatarUrl_extraInitializers = [];
    var _verificationStatus_decorators;
    var _verificationStatus_initializers = [];
    var _verificationStatus_extraInitializers = [];
    var _accessToken_decorators;
    var _accessToken_initializers = [];
    var _accessToken_extraInitializers = [];
    var _refreshToken_decorators;
    var _refreshToken_initializers = [];
    var _refreshToken_extraInitializers = [];
    var _tokenExpiresAt_decorators;
    var _tokenExpiresAt_initializers = [];
    var _tokenExpiresAt_extraInitializers = [];
    var _profileData_decorators;
    var _profileData_initializers = [];
    var _profileData_extraInitializers = [];
    var _lastSyncAt_decorators;
    var _lastSyncAt_initializers = [];
    var _lastSyncAt_extraInitializers = [];
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
    var SocialAccount = _classThis = /** @class */ (function () {
        function SocialAccount_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.platform = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _platform_initializers, void 0)); // 'twitter', 'farcaster', etc.
            this.username = (__runInitializers(this, _platform_extraInitializers), __runInitializers(this, _username_initializers, void 0));
            this.displayName = (__runInitializers(this, _username_extraInitializers), __runInitializers(this, _displayName_initializers, void 0));
            this.profileUrl = (__runInitializers(this, _displayName_extraInitializers), __runInitializers(this, _profileUrl_initializers, void 0));
            this.avatarUrl = (__runInitializers(this, _profileUrl_extraInitializers), __runInitializers(this, _avatarUrl_initializers, void 0));
            this.verificationStatus = (__runInitializers(this, _avatarUrl_extraInitializers), __runInitializers(this, _verificationStatus_initializers, void 0));
            this.accessToken = (__runInitializers(this, _verificationStatus_extraInitializers), __runInitializers(this, _accessToken_initializers, void 0));
            this.refreshToken = (__runInitializers(this, _accessToken_extraInitializers), __runInitializers(this, _refreshToken_initializers, void 0));
            this.tokenExpiresAt = (__runInitializers(this, _refreshToken_extraInitializers), __runInitializers(this, _tokenExpiresAt_initializers, void 0));
            this.profileData = (__runInitializers(this, _tokenExpiresAt_extraInitializers), __runInitializers(this, _profileData_initializers, void 0));
            this.lastSyncAt = (__runInitializers(this, _profileData_extraInitializers), __runInitializers(this, _lastSyncAt_initializers, void 0));
            this.createdAt = (__runInitializers(this, _lastSyncAt_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            // Relations
            this.miner = (__runInitializers(this, _updatedAt_extraInitializers), __runInitializers(this, _miner_initializers, void 0));
            this.minerId = (__runInitializers(this, _miner_extraInitializers), __runInitializers(this, _minerId_initializers, void 0));
            __runInitializers(this, _minerId_extraInitializers);
        }
        return SocialAccount_1;
    }());
    __setFunctionName(_classThis, "SocialAccount");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _platform_decorators = [(0, typeorm_1.Column)(), (0, typeorm_1.Index)()];
        _username_decorators = [(0, typeorm_1.Column)()];
        _displayName_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _profileUrl_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _avatarUrl_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _verificationStatus_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.VerificationStatus,
                default: index_1.VerificationStatus.UNVERIFIED,
            }), (0, typeorm_1.Index)()];
        _accessToken_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _refreshToken_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _tokenExpiresAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _profileData_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _lastSyncAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        _miner_decorators = [(0, typeorm_1.ManyToOne)(function () { return Miner_1.Miner; }, function (miner) { return miner.socialAccounts; }), (0, typeorm_1.JoinColumn)({ name: 'minerId' })];
        _minerId_decorators = [(0, typeorm_1.Column)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _platform_decorators, { kind: "field", name: "platform", static: false, private: false, access: { has: function (obj) { return "platform" in obj; }, get: function (obj) { return obj.platform; }, set: function (obj, value) { obj.platform = value; } }, metadata: _metadata }, _platform_initializers, _platform_extraInitializers);
        __esDecorate(null, null, _username_decorators, { kind: "field", name: "username", static: false, private: false, access: { has: function (obj) { return "username" in obj; }, get: function (obj) { return obj.username; }, set: function (obj, value) { obj.username = value; } }, metadata: _metadata }, _username_initializers, _username_extraInitializers);
        __esDecorate(null, null, _displayName_decorators, { kind: "field", name: "displayName", static: false, private: false, access: { has: function (obj) { return "displayName" in obj; }, get: function (obj) { return obj.displayName; }, set: function (obj, value) { obj.displayName = value; } }, metadata: _metadata }, _displayName_initializers, _displayName_extraInitializers);
        __esDecorate(null, null, _profileUrl_decorators, { kind: "field", name: "profileUrl", static: false, private: false, access: { has: function (obj) { return "profileUrl" in obj; }, get: function (obj) { return obj.profileUrl; }, set: function (obj, value) { obj.profileUrl = value; } }, metadata: _metadata }, _profileUrl_initializers, _profileUrl_extraInitializers);
        __esDecorate(null, null, _avatarUrl_decorators, { kind: "field", name: "avatarUrl", static: false, private: false, access: { has: function (obj) { return "avatarUrl" in obj; }, get: function (obj) { return obj.avatarUrl; }, set: function (obj, value) { obj.avatarUrl = value; } }, metadata: _metadata }, _avatarUrl_initializers, _avatarUrl_extraInitializers);
        __esDecorate(null, null, _verificationStatus_decorators, { kind: "field", name: "verificationStatus", static: false, private: false, access: { has: function (obj) { return "verificationStatus" in obj; }, get: function (obj) { return obj.verificationStatus; }, set: function (obj, value) { obj.verificationStatus = value; } }, metadata: _metadata }, _verificationStatus_initializers, _verificationStatus_extraInitializers);
        __esDecorate(null, null, _accessToken_decorators, { kind: "field", name: "accessToken", static: false, private: false, access: { has: function (obj) { return "accessToken" in obj; }, get: function (obj) { return obj.accessToken; }, set: function (obj, value) { obj.accessToken = value; } }, metadata: _metadata }, _accessToken_initializers, _accessToken_extraInitializers);
        __esDecorate(null, null, _refreshToken_decorators, { kind: "field", name: "refreshToken", static: false, private: false, access: { has: function (obj) { return "refreshToken" in obj; }, get: function (obj) { return obj.refreshToken; }, set: function (obj, value) { obj.refreshToken = value; } }, metadata: _metadata }, _refreshToken_initializers, _refreshToken_extraInitializers);
        __esDecorate(null, null, _tokenExpiresAt_decorators, { kind: "field", name: "tokenExpiresAt", static: false, private: false, access: { has: function (obj) { return "tokenExpiresAt" in obj; }, get: function (obj) { return obj.tokenExpiresAt; }, set: function (obj, value) { obj.tokenExpiresAt = value; } }, metadata: _metadata }, _tokenExpiresAt_initializers, _tokenExpiresAt_extraInitializers);
        __esDecorate(null, null, _profileData_decorators, { kind: "field", name: "profileData", static: false, private: false, access: { has: function (obj) { return "profileData" in obj; }, get: function (obj) { return obj.profileData; }, set: function (obj, value) { obj.profileData = value; } }, metadata: _metadata }, _profileData_initializers, _profileData_extraInitializers);
        __esDecorate(null, null, _lastSyncAt_decorators, { kind: "field", name: "lastSyncAt", static: false, private: false, access: { has: function (obj) { return "lastSyncAt" in obj; }, get: function (obj) { return obj.lastSyncAt; }, set: function (obj, value) { obj.lastSyncAt = value; } }, metadata: _metadata }, _lastSyncAt_initializers, _lastSyncAt_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, null, _miner_decorators, { kind: "field", name: "miner", static: false, private: false, access: { has: function (obj) { return "miner" in obj; }, get: function (obj) { return obj.miner; }, set: function (obj, value) { obj.miner = value; } }, metadata: _metadata }, _miner_initializers, _miner_extraInitializers);
        __esDecorate(null, null, _minerId_decorators, { kind: "field", name: "minerId", static: false, private: false, access: { has: function (obj) { return "minerId" in obj; }, get: function (obj) { return obj.minerId; }, set: function (obj, value) { obj.minerId = value; } }, metadata: _metadata }, _minerId_initializers, _minerId_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        SocialAccount = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return SocialAccount = _classThis;
}();
exports.SocialAccount = SocialAccount;
