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
  weeklyRewards: number;
  weeklyPoints: number;
  dailyRank: number;
  weeklyRank: number;
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

// Weekly rewards pool (distributed on Thursdays)
const WEEKLY_REWARDS_POOL = 500000;

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
      weeklyRewards: 0, // Will be set separately for weekly reward distribution
      weeklyPoints: 0, // Will be calculated during weekly calculation
      dailyRank: 0, // Will be calculated during daily ranking
      weeklyRank: 0, // Will be calculated during weekly calculation
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
    userDailyPoints.weeklyRewards = calculation.weeklyRewards;
    userDailyPoints.weeklyPoints = calculation.weeklyPoints;
    userDailyPoints.dailyRank = calculation.dailyRank;
    userDailyPoints.weeklyRank = calculation.weeklyRank;
    
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
  private async displayFinalSummary(): Promise<void> {
    if (this.allCalculations.length === 0) {
      console.log('\n📊 [DRY RUN] Final Summary: No users processed');
      return;
    }

    // Debug: Check weekly points in allCalculations before displaying
    const usersWithWeeklyPoints = this.allCalculations.filter(calc => calc.weeklyPoints > 0);
    console.log(`🔍 DISPLAY DEBUG: ${usersWithWeeklyPoints.length} users have weeklyPoints > 0 in allCalculations (total: ${this.allCalculations.length})`);
    console.log(`🔍 DISPLAY DEBUG: Is weekly calculation day? ${this.isWeeklyCalculationDay()}`);
    
    // REAL FIX: Force apply weekly points from database if none found
    if (usersWithWeeklyPoints.length === 0 && this.isWeeklyCalculationDay()) {
      console.log(`🔧 REAL FIX: No weekly points found, applying real database values...`);
      
      // Re-run the weekly query to get fresh data
      const { startDate, endDate } = this.getWeeklyCalculationWindow();
      const weeklyQuery = `
        SELECT 
          u."walletAddress",
          COALESCE(SUM(udp."dailyPointsEarned"), 0) as weeklyPoints
        FROM users u
        LEFT JOIN user_daily_points udp ON u."walletAddress" = udp."walletAddress"
          AND udp."createdAt" >= $1 
          AND udp."createdAt" < $2
        GROUP BY u."walletAddress"
        HAVING COALESCE(SUM(udp."dailyPointsEarned"), 0) > 0
        ORDER BY weeklyPoints DESC
      `;
      
      try {
        const weeklyResults = await this.dataSource.query(weeklyQuery, [startDate, endDate]);
        console.log(`🔧 REAL FIX: Found ${weeklyResults.length} users with real weekly points`);
        
        if (weeklyResults.length > 0) {
          console.log(`🔍 First few raw results:`, weeklyResults.slice(0, 3));
          
          const totalWeeklyPoints = weeklyResults.reduce((sum: number, row: any) => {
            const points = parseFloat(row.weeklypoints || row.weeklyPoints || '0');
            return sum + (isNaN(points) ? 0 : points);
          }, 0);
          
          console.log(`🔧 Total weekly points calculated: ${totalWeeklyPoints}`);
          
          // Apply real weekly points to allCalculations
          let updatedCount = 0;
          let addedCount = 0;
          
          weeklyResults.forEach((row: any, index: number) => {
            // Debug: Check what we're actually getting from the database
            console.log(`🔍 Raw database row:`, JSON.stringify(row));
            console.log(`🔍 Raw weeklyPoints value:`, row.weeklyPoints, `Type:`, typeof row.weeklyPoints);
            
            const weeklyPoints = parseFloat(row.weeklypoints || row.weeklyPoints || '0'); // Try both cases
            console.log(`🔍 Parsed weeklyPoints:`, weeklyPoints);
            
            if (isNaN(weeklyPoints)) {
              console.log(`🚨 WARNING: weeklyPoints is NaN for ${row.walletAddress}`);
              return; // Skip this user
            }
            
            const weeklyRank = index + 1;
            const proportion = weeklyPoints / totalWeeklyPoints;
            const weeklyRewards = Math.round(proportion * 500000); // WEEKLY_REWARDS_POOL
            
            console.log(`🔧 Processing ${row.walletAddress} with ${weeklyPoints} weekly points`);
            
            // Find and update existing user with more robust matching
            let found = false;
            const targetWallet = row.walletAddress.toLowerCase().trim();
            
            for (let i = 0; i < this.allCalculations.length; i++) {
              const calc = this.allCalculations[i];
              if (calc && calc.walletAddress.toLowerCase().trim() === targetWallet) {
                console.log(`🔧 MATCH FOUND: ${calc.walletAddress} matches ${row.walletAddress}`);
                
                // Add today's daily points to the weekly points from database
                const totalWeeklyPoints = weeklyPoints + calc.dailyPointsEarned;
                console.log(`🔧 Weekly calculation: ${weeklyPoints} (from DB) + ${calc.dailyPointsEarned} (today) = ${totalWeeklyPoints}`);
                
                calc.weeklyPoints = totalWeeklyPoints;
                calc.weeklyRank = weeklyRank; // Will be recalculated after all users are processed
                calc.weeklyRewards = weeklyRewards; // Will be recalculated after all users are processed
                found = true;
                updatedCount++;
                break;
              }
            }
            
            // If not found, add new user
            if (!found) {
              console.log(`🔧 NO MATCH: Adding new user ${row.walletAddress}`);
              const newCalculation = {
                walletAddress: row.walletAddress,
                twitterHandle: undefined,
                name: undefined,
                dailyPointsEarned: 0,
                totalPoints: 0,
                purchasePoints: 0,
                milestonePoints: 0,
                referralPoints: 0,
                mindsharePoints: 0,
                previousTotalPoints: 0,
                totalReferrals: 0,
                activeReferrals: 0,
                totalReferralTransactionsValue: 0,
                totalRoastEarned: 0,
                mindshare: 0,
                dailyPurchaseCount: 0,
                dailyMilestoneCount: 0,
                dailyNewQualifiedReferrals: 0,
                dailyRewards: 0,
                weeklyRewards: weeklyRewards,
                weeklyPoints: weeklyPoints,
                dailyRank: 0,
                weeklyRank: weeklyRank,
                currentTier: 'BRONZE' as any,
                newTier: 'BRONZE' as any,
                tierChanged: false
              };
              this.allCalculations.push(newCalculation as any);
              addedCount++;
            }
          });
          
          console.log(`🔧 REAL FIX RESULT: Updated ${updatedCount} users, added ${addedCount} users`);
          
          // Recalculate ranks and rewards after adding today's points
          const usersWithWeeklyPoints = this.allCalculations.filter(calc => calc.weeklyPoints > 0);
          if (usersWithWeeklyPoints.length > 0) {
            // Sort by weekly points to get proper rankings
            usersWithWeeklyPoints.sort((a, b) => b.weeklyPoints - a.weeklyPoints);
            
            // First, set all weekly rewards to 0
            this.allCalculations.forEach(calc => {
              calc.weeklyRewards = 0;
            });
            
            // Filter out wallets excluded from rewards (same as daily rewards)
            const eligibleUsers = usersWithWeeklyPoints.filter(calc => {
              const isExcluded = this.isWalletExcludedFromRewards(calc.walletAddress);
              if (isExcluded) {
                console.log(`🚫 Excluding ${calc.walletAddress} from weekly rewards (in EXCLUDE_WALLET_REWARDS)`);
              }
              return !isExcluded;
            });
            
            console.log(`🔧 Weekly rewards: ${usersWithWeeklyPoints.length} total users, ${eligibleUsers.length} eligible (${usersWithWeeklyPoints.length - eligibleUsers.length} excluded)`);
            
            // Only distribute rewards to TOP 5 ELIGIBLE users
            const top5EligibleUsers = eligibleUsers.slice(0, 5);
            const top5TotalPoints = top5EligibleUsers.reduce((sum, calc) => sum + calc.weeklyPoints, 0);
            
            console.log(`🔧 Distributing 500K rewards among TOP 5 eligible users (total points: ${top5TotalPoints})`);
            
            let distributedRewards = 0;
            
            // Distribute rewards proportionally among top 5 eligible users
            top5EligibleUsers.forEach((calc, index) => {
              if (index === 4) { // Last user gets remainder to ensure exact 500K total
                calc.weeklyRewards = 500000 - distributedRewards;
              } else {
                const proportion = calc.weeklyPoints / top5TotalPoints;
                calc.weeklyRewards = Math.floor(proportion * 500000); // Use floor to prevent exceeding
                distributedRewards += calc.weeklyRewards;
              }
              
              console.log(`🔧 Rank ${index + 1}: ${calc.walletAddress} - ${calc.weeklyPoints} pts = ${calc.weeklyRewards} rewards`);
            });
            
            // Set ranks for ALL users (including excluded ones, but they get 0 rewards)
            usersWithWeeklyPoints.forEach((calc, index) => {
              calc.weeklyRank = index + 1;
              // Rewards already set above (0 for excluded/beyond top 5, actual values for top 5 eligible)
            });
            
            console.log(`🔧 Total rewards distributed: ${top5EligibleUsers.reduce((sum, calc) => sum + calc.weeklyRewards, 0)} (should be exactly 500000)`);
          }
          
          const finalCheck = this.allCalculations.filter(calc => calc.weeklyPoints > 0);
          console.log(`🔧 REAL FIX SUCCESS: ${finalCheck.length} users now have real weekly points (including today's points)`);
          
          // Debug: Show first few users with weekly points
          if (finalCheck.length > 0) {
            console.log(`🔧 Sample users with weekly points after real fix:`);
            finalCheck.slice(0, 3).forEach(calc => {
              console.log(`   ${calc.walletAddress}: ${calc.weeklyPoints} weekly points`);
            });
          }
        }
      } catch (error) {
        console.error(`🔧 REAL FIX ERROR:`, error);
      }
    }
    
    if (usersWithWeeklyPoints.length > 0) {
      console.log(`🔍 DISPLAY DEBUG: First 3 users with weekly points:`);
      usersWithWeeklyPoints.slice(0, 3).forEach(calc => {
        console.log(`   ${calc.walletAddress}: weeklyPoints=${calc.weeklyPoints}, dailyPoints=${calc.dailyPointsEarned}`);
      });
    } else {
      console.log(`🔍 DISPLAY DEBUG: No users with weekly points found. Sample of allCalculations:`);
      this.allCalculations.slice(0, 3).forEach(calc => {
        console.log(`   ${calc.walletAddress}: weeklyPoints=${calc.weeklyPoints}, dailyPoints=${calc.dailyPointsEarned}`);
      });
    }

    console.log('\n' + '='.repeat(200));
    console.log('📊 [DRY RUN] FINAL SUMMARY - ALL PROCESSED USERS');
    console.log('='.repeat(200));
    console.log('Rank | Wallet Address                             | Twitter Handle       | Daily Pts | Weekly Pts | Prev Total | New Total | Purchase | Milestone | Referral | Mindshare | P.Count | M.Count | R.Count | Referrals | ROAST    | Tier');
    console.log('='.repeat(200));
    
    // Sort by daily points earned (descending) for better visibility - ALWAYS sort by daily points
    const sortedCalculations = [...this.allCalculations].sort((a, b) => b.dailyPointsEarned - a.dailyPointsEarned);
    
    sortedCalculations.forEach((calc, index) => {
      const tierInfo = calc.tierChanged ? `→ ${calc.newTier} (UP!)` : `(${calc.currentTier})`;
      const rank = (index + 1).toString().padStart(4, ' ');
      const wallet = calc.walletAddress.padEnd(42, ' ');
      const twitterHandle = (calc.twitterHandle || 'N/A').padEnd(20, ' ');
      const dailyPts = Math.round(calc.dailyPointsEarned).toString().padStart(9, ' ');
      const weeklyPts = this.isWeeklyCalculationDay() ? Math.round(calc.weeklyPoints).toString().padStart(10, ' ') : 'TBD'.padStart(10, ' ');
      const prevTotal = calc.previousTotalPoints.toString().padStart(10, ' ');
      const newTotal = calc.totalPoints.toString().padStart(9, ' ');
      const purchase = calc.purchasePoints.toString().padStart(8, ' ');
      const milestone = calc.milestonePoints.toString().padStart(9, ' ');
      const referral = calc.referralPoints.toString().padStart(8, ' ');
      const mindshare = calc.mindsharePoints.toString().padStart(9, ' ');
      const pCount = calc.dailyPurchaseCount.toString().padStart(7, ' ');
      const mCount = calc.dailyMilestoneCount.toString().padStart(7, ' ');
      const rCount = calc.dailyNewQualifiedReferrals.toString().padStart(7, ' ');
      const referrals = `${calc.totalReferrals}(${calc.activeReferrals})`.padStart(9, ' ');
      const roast = Math.round(calc.totalRoastEarned).toString().padStart(8, ' ');
      
      console.log(`${rank} | ${wallet} | ${twitterHandle} | ${dailyPts} | ${weeklyPts} | ${prevTotal} | ${newTotal} | ${purchase} | ${milestone} | ${referral} | ${mindshare} | ${pCount} | ${mCount} | ${rCount} | ${referrals} | ${roast} | ${tierInfo}`);
    });
    
    // Summary statistics
    const totalDailyPoints = sortedCalculations.reduce((sum, calc) => sum + calc.dailyPointsEarned, 0);
    const totalDailyRewards = sortedCalculations.reduce((sum, calc) => sum + calc.dailyRewards, 0);
    const totalWeeklyRewards = sortedCalculations.reduce((sum, calc) => sum + calc.weeklyRewards, 0);
    const totalWeeklyPoints = sortedCalculations.reduce((sum, calc) => sum + calc.weeklyPoints, 0);
    const usersWithPoints = sortedCalculations.filter(calc => calc.dailyPointsEarned > 0).length;
    const tierUpgrades = sortedCalculations.filter(calc => calc.tierChanged).length;
    const totalPurchasePoints = sortedCalculations.reduce((sum, calc) => sum + calc.purchasePoints, 0);
    const totalMilestonePoints = sortedCalculations.reduce((sum, calc) => sum + calc.milestonePoints, 0);
    const totalReferralPoints = sortedCalculations.reduce((sum, calc) => sum + calc.referralPoints, 0);
    const totalMindsharePoints = sortedCalculations.reduce((sum, calc) => sum + calc.mindsharePoints, 0);
    const totalPurchaseCount = sortedCalculations.reduce((sum, calc) => sum + calc.dailyPurchaseCount, 0);
    const totalMilestoneCount = sortedCalculations.reduce((sum, calc) => sum + calc.dailyMilestoneCount, 0);
    const totalNewQualifiedReferrals = sortedCalculations.reduce((sum, calc) => sum + calc.dailyNewQualifiedReferrals, 0);
    
    console.log('='.repeat(200));
    console.log(`📈 SUMMARY STATS: ${sortedCalculations.length} users processed | ${usersWithPoints} earned points | ${tierUpgrades} tier upgrades`);
    console.log(`💰 POINTS BREAKDOWN: ${Math.round(totalDailyPoints)} total daily | ${totalPurchasePoints} purchase | ${totalMilestonePoints} milestone | ${totalReferralPoints} referral | ${totalMindsharePoints} mindshare`);
    console.log(`📊 ACTIVITY COUNTS: ${totalPurchaseCount} purchases | ${totalMilestoneCount} milestones | ${totalNewQualifiedReferrals} new qualified referrals`);
    if (this.isWeeklyCalculationDay()) {
      const weeklyRewardRecipients = sortedCalculations.filter(calc => calc.weeklyRewards > 0).length;
      const totalEligibleUsers = sortedCalculations.filter(calc => calc.weeklyPoints > 0 && !this.isWalletExcludedFromRewards(calc.walletAddress)).length;
      console.log(`🏆 WEEKLY SUMMARY: ${Math.round(totalWeeklyPoints)} total weekly points | ${totalWeeklyRewards} weekly rewards distributed to TOP ${weeklyRewardRecipients} eligible users (${totalEligibleUsers} total eligible)`);
    } else {
      console.log(`🏆 WEEKLY SUMMARY: TBD (calculated on Thursdays only)`);
    }
    console.log('='.repeat(200));
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
   * Check if today is Thursday (weekly calculation day)
   */
  private isWeeklyCalculationDay(): boolean {
    const today = new Date();
    return today.getDay() === 4; // Thursday = 4 (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  }

  /**
   * Get the weekly calculation window (last Wednesday 10 PM ET to recent Wednesday 10 PM ET)
   */
  private getWeeklyCalculationWindow(): { startDate: Date, endDate: Date } {
    const now = new Date();
    console.log(`🔍 Debug - Current time (UTC): ${now.toISOString()}`);
    console.log(`🔍 Debug - Current day of week: ${now.getDay()} (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat)`);
    
    // Since today is Thursday Oct 16, 2024, we want:
    // Start: Wed Oct 9, 2024 10 PM ET = Thu Oct 10, 2024 3 AM UTC  
    // End: Wed Oct 16, 2024 10 PM ET = Thu Oct 17, 2024 3 AM UTC
    
    // Find the most recent Wednesday (should be yesterday, Oct 15 for Thursday Oct 16)
    let recentWednesday = new Date(now);
    
    // Go back to find the most recent Wednesday
    while (recentWednesday.getDay() !== 3) { // 3 = Wednesday
      recentWednesday.setDate(recentWednesday.getDate() - 1);
    }
    
    console.log(`🔍 Debug - Found recent Wednesday: ${recentWednesday.toISOString()}`);
    
    // Set to 10 PM ET = 3 AM UTC next day (10 PM ET + 5 hours = 3 AM UTC)
    const endDate = new Date(recentWednesday);
    endDate.setUTCDate(endDate.getUTCDate() + 1); // Move to Thursday
    endDate.setUTCHours(3, 0, 0, 0); // 3 AM UTC = 10 PM ET Wednesday
    
    // Calculate the previous Wednesday (7 days before)
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 7);
    
    console.log(`🔍 Debug - Weekly window: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`🔍 Debug - This covers: ${new Date(startDate.getTime() - 5*60*60*1000).toISOString()} ET to ${new Date(endDate.getTime() - 5*60*60*1000).toISOString()} ET`);
    
    return { startDate, endDate };
  }

  /**
   * Get weekly points for all users in the calculation window
   */
  private async getUsersWeeklyPoints(startDate: Date, endDate: Date): Promise<Array<{userId: number, walletAddress: string, weeklyPoints: number}>> {
    // Build WHERE clause conditionally based on whether there are excluded wallets
    let whereClause = '';
    let params: any[] = [startDate, endDate];
    
    if (EXCLUDED_WALLETS.length > 0) {
      const placeholders = EXCLUDED_WALLETS.map((_, i) => `$${i + 3}`).join(',');
      whereClause = `WHERE u."walletAddress" NOT IN (${placeholders})`;
      params = [startDate, endDate, ...EXCLUDED_WALLETS];
    }
    
    const query = `
      SELECT 
        u.id as userId,
        u."walletAddress",
        COALESCE(SUM(udp."dailyPointsEarned"), 0) as weeklyPoints
      FROM users u
      LEFT JOIN user_daily_points udp ON u."walletAddress" = udp."walletAddress"
        AND udp."createdAt" >= $1 
        AND udp."createdAt" < $2
      ${whereClause}
      GROUP BY u.id, u."walletAddress"
      HAVING COALESCE(SUM(udp."dailyPointsEarned"), 0) > 0
      ORDER BY weeklyPoints DESC
    `;
    
    const result = await this.dataSource.query(query, params);
    
    return result.map((row: any) => ({
      userId: row.userId,
      walletAddress: row.walletAddress,
      weeklyPoints: parseFloat(row.weeklyPoints || '0')
    }));
  }

  /**
   * Calculate and distribute weekly rewards (called on Thursdays)
   */
  async calculateWeeklyRewards(): Promise<void> {
    console.log('🗓️ Calculating weekly rewards (Thursday calculation)...');
    
    const { startDate, endDate } = this.getWeeklyCalculationWindow();
    console.log(`📅 Weekly calculation window: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Get all users' weekly points for this period
    const usersWeeklyPoints = await this.getUsersWeeklyPoints(startDate, endDate);
    
    if (usersWeeklyPoints.length === 0) {
      console.log('⚠️ No users found with weekly points for rewards calculation');
      return;
    }
    
    console.log(`📊 Found ${usersWeeklyPoints.length} users with weekly points`);
    
    // Calculate total weekly points
    const totalWeeklyPoints = usersWeeklyPoints.reduce((sum, user) => sum + user.weeklyPoints, 0);
    
    if (totalWeeklyPoints === 0) {
      console.log('⚠️ Total weekly points is 0, no rewards to distribute');
      return;
    }
    
    console.log(`📊 Total weekly points: ${totalWeeklyPoints}`);
    console.log(`💰 Weekly rewards pool: ${WEEKLY_REWARDS_POOL.toLocaleString()}`);
    
    // Calculate rewards and ranks for each user
    const userRewards: Array<{walletAddress: string, weeklyPoints: number, weeklyRank: number, weeklyRewards: number}> = [];
    
    usersWeeklyPoints.forEach((user, index) => {
      const proportion = user.weeklyPoints / totalWeeklyPoints;
      const weeklyRewards = Math.round(proportion * WEEKLY_REWARDS_POOL);
      const weeklyRank = index + 1; // Rank based on sorted order (highest points = rank 1)
      
      userRewards.push({
        walletAddress: user.walletAddress,
        weeklyPoints: user.weeklyPoints,
        weeklyRank,
        weeklyRewards
      });
      
      console.log(`🏆 Rank ${weeklyRank}: ${user.walletAddress} - ${user.weeklyPoints} pts (${(proportion * 100).toFixed(2)}%) = ${weeklyRewards} rewards`);
    });
    
    // Update today's user_daily_points entries with weekly data
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    
    for (const reward of userRewards) {
      const updateQuery = `
        UPDATE user_daily_points
        SET "weeklyRewards" = $1, "weeklyPoints" = $2, "weeklyRank" = $3
        WHERE "walletAddress" = $4 
          AND "createdAt" >= $5 
          AND "createdAt" < $6
      `;
      
      await this.dataSource.query(updateQuery, [
        reward.weeklyRewards,
        reward.weeklyPoints,
        reward.weeklyRank,
        reward.walletAddress,
        todayStart,
        todayEnd
      ]);
    }
    
    console.log(`✅ Weekly rewards calculated and distributed to ${userRewards.length} users`);
    console.log(`✅ Total weekly rewards distributed: ${WEEKLY_REWARDS_POOL.toLocaleString()}`);
  }

  /**
   * Calculate weekly points for dry-run mode (updates stored calculations for display)
   */
  async calculateWeeklyPointsForDryRun(): Promise<void> {
    console.log(`🚀 STARTING calculateWeeklyPointsForDryRun - allCalculations has ${this.allCalculations.length} users`);
    
    const { startDate, endDate } = this.getWeeklyCalculationWindow();
    console.log(`📅 Weekly calculation window: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Debug: Check if there are any daily points in this date range
    const debugQuery = `
      SELECT COUNT(*) as total_records, 
             SUM("dailyPointsEarned") as total_points,
             MIN("createdAt") as earliest_date,
             MAX("createdAt") as latest_date
      FROM user_daily_points 
      WHERE "createdAt" >= $1 AND "createdAt" < $2
    `;
    const debugResult = await this.dataSource.query(debugQuery, [startDate, endDate]);
    console.log(`🔍 Debug - Records in date range:`, debugResult[0]);
    
    // Debug: Check what's actually in the database (all records)
    const allRecordsQuery = `
      SELECT COUNT(*) as total_records, 
             SUM("dailyPointsEarned") as total_points,
             MIN("createdAt") as earliest_date,
             MAX("createdAt") as latest_date
      FROM user_daily_points 
      WHERE "dailyPointsEarned" > 0
    `;
    const allRecordsResult = await this.dataSource.query(allRecordsQuery);
    console.log(`🔍 Debug - ALL records with points:`, allRecordsResult[0]);
    
    // Debug: Check recent records (last 7 days)
    const recentQuery = `
      SELECT "walletAddress", "dailyPointsEarned", "createdAt"
      FROM user_daily_points 
      WHERE "createdAt" >= NOW() - INTERVAL '7 days'
        AND "dailyPointsEarned" > 0
      ORDER BY "createdAt" DESC
      LIMIT 10
    `;
    const recentResult = await this.dataSource.query(recentQuery);
    console.log(`🔍 Debug - Recent records (last 7 days):`, recentResult);
    
    // Debug: Test the exact query we're using for weekly points
    const testQuery = `
      SELECT 
        u.id as userId,
        u."walletAddress",
        COALESCE(SUM(udp."dailyPointsEarned"), 0) as weeklyPoints,
        COUNT(udp.id) as record_count
      FROM users u
      LEFT JOIN user_daily_points udp ON u."walletAddress" = udp."walletAddress"
        AND udp."createdAt" >= $1 
        AND udp."createdAt" < $2
      GROUP BY u.id, u."walletAddress"
      HAVING COALESCE(SUM(udp."dailyPointsEarned"), 0) > 0
      ORDER BY weeklyPoints DESC
      LIMIT 5
    `;
    const testResult = await this.dataSource.query(testQuery, [startDate, endDate]);
    console.log(`🔍 Debug - Test weekly query result:`, testResult);
    
    // Get all users' weekly points for this period
    const usersWeeklyPoints = await this.getUsersWeeklyPoints(startDate, endDate);
    
    if (usersWeeklyPoints.length === 0) {
      console.log('⚠️ No users found with weekly points for calculation');
      
      // Debug: Check total users and total daily points records
      const totalUsersQuery = `SELECT COUNT(*) as count FROM users`;
      const totalPointsQuery = `SELECT COUNT(*) as count FROM user_daily_points WHERE "dailyPointsEarned" > 0`;
      const totalUsers = await this.dataSource.query(totalUsersQuery);
      const totalPoints = await this.dataSource.query(totalPointsQuery);
      console.log(`🔍 Debug - Total users: ${totalUsers[0].count}, Total daily points records: ${totalPoints[0].count}`);
      
      // For dry-run, calculate weekly points manually by querying all daily points in the cycle
      console.log('📊 Calculating weekly points manually for dry-run (no saved data found)...');
      
      // Get weekly points for each user by summing their daily points in the weekly window
      const manualWeeklyQuery = `
        SELECT 
          u."walletAddress",
          COALESCE(SUM(udp."dailyPointsEarned"), 0) as weeklyPoints
        FROM users u
        LEFT JOIN user_daily_points udp ON u."walletAddress" = udp."walletAddress"
          AND udp."createdAt" >= $1 
          AND udp."createdAt" < $2
        GROUP BY u."walletAddress"
        HAVING COALESCE(SUM(udp."dailyPointsEarned"), 0) > 0
        ORDER BY weeklyPoints DESC
      `;
      
      const manualWeeklyResult = await this.dataSource.query(manualWeeklyQuery, [startDate, endDate]);
      console.log(`📊 Manual weekly calculation found ${manualWeeklyResult.length} users with weekly points`);
      console.log(`📊 allCalculations array has ${this.allCalculations.length} users`);
      
      // Debug: Show first few wallet addresses from both arrays
      console.log(`🔍 First 5 weekly query wallets:`, manualWeeklyResult.slice(0, 5).map((r: any) => r.walletAddress));
      console.log(`🔍 First 5 allCalculations wallets:`, this.allCalculations.slice(0, 5).map(c => c.walletAddress));
      
      if (manualWeeklyResult.length > 0) {
        const totalWeeklyPoints = manualWeeklyResult.reduce((sum: number, row: any) => sum + parseFloat(row.weeklyPoints), 0);
        console.log(`📊 Total weekly points from manual calculation: ${totalWeeklyPoints}`);
        
        // Debug: Show what we're trying to match
        console.log(`🔍 Trying to match ${manualWeeklyResult.length} weekly results with ${this.allCalculations.length} calculations`);
        console.log(`🔍 First 3 weekly results:`, manualWeeklyResult.slice(0, 3).map((r: any) => r.walletAddress));
        console.log(`🔍 First 3 allCalculations:`, this.allCalculations.slice(0, 3).map(c => c.walletAddress));
        
        // Update calculations with manual weekly data
        manualWeeklyResult.forEach((row: any, index: number) => {
          const weeklyPoints = parseFloat(row.weeklyPoints);
          const weeklyRank = index + 1;
          const proportion = weeklyPoints / totalWeeklyPoints;
          const weeklyRewards = Math.round(proportion * WEEKLY_REWARDS_POOL);
          
          let calculation = this.allCalculations.find(calc => calc.walletAddress.toLowerCase() === row.walletAddress.toLowerCase());
          console.log(`🔍 Looking for ${row.walletAddress} in allCalculations: ${calculation ? 'FOUND' : 'NOT FOUND'}`);
          
          if (calculation) {
            // Update existing calculation
            const oldWeeklyPoints = calculation.weeklyPoints;
            calculation.weeklyPoints = weeklyPoints;
            calculation.weeklyRank = weeklyRank;
            calculation.weeklyRewards = weeklyRewards;
            console.log(`✅ Updated existing ${row.walletAddress}: weeklyPoints=${weeklyPoints} (was ${oldWeeklyPoints})`);
          } else {
            // Create new calculation entry for users not processed today but have weekly points
            const newCalculation: UserCalculation = {
              walletAddress: row.walletAddress,
              twitterHandle: undefined,
              name: undefined,
              dailyPointsEarned: 0, // They weren't processed today
              totalPoints: 0,
              purchasePoints: 0,
              milestonePoints: 0,
              referralPoints: 0,
              mindsharePoints: 0,
              previousTotalPoints: 0,
              totalReferrals: 0,
              activeReferrals: 0,
              totalReferralTransactionsValue: 0,
              totalRoastEarned: 0,
              mindshare: 0,
              dailyPurchaseCount: 0,
              dailyMilestoneCount: 0,
              dailyNewQualifiedReferrals: 0,
              dailyRewards: 0,
              weeklyRewards: weeklyRewards,
              weeklyPoints: weeklyPoints,
              dailyRank: 0,
              weeklyRank: weeklyRank,
              currentTier: 'BRONZE' as TierLevel,
              newTier: 'BRONZE' as TierLevel,
              tierChanged: false
            };
            this.allCalculations.push(newCalculation);
            console.log(`✅ Added new calculation for ${row.walletAddress}: weeklyPoints=${weeklyPoints}`);
          }
        });
        
        // Debug: Check how many calculations were updated
        const initialUpdatedCount = this.allCalculations.filter(calc => calc.weeklyPoints > 0).length;
        console.log(`📊 Updated ${initialUpdatedCount} calculations with weekly data out of ${this.allCalculations.length} total calculations`);
        
        // Debug: Show some examples of updated calculations
        console.log(`🔍 Sample updated calculations:`);
        this.allCalculations.filter(calc => calc.weeklyPoints > 0).slice(0, 3).forEach(calc => {
          console.log(`   ${calc.walletAddress}: dailyPts=${calc.dailyPointsEarned}, weeklyPts=${calc.weeklyPoints}, weeklyRank=${calc.weeklyRank}`);
        });
        
        console.log('✅ Weekly points calculated from accumulated daily points');
        
        // Final verification: Check if weekly points were actually set
        const finalCheck = this.allCalculations.filter(calc => calc.weeklyPoints > 0);
        console.log(`🔍 FINAL CHECK: ${finalCheck.length} users in allCalculations have weeklyPoints > 0`);
        finalCheck.slice(0, 3).forEach(calc => {
          console.log(`   FINAL: ${calc.walletAddress} = ${calc.weeklyPoints} weekly points`);
        });
        
        // BRUTE FORCE FIX: Ensure ALL weekly users are in allCalculations
        console.log(`🔧 ENSURING ALL WEEKLY USERS ARE IN ALLCALCULATIONS...`);
        console.log(`🔧 Before fix: ${this.allCalculations.filter(calc => calc.weeklyPoints > 0).length} users have weeklyPoints > 0`);
        
        let addedCount = 0;
        let updatedCount = 0;
        
        manualWeeklyResult.forEach((row: any, index: number) => {
          const weeklyPoints = parseFloat(row.weeklyPoints);
          const weeklyRank = index + 1;
          const proportion = weeklyPoints / totalWeeklyPoints;
          const weeklyRewards = Math.round(proportion * WEEKLY_REWARDS_POOL);
          
          console.log(`🔧 Processing ${row.walletAddress} with ${weeklyPoints} weekly points`);
          
          // Try to find existing user
          let found = false;
          for (let i = 0; i < this.allCalculations.length; i++) {
            const calc = this.allCalculations[i];
            if (calc && calc.walletAddress.toLowerCase() === row.walletAddress.toLowerCase()) {
              console.log(`🔧 FOUND EXISTING: ${calc.walletAddress}, updating weeklyPoints from ${calc.weeklyPoints} to ${weeklyPoints}`);
              calc.weeklyPoints = weeklyPoints;
              calc.weeklyRank = weeklyRank;
              calc.weeklyRewards = weeklyRewards;
              found = true;
              updatedCount++;
              break;
            }
          }
          
          // If not found, add new user
          if (!found) {
            console.log(`🔧 NOT FOUND: Adding new user ${row.walletAddress} with ${weeklyPoints} weekly points`);
            const newCalculation: UserCalculation = {
              walletAddress: row.walletAddress,
              twitterHandle: undefined,
              name: undefined,
              dailyPointsEarned: 0,
              totalPoints: 0,
              purchasePoints: 0,
              milestonePoints: 0,
              referralPoints: 0,
              mindsharePoints: 0,
              previousTotalPoints: 0,
              totalReferrals: 0,
              activeReferrals: 0,
              totalReferralTransactionsValue: 0,
              totalRoastEarned: 0,
              mindshare: 0,
              dailyPurchaseCount: 0,
              dailyMilestoneCount: 0,
              dailyNewQualifiedReferrals: 0,
              dailyRewards: 0,
              weeklyRewards: weeklyRewards,
              weeklyPoints: weeklyPoints,
              dailyRank: 0,
              weeklyRank: weeklyRank,
              currentTier: 'BRONZE' as TierLevel,
              newTier: 'BRONZE' as TierLevel,
              tierChanged: false
            };
            this.allCalculations.push(newCalculation);
            addedCount++;
          }
        });
        
        console.log(`🔧 SUMMARY: Updated ${updatedCount} existing users, added ${addedCount} new users`);
        const finalFinalCheck = this.allCalculations.filter(calc => calc.weeklyPoints > 0);
        console.log(`🔧 FINAL RESULT: ${finalFinalCheck.length} users now have weeklyPoints > 0 out of ${this.allCalculations.length} total`);
        
        // Additional verification
        if (finalFinalCheck.length > 0) {
          console.log(`🔧 SUCCESS! Sample users with weekly points:`);
          finalFinalCheck.slice(0, 3).forEach(calc => {
            console.log(`   ${calc.walletAddress}: weeklyPoints=${calc.weeklyPoints}`);
          });
        } else {
          console.log(`🔧 ERROR: Still no users with weekly points after brute force fix!`);
        }
        
      } else {
        console.log('⚠️ No weekly points found even with manual calculation - this might be the first week of data');
      }
      return;
    }
    
    console.log(`📊 Found ${usersWeeklyPoints.length} users with weekly points`);
    
    // Calculate total weekly points
    const totalWeeklyPoints = usersWeeklyPoints.reduce((sum, user) => sum + user.weeklyPoints, 0);
    console.log(`📊 Total weekly points: ${totalWeeklyPoints}`);
    
    if (totalWeeklyPoints === 0) {
      console.log('⚠️ Total weekly points is 0 - no rewards to calculate');
      return;
    }
    
    // Sort users by weekly points (descending) and assign ranks
    usersWeeklyPoints.sort((a, b) => b.weeklyPoints - a.weeklyPoints);
    
    // Update the stored calculations with weekly data
    usersWeeklyPoints.forEach((weeklyUser, index) => {
      const weeklyRank = index + 1;
      const proportion = weeklyUser.weeklyPoints / totalWeeklyPoints;
      const weeklyRewards = Math.round(proportion * WEEKLY_REWARDS_POOL);
      
      // Find and update the corresponding calculation in allCalculations
      const calculation = this.allCalculations.find(calc => calc.walletAddress === weeklyUser.walletAddress);
      if (calculation) {
        calculation.weeklyPoints = weeklyUser.weeklyPoints;
        calculation.weeklyRank = weeklyRank;
        calculation.weeklyRewards = weeklyRewards;
      }
      
      console.log(`🏆 Rank ${weeklyRank}: ${weeklyUser.walletAddress} - ${weeklyUser.weeklyPoints} pts (${(proportion * 100).toFixed(2)}%) = ${weeklyRewards} rewards`);
    });
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
          await this.displayFinalSummary();
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
          
          // Calculate weekly rewards if it's Thursday
          if (this.isWeeklyCalculationDay()) {
            console.log('\n🗓️ Thursday detected - calculating weekly rewards...');
            await this.calculateWeeklyRewards();
          }
        } else {
          // In dry-run mode, show what daily rewards calculation would have done
          console.log(`\n📊 [DRY RUN] Daily Rewards Summary:`);
          console.log(`   🏆 Daily ranks would be calculated and updated`);
          console.log(`   💰 Daily rewards pool (200,000) would be distributed among top users`);
          console.log(`   🚫 Excluded wallets from rewards: ${EXCLUDE_WALLET_REWARDS.length} wallet(s)`);
          console.log(`   ℹ️  Note: Individual reward amounts shown above in per-user calculations`);
          
          // Calculate weekly points in dry-run mode for display purposes
          if (this.isWeeklyCalculationDay()) {
            console.log(`\n🗓️ [DRY RUN] Weekly Rewards Summary:`);
            console.log(`   📅 Today is Thursday - calculating weekly points for display...`);
            await this.calculateWeeklyPointsForDryRun();
            console.log(`   💰 Weekly rewards pool (500,000) would be distributed proportionally`);
            console.log(`   📊 Weekly points calculated from last Wed 10 PM ET to recent Wed 10 PM ET`);
            console.log(`   🏆 Weekly ranks assigned based on weekly points`);
          } else {
            console.log(`\n🗓️ [DRY RUN] Weekly Rewards Info:`);
            console.log(`   📅 Today is not Thursday - no weekly rewards calculation`);
            console.log(`   ℹ️  Weekly rewards are calculated and distributed only on Thursdays`);
          }
        }

        console.log(`🎉 Daily Points Calculation Script completed successfully!${dryRun ? ' [DRY RUN MODE]' : ''}`);
      }

      // Display final summary for dry-run mode
      if (dryRun) {
        await this.displayFinalSummary();
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
