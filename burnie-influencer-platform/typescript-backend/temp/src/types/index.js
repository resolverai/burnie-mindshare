"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeGranularity = exports.MetricType = exports.VerificationStatus = exports.RewardType = exports.BlockStatus = exports.SubmissionStatus = exports.CampaignStatus = exports.CampaignType = exports.LLMProvider = exports.AgentPersonality = exports.MinerStatus = void 0;
// Common enums
var MinerStatus;
(function (MinerStatus) {
    MinerStatus["ONLINE"] = "ONLINE";
    MinerStatus["OFFLINE"] = "OFFLINE";
    MinerStatus["MINING"] = "MINING";
    MinerStatus["IDLE"] = "IDLE";
})(MinerStatus || (exports.MinerStatus = MinerStatus = {}));
var AgentPersonality;
(function (AgentPersonality) {
    AgentPersonality["SAVAGE"] = "SAVAGE";
    AgentPersonality["WITTY"] = "WITTY";
    AgentPersonality["CHAOTIC"] = "CHAOTIC";
    AgentPersonality["LEGENDARY"] = "LEGENDARY";
})(AgentPersonality || (exports.AgentPersonality = AgentPersonality = {}));
var LLMProvider;
(function (LLMProvider) {
    LLMProvider["OPENAI"] = "OPENAI";
    LLMProvider["CLAUDE"] = "CLAUDE";
    LLMProvider["CUSTOM"] = "CUSTOM";
})(LLMProvider || (exports.LLMProvider = LLMProvider = {}));
var CampaignType;
(function (CampaignType) {
    CampaignType["ROAST"] = "roast";
    CampaignType["MEME"] = "meme";
    CampaignType["CREATIVE"] = "creative";
    CampaignType["ANALYSIS"] = "analysis";
})(CampaignType || (exports.CampaignType = CampaignType = {}));
var CampaignStatus;
(function (CampaignStatus) {
    CampaignStatus["DRAFT"] = "DRAFT";
    CampaignStatus["ACTIVE"] = "ACTIVE";
    CampaignStatus["PAUSED"] = "PAUSED";
    CampaignStatus["COMPLETED"] = "COMPLETED";
    CampaignStatus["CANCELLED"] = "CANCELLED";
})(CampaignStatus || (exports.CampaignStatus = CampaignStatus = {}));
var SubmissionStatus;
(function (SubmissionStatus) {
    SubmissionStatus["PENDING"] = "PENDING";
    SubmissionStatus["APPROVED"] = "APPROVED";
    SubmissionStatus["REJECTED"] = "REJECTED";
    SubmissionStatus["FLAGGED"] = "FLAGGED";
})(SubmissionStatus || (exports.SubmissionStatus = SubmissionStatus = {}));
var BlockStatus;
(function (BlockStatus) {
    BlockStatus["PENDING"] = "PENDING";
    BlockStatus["MINED"] = "MINED";
    BlockStatus["CONFIRMED"] = "CONFIRMED";
})(BlockStatus || (exports.BlockStatus = BlockStatus = {}));
var RewardType;
(function (RewardType) {
    RewardType["MINING"] = "MINING";
    RewardType["CAMPAIGN_WIN"] = "CAMPAIGN_WIN";
    RewardType["REFERRAL"] = "REFERRAL";
    RewardType["BONUS"] = "BONUS";
})(RewardType || (exports.RewardType = RewardType = {}));
var VerificationStatus;
(function (VerificationStatus) {
    VerificationStatus["UNVERIFIED"] = "UNVERIFIED";
    VerificationStatus["PENDING"] = "PENDING";
    VerificationStatus["VERIFIED"] = "VERIFIED";
    VerificationStatus["REJECTED"] = "REJECTED";
})(VerificationStatus || (exports.VerificationStatus = VerificationStatus = {}));
var MetricType;
(function (MetricType) {
    MetricType["SUBMISSIONS"] = "SUBMISSIONS";
    MetricType["EARNINGS"] = "EARNINGS";
    MetricType["ENGAGEMENT"] = "ENGAGEMENT";
    MetricType["QUALITY_SCORE"] = "QUALITY_SCORE";
})(MetricType || (exports.MetricType = MetricType = {}));
var TimeGranularity;
(function (TimeGranularity) {
    TimeGranularity["HOURLY"] = "HOURLY";
    TimeGranularity["DAILY"] = "DAILY";
    TimeGranularity["WEEKLY"] = "WEEKLY";
    TimeGranularity["MONTHLY"] = "MONTHLY";
})(TimeGranularity || (exports.TimeGranularity = TimeGranularity = {}));
