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

interface UserCalculation {
  walletAddress: string;
  twitterHandle: string | undefined;
  name: string | undefined;
  totalReferrals: number;
  totalReferralTransactionsValue: number;
  totalRoastEarned: number;
  mindshare: number;
  totalPoints: number;
  dailyPointsEarned: number;
  currentTier: TierLevel;
  newTier: TierLevel;
  tierChanged: boolean;
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

// Commission rates by tier
const COMMISSION_RATES = {
  [TierLevel.SILVER]: 0.05,
  [TierLevel.GOLD]: 0.075,
  [TierLevel.PLATINUM]: 0.10,
  [TierLevel.EMERALD]: 0.10,
  [TierLevel.DIAMOND]: 0.10,
  [TierLevel.UNICORN]: 0.10
};

// Database connection
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5434'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'roastpower',
  entities: [UserDailyPoints, UserTiers],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});

class DailyPointsCalculationScript {
  private dataSource: DataSource;
  private mindshareData: MindshareData = {};

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
  }

  /**
   * Load mindshare data from CSV file
   */
  async loadMindshareData(csvPath?: string): Promise<void> {
    if (!csvPath || !fs.existsSync(csvPath)) {
      console.log('CSV file not provided or not found. Continuing without mindshare data.');
      return;
    }

    return new Promise((resolve, reject) => {
      const mindshareData: MindshareData = {};
      let headers: string[] = [];

      fs.createReadStream(csvPath)
        .pipe(csv())
        .on('headers', (headerList: string[]) => {
          headers = headerList;
          console.log('CSV Headers:', headers);
        })
        .on('data', (row: any) => {
          // Find twitter handle and mindshare columns
          let twitterHandle = '';
          let mindshareValue = 0;

          // Look for twitter handle column (case insensitive)
          for (const [key, value] of Object.entries(row)) {
            if (key.toLowerCase().includes('twitter') || key.toLowerCase().includes('handle')) {
              twitterHandle = (value as string).replace('@', '').toLowerCase();
              break;
            }
          }

          // Look for mindshare column (case insensitive)
          for (const [key, value] of Object.entries(row)) {
            if (key.toLowerCase().includes('mindshare') || key.toLowerCase().includes('share')) {
              let numValue = parseFloat(value as string);
              // Handle invalid percentages
              if (isNaN(numValue) || numValue < 0) numValue = 0;
              if (numValue > 100) numValue = 100;
              mindshareValue = numValue;
              break;
            }
          }

          if (twitterHandle) {
            // Handle duplicates - take the last entry
            mindshareData[twitterHandle] = mindshareValue;
          }
        })
        .on('end', () => {
          this.mindshareData = mindshareData;
          console.log(`Loaded mindshare data for ${Object.keys(mindshareData).length} users`);
          resolve();
        })
        .on('error', (error: any) => {
          console.error('Error reading CSV file:', error);
          reject(error);
        });
    });
  }

  /**
   * Get all users with Twitter connections
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
    return users.map((user: any) => ({
      id: user.id,
      walletAddress: user.walletAddress.toLowerCase(),
      createdAt: new Date(user.createdAt),
      referralCount: user.referralCount || 0
    }));
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
   * Calculate user's own purchase count
   */
  async getUserPurchaseCount(walletAddress: string, userCreatedAt: Date): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases
      WHERE LOWER(buyer_wallet_address) = LOWER($1)
        AND payment_status = 'completed'
        AND created_at >= $2
    `;

    const result = await this.dataSource.query(query, [walletAddress, userCreatedAt]);
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
   * Get referral's transaction count
   */
  async getReferralTransactionCount(referralUserId: number): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      WHERE u.id = $1
        AND cp.payment_status = 'completed'
    `;

    const result = await this.dataSource.query(query, [referralUserId]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Calculate total referral transaction value
   */
  async calculateReferralTransactionValue(userId: number, userCreatedAt: Date): Promise<number> {
    const query = `
      SELECT COALESCE(SUM(cp.purchase_price), 0) as total_value
      FROM content_purchases cp
      INNER JOIN user_referrals ur ON ur."userId" = (
        SELECT u.id FROM users u WHERE LOWER(u."walletAddress") = LOWER(cp.buyer_wallet_address)
      )
      WHERE (ur."directReferrerId" = $1 OR ur."grandReferrerId" = $1)
        AND cp.payment_status = 'completed'
        AND cp.created_at >= $2
    `;

    const result = await this.dataSource.query(query, [userId, userCreatedAt]);
    return parseFloat(result[0]?.total_value || '0');
  }

  /**
   * Calculate points for a user
   */
  async calculateUserPoints(user: User): Promise<number> {
    // 1. Purchase points (100 per purchase)
    const purchaseCount = await this.getUserPurchaseCount(user.walletAddress, user.createdAt);
    const purchasePoints = purchaseCount * 100;

    // 2. Milestone points (1000 per every 20 transactions)
    const milestonePoints = Math.floor(purchaseCount / 20) * 1000;

    // 3. Referral points (10,000 per referral with 2+ transactions)
    const referrals = await this.getUserReferrals(user.id);
    let referralPoints = 0;

    for (const referral of referrals) {
      const transactionCount = await this.getReferralTransactionCount(referral.userId);
      if (transactionCount >= 2) {
        referralPoints += 10000;
      }
    }

    const totalPoints = purchasePoints + milestonePoints + referralPoints;

    console.log(`User ${user.walletAddress}: ${purchaseCount} purchases, ${purchasePoints + milestonePoints} purchase/milestone points, ${referralPoints} referral points, Total: ${totalPoints}`);

    return totalPoints;
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
   * Get user's previous daily points total
   */
  async getPreviousTotalPoints(walletAddress: string): Promise<number> {
    const userDailyPointsRepo = this.dataSource.getRepository(UserDailyPoints);
    
    const latestEntry = await userDailyPointsRepo.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
      order: { createdAt: 'DESC' }
    });

    return latestEntry ? parseFloat(latestEntry.totalPoints.toString()) : 0;
  }

  /**
   * Calculate daily points earned
   */
  calculateDailyPointsEarned(currentTotalPoints: number, previousTotalPoints: number): number {
    return Math.max(0, currentTotalPoints - previousTotalPoints);
  }

  /**
   * Process a single user
   */
  async processUser(user: User): Promise<UserCalculation> {
    console.log(`Processing user: ${user.walletAddress}`);

    // Get Twitter connection
    const twitterConnection = await this.getUserTwitterConnection(user.id);
    
    // Calculate points
    const totalPoints = await this.calculateUserPoints(user);
    const previousTotalPoints = await this.getPreviousTotalPoints(user.walletAddress);
    const dailyPointsEarned = this.calculateDailyPointsEarned(totalPoints, previousTotalPoints);

    // Determine tier
    const currentTier = await this.getUserCurrentTier(user.walletAddress);
    const newTier = await this.determineUserTier(user, totalPoints);
    const tierChanged = currentTier !== newTier;

    // Calculate referral transaction value
    const totalReferralTransactionsValue = await this.calculateReferralTransactionValue(user.id, user.createdAt);
    
    // Calculate ROAST earned based on current tier
    const commissionRate = COMMISSION_RATES[currentTier];
    const totalRoastEarned = totalReferralTransactionsValue * commissionRate;

    // Get mindshare data
    const twitterHandle = twitterConnection?.twitterUsername?.toLowerCase();
    const mindshare = twitterHandle && this.mindshareData[twitterHandle] ? this.mindshareData[twitterHandle] : 0;

    return {
      walletAddress: user.walletAddress,
      twitterHandle: twitterConnection?.twitterUsername,
      name: twitterConnection?.twitterDisplayName,
      totalReferrals: user.referralCount,
      totalReferralTransactionsValue,
      totalRoastEarned,
      mindshare,
      totalPoints,
      dailyPointsEarned,
      currentTier,
      newTier,
      tierChanged
    };
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
    userDailyPoints.totalReferralTransactionsValue = calculation.totalReferralTransactionsValue;
    userDailyPoints.totalRoastEarned = calculation.totalRoastEarned;
    userDailyPoints.mindshare = calculation.mindshare;
    userDailyPoints.totalPoints = calculation.totalPoints;
    userDailyPoints.dailyPointsEarned = calculation.dailyPointsEarned;

    await userDailyPointsRepo.save(userDailyPoints);
  }

  /**
   * Save user tier change
   */
  async saveUserTierChange(calculation: UserCalculation): Promise<void> {
    if (!calculation.tierChanged) return;

    const userTiersRepo = this.dataSource.getRepository(UserTiers);

    const userTier = new UserTiers();
    userTier.walletAddress = calculation.walletAddress;
    userTier.twitterHandle = calculation.twitterHandle || undefined;
    userTier.name = calculation.name || undefined;
    userTier.tier = calculation.newTier;
    userTier.previousTier = calculation.currentTier;
    userTier.pointsAtTierChange = calculation.totalPoints;
    userTier.referralsAtTierChange = calculation.totalReferrals;

    await userTiersRepo.save(userTier);

    // Update referral_codes table
    await this.updateUserTierInReferralCodes(calculation.walletAddress, calculation.newTier);

    console.log(`✅ Tier updated: ${calculation.walletAddress} ${calculation.currentTier} → ${calculation.newTier}`);
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

    // Get today's entries and rank them by dailyPointsEarned
    const query = `
      UPDATE user_daily_points 
      SET "dailyRank" = ranked_table.rank
      FROM (
        SELECT id, 
               ROW_NUMBER() OVER (ORDER BY "dailyPointsEarned" DESC, "createdAt" ASC) as rank
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
  async processUsersInBatches(users: User[], batchSize: number = 100): Promise<void> {
    console.log(`Processing ${users.length} users in batches of ${batchSize}`);

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(users.length / batchSize)} (${batch.length} users)`);

      // Process batch in transaction
      await this.dataSource.transaction(async (manager) => {
        for (const user of batch) {
          try {
            const calculation = await this.processUser(user);
            
            // Save to database
            await this.saveUserDailyPoints(calculation);
            await this.saveUserTierChange(calculation);

            console.log(`✅ Processed: ${user.walletAddress} (${calculation.dailyPointsEarned} daily points, tier: ${calculation.currentTier})`);
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
  async run(csvPath?: string): Promise<void> {
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

      // Get all users with Twitter connections
      const users = await this.getUsersWithTwitterConnections();
      console.log(`📊 Found ${users.length} users with Twitter connections`);

      if (users.length === 0) {
        console.log('⚠️ No users found with Twitter connections. Exiting.');
        return;
      }

      // Process users in batches
      await this.processUsersInBatches(users, 100);

      // Calculate daily ranks
      await this.calculateDailyRanks();

      console.log('🎉 Daily Points Calculation Script completed successfully!');

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
  const csvPath = process.argv[2]; // CSV path as command line argument
  
  console.log('🔧 Configuration:');
  console.log(`   Database: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  console.log(`   CSV Path: ${csvPath || 'Not provided'}`);
  console.log('');

  const script = new DailyPointsCalculationScript(AppDataSource);
  
  try {
    await script.run(csvPath);
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
