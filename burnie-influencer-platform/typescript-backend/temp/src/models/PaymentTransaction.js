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
exports.PaymentTransaction = exports.Currency = exports.TransactionStatus = exports.TransactionType = void 0;
var typeorm_1 = require("typeorm");
var User_1 = require("./User");
var TransactionType;
(function (TransactionType) {
    TransactionType["CONTENT_PURCHASE"] = "content_purchase";
    TransactionType["STAKING_REWARD"] = "staking_reward";
    TransactionType["PLATFORM_FEE"] = "platform_fee";
    TransactionType["WITHDRAWAL"] = "withdrawal";
    TransactionType["DEPOSIT"] = "deposit";
    TransactionType["COMMISSION"] = "commission";
    TransactionType["REFUND"] = "refund";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["PENDING"] = "pending";
    TransactionStatus["CONFIRMED"] = "confirmed";
    TransactionStatus["FAILED"] = "failed";
    TransactionStatus["CANCELLED"] = "cancelled";
})(TransactionStatus || (exports.TransactionStatus = TransactionStatus = {}));
var Currency;
(function (Currency) {
    Currency["ROAST"] = "ROAST";
    Currency["USDC"] = "USDC";
})(Currency || (exports.Currency = Currency = {}));
var PaymentTransaction = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('payment_transactions'), (0, typeorm_1.Index)(['fromUserId']), (0, typeorm_1.Index)(['toUserId']), (0, typeorm_1.Index)(['status']), (0, typeorm_1.Index)(['transactionType']), (0, typeorm_1.Index)(['currency'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _fromUserId_decorators;
    var _fromUserId_initializers = [];
    var _fromUserId_extraInitializers = [];
    var _toUserId_decorators;
    var _toUserId_initializers = [];
    var _toUserId_extraInitializers = [];
    var _amount_decorators;
    var _amount_initializers = [];
    var _amount_extraInitializers = [];
    var _currency_decorators;
    var _currency_initializers = [];
    var _currency_extraInitializers = [];
    var _transactionType_decorators;
    var _transactionType_initializers = [];
    var _transactionType_extraInitializers = [];
    var _transactionHash_decorators;
    var _transactionHash_initializers = [];
    var _transactionHash_extraInitializers = [];
    var _platformFee_decorators;
    var _platformFee_initializers = [];
    var _platformFee_extraInitializers = [];
    var _status_decorators;
    var _status_initializers = [];
    var _status_extraInitializers = [];
    var _metadata_decorators;
    var _metadata_initializers = [];
    var _metadata_extraInitializers = [];
    var _fromUser_decorators;
    var _fromUser_initializers = [];
    var _fromUser_extraInitializers = [];
    var _toUser_decorators;
    var _toUser_initializers = [];
    var _toUser_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var PaymentTransaction = _classThis = /** @class */ (function () {
        function PaymentTransaction_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.fromUserId = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _fromUserId_initializers, void 0));
            this.toUserId = (__runInitializers(this, _fromUserId_extraInitializers), __runInitializers(this, _toUserId_initializers, void 0));
            this.amount = (__runInitializers(this, _toUserId_extraInitializers), __runInitializers(this, _amount_initializers, void 0));
            this.currency = (__runInitializers(this, _amount_extraInitializers), __runInitializers(this, _currency_initializers, void 0));
            this.transactionType = (__runInitializers(this, _currency_extraInitializers), __runInitializers(this, _transactionType_initializers, void 0));
            this.transactionHash = (__runInitializers(this, _transactionType_extraInitializers), __runInitializers(this, _transactionHash_initializers, void 0));
            this.platformFee = (__runInitializers(this, _transactionHash_extraInitializers), __runInitializers(this, _platformFee_initializers, void 0));
            this.status = (__runInitializers(this, _platformFee_extraInitializers), __runInitializers(this, _status_initializers, void 0));
            this.metadata = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
            // Relations
            this.fromUser = (__runInitializers(this, _metadata_extraInitializers), __runInitializers(this, _fromUser_initializers, void 0));
            this.toUser = (__runInitializers(this, _fromUser_extraInitializers), __runInitializers(this, _toUser_initializers, void 0));
            this.createdAt = (__runInitializers(this, _toUser_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            __runInitializers(this, _createdAt_extraInitializers);
        }
        // Helper methods
        PaymentTransaction_1.prototype.getAmount = function () {
            return Number(this.amount);
        };
        PaymentTransaction_1.prototype.getPlatformFee = function () {
            return Number(this.platformFee) || 0;
        };
        PaymentTransaction_1.prototype.getNetAmount = function () {
            return this.getAmount() - this.getPlatformFee();
        };
        PaymentTransaction_1.prototype.isROASTTransaction = function () {
            return this.currency === Currency.ROAST;
        };
        PaymentTransaction_1.prototype.isUSDCTransaction = function () {
            return this.currency === Currency.USDC;
        };
        PaymentTransaction_1.prototype.isPending = function () {
            return this.status === TransactionStatus.PENDING;
        };
        PaymentTransaction_1.prototype.isConfirmed = function () {
            return this.status === TransactionStatus.CONFIRMED;
        };
        PaymentTransaction_1.prototype.isFailed = function () {
            return this.status === TransactionStatus.FAILED;
        };
        PaymentTransaction_1.prototype.confirm = function () {
            this.status = TransactionStatus.CONFIRMED;
        };
        PaymentTransaction_1.prototype.fail = function () {
            this.status = TransactionStatus.FAILED;
        };
        PaymentTransaction_1.prototype.cancel = function () {
            this.status = TransactionStatus.CANCELLED;
        };
        PaymentTransaction_1.prototype.addTransactionHash = function (hash) {
            this.transactionHash = hash;
        };
        PaymentTransaction_1.prototype.getFormattedAmount = function () {
            return "".concat(this.getAmount().toLocaleString(), " ").concat(this.currency);
        };
        PaymentTransaction_1.prototype.getTransactionAge = function () {
            return Date.now() - this.createdAt.getTime();
        };
        PaymentTransaction_1.prototype.addMetadata = function (data) {
            this.metadata = __assign(__assign({}, this.metadata), data);
        };
        PaymentTransaction_1.calculatePlatformFee = function (amount, feePercentage) {
            if (feePercentage === void 0) { feePercentage = 12.5; }
            return amount * (feePercentage / 100);
        };
        return PaymentTransaction_1;
    }());
    __setFunctionName(_classThis, "PaymentTransaction");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _fromUserId_decorators = [(0, typeorm_1.Column)({ type: 'integer', nullable: true })];
        _toUserId_decorators = [(0, typeorm_1.Column)({ type: 'integer', nullable: true })];
        _amount_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 8 })];
        _currency_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: Currency,
            })];
        _transactionType_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: TransactionType,
            })];
        _transactionHash_decorators = [(0, typeorm_1.Column)({ type: 'varchar', length: 66, nullable: true })];
        _platformFee_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 8, nullable: true })];
        _status_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: TransactionStatus,
                default: TransactionStatus.PENDING,
            })];
        _metadata_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _fromUser_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.id; }, { nullable: true }), (0, typeorm_1.JoinColumn)({ name: 'fromUserId' })];
        _toUser_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.id; }, { nullable: true }), (0, typeorm_1.JoinColumn)({ name: 'toUserId' })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _fromUserId_decorators, { kind: "field", name: "fromUserId", static: false, private: false, access: { has: function (obj) { return "fromUserId" in obj; }, get: function (obj) { return obj.fromUserId; }, set: function (obj, value) { obj.fromUserId = value; } }, metadata: _metadata }, _fromUserId_initializers, _fromUserId_extraInitializers);
        __esDecorate(null, null, _toUserId_decorators, { kind: "field", name: "toUserId", static: false, private: false, access: { has: function (obj) { return "toUserId" in obj; }, get: function (obj) { return obj.toUserId; }, set: function (obj, value) { obj.toUserId = value; } }, metadata: _metadata }, _toUserId_initializers, _toUserId_extraInitializers);
        __esDecorate(null, null, _amount_decorators, { kind: "field", name: "amount", static: false, private: false, access: { has: function (obj) { return "amount" in obj; }, get: function (obj) { return obj.amount; }, set: function (obj, value) { obj.amount = value; } }, metadata: _metadata }, _amount_initializers, _amount_extraInitializers);
        __esDecorate(null, null, _currency_decorators, { kind: "field", name: "currency", static: false, private: false, access: { has: function (obj) { return "currency" in obj; }, get: function (obj) { return obj.currency; }, set: function (obj, value) { obj.currency = value; } }, metadata: _metadata }, _currency_initializers, _currency_extraInitializers);
        __esDecorate(null, null, _transactionType_decorators, { kind: "field", name: "transactionType", static: false, private: false, access: { has: function (obj) { return "transactionType" in obj; }, get: function (obj) { return obj.transactionType; }, set: function (obj, value) { obj.transactionType = value; } }, metadata: _metadata }, _transactionType_initializers, _transactionType_extraInitializers);
        __esDecorate(null, null, _transactionHash_decorators, { kind: "field", name: "transactionHash", static: false, private: false, access: { has: function (obj) { return "transactionHash" in obj; }, get: function (obj) { return obj.transactionHash; }, set: function (obj, value) { obj.transactionHash = value; } }, metadata: _metadata }, _transactionHash_initializers, _transactionHash_extraInitializers);
        __esDecorate(null, null, _platformFee_decorators, { kind: "field", name: "platformFee", static: false, private: false, access: { has: function (obj) { return "platformFee" in obj; }, get: function (obj) { return obj.platformFee; }, set: function (obj, value) { obj.platformFee = value; } }, metadata: _metadata }, _platformFee_initializers, _platformFee_extraInitializers);
        __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: function (obj) { return "status" in obj; }, get: function (obj) { return obj.status; }, set: function (obj, value) { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
        __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: function (obj) { return "metadata" in obj; }, get: function (obj) { return obj.metadata; }, set: function (obj, value) { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
        __esDecorate(null, null, _fromUser_decorators, { kind: "field", name: "fromUser", static: false, private: false, access: { has: function (obj) { return "fromUser" in obj; }, get: function (obj) { return obj.fromUser; }, set: function (obj, value) { obj.fromUser = value; } }, metadata: _metadata }, _fromUser_initializers, _fromUser_extraInitializers);
        __esDecorate(null, null, _toUser_decorators, { kind: "field", name: "toUser", static: false, private: false, access: { has: function (obj) { return "toUser" in obj; }, get: function (obj) { return obj.toUser; }, set: function (obj, value) { obj.toUser = value; } }, metadata: _metadata }, _toUser_initializers, _toUser_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        PaymentTransaction = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return PaymentTransaction = _classThis;
}();
exports.PaymentTransaction = PaymentTransaction;
