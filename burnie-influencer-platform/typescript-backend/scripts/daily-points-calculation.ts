#!/usr/bin/env ts-node

import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import csv from 'csv-parser';
import { config } from 'dotenv';

// Load environment variables
config({ path: path.join(__dirname, '../.env') });

// Import entities
import { UserDailyPoints } from '../src/models/UserDailyPoints';
import { UserTiers, TierLevel } from '../src/models/UserTiers';

// Define interfaces
interface User {
  id: number;
  walletAddress: string;
  createdAt: Date;
  referralCount: number;
}

interface TwitterConnection {
  userId: number;
  twitterUsername: string;
  twitterDisplayName: string;
  profileImageUrl: string;
}

interface ContentPurchase {
  id: number;
  buyer_wallet_address: string;
  purchase_price: number;
  created_at: Date;
}

interface UserReferral {
  userId: number;
  directReferrerId: number;
  grandReferrerId: number;
}

interface MindshareData {
  [twitterHandle: string]: number;
}

interface MindshareUser {
  username: string;
  normalizedMindShare: number;
}

interface ProcessedMindshareData {
  [twitterHandle: string]: number; // Points allocated based on mindshare
}

interface UserCalculation {
  walletAddress: string;
  twitterHandle: string | undefined;
  name: string | undefined;
  totalReferrals: number;
  activeReferrals: number;
  totalReferralTransactionsValue: number;
  totalRoastEarned: number;
  mindshare: number;
  mindsharePoints: number;
  purchasePoints: number;
  milestonePoints: number;
  referralPoints: number;
  previousTotalPoints: number;
  totalPoints: number;
  dailyPointsEarned: number;
  dailyRewards: number;
  currentTier: TierLevel;
  newTier: TierLevel;
  tierChanged: boolean;
  // Daily component counts for detailed tracking
  dailyPurchaseCount: number;
  dailyMilestoneCount: number;
  dailyNewQualifiedReferrals: number;
}

// Tier requirements
const TIER_REQUIREMENTS = {
  [TierLevel.SILVER]: { referrals: 0, points: 0, purchases: 5 },
  [TierLevel.GOLD]: { referrals: 20, points: 20000, purchases: 0 },
  [TierLevel.PLATINUM]: { referrals: 50, points: 50000, purchases: 0 },
  [TierLevel.EMERALD]: { referrals: 100, points: 100000, purchases: 0 },
  [TierLevel.DIAMOND]: { referrals: 200, points: 200000, purchases: 0 },
  [TierLevel.UNICORN]: { referrals: 500, points: 500000, purchases: 0 }
};

// Daily mindshare points pool
const DAILY_MINDSHARE_POINTS_POOL = 25000;
const TOP_MINDSHARE_USERS_COUNT = 100;

// Daily rewards pool
const DAILY_REWARDS_POOL = 200000;
const TOP_REWARDS_USERS_COUNT = 25;

// Excluded wallets (lowercase) - these wallets will be skipped from points calculation
const EXCLUDED_WALLETS: string[] = [
  // Add wallet addresses here that should be excluded
  // Example: '0x1234567890abcdef1234567890abcdef12345678',
  // Example: '0xabcdef1234567890abcdef1234567890abcdef12',
];

// Excluded wallets from rewards (lowercase) - these wallets will be skipped from rewards distribution only
const EXCLUDE_WALLET_REWARDS: string[] = [
  // Add wallet addresses here that should be excluded from rewards
  // Example: '0x1234567890abcdef1234567890abcdef12345678',
  // Example: '0xabcdef1234567890abcdef1234567890abcdef12',
  '0x1b19d30c6b6d3161668738b169f8920507e7f22a',
  '0x2129d279fa40c41ec930f4604ab3a6a5bf30823b',
  '0x3e0b1d31454b982a02517f97dd2ae71bd1c9ee6e',
  '0x5825f8948b32da4e18784f27b4af4390612a8fe1'
];  

// Commission rates by tier
const COMMISSION_RATES = {
  [TierLevel.SILVER]: 0.05,
  [TierLevel.GOLD]: 0.075,
  [TierLevel.PLATINUM]: 0.10,
  [TierLevel.EMERALD]: 0.10,
  [TierLevel.DIAMOND]: 0.10,
  [TierLevel.UNICORN]: 0.10
};

// Database connection will be created in main() with SSL flag
let AppDataSource: DataSource;

