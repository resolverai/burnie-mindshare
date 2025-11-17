#!/usr/bin/env ts-node

import { DataSource } from 'typeorm';
import * as path from 'path';
import { config } from 'dotenv';

// Load environment variables
config({ path: path.join(__dirname, '../.env') });

// Import Season 2 entities
import { SomniaDreamathonYapperPoints } from '../src/models/SomniaDreamathonYapperPoints';
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

interface YapperCalculation {
  walletAddress: string;
  projectId: number | null;
  twitterHandle: string | undefined;
  name: string | undefined;
  totalReferrals: number;
  activeReferrals: number;
  totalPoints: number;
  dailyPointsEarned: number;
  dreamathonContentPoints: number;
  referralPoints: number;
  transactionMilestonePoints: number;
  championBonusPoints: number;
  impressionsPoints: number;
  totalImpressions: number;
  dailyDreamathonPostsCount: number;
  dailyNewQualifiedReferrals: number;
  dailyMilestoneCount: number;
  weeklyPoints: number;
  weeklyRank: number;
  weeklyRewards: number;
  grandPrizeRewards: number;
  bonusChampion: number;
  dailyRank: number | undefined;
  projectRank: number | undefined;
  previousTotalPoints: number;
  currentTier: TierLevel;
  newTier: TierLevel;
  tierChanged: boolean;
}

// Season 2 Constants
const DREAMATHON_CONTENT_POINTS = 100; // Points per post
const MAX_DAILY_POSTS_PER_PROJECT = 3; // Max posts per project per day
const REFERRAL_QUALIFICATION_POINTS = 500; // Per qualified referral
const TRANSACTION_MILESTONE_POINTS = 10000; // Per 20 referral purchases
const CHAMPION_BONUS_POINTS = 10000; // Top 5 in project leaderboard
const DAILY_IMPRESSIONS_POOL = 200000; // 200K points divided among top 100
const TOP_IMPRESSIONS_USERS_COUNT = 100;

// Weekly rewards pool (distributed on Mondays at 10 AM ET)
const WEEKLY_REWARDS_POOL = 600000; // 600K for Top 50
const TOP_WEEKLY_USERS_COUNT = 50;

// Campaign dates (Nov 16 - Dec 7, 2025)
const CAMPAIGN_START_DATE = new Date('2025-11-16T15:00:00Z'); // 10 AM ET
const CAMPAIGN_END_DATE = new Date('2025-12-07T15:00:00Z'); // 10 AM ET

// Tier requirements (Season 2)
const TIER_REQUIREMENTS = {
  [TierLevel.SILVER]: { points: 0 }, // Signup + Connect Twitter
  [TierLevel.GOLD]: { points: 20000 },
  [TierLevel.PLATINUM]: { points: 50000 },
  [TierLevel.EMERALD]: { points: 100000 },
  [TierLevel.DIAMOND]: { points: 200000 },
  [TierLevel.UNICORN]: { points: 500000 }
};

// Excluded wallets (lowercase) - these wallets will be skipped from points calculation
const EXCLUDED_WALLETS: string[] = [
  // Add wallet addresses here that should be excluded
];

// Excluded wallets from rewards (lowercase)
const EXCLUDE_WALLET_REWARDS: string[] = [
  // Add wallet addresses here that should be excluded from rewards
];

// Database connection
let AppDataSource: DataSource;

class SomniaDailyPointsYapperScript {
  private dataSource: DataSource;
  private allCalculations: YapperCalculation[] = [];
  private impressionsData: Map<string, number> = new Map(); // twitterHandle -> impressions

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
   * Check if today is within the campaign period
   */
  private isWithinCampaignPeriod(): boolean {
    const now = new Date();
    return now >= CAMPAIGN_START_DATE && now <= CAMPAIGN_END_DATE;
  }

  /**
   * Get all users with Twitter connections who are whitelisted for Somnia
   */
  async getUsersWithTwitterConnections(): Promise<User[]> {
    const query = `
      SELECT DISTINCT u.id, u."walletAddress", u."createdAt", u."referralCount"
      FROM users u
      INNER JOIN yapper_twitter_connections ytc ON u.id = ytc."userId"
      WHERE ytc."isConnected" = true
        AND u."createdAt" >= $1
      ORDER BY u.id
    `;

    const users = await this.dataSource.query(query, [CAMPAIGN_START_DATE]);
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
   * Get user's last recorded entry from somnia_dreamathon_yapper_points
   */
  async getLastRecordedEntry(walletAddress: string): Promise<{ lastEntry: SomniaDreamathonYapperPoints | null; cumulativePoints: number }> {
    const repo = this.dataSource.getRepository(SomniaDreamathonYapperPoints);
    
    // Get the most recent entry for timestamp reference
    const latestEntry = await repo.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
      order: { createdAt: 'DESC' }
    });

