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
exports.TwitterUserConnection = void 0;
var typeorm_1 = require("typeorm");
var User_1 = require("./User");
var TwitterUserConnection = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('twitter_user_connections'), (0, typeorm_1.Index)(['userId']), (0, typeorm_1.Unique)(['twitterUserId'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _userId_decorators;
    var _userId_initializers = [];
    var _userId_extraInitializers = [];
    var _twitterUserId_decorators;
    var _twitterUserId_initializers = [];
    var _twitterUserId_extraInitializers = [];
    var _twitterUsername_decorators;
    var _twitterUsername_initializers = [];
    var _twitterUsername_extraInitializers = [];
    var _twitterDisplayName_decorators;
    var _twitterDisplayName_initializers = [];
    var _twitterDisplayName_extraInitializers = [];
    var _profileImageUrl_decorators;
    var _profileImageUrl_initializers = [];
    var _profileImageUrl_extraInitializers = [];
    var _accessToken_decorators;
    var _accessToken_initializers = [];
    var _accessToken_extraInitializers = [];
    var _refreshToken_decorators;
    var _refreshToken_initializers = [];
    var _refreshToken_extraInitializers = [];
    var _isConnected_decorators;
    var _isConnected_initializers = [];
    var _isConnected_extraInitializers = [];
    var _lastSyncAt_decorators;
    var _lastSyncAt_initializers = [];
    var _lastSyncAt_extraInitializers = [];
    var _learningData_decorators;
    var _learningData_initializers = [];
    var _learningData_extraInitializers = [];
    var _user_decorators;
    var _user_initializers = [];
    var _user_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var TwitterUserConnection = _classThis = /** @class */ (function () {
        function TwitterUserConnection_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.userId = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _userId_initializers, void 0));
            this.twitterUserId = (__runInitializers(this, _userId_extraInitializers), __runInitializers(this, _twitterUserId_initializers, void 0));
            this.twitterUsername = (__runInitializers(this, _twitterUserId_extraInitializers), __runInitializers(this, _twitterUsername_initializers, void 0));
            this.twitterDisplayName = (__runInitializers(this, _twitterUsername_extraInitializers), __runInitializers(this, _twitterDisplayName_initializers, void 0));
            this.profileImageUrl = (__runInitializers(this, _twitterDisplayName_extraInitializers), __runInitializers(this, _profileImageUrl_initializers, void 0));
            this.accessToken = (__runInitializers(this, _profileImageUrl_extraInitializers), __runInitializers(this, _accessToken_initializers, void 0));
            this.refreshToken = (__runInitializers(this, _accessToken_extraInitializers), __runInitializers(this, _refreshToken_initializers, void 0));
            this.isConnected = (__runInitializers(this, _refreshToken_extraInitializers), __runInitializers(this, _isConnected_initializers, void 0));
            this.lastSyncAt = (__runInitializers(this, _isConnected_extraInitializers), __runInitializers(this, _lastSyncAt_initializers, void 0));
            this.learningData = (__runInitializers(this, _lastSyncAt_extraInitializers), __runInitializers(this, _learningData_initializers, void 0));
            // Relations
            this.user = (__runInitializers(this, _learningData_extraInitializers), __runInitializers(this, _user_initializers, void 0));
            this.createdAt = (__runInitializers(this, _user_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            __runInitializers(this, _updatedAt_extraInitializers);
        }
        // Helper methods
        TwitterUserConnection_1.prototype.isActive = function () {
            return this.isConnected;
        };
        TwitterUserConnection_1.prototype.needsRefresh = function () {
            if (!this.lastSyncAt)
                return true;
            var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            return this.lastSyncAt < oneHourAgo;
        };
        return TwitterUserConnection_1;
    }());
    __setFunctionName(_classThis, "TwitterUserConnection");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _userId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _twitterUserId_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 50 })];
        _twitterUsername_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 50 })];
        _twitterDisplayName_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 100, nullable: true })];
        _profileImageUrl_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _accessToken_decorators = [(0, typeorm_1.Column)({ type: 'text' })];
        _refreshToken_decorators = [(0, typeorm_1.Column)({ type: 'text', nullable: true })];
        _isConnected_decorators = [(0, typeorm_1.Column)({ type: 'boolean', default: true })];
        _lastSyncAt_decorators = [(0, typeorm_1.Column)({ type: 'timestamp', nullable: true })];
        _learningData_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _user_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.id; }), (0, typeorm_1.JoinColumn)({ name: 'userId' })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _userId_decorators, { kind: "field", name: "userId", static: false, private: false, access: { has: function (obj) { return "userId" in obj; }, get: function (obj) { return obj.userId; }, set: function (obj, value) { obj.userId = value; } }, metadata: _metadata }, _userId_initializers, _userId_extraInitializers);
        __esDecorate(null, null, _twitterUserId_decorators, { kind: "field", name: "twitterUserId", static: false, private: false, access: { has: function (obj) { return "twitterUserId" in obj; }, get: function (obj) { return obj.twitterUserId; }, set: function (obj, value) { obj.twitterUserId = value; } }, metadata: _metadata }, _twitterUserId_initializers, _twitterUserId_extraInitializers);
        __esDecorate(null, null, _twitterUsername_decorators, { kind: "field", name: "twitterUsername", static: false, private: false, access: { has: function (obj) { return "twitterUsername" in obj; }, get: function (obj) { return obj.twitterUsername; }, set: function (obj, value) { obj.twitterUsername = value; } }, metadata: _metadata }, _twitterUsername_initializers, _twitterUsername_extraInitializers);
        __esDecorate(null, null, _twitterDisplayName_decorators, { kind: "field", name: "twitterDisplayName", static: false, private: false, access: { has: function (obj) { return "twitterDisplayName" in obj; }, get: function (obj) { return obj.twitterDisplayName; }, set: function (obj, value) { obj.twitterDisplayName = value; } }, metadata: _metadata }, _twitterDisplayName_initializers, _twitterDisplayName_extraInitializers);
        __esDecorate(null, null, _profileImageUrl_decorators, { kind: "field", name: "profileImageUrl", static: false, private: false, access: { has: function (obj) { return "profileImageUrl" in obj; }, get: function (obj) { return obj.profileImageUrl; }, set: function (obj, value) { obj.profileImageUrl = value; } }, metadata: _metadata }, _profileImageUrl_initializers, _profileImageUrl_extraInitializers);
        __esDecorate(null, null, _accessToken_decorators, { kind: "field", name: "accessToken", static: false, private: false, access: { has: function (obj) { return "accessToken" in obj; }, get: function (obj) { return obj.accessToken; }, set: function (obj, value) { obj.accessToken = value; } }, metadata: _metadata }, _accessToken_initializers, _accessToken_extraInitializers);
        __esDecorate(null, null, _refreshToken_decorators, { kind: "field", name: "refreshToken", static: false, private: false, access: { has: function (obj) { return "refreshToken" in obj; }, get: function (obj) { return obj.refreshToken; }, set: function (obj, value) { obj.refreshToken = value; } }, metadata: _metadata }, _refreshToken_initializers, _refreshToken_extraInitializers);
        __esDecorate(null, null, _isConnected_decorators, { kind: "field", name: "isConnected", static: false, private: false, access: { has: function (obj) { return "isConnected" in obj; }, get: function (obj) { return obj.isConnected; }, set: function (obj, value) { obj.isConnected = value; } }, metadata: _metadata }, _isConnected_initializers, _isConnected_extraInitializers);
        __esDecorate(null, null, _lastSyncAt_decorators, { kind: "field", name: "lastSyncAt", static: false, private: false, access: { has: function (obj) { return "lastSyncAt" in obj; }, get: function (obj) { return obj.lastSyncAt; }, set: function (obj, value) { obj.lastSyncAt = value; } }, metadata: _metadata }, _lastSyncAt_initializers, _lastSyncAt_extraInitializers);
        __esDecorate(null, null, _learningData_decorators, { kind: "field", name: "learningData", static: false, private: false, access: { has: function (obj) { return "learningData" in obj; }, get: function (obj) { return obj.learningData; }, set: function (obj, value) { obj.learningData = value; } }, metadata: _metadata }, _learningData_initializers, _learningData_extraInitializers);
        __esDecorate(null, null, _user_decorators, { kind: "field", name: "user", static: false, private: false, access: { has: function (obj) { return "user" in obj; }, get: function (obj) { return obj.user; }, set: function (obj, value) { obj.user = value; } }, metadata: _metadata }, _user_initializers, _user_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        TwitterUserConnection = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return TwitterUserConnection = _classThis;
}();
exports.TwitterUserConnection = TwitterUserConnection;