class DailyPointsCalculationScript {
  private dataSource: DataSource;
  private mindshareData: MindshareData = {};
  private processedMindshareData: ProcessedMindshareData = {};
  private allCalculations: UserCalculation[] = [];

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
  }

  /**
   * Check if a wallet address should be excluded from calculations
   */
  private isWalletExcluded(walletAddress: string): boolean {
    return EXCLUDED_WALLETS.includes(walletAddress.toLowerCase());
  }

  /**
   * Check if a wallet address should be excluded from rewards distribution
   */
  private isWalletExcludedFromRewards(walletAddress: string): boolean {
    return EXCLUDE_WALLET_REWARDS.includes(walletAddress.toLowerCase());
  }

  /**
   * Load mindshare data from CSV file and process top 100 users
   */
  async loadMindshareData(csvPath?: string): Promise<void> {
    if (!csvPath || !fs.existsSync(csvPath)) {
      console.log('CSV file not provided or not found. Continuing without mindshare data.');
      return;
    }

    return new Promise((resolve, reject) => {
      const rawMindshareUsers: MindshareUser[] = [];
      let headers: string[] = [];

      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('headers', (headerList: string[]) => {
          headers = headerList;
          console.log('CSV Headers:', headers);
        })
        .on('data', (row: any) => {
          // Extract username and normalizedMindShare columns
          const username = row['username'];
          const normalizedMindShare = parseFloat(row['normalizedMindShare']);

          if (username && !isNaN(normalizedMindShare) && normalizedMindShare >= 0) {
            rawMindshareUsers.push({
              username: username.replace('@', '').toLowerCase(),
              normalizedMindShare: normalizedMindShare
            });
          }
        })
        .on('end', () => {
          // Process mindshare data
          this.processMindshareData(rawMindshareUsers);
          console.log(`Loaded mindshare data for ${rawMindshareUsers.length} users`);
          console.log(`Top ${TOP_MINDSHARE_USERS_COUNT} users will receive mindshare points`);
          resolve();
        })
        .on('error', (error: any) => {
          console.error('Error reading CSV file:', error);
          reject(error);
        });
    });
  }

  /**
   * Process mindshare data to calculate points for top 100 users
   */
  private processMindshareData(users: MindshareUser[]): void {
    // Step 1: Sort by normalizedMindShare in descending order
    const sortedUsers = users.sort((a, b) => b.normalizedMindShare - a.normalizedMindShare);
    
    // Step 2: Take top 100 users
    const top100Users = sortedUsers.slice(0, TOP_MINDSHARE_USERS_COUNT);
    
    if (top100Users.length === 0) {
      console.log('No valid mindshare users found');
      return;
    }
    
    // Step 3: Calculate sum of top 100 mindshares (should be close to 1.0 if all users included)
    const totalMindshare = top100Users.reduce((sum, user) => sum + user.normalizedMindShare, 0);
    
    console.log(`Top 100 users total mindshare: ${totalMindshare.toFixed(6)} (${(totalMindshare * 100).toFixed(4)}%)`);
    
    // Step 4: Calculate points directly from proportion (normalizedMindShare is already a decimal proportion)
    this.processedMindshareData = {};
    this.mindshareData = {}; // Keep for backward compatibility
    
    top100Users.forEach((user, index) => {
      // normalizedMindShare is already a decimal proportion, so multiply directly
      const mindsharePoints = Math.round(user.normalizedMindShare * DAILY_MINDSHARE_POINTS_POOL);
      
      this.processedMindshareData[user.username] = mindsharePoints;
      this.mindshareData[user.username] = user.normalizedMindShare; // Keep original value
      
      if (index < 10) { // Log first 10 for verification
        console.log(`#${index + 1}: ${user.username} - ${user.normalizedMindShare.toFixed(6)} (${(user.normalizedMindShare * 100).toFixed(4)}%) = ${mindsharePoints} points`);
      }
    });
    
    console.log(`Processed mindshare points for ${Object.keys(this.processedMindshareData).length} users`);
  }

  /**
   * Get all users with Twitter connections (excluding blocked wallets)
   */
  async getUsersWithTwitterConnections(): Promise<User[]> {
    const query = `
      SELECT DISTINCT u.id, u."walletAddress", u."createdAt", u."referralCount"
      FROM users u
      INNER JOIN yapper_twitter_connections ytc ON u.id = ytc."userId"
      WHERE ytc."isConnected" = true
      ORDER BY u.id
    `;

    const users = await this.dataSource.query(query);
    const filteredUsers = users
      .map((user: any) => ({
      id: user.id,
      walletAddress: user.walletAddress.toLowerCase(),
      createdAt: new Date(user.createdAt),
      referralCount: user.referralCount || 0
      }))
      .filter((user: User) => !this.isWalletExcluded(user.walletAddress));

    console.log(`📊 Found ${users.length} total users, ${filteredUsers.length} after excluding blocked wallets`);
    
    return filteredUsers;
  }

  /**
   * Get a single user with Twitter connection by wallet address
   */
  async getSingleUserWithTwitterConnection(walletAddress: string): Promise<User | null> {
    // Check if wallet is excluded first
    if (this.isWalletExcluded(walletAddress)) {
      console.log(`⚠️ Wallet ${walletAddress} is in the exclusion list`);
      return null;
    }

    const query = `
      SELECT DISTINCT u.id, u."walletAddress", u."createdAt", u."referralCount"
      FROM users u
      INNER JOIN yapper_twitter_connections ytc ON u.id = ytc."userId"
      WHERE ytc."isConnected" = true AND LOWER(u."walletAddress") = LOWER($1)
      LIMIT 1
    `;

    const users = await this.dataSource.query(query, [walletAddress]);
    if (users.length === 0) {
      return null;
    }

    const user = users[0];
    return {
      id: user.id,
      walletAddress: user.walletAddress.toLowerCase(),
      createdAt: new Date(user.createdAt),
      referralCount: user.referralCount || 0
    };
  }

  /**
   * Get Twitter connection data for a user
   */
  async getUserTwitterConnection(userId: number): Promise<TwitterConnection | null> {
    const query = `
      SELECT "userId", "twitterUsername", "twitterDisplayName", "profileImageUrl"
      FROM yapper_twitter_connections
      WHERE "userId" = $1 AND "isConnected" = true
    `;

    const result = await this.dataSource.query(query, [userId]);
    return result.length > 0 ? result[0] : null;
  }

  /**
   * Calculate user's own purchase count (excluding zero-price purchases)
   */
  async getUserPurchaseCount(walletAddress: string, userCreatedAt: Date): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases
      WHERE LOWER(buyer_wallet_address) = LOWER($1)
        AND payment_status = 'completed'
        AND created_at >= $2
        AND purchase_price > 0
    `;

    const result = await this.dataSource.query(query, [walletAddress, userCreatedAt]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Calculate direct referral purchase count (excluding zero-price purchases)
   */
  async getDirectReferralPurchaseCount(userId: number, userCreatedAt: Date): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      INNER JOIN user_referrals ur ON ur."userId" = u.id
      WHERE ur."directReferrerId" = $1
        AND cp.payment_status = 'completed'
        AND cp.created_at >= $2
        AND cp.purchase_price > 0
    `;

    const result = await this.dataSource.query(query, [userId, userCreatedAt]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Get user purchase count since a specific timestamp (excluding zero-price purchases)
   */
  async getUserPurchaseCountSince(walletAddress: string, sinceTimestamp: Date): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases
      WHERE LOWER(buyer_wallet_address) = LOWER($1)
        AND payment_status = 'completed'
        AND created_at > $2
        AND purchase_price > 0
    `;

    const result = await this.dataSource.query(query, [walletAddress, sinceTimestamp]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Get direct referral purchase count since a specific timestamp (excluding zero-price purchases)
   */
  async getDirectReferralPurchaseCountSince(userId: number, sinceTimestamp: Date): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      INNER JOIN user_referrals ur ON ur."userId" = u.id
      WHERE ur."directReferrerId" = $1
        AND cp.payment_status = 'completed'
        AND cp.created_at > $2
        AND cp.purchase_price > 0
    `;

    const result = await this.dataSource.query(query, [userId, sinceTimestamp]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Get all users referred by this user
   */
  async getUserReferrals(userId: number): Promise<UserReferral[]> {
    const query = `
      SELECT "userId", "directReferrerId", "grandReferrerId"
      FROM user_referrals
      WHERE "directReferrerId" = $1
    `;

    const result = await this.dataSource.query(query, [userId]);
    return result;
  }

  /**
   * Get referral's transaction count (excluding zero-price purchases)
   */
  async getReferralTransactionCount(referralUserId: number): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      WHERE u.id = $1
        AND cp.payment_status = 'completed'
        AND cp.purchase_price > 0
    `;

    const result = await this.dataSource.query(query, [referralUserId]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Get new referral points since a specific timestamp
   */
  async getNewReferralPointsSince(userId: number, sinceTimestamp: Date): Promise<{ newReferralPoints: number; activeReferrals: number; newQualifiedReferrals: number }> {
    // Get all referrals for this user
    const referrals = await this.getUserReferrals(userId);
    let newReferralPoints = 0;
    let activeReferrals = 0;
    let newQualifiedReferrals = 0;

    for (const referral of referrals) {
      // Check if this referral became qualified (2+ transactions) since the timestamp
      const totalTransactions = await this.getReferralTransactionCount(referral.userId);
      const transactionsSinceTimestamp = await this.getReferralTransactionCountSince(referral.userId, sinceTimestamp);
      
      const wasQualifiedBefore = (totalTransactions - transactionsSinceTimestamp) >= 2;
      const isQualifiedNow = totalTransactions >= 2;
      
      if (isQualifiedNow) {
        activeReferrals += 1;
        
        // If they weren't qualified before but are now, award points
        if (!wasQualifiedBefore) {
          newReferralPoints += 1000;
          newQualifiedReferrals += 1;
        }
      }
    }

    return { newReferralPoints, activeReferrals, newQualifiedReferrals };
  }

  /**
   * Get referral transaction count since a specific timestamp (excluding zero-price purchases)
   */
  async getReferralTransactionCountSince(referralUserId: number, sinceTimestamp: Date): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      WHERE u.id = $1
        AND cp.payment_status = 'completed'
        AND cp.created_at > $2
        AND cp.purchase_price > 0
    `;

    const result = await this.dataSource.query(query, [referralUserId, sinceTimestamp]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Calculate total referral transaction value (with price cap of 1999, excluding zero-price purchases)
   */
  async calculateReferralTransactionValue(userId: number, userCreatedAt: Date): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(
        CASE 
          WHEN cp.purchase_price > 1999 THEN 1999
          ELSE cp.purchase_price
        END
      ), 0) as total_value
      FROM content_purchases cp
      INNER JOIN user_referrals ur ON ur."userId" = (
        SELECT u.id FROM users u WHERE LOWER(u."walletAddress") = LOWER(cp.buyer_wallet_address)
      )
      WHERE (ur."directReferrerId" = $1 OR ur."grandReferrerId" = $1)
        AND cp.payment_status = 'completed'
        AND cp.created_at >= $2
        AND cp.purchase_price > 0
    `;

    const result = await this.dataSource.query(query, [userId, userCreatedAt]);
    return parseFloat(result[0]?.total_value || '0');
  }

  /**
   * Calculate incremental points since last recorded entry
   */
  async calculateIncrementalPoints(user: User, lastRecordedEntry: UserDailyPoints | null, twitterHandle?: string): Promise<{ 
    purchasePoints: number; 
    milestonePoints: number; 
    referralPoints: number; 
    mindsharePoints: number;
    activeReferrals: number;
    totalIncrementalPoints: number;
    dailyPurchaseCount: number;
    dailyMilestoneCount: number;
    dailyNewQualifiedReferrals: number;
  }> {
    const sinceTimestamp = lastRecordedEntry ? lastRecordedEntry.createdAt : user.createdAt;
    
    console.log(`  🔄 Calculating incremental points since: ${sinceTimestamp.toISOString()}`);
    
    // 1. Purchase points since last recorded entry
    const newPurchaseCount = await this.getUserPurchaseCountSince(user.walletAddress, sinceTimestamp);
    const purchasePoints = newPurchaseCount * 100;

    // 2. Milestone points - calculate total referral milestones now vs. total milestones at last entry
    const totalReferralPurchaseCount = await this.getDirectReferralPurchaseCount(user.id, user.createdAt);
    const newReferralPurchaseCount = await this.getDirectReferralPurchaseCountSince(user.id, sinceTimestamp);
    const currentMilestones = Math.floor(totalReferralPurchaseCount / 20);
    const previousMilestones = lastRecordedEntry ? Math.floor((totalReferralPurchaseCount - newReferralPurchaseCount) / 20) : 0;
    const newMilestones = currentMilestones - previousMilestones;
    const milestonePoints = newMilestones * 10000;

    // 3. Referral points - check for new qualified referrals since last entry
    const { newReferralPoints, activeReferrals, newQualifiedReferrals } = await this.getNewReferralPointsSince(user.id, sinceTimestamp);
    const referralPoints = newReferralPoints;

    // 4. Mindshare points (always current day's full allocation)
    let mindsharePoints = 0;
    if (twitterHandle) {
      const handleLower = twitterHandle.toLowerCase();
      mindsharePoints = this.processedMindshareData[handleLower] || 0;
      
      // Debug logging for mindshare lookup
      if (this.processedMindshareData[handleLower]) {
        console.log(`  ✅ Mindshare found for ${handleLower}: ${mindsharePoints} points`);
      } else if (Object.keys(this.processedMindshareData).length > 0) {
        console.log(`  ❌ No mindshare found for ${handleLower}`);
        // Log available handles for debugging
        const availableHandles = Object.keys(this.processedMindshareData).slice(0, 5);
        console.log(`  Available handles (first 5): ${availableHandles.join(', ')}`);
      }
    } else {
      console.log(`  ⚠️ No Twitter handle found for user`);
    }

    const totalIncrementalPoints = purchasePoints + milestonePoints + referralPoints + mindsharePoints;

    console.log(`  📊 Incremental Points Breakdown:`);
    console.log(`    New Purchases: ${newPurchaseCount} = ${purchasePoints} points`);
    console.log(`    New Referral Milestones: ${newMilestones} (${newReferralPurchaseCount} new referral purchases, ${totalReferralPurchaseCount} total) = ${milestonePoints} points`);
    console.log(`    New Referral Points: ${referralPoints} points (${activeReferrals} active referrals)`);
    console.log(`    Today's Mindshare: ${mindsharePoints} points`);
    console.log(`    Total Incremental: ${totalIncrementalPoints} points`);

    return { 
      purchasePoints, 
      milestonePoints, 
      referralPoints, 
      mindsharePoints, 
      activeReferrals,
      totalIncrementalPoints,
      dailyPurchaseCount: newPurchaseCount,
      dailyMilestoneCount: newMilestones,
      dailyNewQualifiedReferrals: newQualifiedReferrals
    };
  }

  /**
   * Determine user's tier based on referrals, points, and purchases
   */
  async determineUserTier(user: User, totalPoints: number): Promise<TierLevel> {
    const purchaseCount = await this.getUserPurchaseCount(user.walletAddress, user.createdAt);
    
    // Check tiers from highest to lowest
    const tiers = [TierLevel.UNICORN, TierLevel.DIAMOND, TierLevel.EMERALD, TierLevel.PLATINUM, TierLevel.GOLD, TierLevel.SILVER];
    
    for (const tier of tiers) {
      const req = TIER_REQUIREMENTS[tier];
      
      if (tier === TierLevel.SILVER) {
        // Silver tier: 5+ own purchases
        if (purchaseCount >= req.purchases) {
          return tier;
        }
      } else {
        // Other tiers: referrals OR points
        if (user.referralCount >= req.referrals || totalPoints >= req.points) {
          return tier;
        }
      }
    }

    return TierLevel.SILVER; // Default
  }

  /**
   * Get user's current tier from referral_codes table
   */
  async getUserCurrentTier(walletAddress: string): Promise<TierLevel> {
    const query = `
      SELECT tier
      FROM referral_codes
      WHERE LOWER("leaderWalletAddress") = LOWER($1)
    `;

    const result = await this.dataSource.query(query, [walletAddress]);
    return result[0]?.tier || TierLevel.SILVER;
  }

  /**
   * Update user's tier in referral_codes table
   */
  async updateUserTierInReferralCodes(walletAddress: string, newTier: TierLevel): Promise<void> {
    const query = `
      UPDATE referral_codes
      SET tier = $1, "updatedAt" = NOW()
      WHERE LOWER("leaderWalletAddress") = LOWER($2)
    `;

    const result = await this.dataSource.query(query, [newTier, walletAddress]);
    
    if (result.rowCount === 0) {
      throw new Error(`Failed to update tier in referral_codes for wallet ${walletAddress}`);
    }
  }

  /**
   * Get user's last recorded entry and cumulative points from user_daily_points table
   */
  async getLastRecordedEntry(walletAddress: string): Promise<{ lastEntry: UserDailyPoints | null; cumulativePoints: number }> {
    const userDailyPointsRepo = this.dataSource.getRepository(UserDailyPoints);
    
    // Get the most recent entry for timestamp reference
    const latestEntry = await userDailyPointsRepo.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
      order: { createdAt: 'DESC' }
    });

    // Get cumulative points (same logic as leaderboard)
    const sumResult = await userDailyPointsRepo
      .createQueryBuilder('udp')
      .select('SUM(udp.dailyPointsEarned)', 'cumulativePoints')
      .where('udp.walletAddress = :walletAddress', { walletAddress: walletAddress.toLowerCase() })
      .getRawOne();

    const cumulativePoints = sumResult?.cumulativePoints ? parseFloat(sumResult.cumulativePoints) : 0;

    console.log(`  📋 Last Recorded Entry: ${latestEntry ? `Found (${latestEntry.createdAt.toISOString()})` : 'None found (new user)'}`);
    console.log(`  📊 Cumulative Points: ${cumulativePoints} (sum of all dailyPointsEarned)`);
    
    return { lastEntry: latestEntry, cumulativePoints };
  }


  /**
   * Process a single user using incremental calculation approach
   */
  async processUser(user: User): Promise<UserCalculation> {
    console.log(`Processing user: ${user.walletAddress}`);

    // Double-check if wallet should be excluded (safety check)
    if (this.isWalletExcluded(user.walletAddress)) {
      throw new Error(`Attempted to process excluded wallet: ${user.walletAddress}`);
    }

    // Get Twitter connection
    const twitterConnection = await this.getUserTwitterConnection(user.id);
    const twitterHandle = twitterConnection?.twitterUsername?.toLowerCase();
    
    console.log(`  Twitter handle: ${twitterHandle || 'None'} (from DB: ${twitterConnection?.twitterUsername || 'None'})`);
    
    // Get last recorded entry for this user
    const { lastEntry, cumulativePoints } = await this.getLastRecordedEntry(user.walletAddress);
    
    // Calculate incremental points since last recorded entry
    const incrementalResult = await this.calculateIncrementalPoints(user, lastEntry, twitterHandle);
    
    // Calculate new totals
    const previousTotalPoints = cumulativePoints; // Use cumulative sum (same as leaderboard)
    const dailyPointsEarned = incrementalResult.totalIncrementalPoints;
    const newTotalPoints = previousTotalPoints + dailyPointsEarned;
    
    // Debug logging for points calculation flow
    console.log(`  📊 Points Calculation Summary:`);
    console.log(`    Previous Total Points: ${previousTotalPoints}`);
    console.log(`    Daily Points Earned: ${dailyPointsEarned}`);
    console.log(`    New Total Points: ${newTotalPoints}`);

    // Determine tier based on new total points
    const currentTier = await this.getUserCurrentTier(user.walletAddress);
    const newTier = await this.determineUserTier(user, newTotalPoints);
    const tierChanged = currentTier !== newTier;

    // Calculate referral transaction value
    const totalReferralTransactionsValue = await this.calculateReferralTransactionValue(user.id, user.createdAt);
    
    // Calculate ROAST earned based on current tier
    const commissionRate = COMMISSION_RATES[currentTier];
    const totalRoastEarned = totalReferralTransactionsValue * commissionRate;

    // Get mindshare data (original value for storage)
    const mindshare = twitterHandle && this.mindshareData[twitterHandle] ? this.mindshareData[twitterHandle] : 0;

    const calculation = {
      walletAddress: user.walletAddress,
      twitterHandle: twitterConnection?.twitterUsername,
      name: twitterConnection?.twitterDisplayName,
      totalReferrals: user.referralCount,
      activeReferrals: incrementalResult.activeReferrals,
      totalReferralTransactionsValue,
      totalRoastEarned,
      mindshare,
      mindsharePoints: incrementalResult.mindsharePoints,
      purchasePoints: incrementalResult.purchasePoints,
      milestonePoints: incrementalResult.milestonePoints,
      referralPoints: incrementalResult.referralPoints,
      previousTotalPoints,
      totalPoints: newTotalPoints,
      dailyPointsEarned,
      dailyRewards: 0, // Will be calculated later for top 25 users
      currentTier,
      newTier,
      tierChanged,
      dailyPurchaseCount: incrementalResult.dailyPurchaseCount,
      dailyMilestoneCount: incrementalResult.dailyMilestoneCount,
      dailyNewQualifiedReferrals: incrementalResult.dailyNewQualifiedReferrals
    };
    
    console.log(`  💾 Final Calculation Result:`);
    console.log(`    Daily Points Earned: ${dailyPointsEarned}`);
    console.log(`    New Total Points: ${newTotalPoints}`);
    console.log(`    Will be saved to database: ${dailyPointsEarned > 0 ? 'YES' : 'NO (0 daily points)'}`);
    
    return calculation;
  }

  /**
   * Save user daily points
   */
  async saveUserDailyPoints(calculation: UserCalculation): Promise<void> {
    const userDailyPointsRepo = this.dataSource.getRepository(UserDailyPoints);

    const userDailyPoints = new UserDailyPoints();
    userDailyPoints.walletAddress = calculation.walletAddress;
    userDailyPoints.twitterHandle = calculation.twitterHandle || undefined;
    userDailyPoints.name = calculation.name || undefined;
    userDailyPoints.totalReferrals = calculation.totalReferrals;
    userDailyPoints.activeReferrals = calculation.activeReferrals;
    userDailyPoints.totalReferralTransactionsValue = calculation.totalReferralTransactionsValue;
    userDailyPoints.totalRoastEarned = calculation.totalRoastEarned;
    userDailyPoints.mindshare = calculation.mindshare;
    userDailyPoints.totalPoints = calculation.totalPoints;
    userDailyPoints.dailyPointsEarned = calculation.dailyPointsEarned;
    userDailyPoints.dailyRewards = calculation.dailyRewards;
    
    // Store detailed point components
    userDailyPoints.purchasePoints = calculation.purchasePoints;
    userDailyPoints.milestonePoints = calculation.milestonePoints;
    userDailyPoints.referralPoints = calculation.referralPoints;
    userDailyPoints.mindsharePoints = calculation.mindsharePoints;
    userDailyPoints.dailyPurchaseCount = calculation.dailyPurchaseCount;
    userDailyPoints.dailyMilestoneCount = calculation.dailyMilestoneCount;
    userDailyPoints.dailyNewQualifiedReferrals = calculation.dailyNewQualifiedReferrals;

    await userDailyPointsRepo.save(userDailyPoints);
  }

  /**
   * Save user tier information (creates daily entry for every processed user)
   */
  async saveUserTierChange(calculation: UserCalculation): Promise<void> {
    const userTiersRepo = this.dataSource.getRepository(UserTiers);

    // Check if there's already an entry for today for this user
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    const todaysTierRecord = await userTiersRepo
      .createQueryBuilder('userTier')
      .where('userTier.walletAddress = :walletAddress', { walletAddress: calculation.walletAddress })
      .andWhere('userTier.createdAt >= :startOfDay', { startOfDay })
      .andWhere('userTier.createdAt < :endOfDay', { endOfDay })
      .getOne();

    // Check if user has any previous tier records (for determining if it's first time)
    const existingTierRecord = await userTiersRepo.findOne({
      where: { walletAddress: calculation.walletAddress },
      order: { createdAt: 'DESC' }
    });

    const isFirstTimeEntry = !existingTierRecord;
    const isTierUpgrade = calculation.tierChanged && this.isTierHigher(calculation.newTier, calculation.currentTier);
    const shouldCreateTodaysEntry = !todaysTierRecord; // Create entry if none exists for today

    // Create daily entry if none exists for today
    if (shouldCreateTodaysEntry) {
    const userTier = new UserTiers();
    userTier.walletAddress = calculation.walletAddress;
    userTier.twitterHandle = calculation.twitterHandle || undefined;
    userTier.name = calculation.name || undefined;
    userTier.tier = calculation.newTier;
    userTier.previousTier = calculation.currentTier;
    userTier.pointsAtTierChange = calculation.totalPoints;
    userTier.referralsAtTierChange = calculation.totalReferrals;

    await userTiersRepo.save(userTier);

      if (isTierUpgrade) {
        console.log(`✅ Tier upgraded: ${calculation.walletAddress} ${calculation.currentTier} → ${calculation.newTier}`);
      } else if (isFirstTimeEntry) {
        console.log(`🆕 First tier recorded: ${calculation.walletAddress} → ${calculation.newTier}`);
      } else {
        console.log(`📊 Daily tier snapshot: ${calculation.walletAddress} → ${calculation.newTier}`);
      }
    }

    // Always ensure referral_codes table reflects the current tier
    if (calculation.tierChanged || shouldCreateTodaysEntry) {
    await this.updateUserTierInReferralCodes(calculation.walletAddress, calculation.newTier);

      if (!shouldCreateTodaysEntry && calculation.tierChanged) {
        console.log(`🔄 Tier updated in referral_codes: ${calculation.walletAddress} ${calculation.currentTier} → ${calculation.newTier}`);
      }
    }
  }

  /**
   * Display final summary of all processed users (for dry-run mode)
   */
  private displayFinalSummary(): void {
    if (this.allCalculations.length === 0) {
      console.log('\n📊 [DRY RUN] Final Summary: No users processed');
      return;
    }

    console.log('\n' + '='.repeat(220));
    console.log('📊 [DRY RUN] FINAL SUMMARY - ALL PROCESSED USERS');
    console.log('='.repeat(220));
    console.log('Rank | Wallet Address                             | Twitter Handle       | Daily Pts | Prev Total | New Total | Purchase | Milestone | Referral | Mindshare | P.Count | M.Count | R.Count | Rewards | Referrals | ROAST    | Tier');
    console.log('='.repeat(220));
    
    // Sort by daily points earned (descending) for better visibility
    const sortedCalculations = [...this.allCalculations].sort((a, b) => b.dailyPointsEarned - a.dailyPointsEarned);
    
    sortedCalculations.forEach((calc, index) => {
      const tierInfo = calc.tierChanged ? `→ ${calc.newTier} (UP!)` : `(${calc.currentTier})`;
      const rank = (index + 1).toString().padStart(4, ' ');
      const wallet = calc.walletAddress.padEnd(42, ' ');
      const twitterHandle = (calc.twitterHandle || 'N/A').padEnd(20, ' ');
      const dailyPts = Math.round(calc.dailyPointsEarned).toString().padStart(9, ' ');
      const prevTotal = calc.previousTotalPoints.toString().padStart(10, ' ');
      const newTotal = calc.totalPoints.toString().padStart(9, ' ');
      const purchase = calc.purchasePoints.toString().padStart(8, ' ');
      const milestone = calc.milestonePoints.toString().padStart(9, ' ');
      const referral = calc.referralPoints.toString().padStart(8, ' ');
      const mindshare = calc.mindsharePoints.toString().padStart(9, ' ');
      const pCount = calc.dailyPurchaseCount.toString().padStart(7, ' ');
      const mCount = calc.dailyMilestoneCount.toString().padStart(7, ' ');
      const rCount = calc.dailyNewQualifiedReferrals.toString().padStart(7, ' ');
      const rewards = calc.dailyRewards.toString().padStart(7, ' ');
      const referrals = `${calc.totalReferrals}(${calc.activeReferrals})`.padStart(9, ' ');
      const roast = Math.round(calc.totalRoastEarned).toString().padStart(8, ' ');
      
      console.log(`${rank} | ${wallet} | ${twitterHandle} | ${dailyPts} | ${prevTotal} | ${newTotal} | ${purchase} | ${milestone} | ${referral} | ${mindshare} | ${pCount} | ${mCount} | ${rCount} | ${rewards} | ${referrals} | ${roast} | ${tierInfo}`);
    });
    
    // Summary statistics
    const totalDailyPoints = sortedCalculations.reduce((sum, calc) => sum + calc.dailyPointsEarned, 0);
    const totalRewards = sortedCalculations.reduce((sum, calc) => sum + calc.dailyRewards, 0);
    const usersWithPoints = sortedCalculations.filter(calc => calc.dailyPointsEarned > 0).length;
    const tierUpgrades = sortedCalculations.filter(calc => calc.tierChanged).length;
    const totalPurchasePoints = sortedCalculations.reduce((sum, calc) => sum + calc.purchasePoints, 0);
    const totalMilestonePoints = sortedCalculations.reduce((sum, calc) => sum + calc.milestonePoints, 0);
    const totalReferralPoints = sortedCalculations.reduce((sum, calc) => sum + calc.referralPoints, 0);
    const totalMindsharePoints = sortedCalculations.reduce((sum, calc) => sum + calc.mindsharePoints, 0);
    const totalPurchaseCount = sortedCalculations.reduce((sum, calc) => sum + calc.dailyPurchaseCount, 0);
    const totalMilestoneCount = sortedCalculations.reduce((sum, calc) => sum + calc.dailyMilestoneCount, 0);
    const totalNewQualifiedReferrals = sortedCalculations.reduce((sum, calc) => sum + calc.dailyNewQualifiedReferrals, 0);
    
    console.log('='.repeat(220));
    console.log(`📈 SUMMARY STATS: ${sortedCalculations.length} users processed | ${usersWithPoints} earned points | ${tierUpgrades} tier upgrades`);
    console.log(`💰 POINTS BREAKDOWN: ${Math.round(totalDailyPoints)} total daily | ${totalPurchasePoints} purchase | ${totalMilestonePoints} milestone | ${totalReferralPoints} referral | ${totalMindsharePoints} mindshare`);
    console.log(`📊 ACTIVITY COUNTS: ${totalPurchaseCount} purchases | ${totalMilestoneCount} milestones | ${totalNewQualifiedReferrals} new qualified referrals`);
    console.log(`🎁 REWARDS: ${totalRewards} total rewards distributed`);
    console.log('='.repeat(220));
  }

  /**
   * Check if new tier is higher than current tier
   */
  private isTierHigher(newTier: TierLevel, currentTier: TierLevel): boolean {
    const tierOrder = [
      TierLevel.SILVER,
      TierLevel.GOLD, 
      TierLevel.PLATINUM,
      TierLevel.EMERALD,
      TierLevel.DIAMOND,
      TierLevel.UNICORN
    ];
    
    const newTierIndex = tierOrder.indexOf(newTier);
    const currentTierIndex = tierOrder.indexOf(currentTier);
    
    return newTierIndex > currentTierIndex;
  }

  /**
   * Calculate daily rewards for top users (up to 25, excluding reward-excluded wallets)
   */
  async calculateDailyRewards(): Promise<void> {
    console.log('Calculating daily rewards for top users...');

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // Get ALL users with daily points earned for today (we'll filter later)
    const allUsersQuery = `
      SELECT id, "walletAddress", "dailyPointsEarned"
      FROM user_daily_points
      WHERE "createdAt" >= $1 AND "createdAt" < $2
        AND "dailyPointsEarned" > 0
      ORDER BY "dailyPointsEarned" DESC, "createdAt" ASC
    `;

    const allUsers = await this.dataSource.query(allUsersQuery, [todayStart, todayEnd]);

    if (allUsers.length === 0) {
      console.log('No users with daily points earned found for rewards calculation');
      return;
    }

    // Filter out wallets excluded from rewards
    const eligibleUsers = allUsers.filter((user: any) => {
      const isExcluded = this.isWalletExcludedFromRewards(user.walletAddress);
      if (isExcluded) {
        console.log(`🚫 Excluding ${user.walletAddress} from rewards (in EXCLUDE_WALLET_REWARDS)`);
      }
      return !isExcluded;
    });

    if (eligibleUsers.length === 0) {
      console.log('No eligible users found for rewards distribution after filtering');
      return;
    }

    // Take top 25 from eligible users
    const topEligibleUsers = eligibleUsers.slice(0, TOP_REWARDS_USERS_COUNT);

    // Calculate total daily points earned by top eligible users
    const totalDailyPointsTop = topEligibleUsers.reduce((sum: number, user: any) => {
      return sum + parseFloat(user.dailyPointsEarned || '0');
    }, 0);

    if (totalDailyPointsTop === 0) {
      console.log('Total daily points earned by eligible users is 0, no rewards to distribute');
      return;
    }

    console.log(`📊 Found ${allUsers.length} total users with daily points earned`);
    console.log(`📊 Found ${eligibleUsers.length} eligible users after filtering rewards exclusions`);
    console.log(`📊 Selected top ${topEligibleUsers.length} eligible users for rewards`);
    console.log(`📊 Total daily points by selected users: ${totalDailyPointsTop}`);
    console.log(`💰 Daily rewards pool: ${DAILY_REWARDS_POOL}`);
    console.log(`💰 Distributing rewards among ${topEligibleUsers.length} selected users...`);

    // Calculate and update daily rewards for each selected user
    for (const user of topEligibleUsers) {
      const userDailyPoints = parseFloat(user.dailyPointsEarned || '0');
      const proportion = userDailyPoints / totalDailyPointsTop;
      const dailyRewards = Math.round(proportion * DAILY_REWARDS_POOL);

      // Update the user's daily rewards
      const updateQuery = `
        UPDATE user_daily_points
        SET "dailyRewards" = $1
        WHERE id = $2
      `;

      await this.dataSource.query(updateQuery, [dailyRewards, user.id]);

      console.log(`💰 ${user.walletAddress}: ${userDailyPoints} points (${(proportion * 100).toFixed(2)}%) = ${dailyRewards} rewards`);
    }

    console.log(`✅ Daily rewards calculated and distributed to ${topEligibleUsers.length} users`);
    console.log(`✅ Total rewards distributed: ${DAILY_REWARDS_POOL.toLocaleString()}`);
    
    if (EXCLUDE_WALLET_REWARDS.length > 0) {
      console.log(`ℹ️  ${EXCLUDE_WALLET_REWARDS.length} wallet(s) excluded from rewards distribution`);
    }
  }

  /**
   * Calculate daily ranks
   */
  async calculateDailyRanks(): Promise<void> {
    console.log('Calculating daily ranks...');

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // Get today's entries and rank them by dailyPointsEarned, then by mindshare
    const query = `
      UPDATE user_daily_points 
      SET "dailyRank" = ranked_table.rank
      FROM (
        SELECT id, 
               ROW_NUMBER() OVER (ORDER BY "dailyPointsEarned" DESC, mindshare DESC, "createdAt" ASC) as rank
        FROM user_daily_points
        WHERE "createdAt" >= $1 AND "createdAt" < $2
      ) as ranked_table
      WHERE user_daily_points.id = ranked_table.id
    `;

    await this.dataSource.query(query, [todayStart, todayEnd]);
    console.log('✅ Daily ranks calculated');
  }

  /**
   * Process users in batches
   */
  async processUsersInBatches(users: User[], batchSize: number = 100, dryRun: boolean = false): Promise<void> {
    console.log(`Processing ${users.length} users in batches of ${batchSize}`);

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(users.length / batchSize)} (${batch.length} users)`);

      // Process batch in transaction
      await this.dataSource.transaction(async (manager) => {
        for (const user of batch) {
          try {
            const calculation = await this.processUser(user);
            
            // Store calculation for final summary (in dry-run mode)
            if (dryRun) {
              this.allCalculations.push(calculation);
            }
            
            // Save to database (if not dry run)
            if (!dryRun) {
            await this.saveUserDailyPoints(calculation);
            await this.saveUserTierChange(calculation);
            } else {
              // In dry-run mode, show all key values in a single line
              const tierInfo = calculation.tierChanged ? ` → ${calculation.newTier} (UPGRADED!)` : ` (${calculation.currentTier})`;
              console.log(`📊 [DRY RUN] ${user.walletAddress} | Daily: ${calculation.dailyPointsEarned} pts | Total: ${calculation.totalPoints} pts | Rewards: ${calculation.dailyRewards} | Referrals: ${calculation.totalReferrals}(${calculation.activeReferrals}) | ROAST: ${calculation.totalRoastEarned} | Mindshare: ${calculation.mindsharePoints} | Tier${tierInfo}`);
            }

            console.log(`✅ Processed: ${user.walletAddress} (${calculation.dailyPointsEarned} daily points, tier: ${calculation.currentTier})${dryRun ? ' [DRY RUN - NOT SAVED]' : ''}`);
          } catch (error) {
            console.error(`❌ Error processing user ${user.walletAddress}:`, error);
            throw error; // This will rollback the transaction
          }
        }
      });

      console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed`);
    }
  }

  /**
   * Main execution function
   */
  async run(csvPath?: string, singleUserWallet?: string, dryRun: boolean = false): Promise<void> {
    try {
      console.log('🚀 Starting Daily Points Calculation Script');
      console.log('📅 Date:', new Date().toISOString());

      // Initialize database connection
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
        console.log('✅ Database connected');
      }

      // Load mindshare data
      await this.loadMindshareData(csvPath);

      if (singleUserWallet) {
        // Process single user
        console.log(`🎯 Processing single user: ${singleUserWallet}`);
        const user = await this.getSingleUserWithTwitterConnection(singleUserWallet);
        
        if (!user) {
          console.log(`❌ User not found or doesn't have Twitter connection: ${singleUserWallet}`);
          return;
        }

        console.log(`📊 Found user with Twitter connection`);
        
        // Process single user
        const calculation = await this.processUser(user);
        
        // Store calculation for final summary (in dry-run mode)
        if (dryRun) {
          this.allCalculations.push(calculation);
        }
        
        // Save to database (if not dry run)
        if (!dryRun) {
          await this.saveUserDailyPoints(calculation);
          await this.saveUserTierChange(calculation);

          // Calculate daily rewards (will include this single user if they have daily points)
          await this.calculateDailyRewards();
        } else {
          // In dry-run mode, show all key values in a single line
          const tierInfo = calculation.tierChanged ? ` → ${calculation.newTier} (UPGRADED!)` : ` (${calculation.currentTier})`;
          console.log(`📊 [DRY RUN] ${user.walletAddress} | Daily: ${calculation.dailyPointsEarned} pts | Total: ${calculation.totalPoints} pts | Rewards: ${calculation.dailyRewards} | Referrals: ${calculation.totalReferrals}(${calculation.activeReferrals}) | ROAST: ${calculation.totalRoastEarned} | Mindshare: ${calculation.mindsharePoints} | Tier${tierInfo}`);
        }

        console.log(`✅ Processed: ${user.walletAddress} (${calculation.dailyPointsEarned} daily points, tier: ${calculation.currentTier})${dryRun ? ' [DRY RUN - NOT SAVED]' : ''}`);
        console.log(`🎉 Single User Points Calculation completed successfully!${dryRun ? ' [DRY RUN MODE]' : ''}`);
        
        // Display final summary for dry-run mode
        if (dryRun) {
          this.displayFinalSummary();
        }
        
      } else {
        // Process all users
      const users = await this.getUsersWithTwitterConnections();
      console.log(`📊 Found ${users.length} users with Twitter connections`);

      if (users.length === 0) {
        console.log('⚠️ No users found with Twitter connections. Exiting.');
        return;
      }

      // Process users in batches
        await this.processUsersInBatches(users, 100, dryRun);

        // Calculate daily ranks and rewards (if not dry run)
        if (!dryRun) {
      await this.calculateDailyRanks();
          await this.calculateDailyRewards();
        } else {
          // In dry-run mode, show what daily rewards calculation would have done
          console.log(`\n📊 [DRY RUN] Daily Rewards Summary:`);
          console.log(`   🏆 Daily ranks would be calculated and updated`);
          console.log(`   💰 Daily rewards pool (200,000) would be distributed among top users`);
          console.log(`   🚫 Excluded wallets from rewards: ${EXCLUDE_WALLET_REWARDS.length} wallet(s)`);
          console.log(`   ℹ️  Note: Individual reward amounts shown above in per-user calculations`);
        }

        console.log(`🎉 Daily Points Calculation Script completed successfully!${dryRun ? ' [DRY RUN MODE]' : ''}`);
      }

      // Display final summary for dry-run mode
      if (dryRun) {
        this.displayFinalSummary();
      }

    } catch (error) {
      console.error('💥 Script failed:', error);
      throw error;
    } finally {
      // Clean up database connection
      if (this.dataSource.isInitialized) {
        await this.dataSource.destroy();
        console.log('✅ Database connection closed');
      }
    }
  }
}