    // Get cumulative points
    const sumResult = await repo
      .createQueryBuilder('sdyp')
      .select('SUM(sdyp.dailyPointsEarned)', 'cumulativePoints')
      .where('sdyp.walletAddress = :walletAddress', { walletAddress: walletAddress.toLowerCase() })
      .getRawOne();

    const cumulativePoints = sumResult?.cumulativePoints ? parseFloat(sumResult.cumulativePoints) : 0;

    console.log(`  📋 Last Recorded Entry: ${latestEntry ? `Found (${latestEntry.createdAt.toISOString()})` : 'None found (new user)'}`);
    console.log(`  📊 Cumulative Points: ${cumulativePoints} (sum of all dailyPointsEarned)`);
    
    return { lastEntry: latestEntry, cumulativePoints };
  }

  /**
   * Get Dreamathon content posts count for today (max 3 per project per day)
   */
  async getDreamathonPostsCount(userId: number, projectId: number | null, sinceTimestamp: Date): Promise<number> {
    // TODO: Query twitter_post_tracking or content_purchases table
    // For now, return 0 (to be implemented with actual data source)
    return 0;
  }

  /**
   * Get new qualified referrals since last recorded entry
   * Qualified: New user + 3 purchases on Base mainnet OR 10 purchases on Somnia testnet
   */
  async getNewQualifiedReferralsSince(userId: number, sinceTimestamp: Date): Promise<{ newReferralPoints: number; activeReferrals: number; newQualifiedReferrals: number }> {
    // Get all referrals for this user
    const referralsQuery = `
      SELECT "userId"
      FROM user_referrals
      WHERE "directReferrerId" = $1
    `;
    
    const referrals = await this.dataSource.query(referralsQuery, [userId]);
    let newReferralPoints = 0;
    let activeReferrals = 0;
    let newQualifiedReferrals = 0;

    for (const referral of referrals) {
      // Check Base mainnet purchases
      const basePurchasesQuery = `
        SELECT COUNT(*) as count
        FROM content_purchases cp
        INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
        WHERE u.id = $1
          AND cp.payment_status = 'completed'
          AND cp.created_at >= $2
          AND cp.purchase_price > 0
      `;
      
      const totalPurchases = await this.dataSource.query(basePurchasesQuery, [referral.userId, CAMPAIGN_START_DATE]);
      const purchasesSinceTimestamp = await this.dataSource.query(basePurchasesQuery, [referral.userId, sinceTimestamp]);
      
      const totalCount = parseInt(totalPurchases[0]?.count || '0');
      const newCount = parseInt(purchasesSinceTimestamp[0]?.count || '0');
      
      const wasQualifiedBefore = (totalCount - newCount) >= 3;
      const isQualifiedNow = totalCount >= 3;
      
      if (isQualifiedNow) {
        activeReferrals += 1;
        
        // If they weren't qualified before but are now, award points
        if (!wasQualifiedBefore) {
          newReferralPoints += REFERRAL_QUALIFICATION_POINTS;
          newQualifiedReferrals += 1;
        }
      }
    }

    return { newReferralPoints, activeReferrals, newQualifiedReferrals };
  }

  /**
   * Get transaction milestone points (every 20 referral purchases)
   */
  async getTransactionMilestonePoints(userId: number, sinceTimestamp: Date): Promise<{ milestonePoints: number; milestoneCount: number }> {
    // Get total referral purchases
    const totalQuery = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      INNER JOIN user_referrals ur ON ur."userId" = u.id
      WHERE ur."directReferrerId" = $1
        AND cp.payment_status = 'completed'
        AND cp.created_at >= $2
        AND cp.purchase_price > 0
    `;
    
    const totalResult = await this.dataSource.query(totalQuery, [userId, CAMPAIGN_START_DATE]);
    const newResult = await this.dataSource.query(totalQuery, [userId, sinceTimestamp]);
    
    const totalPurchases = parseInt(totalResult[0]?.count || '0');
    const newPurchases = parseInt(newResult[0]?.count || '0');
    
    const currentMilestones = Math.floor(totalPurchases / 20);
    const previousMilestones = Math.floor((totalPurchases - newPurchases) / 20);
    const newMilestones = currentMilestones - previousMilestones;
    
    return {
      milestonePoints: newMilestones * TRANSACTION_MILESTONE_POINTS,
      milestoneCount: newMilestones
    };
  }

  /**
   * Calculate impressions points (share of 200K daily pool among top 100)
   */
  calculateImpressionsPoints(twitterHandle: string | undefined): { impressionsPoints: number; totalImpressions: number } {
    if (!twitterHandle) {
      return { impressionsPoints: 0, totalImpressions: 0 };
    }

    const handleLower = twitterHandle.toLowerCase();
    const impressions = this.impressionsData.get(handleLower) || 0;
    
    // TODO: Calculate proportional share from 200K pool based on impressions ranking
    // For now, return 0 (to be implemented with actual impressions data)
    return { impressionsPoints: 0, totalImpressions: impressions };
  }

  /**
   * Calculate incremental points since last recorded entry
   */
  async calculateIncrementalPoints(
    user: User, 
    projectId: number | null,
    lastRecordedEntry: SomniaDreamathonYapperPoints | null, 
    twitterHandle?: string
  ): Promise<any> {
    const sinceTimestamp = lastRecordedEntry ? lastRecordedEntry.createdAt : user.createdAt;
    
    console.log(`  🔄 Calculating incremental points since: ${sinceTimestamp.toISOString()}`);
    
    // 1. Dreamathon content points
    const dreamathonPostsCount = await this.getDreamathonPostsCount(user.id, projectId, sinceTimestamp);
    const dreamathonContentPoints = Math.min(dreamathonPostsCount, MAX_DAILY_POSTS_PER_PROJECT) * DREAMATHON_CONTENT_POINTS;

    // 2. Referral points
    const { newReferralPoints, activeReferrals, newQualifiedReferrals } = await this.getNewQualifiedReferralsSince(user.id, sinceTimestamp);
    
    // 3. Transaction milestone points
    const { milestonePoints, milestoneCount } = await this.getTransactionMilestonePoints(user.id, sinceTimestamp);
    
    // 4. Champion bonus points (TODO: implement project leaderboard logic)
    const championBonusPoints = 0;
    
    // 5. Impressions points
    const { impressionsPoints, totalImpressions } = this.calculateImpressionsPoints(twitterHandle);

    const totalIncrementalPoints = dreamathonContentPoints + newReferralPoints + milestonePoints + championBonusPoints + impressionsPoints;

    console.log(`  📊 Incremental Points Breakdown:`);
    console.log(`    Dreamathon Content: ${dreamathonPostsCount} posts = ${dreamathonContentPoints} points`);
    console.log(`    Referrals: ${newQualifiedReferrals} new qualified = ${newReferralPoints} points`);
    console.log(`    Transaction Milestones: ${milestoneCount} = ${milestonePoints} points`);
    console.log(`    Champion Bonus: ${championBonusPoints} points`);
    console.log(`    Impressions: ${totalImpressions} impressions = ${impressionsPoints} points`);
    console.log(`    Total Incremental: ${totalIncrementalPoints} points`);

    return { 
      dreamathonContentPoints,
      referralPoints: newReferralPoints,
      transactionMilestonePoints: milestonePoints,
      championBonusPoints,
      impressionsPoints,
      totalImpressions,
      activeReferrals,
      totalIncrementalPoints,
      dailyDreamathonPostsCount: dreamathonPostsCount,
      dailyNewQualifiedReferrals: newQualifiedReferrals,
      dailyMilestoneCount: milestoneCount
    };
  }

  /**
   * Determine user's tier based on points
   */
  determineUserTier(totalPoints: number): TierLevel {
    const tiers = [TierLevel.UNICORN, TierLevel.DIAMOND, TierLevel.EMERALD, TierLevel.PLATINUM, TierLevel.GOLD, TierLevel.SILVER];
    
    for (const tier of tiers) {
      const req = TIER_REQUIREMENTS[tier];
      if (totalPoints >= req.points) {
        return tier;
      }
    }

    return TierLevel.SILVER; // Default
  }

  /**
   * Get user's current tier from user_tiers table
   */
  async getUserCurrentTier(walletAddress: string): Promise<TierLevel> {
    const query = `
      SELECT tier
      FROM user_tiers
      WHERE LOWER("walletAddress") = LOWER($1)
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;

    const result = await this.dataSource.query(query, [walletAddress]);
    return result[0]?.tier || TierLevel.SILVER;
  }

  /**
   * Process a single user
   */
  async processUser(user: User, projectId: number | null = null): Promise<YapperCalculation> {
    console.log(`Processing user: ${user.walletAddress} (project: ${projectId || 'all'})`);

    // Get Twitter connection
    const twitterConnection = await this.getUserTwitterConnection(user.id);
    const twitterHandle = twitterConnection?.twitterUsername?.toLowerCase();
    
    console.log(`  Twitter handle: ${twitterHandle || 'None'}`);
    
    // Get last recorded entry
    const { lastEntry, cumulativePoints } = await this.getLastRecordedEntry(user.walletAddress);
    
    // Calculate incremental points
    const incrementalResult = await this.calculateIncrementalPoints(user, projectId, lastEntry, twitterHandle);
    
    // Calculate new totals
    const previousTotalPoints = cumulativePoints;
    const dailyPointsEarned = incrementalResult.totalIncrementalPoints;
    const newTotalPoints = previousTotalPoints + dailyPointsEarned;
    
    console.log(`  📊 Points Calculation Summary:`);
    console.log(`    Previous Total Points: ${previousTotalPoints}`);
    console.log(`    Daily Points Earned: ${dailyPointsEarned}`);
    console.log(`    New Total Points: ${newTotalPoints}`);

    // Determine tier
    const currentTier = await this.getUserCurrentTier(user.walletAddress);
    const newTier = this.determineUserTier(newTotalPoints);
    const tierChanged = currentTier !== newTier;

    const calculation: YapperCalculation = {
      walletAddress: user.walletAddress,
      projectId,
      twitterHandle: twitterConnection?.twitterUsername,
      name: twitterConnection?.twitterDisplayName,
      totalReferrals: user.referralCount,
      activeReferrals: incrementalResult.activeReferrals,
      totalPoints: newTotalPoints,
      dailyPointsEarned,
      dreamathonContentPoints: incrementalResult.dreamathonContentPoints,
      referralPoints: incrementalResult.referralPoints,
      transactionMilestonePoints: incrementalResult.transactionMilestonePoints,
      championBonusPoints: incrementalResult.championBonusPoints,
      impressionsPoints: incrementalResult.impressionsPoints,
      totalImpressions: incrementalResult.totalImpressions,
      dailyDreamathonPostsCount: incrementalResult.dailyDreamathonPostsCount,
      dailyNewQualifiedReferrals: incrementalResult.dailyNewQualifiedReferrals,
      dailyMilestoneCount: incrementalResult.dailyMilestoneCount,
      weeklyPoints: 0, // Will be calculated later
      weeklyRank: 0,
      weeklyRewards: 0,
      grandPrizeRewards: 0,
      bonusChampion: 0,
      dailyRank: undefined,
      projectRank: undefined,
      previousTotalPoints,
      currentTier,
      newTier,
      tierChanged
    };
    
    return calculation;
  }

  /**
   * Save yapper daily points
   */
  async saveYapperDailyPoints(calculation: YapperCalculation): Promise<void> {
    const repo = this.dataSource.getRepository(SomniaDreamathonYapperPoints);

    const yapperPoints = new SomniaDreamathonYapperPoints();
    yapperPoints.walletAddress = calculation.walletAddress;
    yapperPoints.projectId = calculation.projectId;
    yapperPoints.twitterHandle = calculation.twitterHandle;
    yapperPoints.name = calculation.name;
    yapperPoints.totalReferrals = calculation.totalReferrals;
    yapperPoints.activeReferrals = calculation.activeReferrals;
    yapperPoints.totalPoints = calculation.totalPoints;
    yapperPoints.dailyPointsEarned = calculation.dailyPointsEarned;
    yapperPoints.dreamathonContentPoints = calculation.dreamathonContentPoints;
    yapperPoints.referralPoints = calculation.referralPoints;
    yapperPoints.transactionMilestonePoints = calculation.transactionMilestonePoints;
    yapperPoints.championBonusPoints = calculation.championBonusPoints;
    yapperPoints.impressionsPoints = calculation.impressionsPoints;
    yapperPoints.totalImpressions = calculation.totalImpressions;
    yapperPoints.dailyDreamathonPostsCount = calculation.dailyDreamathonPostsCount;
    yapperPoints.dailyNewQualifiedReferrals = calculation.dailyNewQualifiedReferrals;
    yapperPoints.dailyMilestoneCount = calculation.dailyMilestoneCount;
    yapperPoints.weeklyPoints = calculation.weeklyPoints;
    yapperPoints.weeklyRank = calculation.weeklyRank;
    yapperPoints.weeklyRewards = calculation.weeklyRewards;
    yapperPoints.grandPrizeRewards = calculation.grandPrizeRewards;
    yapperPoints.bonusChampion = calculation.bonusChampion;
    yapperPoints.dailyRank = calculation.dailyRank;
    yapperPoints.projectRank = calculation.projectRank;

    await repo.save(yapperPoints);
  }

  /**
   * Update user tier in user_tiers table
   */
  async updateUserTier(calculation: YapperCalculation): Promise<void> {
    if (!calculation.tierChanged) {
      return;
    }

    const userTiersRepo = this.dataSource.getRepository(UserTiers);

    const userTier = new UserTiers();
    userTier.walletAddress = calculation.walletAddress;
    userTier.twitterHandle = calculation.twitterHandle;
    userTier.name = calculation.name;
    userTier.tier = calculation.newTier;
    userTier.previousTier = calculation.currentTier;
    userTier.pointsAtTierChange = calculation.totalPoints;
    userTier.referralsAtTierChange = calculation.totalReferrals;

    await userTiersRepo.save(userTier);

    console.log(`✅ Tier upgraded: ${calculation.walletAddress} ${calculation.currentTier} → ${calculation.newTier}`);
  }

  /**
   * Check if today is Monday (weekly calculation day)
   */
  private isWeeklyCalculationDay(): boolean {
    const today = new Date();
    return today.getDay() === 1; // Monday = 1
  }

  /**
   * Main execution function
   */
  async run(dryRun: boolean = false): Promise<void> {
    try {
      console.log('🚀 Starting Somnia Dreamathon Yapper Points Calculation Script');
      console.log('📅 Date:', new Date().toISOString());

      // Check if within campaign period
      if (!this.isWithinCampaignPeriod()) {
        console.log('⚠️ Current date is outside campaign period (Nov 16 - Dec 7, 2025)');
        console.log('   Exiting script');
        return;
      }

      // Initialize database connection
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
        console.log('✅ Database connected');
      }

      // Get all users
      const users = await this.getUsersWithTwitterConnections();
      console.log(`📊 Found ${users.length} users with Twitter connections`);

      if (users.length === 0) {
        console.log('⚠️ No users found. Exiting.');
        return;
      }

      // Process each user
      for (const user of users) {
        try {
          const calculation = await this.processUser(user);
          
          if (dryRun) {
            this.allCalculations.push(calculation);
            console.log(`📊 [DRY RUN] ${user.walletAddress} | Daily: ${calculation.dailyPointsEarned} pts | Total: ${calculation.totalPoints} pts`);
          } else {
            await this.saveYapperDailyPoints(calculation);
            await this.updateUserTier(calculation);
            console.log(`✅ Processed: ${user.walletAddress} (${calculation.dailyPointsEarned} daily points)`);
          }
        } catch (error) {
          console.error(`❌ Error processing user ${user.walletAddress}:`, error);
        }
      }

      // Calculate weekly rewards if it's Monday
      if (this.isWeeklyCalculationDay() && !dryRun) {
        console.log('\n🗓️ Monday detected - calculating weekly rewards...');
        // TODO: Implement weekly rewards calculation
      }

      console.log(`🎉 Somnia Yapper Points Calculation completed successfully!${dryRun ? ' [DRY RUN MODE]' : ''}`);

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
  let useSSL: boolean | undefined;
  let dryRun: boolean = false;
  
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    if (arg === '--ssl') {
      useSSL = true;
    } else if (arg === '--no-ssl') {
      useSSL = false;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  // Determine SSL usage
  let sslEnabled: boolean;
  if (useSSL !== undefined) {
    sslEnabled = useSSL;
  } else {
    sslEnabled = process.env.NODE_ENV === 'production' || 
                 process.env.DB_HOST?.includes('rds.amazonaws.com') || 
                 false;
  }

  // Create database connection
  AppDataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5434'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'roastpower',
    entities: [SomniaDreamathonYapperPoints, UserTiers],
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
  console.log(`   SSL: ${sslEnabled ? 'Enabled' : 'Disabled'}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Campaign: Nov 16 - Dec 7, 2025`);
  console.log('');

  const script = new SomniaDailyPointsYapperScript(AppDataSource);
  
  try {
    await script.run(dryRun);
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

export { SomniaDailyPointsYapperScript };

