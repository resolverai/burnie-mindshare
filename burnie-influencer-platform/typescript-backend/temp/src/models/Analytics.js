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
exports.Analytics = void 0;
var typeorm_1 = require("typeorm");
var index_1 = require("../types/index");
var Analytics = function () {
    var _classDecorators = [(0, typeorm_1.Entity)('analytics')];
    var _classDescriptor;
    var _classExtraInitializers = [];
    var _classThis;
    var _id_decorators;
    var _id_initializers = [];
    var _id_extraInitializers = [];
    var _metricType_decorators;
    var _metricType_initializers = [];
    var _metricType_extraInitializers = [];
    var _granularity_decorators;
    var _granularity_initializers = [];
    var _granularity_extraInitializers = [];
    var _periodStart_decorators;
    var _periodStart_initializers = [];
    var _periodStart_extraInitializers = [];
    var _periodEnd_decorators;
    var _periodEnd_initializers = [];
    var _periodEnd_extraInitializers = [];
    var _value_decorators;
    var _value_initializers = [];
    var _value_extraInitializers = [];
    var _minerId_decorators;
    var _minerId_initializers = [];
    var _minerId_extraInitializers = [];
    var _campaignId_decorators;
    var _campaignId_initializers = [];
    var _campaignId_extraInitializers = [];
    var _projectId_decorators;
    var _projectId_initializers = [];
    var _projectId_extraInitializers = [];
    var _metadata_decorators;
    var _metadata_initializers = [];
    var _metadata_extraInitializers = [];
    var _createdAt_decorators;
    var _createdAt_initializers = [];
    var _createdAt_extraInitializers = [];
    var _updatedAt_decorators;
    var _updatedAt_initializers = [];
    var _updatedAt_extraInitializers = [];
    var Analytics = _classThis = /** @class */ (function () {
        function Analytics_1() {
            this.id = __runInitializers(this, _id_initializers, void 0);
            this.metricType = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _metricType_initializers, void 0));
            this.granularity = (__runInitializers(this, _metricType_extraInitializers), __runInitializers(this, _granularity_initializers, void 0));
            this.periodStart = (__runInitializers(this, _granularity_extraInitializers), __runInitializers(this, _periodStart_initializers, void 0));
            this.periodEnd = (__runInitializers(this, _periodStart_extraInitializers), __runInitializers(this, _periodEnd_initializers, void 0));
            this.value = (__runInitializers(this, _periodEnd_extraInitializers), __runInitializers(this, _value_initializers, void 0));
            this.minerId = (__runInitializers(this, _value_extraInitializers), __runInitializers(this, _minerId_initializers, void 0));
            this.campaignId = (__runInitializers(this, _minerId_extraInitializers), __runInitializers(this, _campaignId_initializers, void 0));
            this.projectId = (__runInitializers(this, _campaignId_extraInitializers), __runInitializers(this, _projectId_initializers, void 0));
            this.metadata = (__runInitializers(this, _projectId_extraInitializers), __runInitializers(this, _metadata_initializers, void 0));
            this.createdAt = (__runInitializers(this, _metadata_extraInitializers), __runInitializers(this, _createdAt_initializers, void 0));
            this.updatedAt = (__runInitializers(this, _createdAt_extraInitializers), __runInitializers(this, _updatedAt_initializers, void 0));
            __runInitializers(this, _updatedAt_extraInitializers);
        }
        return Analytics_1;
    }());
    __setFunctionName(_classThis, "Analytics");
    (function () {
        var _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        _id_decorators = [(0, typeorm_1.PrimaryGeneratedColumn)()];
        _metricType_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.MetricType,
            }), (0, typeorm_1.Index)()];
        _granularity_decorators = [(0, typeorm_1.Column)({
                type: 'enum',
                enum: index_1.TimeGranularity,
            }), (0, typeorm_1.Index)()];
        _periodStart_decorators = [(0, typeorm_1.Column)({ type: 'timestamp' }), (0, typeorm_1.Index)()];
        _periodEnd_decorators = [(0, typeorm_1.Column)({ type: 'timestamp' }), (0, typeorm_1.Index)()];
        _value_decorators = [(0, typeorm_1.Column)({ type: 'decimal', precision: 10, scale: 2 })];
        _minerId_decorators = [(0, typeorm_1.Column)({ nullable: true }), (0, typeorm_1.Index)()];
        _campaignId_decorators = [(0, typeorm_1.Column)({ nullable: true }), (0, typeorm_1.Index)()];
        _projectId_decorators = [(0, typeorm_1.Column)({ nullable: true }), (0, typeorm_1.Index)()];
        _metadata_decorators = [(0, typeorm_1.Column)({ type: 'jsonb', nullable: true })];
        _createdAt_decorators = [(0, typeorm_1.CreateDateColumn)()];
        _updatedAt_decorators = [(0, typeorm_1.UpdateDateColumn)()];
        __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: function (obj) { return "id" in obj; }, get: function (obj) { return obj.id; }, set: function (obj, value) { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
        __esDecorate(null, null, _metricType_decorators, { kind: "field", name: "metricType", static: false, private: false, access: { has: function (obj) { return "metricType" in obj; }, get: function (obj) { return obj.metricType; }, set: function (obj, value) { obj.metricType = value; } }, metadata: _metadata }, _metricType_initializers, _metricType_extraInitializers);
        __esDecorate(null, null, _granularity_decorators, { kind: "field", name: "granularity", static: false, private: false, access: { has: function (obj) { return "granularity" in obj; }, get: function (obj) { return obj.granularity; }, set: function (obj, value) { obj.granularity = value; } }, metadata: _metadata }, _granularity_initializers, _granularity_extraInitializers);
        __esDecorate(null, null, _periodStart_decorators, { kind: "field", name: "periodStart", static: false, private: false, access: { has: function (obj) { return "periodStart" in obj; }, get: function (obj) { return obj.periodStart; }, set: function (obj, value) { obj.periodStart = value; } }, metadata: _metadata }, _periodStart_initializers, _periodStart_extraInitializers);
        __esDecorate(null, null, _periodEnd_decorators, { kind: "field", name: "periodEnd", static: false, private: false, access: { has: function (obj) { return "periodEnd" in obj; }, get: function (obj) { return obj.periodEnd; }, set: function (obj, value) { obj.periodEnd = value; } }, metadata: _metadata }, _periodEnd_initializers, _periodEnd_extraInitializers);
        __esDecorate(null, null, _value_decorators, { kind: "field", name: "value", static: false, private: false, access: { has: function (obj) { return "value" in obj; }, get: function (obj) { return obj.value; }, set: function (obj, value) { obj.value = value; } }, metadata: _metadata }, _value_initializers, _value_extraInitializers);
        __esDecorate(null, null, _minerId_decorators, { kind: "field", name: "minerId", static: false, private: false, access: { has: function (obj) { return "minerId" in obj; }, get: function (obj) { return obj.minerId; }, set: function (obj, value) { obj.minerId = value; } }, metadata: _metadata }, _minerId_initializers, _minerId_extraInitializers);
        __esDecorate(null, null, _campaignId_decorators, { kind: "field", name: "campaignId", static: false, private: false, access: { has: function (obj) { return "campaignId" in obj; }, get: function (obj) { return obj.campaignId; }, set: function (obj, value) { obj.campaignId = value; } }, metadata: _metadata }, _campaignId_initializers, _campaignId_extraInitializers);
        __esDecorate(null, null, _projectId_decorators, { kind: "field", name: "projectId", static: false, private: false, access: { has: function (obj) { return "projectId" in obj; }, get: function (obj) { return obj.projectId; }, set: function (obj, value) { obj.projectId = value; } }, metadata: _metadata }, _projectId_initializers, _projectId_extraInitializers);
        __esDecorate(null, null, _metadata_decorators, { kind: "field", name: "metadata", static: false, private: false, access: { has: function (obj) { return "metadata" in obj; }, get: function (obj) { return obj.metadata; }, set: function (obj, value) { obj.metadata = value; } }, metadata: _metadata }, _metadata_initializers, _metadata_extraInitializers);
        __esDecorate(null, null, _createdAt_decorators, { kind: "field", name: "createdAt", static: false, private: false, access: { has: function (obj) { return "createdAt" in obj; }, get: function (obj) { return obj.createdAt; }, set: function (obj, value) { obj.createdAt = value; } }, metadata: _metadata }, _createdAt_initializers, _createdAt_extraInitializers);
        __esDecorate(null, null, _updatedAt_decorators, { kind: "field", name: "updatedAt", static: false, private: false, access: { has: function (obj) { return "updatedAt" in obj; }, get: function (obj) { return obj.updatedAt; }, set: function (obj, value) { obj.updatedAt = value; } }, metadata: _metadata }, _updatedAt_initializers, _updatedAt_extraInitializers);
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        Analytics = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return Analytics = _classThis;
}();
exports.Analytics = Analytics;
