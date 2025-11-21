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

// Weekly rewards pool (distributed on Tuesdays at 10 AM ET)
const WEEKLY_REWARDS_POOL = 600000; // 600K for Top 50
const TOP_WEEKLY_USERS_COUNT = 50;

// Campaign dates (Nov 18 - Dec 9, 2025)
const CAMPAIGN_START_DATE = new Date('2025-11-18T15:00:00Z'); // 10 AM ET
const CAMPAIGN_END_DATE = new Date('2025-12-09T15:00:00Z'); // 10 AM ET

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
  private impressionsDataByProject: Map<number, Map<string, number>> = new Map(); // projectId -> (walletAddress -> impressions)

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
   * Get all users who should be eligible for Season 2 points:
   * - Users with Twitter connections (for content points)
   * - Users who made purchases (for transaction milestones)
   * - Users who have referrals that made purchases (for referral points)
   */
  async getUsersWithTwitterConnections(): Promise<User[]> {
    // Combine all users using UNION (single parameter for all queries)
    const combinedQuery = `
      SELECT DISTINCT u.id, u."walletAddress", u."createdAt", u."referralCount"
      FROM users u
      INNER JOIN yapper_twitter_connections ytc ON u.id = ytc."userId"
      WHERE ytc."isConnected" = true
        AND u."createdAt" >= $1
      UNION
      SELECT DISTINCT u.id, u."walletAddress", u."createdAt", u."referralCount"
      FROM users u
      INNER JOIN content_purchases cp ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      WHERE cp.payment_status = 'completed'
        AND cp.purchase_price > 0
        AND cp.created_at >= $1
      UNION
      SELECT DISTINCT u.id, u."walletAddress", u."createdAt", u."referralCount"
      FROM users u
      INNER JOIN user_referrals ur ON ur."directReferrerId" = u.id
      INNER JOIN users referred_user ON ur."userId" = referred_user.id
      INNER JOIN content_purchases cp ON LOWER(cp.buyer_wallet_address) = LOWER(referred_user."walletAddress")
      WHERE cp.payment_status = 'completed'
        AND cp.purchase_price > 0
        AND cp.created_at >= $1
      ORDER BY id
    `;

    const users = await this.dataSource.query(combinedQuery, [CAMPAIGN_START_DATE]);
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
   * Get Dreamathon content posts for Somnia whitelisted projects since timestamp
   * Returns map of projectId -> post count (max 3 projects counted)
   */
  async getDreamathonPostsByProject(userId: number, sinceTimestamp: Date): Promise<Map<number, number>> {
    const query = `
      SELECT c."projectId", COUNT(DISTINCT utp.id) as post_count
      FROM user_twitter_posts utp
      INNER JOIN users u ON utp.wallet_address = u."walletAddress"
      INNER JOIN content_marketplace cm ON utp.content_id = cm.id
      INNER JOIN campaigns c ON cm."campaignId" = c.id
      INNER JOIN projects p ON c."projectId" = p.id
      WHERE u.id = $1
        AND utp."createdAt" >= $2
        AND p.somnia_whitelisted = true
      GROUP BY c."projectId"
      ORDER BY post_count DESC
      LIMIT 3
    `;
    
    const results = await this.dataSource.query(query, [userId, sinceTimestamp]);
    const projectPostsMap = new Map<number, number>();
    
    for (const row of results) {
      projectPostsMap.set(row.projectId, parseInt(row.post_count));
    }
    
    console.log(`  📝 Dreamathon posts by project: ${JSON.stringify(Array.from(projectPostsMap.entries()))}`);
    
    return projectPostsMap;
  }

  /**
   * Get new qualified referrals since last recorded entry
   * Qualified: New user + (3 purchases on Base mainnet OR 10 purchases on Somnia testnet)
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
      // Check Base mainnet purchases (network IS NULL or != 'somnia_testnet')
      const basePurchasesQuery = `
        SELECT COUNT(*) as count
        FROM content_purchases cp
        INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
        WHERE u.id = $1
          AND cp.payment_status = 'completed'
          AND cp.purchase_price > 0
          AND (cp.network IS NULL OR cp.network != 'somnia_testnet')
          AND cp.created_at >= $2
      `;
      
      // Check Somnia testnet purchases (network = 'somnia_testnet')
      const somniaPurchasesQuery = `
        SELECT COUNT(*) as count
        FROM content_purchases cp
        INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
        WHERE u.id = $1
          AND cp.payment_status = 'completed'
          AND cp.purchase_price > 0
          AND cp.network = 'somnia_testnet'
          AND cp.created_at >= $2
      `;
      
      // Get totals since campaign start
      const totalBasePurchases = await this.dataSource.query(basePurchasesQuery, [referral.userId, CAMPAIGN_START_DATE]);
      const totalSomniaPurchases = await this.dataSource.query(somniaPurchasesQuery, [referral.userId, CAMPAIGN_START_DATE]);
      
      // Get new purchases since last timestamp
      const newBasePurchases = await this.dataSource.query(basePurchasesQuery, [referral.userId, sinceTimestamp]);
      const newSomniaPurchases = await this.dataSource.query(somniaPurchasesQuery, [referral.userId, sinceTimestamp]);
      
      const totalBaseCount = parseInt(totalBasePurchases[0]?.count || '0');
      const totalSomniaCount = parseInt(totalSomniaPurchases[0]?.count || '0');
      const newBaseCount = parseInt(newBasePurchases[0]?.count || '0');
      const newSomniaCount = parseInt(newSomniaPurchases[0]?.count || '0');
      
      // Check if qualified before and now
      const wasQualifiedBefore = ((totalBaseCount - newBaseCount) >= 3) || ((totalSomniaCount - newSomniaCount) >= 10);
      const isQualifiedNow = (totalBaseCount >= 3) || (totalSomniaCount >= 10);
      
      if (isQualifiedNow) {
        activeReferrals += 1;
        
        // If they weren't qualified before but are now, award points
        if (!wasQualifiedBefore) {
          newReferralPoints += REFERRAL_QUALIFICATION_POINTS;
          newQualifiedReferrals += 1;
          console.log(`    ✅ New qualified referral: userId ${referral.userId} (Base: ${totalBaseCount}, Somnia: ${totalSomniaCount})`);
        }
      }
    }

    return { newReferralPoints, activeReferrals, newQualifiedReferrals };
  }

  /**
   * Get transaction milestone points (every 20 referral purchases on Base OR Somnia)
   */
  async getTransactionMilestonePoints(userId: number, sinceTimestamp: Date): Promise<{ milestonePoints: number; milestoneCount: number }> {
    // Get Base mainnet referral purchases
    const baseQuery = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      INNER JOIN user_referrals ur ON ur."userId" = u.id
      WHERE ur."directReferrerId" = $1
        AND cp.payment_status = 'completed'
        AND cp.purchase_price > 0
        AND (cp.network IS NULL OR cp.network != 'somnia_testnet')
        AND cp.created_at >= $2
    `;
    
    // Get Somnia testnet referral purchases
    const somniaQuery = `
      SELECT COUNT(*) as count
      FROM content_purchases cp
      INNER JOIN users u ON LOWER(cp.buyer_wallet_address) = LOWER(u."walletAddress")
      INNER JOIN user_referrals ur ON ur."userId" = u.id
      WHERE ur."directReferrerId" = $1
        AND cp.payment_status = 'completed'
        AND cp.purchase_price > 0
        AND cp.network = 'somnia_testnet'
        AND cp.created_at >= $2
    `;
    
    // Get totals since campaign start
    const totalBaseResult = await this.dataSource.query(baseQuery, [userId, CAMPAIGN_START_DATE]);
    const totalSomniaResult = await this.dataSource.query(somniaQuery, [userId, CAMPAIGN_START_DATE]);
    
    // Get new purchases since last timestamp
    const newBaseResult = await this.dataSource.query(baseQuery, [userId, sinceTimestamp]);
    const newSomniaResult = await this.dataSource.query(somniaQuery, [userId, sinceTimestamp]);
    
    const totalBasePurchases = parseInt(totalBaseResult[0]?.count || '0');
    const totalSomniaPurchases = parseInt(totalSomniaResult[0]?.count || '0');
    const newBasePurchases = parseInt(newBaseResult[0]?.count || '0');
    const newSomniaPurchases = parseInt(newSomniaResult[0]?.count || '0');
    
    // Combine Base + Somnia purchases for milestone calculation
    const totalPurchases = totalBasePurchases + totalSomniaPurchases;
    const newPurchases = newBasePurchases + newSomniaPurchases;
    
    const currentMilestones = Math.floor(totalPurchases / 20);
    const previousMilestones = Math.floor((totalPurchases - newPurchases) / 20);
    const newMilestones = currentMilestones - previousMilestones;
    
    console.log(`    💰 Transaction milestones: Base=${totalBasePurchases}, Somnia=${totalSomniaPurchases}, Total=${totalPurchases}, Milestones=${currentMilestones}`);
    
    return {
      milestonePoints: newMilestones * TRANSACTION_MILESTONE_POINTS,
      milestoneCount: newMilestones
    };
  }

  /**
   * Get total cumulative impressions (views) from ALL user_twitter_posts for a specific project
   * This returns the current total impressions across all posts (not filtered by date)
   */
  async getTotalImpressionsForProject(walletAddress: string, projectId: number): Promise<number> {
    const query = `
      SELECT 
        utp.main_tweet_id,
        utp.thread_tweet_ids,
        utp.engagement_metrics
      FROM user_twitter_posts utp
      INNER JOIN content_marketplace cm ON utp.content_id = cm.id
      INNER JOIN campaigns c ON cm."campaignId" = c.id
      INNER JOIN projects p ON c."projectId" = p.id
      WHERE utp.wallet_address = $1
        AND p.id = $2
        AND p.somnia_whitelisted = true
    `;
    
    const posts = await this.dataSource.query(query, [walletAddress, projectId]);
    let totalImpressions = 0;
    
    console.log(`    🔍 Debug: Found ${posts.length} posts for wallet ${walletAddress} project ${projectId}`);
    
    for (const post of posts) {
      const metrics = post.engagement_metrics || {};
      
      console.log(`    🔍 Debug: Post main_tweet_id=${post.main_tweet_id}, thread_tweet_ids=${JSON.stringify(post.thread_tweet_ids)}`);
      console.log(`    🔍 Debug: engagement_metrics structure: ${JSON.stringify(metrics, null, 2)}`);
      
      // Get views from main tweet
      if (post.main_tweet_id && metrics[post.main_tweet_id]) {
        const views = metrics[post.main_tweet_id].views || 0;
        console.log(`    🔍 Debug: Main tweet ${post.main_tweet_id} has ${views} views`);
        totalImpressions += views;
      } else if (post.main_tweet_id) {
        console.log(`    🔍 Debug: Main tweet ${post.main_tweet_id} has NO metrics`);
      }
      
      // Get views from thread tweets
      if (post.thread_tweet_ids && Array.isArray(post.thread_tweet_ids)) {
        for (const tweetId of post.thread_tweet_ids) {
          if (metrics[tweetId]) {
            const views = metrics[tweetId].views || 0;
            console.log(`    🔍 Debug: Thread tweet ${tweetId} has ${views} views`);
            totalImpressions += views;
          } else {
            console.log(`    🔍 Debug: Thread tweet ${tweetId} has NO metrics`);
          }
        }
      }
    }
    
    console.log(`    🔍 Debug: Total impressions for project ${projectId}: ${totalImpressions}`);
    
    return totalImpressions;
  }

  /**
   * Get previous impressions from last recorded entry for this user+project
   */
  async getPreviousImpressionsForProject(walletAddress: string, projectId: number): Promise<number> {
    const repo = this.dataSource.getRepository(SomniaDreamathonYapperPoints);
    const lastEntry = await repo.findOne({
      where: { 
        walletAddress: walletAddress.toLowerCase(),
        projectId: projectId
      },
      order: { createdAt: 'DESC' }
    });

    return lastEntry?.totalImpressions || 0;
  }

  /**
   * Populate delta impressions data for all users across all Somnia projects
   * Delta = Current total impressions - Previous recorded impressions
   */
  async populateImpressionsData(users: User[], somniaProjects: number[]): Promise<void> {
    console.log(`\n📊 Populating delta impressions data for ${users.length} users across ${somniaProjects.length} projects...`);
    
    for (const projectId of somniaProjects) {
      const projectImpressions = new Map<string, number>();
      
      for (const user of users) {
        // Get current total impressions from all posts
        const currentTotalImpressions = await this.getTotalImpressionsForProject(user.walletAddress, projectId);
        
        // Get previous recorded impressions from last entry
        const previousImpressions = await this.getPreviousImpressionsForProject(user.walletAddress, projectId);
        
        // Calculate delta (new impressions since last record)
        const deltaImpressions = currentTotalImpressions - previousImpressions;
        
        if (deltaImpressions > 0) {
          projectImpressions.set(user.walletAddress, deltaImpressions);
          console.log(`    User ${user.walletAddress} Project ${projectId}: Current=${currentTotalImpressions}, Previous=${previousImpressions}, Delta=${deltaImpressions}`);
        }
      }
      
      this.impressionsDataByProject.set(projectId, projectImpressions);
      console.log(`  ✅ Project ${projectId}: ${projectImpressions.size} users with new impressions`);
    }
  }

  /**
   * Calculate impressions points for a user and project (20K pool per project, top 10)
   * Uses delta impressions for ranking, but returns current total for storage
   */
  async calculateImpressionsPoints(walletAddress: string, projectId: number): Promise<{ impressionsPoints: number; totalImpressions: number }> {
    const projectData = this.impressionsDataByProject.get(projectId);
    if (!projectData) {
      // No delta impressions - get current total for storage
      const currentTotal = await this.getTotalImpressionsForProject(walletAddress, projectId);
      return { impressionsPoints: 0, totalImpressions: currentTotal };
    }

    const deltaImpressions = projectData.get(walletAddress) || 0;
    
    // Get current total impressions for storage
    const currentTotalImpressions = await this.getTotalImpressionsForProject(walletAddress, projectId);
    
    if (deltaImpressions === 0) {
      return { impressionsPoints: 0, totalImpressions: currentTotalImpressions };
    }

    // Sort all users by DELTA impressions for this project (descending)
    const sortedUsers = Array.from(projectData.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 only
    
    // Check if user is in top 10
    const userRank = sortedUsers.findIndex(([addr]) => addr === walletAddress);
    if (userRank === -1) {
      // User not in top 10 - no points but still save total
      return { impressionsPoints: 0, totalImpressions: currentTotalImpressions };
    }
    
    // Calculate total DELTA impressions of top 10
    const totalTop10DeltaImpressions = sortedUsers.reduce((sum, [_, views]) => sum + views, 0);
    
    // Calculate proportional share of 20K pool based on delta impressions
    const IMPRESSIONS_POOL_PER_PROJECT = 20000;
    const sharePercentage = deltaImpressions / totalTop10DeltaImpressions;
    const impressionsPoints = Math.round(sharePercentage * IMPRESSIONS_POOL_PER_PROJECT);
    
    console.log(`    👁️ Impressions for project ${projectId}: Delta=${deltaImpressions} views (Total=${currentTotalImpressions}), rank ${userRank + 1}/10, points: ${impressionsPoints}`);
    
    return { impressionsPoints, totalImpressions: currentTotalImpressions };
  }

  /**
   * Calculate champion bonus points (Top 5 per project on last day only)
   */
  async calculateChampionBonusPoints(projectId: number): Promise<Map<string, number>> {
    const championBonusMap = new Map<string, number>();
    
    // Only award champion bonus on the last day of campaign
    const today = new Date();
    const isLastDay = today.toDateString() === CAMPAIGN_END_DATE.toDateString();
    
    if (!isLastDay) {
      console.log(`  🏆 Champion bonus: Not last day yet (${today.toISOString()} vs ${CAMPAIGN_END_DATE.toISOString()})`);
      return championBonusMap;
    }
    
    console.log(`  🏆 LAST DAY - Calculating champion bonus for project ${projectId}...`);
    
    // Get top 5 users by total points for this project
    const query = `
      SELECT 
        "walletAddress",
        SUM("dailyPointsEarned") as total_points
      FROM somnia_dreamathon_yapper_points
      WHERE "projectId" = $1
      GROUP BY "walletAddress"
      ORDER BY total_points DESC
      LIMIT 5
    `;
    
    const topUsers = await this.dataSource.query(query, [projectId]);
    
    for (const user of topUsers) {
      championBonusMap.set(user.walletAddress.toLowerCase(), CHAMPION_BONUS_POINTS);
      console.log(`    ✅ Champion: ${user.walletAddress} (${user.total_points} points) → +${CHAMPION_BONUS_POINTS} bonus`);
    }
    
    return championBonusMap;
  }

  /**
   * Get all Somnia whitelisted project IDs
   */
  async getSomniaWhitelistedProjects(): Promise<number[]> {
    const query = `
      SELECT DISTINCT p.id
      FROM projects p
      WHERE p.somnia_whitelisted = true
      ORDER BY p.id
    `;
    
    const results = await this.dataSource.query(query);
    return results.map((row: any) => row.id);
  }

  /**
   * Calculate incremental points for a specific project (or NULL for global-only)
   */
  async calculateIncrementalPointsForProject(
    user: User, 
    projectId: number | null,
    lastRecordedEntry: SomniaDreamathonYapperPoints | null, 
    globalReferralPoints: number,
    globalMilestonePoints: number,
    championBonusMap: Map<string, number>
  ): Promise<any> {
    const sinceTimestamp = lastRecordedEntry ? lastRecordedEntry.createdAt : user.createdAt;
    
    // For NULL projectId (global-only users), skip project-specific points
    let dreamathonContentPoints = 0;
    let championBonusPoints = 0;
    let impressionsPoints = 0;
    let totalImpressions = 0;
    let dreamathonPostsCount = 0;
    
    if (projectId !== null) {
      // 1. Dreamathon content points (project-specific)
      const projectPostsMap = await this.getDreamathonPostsByProject(user.id, sinceTimestamp);
      dreamathonPostsCount = projectPostsMap.get(projectId) || 0;
      dreamathonContentPoints = dreamathonPostsCount * DREAMATHON_CONTENT_POINTS;

      // 4. Champion bonus points (project-specific, last day only)
      championBonusPoints = championBonusMap.get(user.walletAddress.toLowerCase()) || 0;
      
      // 5. Impressions points (project-specific)
      const impressionsResult = await this.calculateImpressionsPoints(user.walletAddress, projectId);
      impressionsPoints = impressionsResult.impressionsPoints;
      totalImpressions = impressionsResult.totalImpressions;
    }

    // 2. Referral points (GLOBAL - duplicated across all records)
    const referralPoints = globalReferralPoints;
    
    // 3. Transaction milestone points (GLOBAL - duplicated across all records)
    const transactionMilestonePoints = globalMilestonePoints;

    const totalIncrementalPoints = dreamathonContentPoints + referralPoints + transactionMilestonePoints + championBonusPoints + impressionsPoints;

    return { 
      dreamathonContentPoints,
      referralPoints,
      transactionMilestonePoints,
      championBonusPoints,
      impressionsPoints,
      totalImpressions,
      totalIncrementalPoints,
      dailyDreamathonPostsCount: dreamathonPostsCount
    };
  }

  /**
   * Process a single user for a specific project
   */
  async processUserForProject(
    user: User, 
    projectId: number | null,
    globalReferralPoints: number,
    globalMilestonePoints: number,
    globalActiveReferrals: number,
    globalNewQualifiedReferrals: number,
    globalMilestoneCount: number,
    championBonusMap: Map<string, number>
  ): Promise<YapperCalculation | null> {
    // Get Twitter connection
    const twitterConnection = await this.getUserTwitterConnection(user.id);
    
    // Get last recorded entry for this user and project
    const repo = this.dataSource.getRepository(SomniaDreamathonYapperPoints);
    
    // Handle null projectId for TypeORM query
    const whereClause: any = { 
      walletAddress: user.walletAddress.toLowerCase()
    };
    if (projectId !== null) {
      whereClause.projectId = projectId;
    } else {
      whereClause.projectId = null;
    }
    
    const lastEntry = await repo.findOne({
      where: whereClause,
      order: { createdAt: 'DESC' }
    });

    // Get cumulative points for this user and project
    let sumResult;
    if (projectId !== null) {
      sumResult = await repo
        .createQueryBuilder('sdyp')
        .select('SUM(sdyp.dailyPointsEarned)', 'cumulativePoints')
        .where('sdyp.walletAddress = :walletAddress', { walletAddress: user.walletAddress.toLowerCase() })
        .andWhere('sdyp.projectId = :projectId', { projectId })
        .getRawOne();
    } else {
      sumResult = await repo
        .createQueryBuilder('sdyp')
        .select('SUM(sdyp.dailyPointsEarned)', 'cumulativePoints')
        .where('sdyp.walletAddress = :walletAddress', { walletAddress: user.walletAddress.toLowerCase() })
        .andWhere('sdyp.projectId IS NULL')
        .getRawOne();
    }

    const cumulativePoints = sumResult?.cumulativePoints ? parseFloat(sumResult.cumulativePoints) : 0;
    
    // Calculate incremental points for this project
    const incrementalResult = await this.calculateIncrementalPointsForProject(
      user, 
      projectId, 
      lastEntry,
      globalReferralPoints,
      globalMilestonePoints,
      championBonusMap
    );
    
    // Skip if no points earned for this project
    if (incrementalResult.totalIncrementalPoints === 0) {
      return null;
    }
    
    // Calculate new totals
    const previousTotalPoints = cumulativePoints;
    const dailyPointsEarned = incrementalResult.totalIncrementalPoints;
    const newTotalPoints = previousTotalPoints + dailyPointsEarned;

    // Determine tier (based on total points across ALL projects)
    const currentTier = await this.getUserCurrentTier(user.walletAddress);
    const newTier = this.determineUserTier(newTotalPoints);
    const tierChanged = currentTier !== newTier;

    const calculation: YapperCalculation = {
      walletAddress: user.walletAddress,
      projectId,
      twitterHandle: twitterConnection?.twitterUsername,
      name: twitterConnection?.twitterDisplayName,
      totalReferrals: user.referralCount,
      activeReferrals: globalActiveReferrals,
      totalPoints: newTotalPoints,
      dailyPointsEarned,
      dreamathonContentPoints: incrementalResult.dreamathonContentPoints,
      referralPoints: incrementalResult.referralPoints,
      transactionMilestonePoints: incrementalResult.transactionMilestonePoints,
      championBonusPoints: incrementalResult.championBonusPoints,
      impressionsPoints: incrementalResult.impressionsPoints,
      totalImpressions: incrementalResult.totalImpressions,
      dailyDreamathonPostsCount: incrementalResult.dailyDreamathonPostsCount,
      dailyNewQualifiedReferrals: globalNewQualifiedReferrals, // Global value
      dailyMilestoneCount: globalMilestoneCount, // Global value
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
   * Process a single user across all Somnia projects
   */
  async processUser(user: User): Promise<YapperCalculation[]> {
    console.log(`\n👤 Processing user: ${user.walletAddress}`);
    
    // Debug: Check what posts exist for this user
    const debugPostsQuery = `
      SELECT 
        utp.id,
        utp.content_id,
        utp.wallet_address,
        cm.id as cm_id,
        cm."campaignId",
        c.id as campaign_id,
        c."projectId",
        p.id as project_id,
        p.name as project_name,
        p.somnia_whitelisted
      FROM user_twitter_posts utp
      LEFT JOIN content_marketplace cm ON utp.content_id = cm.id
      LEFT JOIN campaigns c ON cm."campaignId" = c.id
      LEFT JOIN projects p ON c."projectId" = p.id
      WHERE utp.wallet_address = $1
      LIMIT 5
    `;
    const debugPosts = await this.dataSource.query(debugPostsQuery, [user.walletAddress]);
    console.log(`  🔍 Debug: User has ${debugPosts.length} total posts (showing first 5):`);
    for (const post of debugPosts) {
      console.log(`    - Post ID: ${post.id}, Content ID: ${post.content_id}, Campaign ID: ${post.campaignId}, Project: ${post.project_name || 'NULL'} (ID: ${post.project_id || 'NULL'}), Somnia: ${post.somnia_whitelisted || 'NULL'}`);
    }


    // Get Twitter connection
    const twitterConnection = await this.getUserTwitterConnection(user.id);
    const twitterHandle = twitterConnection?.twitterUsername || 'None';
    
    console.log(`  🐦 Twitter handle: ${twitterHandle}`);
    
    // Calculate GLOBAL points once (referrals + transaction milestones)
    const lastGlobalEntry = await this.getLastRecordedEntry(user.walletAddress);
    const sinceTimestamp = lastGlobalEntry.lastEntry ? lastGlobalEntry.lastEntry.createdAt : user.createdAt;
    
    console.log(`  📅 Calculating since: ${sinceTimestamp.toISOString()}`);
    
    const { newReferralPoints, activeReferrals, newQualifiedReferrals } = await this.getNewQualifiedReferralsSince(user.id, sinceTimestamp);
    const { milestonePoints, milestoneCount } = await this.getTransactionMilestonePoints(user.id, sinceTimestamp);
    
    console.log(`  🌍 Global points: Referrals=${newReferralPoints}, Milestones=${milestonePoints}`);
    
    // Get all Somnia projects
    const somniaProjects = await this.getSomniaWhitelistedProjects();
    console.log(`  📋 Processing ${somniaProjects.length} Somnia projects`);
    
    const calculations: YapperCalculation[] = [];
    
    // Process each project
    for (const projectId of somniaProjects) {
      // Get champion bonus map for this project
      const championBonusMap = await this.calculateChampionBonusPoints(projectId);
      
      const calculation = await this.processUserForProject(
        user,
        projectId,
        newReferralPoints,
        milestonePoints,
        activeReferrals,
        newQualifiedReferrals,
        milestoneCount,
        championBonusMap
      );
      
      if (calculation) {
        calculations.push(calculation);
        console.log(`    ✅ Project ${projectId}: ${calculation.dailyPointsEarned} points`);
      }
    }
    
    // If user has global points but no project-specific records, create one record with NULL project
    // This handles users who make purchases or have referrals but don't post content
    if (calculations.length === 0 && (newReferralPoints > 0 || milestonePoints > 0)) {
      console.log(`  📝 Creating global record for user with referral/milestone points only`);
      const globalCalculation = await this.processUserForProject(
        user,
        null, // NULL project means "All Projects"
        newReferralPoints,
        milestonePoints,
        activeReferrals,
        newQualifiedReferrals,
        milestoneCount,
        new Map() // No champion bonus for global record
      );
      
      if (globalCalculation) {
        calculations.push(globalCalculation);
        console.log(`    ✅ Global record: ${globalCalculation.dailyPointsEarned} points`);
      }
    }
    
    console.log(`  📊 Total: ${calculations.length} project records created`);
    
    return calculations;
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
    if (calculation.dailyRank !== undefined) {
      yapperPoints.dailyRank = calculation.dailyRank;
    }
    if (calculation.projectRank !== undefined) {
      yapperPoints.projectRank = calculation.projectRank;
    }

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
   * Check if today is Tuesday (weekly calculation day)
   */
  private isWeeklyCalculationDay(): boolean {
    const today = new Date();
    return today.getDay() === 2; // Tuesday = 2
  }

  /**
   * Print dry run summary table
   */
  private printDryRunSummary(): void {
    console.log('\n' + '='.repeat(150));
    console.log('📊 DRY RUN SUMMARY - YAPPER POINTS BREAKDOWN');
    console.log('='.repeat(150));
    
    // Group by wallet address to show all project records
    const walletMap = new Map<string, YapperCalculation[]>();
    
    for (const calc of this.allCalculations) {
      if (!walletMap.has(calc.walletAddress)) {
        walletMap.set(calc.walletAddress, []);
      }
      walletMap.get(calc.walletAddress)!.push(calc);
    }
    
    // Print header
    console.log(
      'Wallet Address'.padEnd(45) + 
      'Project'.padEnd(10) + 
      'Content'.padEnd(10) + 
      'Referral'.padEnd(10) + 
      'Milestone'.padEnd(10) + 
      'Champion'.padEnd(10) + 
      'Impressions'.padEnd(12) + 
      'Daily Total'.padEnd(12) + 
      'Total Points'
    );
    console.log('-'.repeat(150));
    
    // Print each wallet's project records
    for (const [wallet, calculations] of walletMap.entries()) {
      for (const calc of calculations) {
        console.log(
          wallet.substring(0, 42).padEnd(45) +
          (calc.projectId?.toString() || 'N/A').padEnd(10) +
          calc.dreamathonContentPoints.toString().padEnd(10) +
          calc.referralPoints.toString().padEnd(10) +
          calc.transactionMilestonePoints.toString().padEnd(10) +
          calc.championBonusPoints.toString().padEnd(10) +
          calc.impressionsPoints.toString().padEnd(12) +
          calc.dailyPointsEarned.toString().padEnd(12) +
          calc.totalPoints.toString()
        );
      }
      console.log('-'.repeat(150));
    }
    
    // Print totals
    const totalRecords = this.allCalculations.length;
    const totalContent = this.allCalculations.reduce((sum, c) => sum + c.dreamathonContentPoints, 0);
    const totalReferral = this.allCalculations.reduce((sum, c) => sum + c.referralPoints, 0);
    const totalMilestone = this.allCalculations.reduce((sum, c) => sum + c.transactionMilestonePoints, 0);
    const totalChampion = this.allCalculations.reduce((sum, c) => sum + c.championBonusPoints, 0);
    const totalImpressions = this.allCalculations.reduce((sum, c) => sum + c.impressionsPoints, 0);
    const totalDaily = this.allCalculations.reduce((sum, c) => sum + c.dailyPointsEarned, 0);
    
    console.log('TOTALS:'.padEnd(45) + 
      `${totalRecords} recs`.padEnd(10) +
      totalContent.toString().padEnd(10) +
      totalReferral.toString().padEnd(10) +
      totalMilestone.toString().padEnd(10) +
      totalChampion.toString().padEnd(10) +
      totalImpressions.toString().padEnd(12) +
      totalDaily.toString()
    );
    console.log('='.repeat(150));
    
    console.log(`\n📈 Summary Statistics:`);
    console.log(`   Total Users: ${walletMap.size}`);
    console.log(`   Total Project Records: ${totalRecords}`);
    console.log(`   Avg Records per User: ${(totalRecords / walletMap.size).toFixed(2)}`);
    console.log(`   Total Content Points: ${totalContent}`);
    console.log(`   Total Referral Points: ${totalReferral}`);
    console.log(`   Total Milestone Points: ${totalMilestone}`);
    console.log(`   Total Champion Bonus: ${totalChampion}`);
    console.log(`   Total Impressions Points: ${totalImpressions}`);
    console.log(`   Total Daily Points: ${totalDaily}`);
    console.log('='.repeat(150) + '\n');
  }

  /**
   * Main execution function
   */
  async run(dryRun: boolean = false): Promise<void> {
    try {
      console.log('🚀 Starting Somnia Dreamathon Yapper Points Calculation Script');
      console.log('📅 Date:', new Date().toISOString());
      console.log(`🔧 Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);

      // Check if within campaign period
      if (!this.isWithinCampaignPeriod()) {
        console.log('⚠️ Current date is outside campaign period (Nov 18 - Dec 9, 2025)');
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

      // Get all Somnia projects
      const somniaProjects = await this.getSomniaWhitelistedProjects();
      console.log(`🎯 Found ${somniaProjects.length} Somnia whitelisted projects`);

      // Populate delta impressions data for all users across all projects
      // This calculates: Current total impressions - Previous recorded impressions
      await this.populateImpressionsData(users, somniaProjects);

      // Process each user (creates multiple records per user - one per project with activity)
      let totalRecordsCreated = 0;
      
      for (const user of users) {
        try {
          const calculations = await this.processUser(user);
          
          if (dryRun) {
            this.allCalculations.push(...calculations);
            console.log(`  📊 [DRY RUN] Created ${calculations.length} project records`);
          } else {
            for (const calculation of calculations) {
              await this.saveYapperDailyPoints(calculation);
              await this.updateUserTier(calculation);
            }
            totalRecordsCreated += calculations.length;
            console.log(`  ✅ Saved ${calculations.length} project records`);
          }
        } catch (error) {
          console.error(`❌ Error processing user ${user.walletAddress}:`, error);
        }
      }

      if (!dryRun) {
        console.log(`\n📝 Total records created: ${totalRecordsCreated}`);
      }

      // Calculate weekly rewards if it's Tuesday
      if (this.isWeeklyCalculationDay() && !dryRun) {
        console.log('\n🗓️ Tuesday detected - calculating weekly rewards...');
        // TODO: Implement weekly rewards calculation
      }

      // Print dry run summary
      if (dryRun) {
        this.printDryRunSummary();
      }

      console.log(`\n🎉 Somnia Yapper Points Calculation completed successfully!${dryRun ? ' [DRY RUN MODE]' : ''}`);

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
  console.log(`   Campaign: Nov 18 - Dec 9, 2025`);
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

