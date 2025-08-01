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
exports.BiddingSystem = exports.BidCurrency = void 0;
var typeorm_1 = require("typeorm");
var User_1 = require("./User");
var ContentMarketplace_1 = require("./ContentMarketplace");
var BidCurrency;
(function (BidCurrency) {
    BidCurrency["ROAST"] = "ROAST";
    BidCurrency["USDC"] = "USDC";
})(BidCurrency || (exports.BidCurrency = BidCurrency = {}));
var BiddingSystem = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('bidding_system'), (0, typeorm_1.Index)(['contentId', 'bidAmount']), (0, typeorm_1.Index)(['bidderId']), (0, typeorm_1.Index)(['isWinning'])];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _contentId_decorators;
    var _contentId_initializers = [];
    var _contentId_extraInitializers = [];
    var _bidderId_decorators;
    var _bidderId_initializers = [];
    var _bidderId_extraInitializers = [];
    var _bidAmount_decorators;
    var _bidAmount_initializers = [];
    var _bidAmount_extraInitializers = [];
    var _bidCurrency_decorators;
    var _bidCurrency_initializers = [];
    var _bidCurrency_extraInitializers = [];
    var _isWinning_decorators;
    var _isWinning_initializers = [];
    var _isWinning_extraInitializers = [];
    var _content_decorators;
    var _content_initializers = [];
    var _content_extraInitializers = [];
    var _bidder_decorators;
    var _bidder_initializers = [];
    var _bidder_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var BiddingSystem = _classThis = /** @class */ (function () {
        function BiddingSystem_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.contentId = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _contentId_initializers, void 0));
            this.bidderId = (__runInitializers(this, _contentId_extraInitializers), __runInitializers(this, _bidderId_initializers, void 0));
            this.bidAmount = (__runInitializers(this, _bidderId_extraInitializers), __runInitializers(this, _bidAmount_initializers, void 0));
            this.bidCurrency = (__runInitializers(this, _bidAmount_extraInitializers), __runInitializers(this, _bidCurrency_initializers, void 0));
            this.isWinning = (__runInitializers(this, _bidCurrency_extraInitializers), __runInitializers(this, _isWinning_initializers, void 0));
            // Relations
            this.content = (__runInitializers(this, _isWinning_extraInitializers), __runInitializers(this, _content_initializers, void 0));
            this.bidder = (__runInitializers(this, _content_extraInitializers), __runInitializers(this, _bidder_initializers, void 0));
            this.createdAt = (__runInitializers(this, _bidder_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            __runInitializers(this, _createdAt_extraInitializers);
        }
        // Helper methods
        BiddingSystem_1.prototype.getBidAmount = function () {
            return Number(this.bidAmount);
        };
        BiddingSystem_1.prototype.isROASTBid = function () {
            return this.bidCurrency === BidCurrency.ROAST;
        };
        BiddingSystem_1.prototype.isUSDCBid = function () {
            return this.bidCurrency === BidCurrency.USDC;
        };
        BiddingSystem_1.prototype.setAsWinning = function () {
            this.isWinning = true;
        };
        BiddingSystem_1.prototype.setAsLosing = function () {
            this.isWinning = false;
        };
        // Convert bid to USD equivalent for comparison (mock rates)
        BiddingSystem_1.prototype.getBidValueInUSD = function () {
            var mockRates = {
                ROAST: 0.1, // $0.10 per ROAST
                USDC: 1.0, // $1.00 per USDC
            };
            return this.getBidAmount() * mockRates[this.bidCurrency];
        };
        BiddingSystem_1.prototype.canAffordBid = function (user) {
            var balance = this.bidCurrency === BidCurrency.ROAST
                ? user.roastBalance
                : user.usdcBalance;
            return Number(balance) >= this.getBidAmount();
        };
        BiddingSystem_1.prototype.getTimeElapsed = function () {
            return Date.now() - this.createdAt.getTime();
        };
        BiddingSystem_1.prototype.getFormattedBid = function () {
            return "".concat(this.getBidAmount().toLocaleString(), " ").concat(this.bidCurrency);
        };
        return BiddingSystem_1;
    }());
    __setFunctionName(_classThis, "BiddingSystem");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _contentId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _bidderId_decorators = [(0, typeorm_1.Column)({ type: 'integer' })];
        _bidAmount_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 18, scale: 8 })];
        _bidCurrency_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: BidCurrency,
                default: BidCurrency.ROAST,
            })];
        _isWinning_decorators = [(0, typeorm_1.Column)({ type: 'boolean', default: false })];
        _content_decorators = [(0, typeorm_1.ManyToOne)(function () { return ContentMarketplace_1.ContentMarketplace; }, function (content) { return content.id; }), (0, typeorm_1.JoinColumn)({ name: 'contentId' })];
        _bidder_decorators = [(0, typeorm_1.ManyToOne)(function () { return User_1.User; }, function (user) { return user.id; }), (0, typeorm_1.JoinColumn)({ name: 'bidderId' })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _contentId_decorators, { kind: "field", name: "contentId", static: false, private: false, access: { has: function (obj) { return "contentId" in obj; }, get: function (obj) { return obj.contentId; }, set: function (obj, value) { obj.contentId = value; } }, metadata: _metadata }, _contentId_initializers, _contentId_extraInitializers);
        __esDecorate(null, null, _bidderId_decorators, { kind: "field", name: "bidderId", static: false, private: false, access: { has: function (obj) { return "bidderId" in obj; }, get: function (obj) { return obj.bidderId; }, set: function (obj, value) { obj.bidderId = value; } }, metadata: _metadata }, _bidderId_initializers, _bidderId_extraInitializers);
        __esDecorate(null, null, _bidAmount_decorators, { kind: "field", name: "bidAmount", static: false, private: false, access: { has: function (obj) { return "bidAmount" in obj; }, get: function (obj) { return obj.bidAmount; }, set: function (obj, value) { obj.bidAmount = value; } }, metadata: _metadata }, _bidAmount_initializers, _bidAmount_extraInitializers);
        __esDecorate(null, null, _bidCurrency_decorators, { kind: "field", name: "bidCurrency", static: false, private: false, access: { has: function (obj) { return "bidCurrency" in obj; }, get: function (obj) { return obj.bidCurrency; }, set: function (obj, value) { obj.bidCurrency = value; } }, metadata: _metadata }, _bidCurrency_initializers, _bidCurrency_extraInitializers);
        __esDecorate(null, null, _isWinning_decorators, { kind: "field", name: "isWinning", static: false, private: false, access: { has: function (obj) { return "isWinning" in obj; }, get: function (obj) { return obj.isWinning; }, set: function (obj, value) { obj.isWinning = value; } }, metadata: _metadata }, _isWinning_initializers, _isWinning_extraInitializers);
        __esDecorate(null, null, _content_decorators, { kind: "field", name: "content", static: false, private: false, access: { has: function (obj) { return "content" in obj; }, get: function (obj) { return obj.content; }, set: function (obj, value) { obj.content = value; } }, metadata: _metadata }, _content_initializers, _content_extraInitializers);
        __esDecorate(null, null, _bidder_decorators, { kind: "field", name: "bidder", static: false, private: false, access: { has: function (obj) { return "bidder" in obj; }, get: function (obj) { return obj.bidder; }, set: function (obj, value) { obj.bidder = value; } }, metadata: _metadata }, _bidder_initializers, _bidder_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        BiddingSystem = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return BiddingSystem = _classThis;
}();
exports.BiddingSystem = BiddingSystem;
