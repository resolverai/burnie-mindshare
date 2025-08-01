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
exports.Reward = void 0;
var typeorm_1 = require("typeorm");
var Miner_1 = require("./Miner");
var Block_1 = require("./Block");
var index_1 = require("../types/index");
var Reward = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('rewards')];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _type_decorators;
    var _type_initializers = [];
    var _type_extraInitializers = [];
    var _amount_decorators;
    var _amount_initializers = [];
    var _amount_extraInitializers = [];
    var _transactionHash_decorators;
    var _transactionHash_initializers = [];
    var _transactionHash_extraInitializers = [];
    var _isPaid_decorators;
    var _isPaid_initializers = [];
    var _isPaid_extraInitializers = [];
    var _calculation_decorators;
    var _calculation_initializers = [];
    var _calculation_extraInitializers = [];
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
    var _block_decorators;
    var _block_initializers = [];
    var _block_extraInitializers = [];
    var _blockId_decorators;
    var _blockId_initializers = [];
    var _blockId_extraInitializers = [];
    var Reward = _classThis = /** @class */ (function () {
        function Reward_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.type = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _type_initializers, void 0));
            this.amount = (__runInitializers(this, _type_extraInitializers), __runInitializers(this, _amount_initializers, void 0));
            this.transactionHash = (__runInitializers(this, _amount_extraInitializers), __runInitializers(this, _transactionHash_initializers, void 0));
            this.isPaid = (__runInitializers(this, _transactionHash_extraInitializers), __runInitializers(this, _isPaid_initializers, void 0));
            this.calculation = (__runInitializers(this, _isPaid_extraInitializers), __runInitializers(this, _calculation_initializers, void 0));
            this.metadata = (__runInitializers(this, _calculation_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
            this.createdAt = (__runInitializers(this, _metadata_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            // Relations
            this.miner = (__runInitializers(this, _updatedAt_extraInitializers), __runInitializers(this, _miner_initializers, void 0));
            this.minerId = (__runInitializers(this, _miner_extraInitializers), __runInitializers(this, _minerId_initializers, void 0));
            this.block = (__runInitializers(this, _minerId_extraInitializers), __runInitializers(this, _block_initializers, void 0));
            this.blockId = (__runInitializers(this, _block_extraInitializers), __runInitializers(this, _blockId_initializers, void 0));
            __runInitializers(this, _blockId_extraInitializers);
        }
        return Reward_1;
    }());
    __setFunctionName(_classThis, "Reward");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _type_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.RewardType,
                default: index_1.RewardType.MINING,
            }), (0, typeorm_1.Index)()];
        _amount_decorators = [(0, typeorm_1.Column)({ type: 'bigint' })];
        _transactionHash_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        _isPaid_decorators = [(0, typeorm_1.Column)({ default: false })];
        _calculation_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _metadata_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        _miner_decorators = [(0, typeorm_1.ManyToOne)(function () { return Miner_1.Miner; }, function (miner) { return miner.rewards; }), (0, typeorm_1.JoinColumn)({ name: 'minerId' })];
        _minerId_decorators = [(0, typeorm_1.Column)()];
        _block_decorators = [(0, typeorm_1.ManyToOne)(function () { return Block_1.Block; }, function (block) { return block.rewards; }, { nullable: true }), (0, typeorm_1.JoinColumn)({ name: 'blockId' })];
        _blockId_decorators = [(0, typeorm_1.Column)({ nullable: true })];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _type_decorators, { kind: "field", name: "type", static: false, private: false, access: { has: function (obj) { return "type" in obj; }, get: function (obj) { return obj.type; }, set: function (obj, value) { obj.type = value; } }, metadata: _metadata }, _type_initializers, _type_extraInitializers);
        __esDecorate(null, null, _amount_decorators, { kind: "field", name: "amount", static: false, private: false, access: { has: function (obj) { return "amount" in obj; }, get: function (obj) { return obj.amount; }, set: function (obj, value) { obj.amount = value; } }, metadata: _metadata }, _amount_initializers, _amount_extraInitializers);
        __esDecorate(null, null, _transactionHash_decorators, { kind: "field", name: "transactionHash", static: false, private: false, access: { has: function (obj) { return "transactionHash" in obj; }, get: function (obj) { return obj.transactionHash; }, set: function (obj, value) { obj.transactionHash = value; } }, metadata: _metadata }, _transactionHash_initializers, _transactionHash_extraInitializers);
        __esDecorate(null, null, _isPaid_decorators, { kind: "field", name: "isPaid", static: false, private: false, access: { has: function (obj) { return "isPaid" in obj; }, get: function (obj) { return obj.isPaid; }, set: function (obj, value) { obj.isPaid = value; } }, metadata: _metadata }, _isPaid_initializers, _isPaid_extraInitializers);
        __esDecorate(null, null, _calculation_decorators, { kind: "field", name: "calculation", static: false, private: false, access: { has: function (obj) { return "calculation" in obj; }, get: function (obj) { return obj.calculation; }, set: function (obj, value) { obj.calculation = value; } }, metadata: _metadata }, _calculation_initializers, _calculation_extraInitializers);
        __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: function (obj) { return "metadata" in obj; }, get: function (obj) { return obj.metadata; }, set: function (obj, value) { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, null, _miner_decorators, { kind: "field", name: "miner", static: false, private: false, access: { has: function (obj) { return "miner" in obj; }, get: function (obj) { return obj.miner; }, set: function (obj, value) { obj.miner = value; } }, metadata: _metadata }, _miner_initializers, _miner_extraInitializers);
        __esDecorate(null, null, _minerId_decorators, { kind: "field", name: "minerId", static: false, private: false, access: { has: function (obj) { return "minerId" in obj; }, get: function (obj) { return obj.minerId; }, set: function (obj, value) { obj.minerId = value; } }, metadata: _metadata }, _minerId_initializers, _minerId_extraInitializers);
        __esDecorate(null, null, _block_decorators, { kind: "field", name: "block", static: false, private: false, access: { has: function (obj) { return "block" in obj; }, get: function (obj) { return obj.block; }, set: function (obj, value) { obj.block = value; } }, metadata: _metadata }, _block_initializers, _block_extraInitializers);
        __esDecorate(null, null, _blockId_decorators, { kind: "field", name: "blockId", static: false, private: false, access: { has: function (obj) { return "blockId" in obj; }, get: function (obj) { return obj.blockId; }, set: function (obj, value) { obj.blockId = value; } }, metadata: _metadata }, _blockId_initializers, _blockId_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        Reward = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return Reward = _classThis;
}();
exports.Reward = Reward;
