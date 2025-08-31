-- Migration: Normalize all wallet addresses to lowercase
-- File: 005_normalize_wallet_addresses.sql
-- Description: Converts all existing wallet addresses to lowercase and adds check constraints
-- 
-- ⚠️  IMPORTANT: Run 006_merge_duplicate_users.sql FIRST if you have duplicate user records
-- with different wallet address cases (e.g., both "0xABC..." and "0xabc..." exist)
-- 
-- Run this on your production database AFTER merging duplicates
-- Column names are EXACTLY as they appear in your database schema

-- Users table (column: walletAddress)
UPDATE users SET "walletAddress" = LOWER("walletAddress") WHERE "walletAddress" != LOWER("walletAddress");

-- Content Marketplace table (column: wallet_address)
UPDATE content_marketplace SET "wallet_address" = LOWER("wallet_address") WHERE "wallet_address" != LOWER("wallet_address");

-- Content Purchases table (columns: buyer_wallet_address, miner_wallet_address)
UPDATE content_purchases SET "buyer_wallet_address" = LOWER("buyer_wallet_address") WHERE "buyer_wallet_address" != LOWER("buyer_wallet_address");
UPDATE content_purchases SET "miner_wallet_address" = LOWER("miner_wallet_address") WHERE "miner_wallet_address" != LOWER("miner_wallet_address");

-- Miners table (column: walletAddress)
UPDATE miners SET "walletAddress" = LOWER("walletAddress") WHERE "walletAddress" != LOWER("walletAddress");

-- Waitlist table (column: walletAddress)
UPDATE waitlist SET "walletAddress" = LOWER("walletAddress") WHERE "walletAddress" != LOWER("walletAddress");

-- Referral Codes table (column: leaderWalletAddress)
UPDATE referral_codes SET "leaderWalletAddress" = LOWER("leaderWalletAddress") WHERE "leaderWalletAddress" != LOWER("leaderWalletAddress");

-- Referral Payouts table (column: payoutWalletAddress)
UPDATE referral_payouts SET "payoutWalletAddress" = LOWER("payoutWalletAddress") WHERE "payoutWalletAddress" != LOWER("payoutWalletAddress");

-- Add check constraints to prevent future mixed-case addresses
ALTER TABLE users ADD CONSTRAINT check_lowercase_wallet_address CHECK ("walletAddress" = LOWER("walletAddress"));
ALTER TABLE content_marketplace ADD CONSTRAINT check_lowercase_wallet_address CHECK ("wallet_address" = LOWER("wallet_address"));
ALTER TABLE content_purchases ADD CONSTRAINT check_lowercase_buyer_wallet_address CHECK ("buyer_wallet_address" = LOWER("buyer_wallet_address"));
ALTER TABLE content_purchases ADD CONSTRAINT check_lowercase_miner_wallet_address CHECK ("miner_wallet_address" = LOWER("miner_wallet_address"));
ALTER TABLE miners ADD CONSTRAINT check_lowercase_wallet_address CHECK ("walletAddress" = LOWER("walletAddress"));
ALTER TABLE waitlist ADD CONSTRAINT check_lowercase_wallet_address CHECK ("walletAddress" = LOWER("walletAddress"));
ALTER TABLE referral_codes ADD CONSTRAINT check_lowercase_leader_wallet_address CHECK ("leaderWalletAddress" = LOWER("leaderWalletAddress"));
ALTER TABLE referral_payouts ADD CONSTRAINT check_lowercase_payout_wallet_address CHECK ("payoutWalletAddress" = LOWER("payoutWalletAddress"));

-- Migration completed successfully
-- All wallet addresses are now normalized to lowercase
-- Check constraints prevent future mixed-case entries