// Script execution
async function main() {
  // Parse command line arguments
  let csvPath: string | undefined;
  let singleUserWallet: string | undefined;
  let useSSL: boolean | undefined;
  let dryRun: boolean = false;
  
  // Parse arguments: --csv=path, --user=wallet, --ssl, --no-ssl, --dry-run, or positional arguments
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    if (arg && arg.startsWith('--csv=')) {
      csvPath = arg.substring(6);
    } else if (arg && arg.startsWith('--user=')) {
      singleUserWallet = arg.substring(7).toLowerCase();
    } else if (arg && arg.startsWith('--wallet=')) {
      singleUserWallet = arg.substring(9).toLowerCase();
    } else if (arg === '--ssl') {
      useSSL = true;
    } else if (arg === '--no-ssl') {
      useSSL = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (!csvPath && arg && arg.includes('.csv')) {
      // First positional argument that looks like a CSV file
      csvPath = arg;
    } else if (!singleUserWallet && arg && arg.startsWith('0x')) {
      // First positional argument that looks like a wallet address
      singleUserWallet = arg.toLowerCase();
    }
  }

  // Determine SSL usage
  let sslEnabled: boolean;
  if (useSSL !== undefined) {
    // Explicitly set via command line
    sslEnabled = useSSL;
  } else {
    // Auto-detect: use SSL for production or AWS RDS
    sslEnabled = process.env.NODE_ENV === 'production' || 
                 process.env.DB_HOST?.includes('rds.amazonaws.com') || 
                 false;
  }

  // Create database connection with SSL configuration
  AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5434'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'roastpower',
    entities: [UserDailyPoints, UserTiers],
    synchronize: false,
    logging: process.env.DB_LOGGING === 'true',
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    extra: {
      connectionLimit: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    },
  });
  
  console.log('🔧 Configuration:');
  console.log(`   Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  console.log(`   SSL: ${sslEnabled ? 'Enabled' : 'Disabled'} ${useSSL !== undefined ? '(explicit)' : '(auto-detected)'}`);
  console.log(`   CSV Path: ${csvPath || 'Not provided'}`);
  console.log(`   Single User: ${singleUserWallet || 'Not specified (will process all users)'}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (calculations only, no database writes)' : 'LIVE (calculations + database writes)'}`);
  console.log(`   Excluded Wallets: ${EXCLUDED_WALLETS.length} wallet(s)`);
  if (EXCLUDED_WALLETS.length > 0) {
    EXCLUDED_WALLETS.forEach((wallet, index) => {
      console.log(`     ${index + 1}. ${wallet}`);
    });
  }
  console.log(`   Excluded from Rewards: ${EXCLUDE_WALLET_REWARDS.length} wallet(s)`);
  if (EXCLUDE_WALLET_REWARDS.length > 0) {
    EXCLUDE_WALLET_REWARDS.forEach((wallet, index) => {
      console.log(`     ${index + 1}. ${wallet}`);
    });
  }
  console.log('');

  const script = new DailyPointsCalculationScript(AppDataSource);
  
  try {
    await script.run(csvPath, singleUserWallet, dryRun);
    process.exit(0);
  } catch (error) {
    console.error('Script execution failed:', error);
    process.exit(1);
  }
}

// Run the script if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { DailyPointsCalculationScript };
