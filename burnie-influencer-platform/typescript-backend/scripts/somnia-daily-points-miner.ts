#!/usr/bin/env ts-node

import { DataSource } from 'typeorm';
import * as path from 'path';
import { config } from 'dotenv';

// Load environment variables
config({ path: path.join(__dirname, '../.env') });

// Import Season 2 entities
import { SomniaDreamathonMinerPoints } from '../src/models/SomniaDreamathonMinerPoints';

// Define interfaces
interface MinerWallet {
  walletAddress: string;
  createdAt: Date;
}

interface MinerCalculation {
  walletAddress: string;
  projectId: number | null;
  name: string | undefined;
  dailyUptimePercentage: number;
  dailyContentGenerated: number;
  dailyContentSold: number;
  dailySalesRevenue: number;
  dailyRevenueShare: number;
  weeklyUptimeRewards: number;
  weeklyTopSellerBonus: number;
  grandPrizeRewards: number;
  dailySalesRank: number | undefined;
  weeklyTopSellerRank: number;
  overallRank: number | undefined;
}

// Season 2 Constants
const REVENUE_SHARE_PERCENTAGE = 0.70; // 70% of sales go to miner
const MIN_UPTIME_FOR_REWARDS = 95; // 95% minimum uptime to qualify

// Weekly rewards (distributed on Mondays at 10 AM ET)
const WEEKLY_UPTIME_POOL = 450000; // 450K divided equally among qualifying nodes
const WEEKLY_TOP_SELLER_POOL = 1000000; // 1M distributed proportionally based on sales

// Campaign dates (Nov 16 - Dec 7, 2025)
const CAMPAIGN_START_DATE = new Date('2025-11-16T15:00:00Z'); // 10 AM ET
const CAMPAIGN_END_DATE = new Date('2025-12-07T15:00:00Z'); // 10 AM ET

// Excluded wallets (lowercase)
const EXCLUDED_WALLETS: string[] = [
  // Add wallet addresses here that should be excluded
];

// Excluded wallets from rewards
const EXCLUDE_WALLET_REWARDS: string[] = [
  // Add wallet addresses here that should be excluded from rewards
];

// Database connection
let AppDataSource: DataSource;

class SomniaDailyPointsMinerScript {
  private dataSource: DataSource;
  private allCalculations: MinerCalculation[] = [];

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
   * Get all miners (users who have generated content via dedicated miner)
   */
  async getMiners(): Promise<MinerWallet[]> {
    const query = `
      SELECT DISTINCT dme."walletAddress", MIN(dme."createdAt") as "createdAt"
      FROM dedicated_miner_executions dme
      WHERE dme."createdAt" >= $1
      GROUP BY dme."walletAddress"
      ORDER BY "createdAt"
    `;

    const miners = await this.dataSource.query(query, [CAMPAIGN_START_DATE]);
    const filteredMiners = miners
      .map((miner: any) => ({
        walletAddress: miner.walletAddress.toLowerCase(),
        createdAt: new Date(miner.createdAt)
      }))
      .filter((miner: MinerWallet) => !this.isWalletExcluded(miner.walletAddress));

    console.log(`📊 Found ${miners.length} total miners, ${filteredMiners.length} after excluding blocked wallets`);
    
    return filteredMiners;
  }

  /**
   * Get last recorded entry from somnia_dreamathon_miner_points
   */
  async getLastRecordedEntry(walletAddress: string): Promise<SomniaDreamathonMinerPoints | null> {
    const repo = this.dataSource.getRepository(SomniaDreamathonMinerPoints);
    
    const latestEntry = await repo.findOne({
      where: { walletAddress: walletAddress.toLowerCase() },
      order: { createdAt: 'DESC' }
    });

    console.log(`  📋 Last Recorded Entry: ${latestEntry ? `Found (${latestEntry.createdAt.toISOString()})` : 'None found (new miner)'}`);
    
    return latestEntry;
  }

  /**
   * Calculate daily uptime percentage
   */
  async calculateDailyUptime(walletAddress: string, sinceTimestamp: Date): Promise<number> {
    // Get all dedicated miner executions for today
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const query = `
      SELECT 
        COUNT(*) as total_attempts,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_attempts
      FROM dedicated_miner_executions
      WHERE LOWER("walletAddress") = LOWER($1)
        AND "createdAt" >= $2
        AND "createdAt" < $3
    `;

    const result = await this.dataSource.query(query, [walletAddress, todayStart, todayEnd]);
    
    const totalAttempts = parseInt(result[0]?.total_attempts || '0');
    const successfulAttempts = parseInt(result[0]?.successful_attempts || '0');
    
    if (totalAttempts === 0) {
      return 0;
    }

    const uptimePercentage = (successfulAttempts / totalAttempts) * 100;
    
    return Math.round(uptimePercentage * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Get daily content generated count
   */
  async getDailyContentGenerated(walletAddress: string, sinceTimestamp: Date): Promise<number> {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const query = `
      SELECT COUNT(*) as count
      FROM content_marketplace cm
      WHERE LOWER(cm."minerWallet") = LOWER($1)
        AND cm."createdAt" >= $2
        AND cm."createdAt" < $3
    `;

    const result = await this.dataSource.query(query, [walletAddress, todayStart, todayEnd]);
    return parseInt(result[0]?.count || '0');
  }

  /**
   * Get daily content sold and sales revenue
   */
  async getDailySalesData(walletAddress: string, sinceTimestamp: Date): Promise<{ contentSold: number; salesRevenue: number; revenueShare: number }> {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const query = `
      SELECT 
        COUNT(DISTINCT cp.id) as content_sold,
        COALESCE(SUM(cp.purchase_price), 0) as total_revenue
      FROM content_purchases cp
      INNER JOIN content_marketplace cm ON cp.content_id = cm.id
      WHERE LOWER(cm."minerWallet") = LOWER($1)
        AND cp.payment_status = 'completed'
        AND cp.created_at >= $2
        AND cp.created_at < $3
    `;

    const result = await this.dataSource.query(query, [walletAddress, todayStart, todayEnd]);
    
    const contentSold = parseInt(result[0]?.content_sold || '0');
    const totalRevenue = parseFloat(result[0]?.total_revenue || '0');
    const revenueShare = totalRevenue * REVENUE_SHARE_PERCENTAGE;
    
    return { contentSold, salesRevenue: totalRevenue, revenueShare };
  }

  /**
   * Process a single miner
   */
  async processMiner(miner: MinerWallet, projectId: number | null = null): Promise<MinerCalculation> {
    console.log(`Processing miner: ${miner.walletAddress} (project: ${projectId || 'all'})`);

    // Get last recorded entry
    const lastEntry = await this.getLastRecordedEntry(miner.walletAddress);
    const sinceTimestamp = lastEntry ? lastEntry.createdAt : miner.createdAt;
    
    // Calculate daily metrics
    const dailyUptimePercentage = await this.calculateDailyUptime(miner.walletAddress, sinceTimestamp);
    const dailyContentGenerated = await this.getDailyContentGenerated(miner.walletAddress, sinceTimestamp);
    const { contentSold, salesRevenue, revenueShare } = await this.getDailySalesData(miner.walletAddress, sinceTimestamp);
    
    console.log(`  📊 Daily Metrics:`);
    console.log(`    Uptime: ${dailyUptimePercentage}%`);
    console.log(`    Content Generated: ${dailyContentGenerated}`);
    console.log(`    Content Sold: ${contentSold}`);
    console.log(`    Sales Revenue: ${salesRevenue} $ROAST`);
    console.log(`    Revenue Share (70%): ${revenueShare} $ROAST`);

    const calculation: MinerCalculation = {
      walletAddress: miner.walletAddress,
      projectId,
      name: undefined, // Can be populated if user data is available
      dailyUptimePercentage,
      dailyContentGenerated,
      dailyContentSold: contentSold,
      dailySalesRevenue: salesRevenue,
      dailyRevenueShare: revenueShare,
      weeklyUptimeRewards: 0, // Will be calculated later
      weeklyTopSellerBonus: 0, // Will be calculated later
      grandPrizeRewards: 0,
      dailySalesRank: undefined,
      weeklyTopSellerRank: 0,
      overallRank: undefined
    };
    
    return calculation;
  }

  /**
   * Save miner daily points
   */
  async saveMinerDailyPoints(calculation: MinerCalculation): Promise<void> {
    const repo = this.dataSource.getRepository(SomniaDreamathonMinerPoints);

    const minerPoints = new SomniaDreamathonMinerPoints();
    minerPoints.walletAddress = calculation.walletAddress;
    minerPoints.projectId = calculation.projectId;
    minerPoints.name = calculation.name;
    minerPoints.dailyUptimePercentage = calculation.dailyUptimePercentage;
    minerPoints.dailyContentGenerated = calculation.dailyContentGenerated;
    minerPoints.dailyContentSold = calculation.dailyContentSold;
    minerPoints.dailySalesRevenue = calculation.dailySalesRevenue;
    minerPoints.dailyRevenueShare = calculation.dailyRevenueShare;
    minerPoints.weeklyUptimeRewards = calculation.weeklyUptimeRewards;
    minerPoints.weeklyTopSellerBonus = calculation.weeklyTopSellerBonus;
    minerPoints.grandPrizeRewards = calculation.grandPrizeRewards;
    minerPoints.dailySalesRank = calculation.dailySalesRank;
    minerPoints.weeklyTopSellerRank = calculation.weeklyTopSellerRank;
    minerPoints.overallRank = calculation.overallRank;

    await repo.save(minerPoints);
  }

  /**
   * Calculate daily ranks based on sales revenue
   */
  async calculateDailyRanks(): Promise<void> {
    console.log('Calculating daily sales ranks...');

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const query = `
      UPDATE somnia_dreamathon_miner_points 
      SET "dailySalesRank" = ranked_table.rank
      FROM (
        SELECT id, 
               ROW_NUMBER() OVER (ORDER BY "dailySalesRevenue" DESC, "createdAt" ASC) as rank
        FROM somnia_dreamathon_miner_points
        WHERE "createdAt" >= $1 AND "createdAt" < $2
      ) as ranked_table
      WHERE somnia_dreamathon_miner_points.id = ranked_table.id
    `;

    await this.dataSource.query(query, [todayStart, todayEnd]);
    console.log('✅ Daily sales ranks calculated');
  }

  /**
   * Check if today is Monday (weekly calculation day)
   */
  private isWeeklyCalculationDay(): boolean {
    const today = new Date();
    return today.getDay() === 1; // Monday = 1
  }

  /**
   * Calculate weekly rewards (called on Mondays)
   */
  async calculateWeeklyRewards(): Promise<void> {
    console.log('🗓️ Calculating weekly rewards (Monday calculation)...');
    
    // Get weekly calculation window (last Monday to this Monday)
    const today = new Date();
    const lastMonday = new Date(today);
    lastMonday.setDate(lastMonday.getDate() - 7);
    lastMonday.setHours(15, 0, 0, 0); // 10 AM ET = 3 PM UTC
    
    const thisMonday = new Date(today);
    thisMonday.setHours(15, 0, 0, 0);
    
    console.log(`📅 Weekly window: ${lastMonday.toISOString()} to ${thisMonday.toISOString()}`);
    
    // 1. Calculate uptime rewards (450K divided equally among nodes with 95%+ uptime)
    const uptimeQuery = `
      SELECT DISTINCT "walletAddress", AVG("dailyUptimePercentage") as avg_uptime
      FROM somnia_dreamathon_miner_points
      WHERE "createdAt" >= $1 AND "createdAt" < $2
      GROUP BY "walletAddress"
      HAVING AVG("dailyUptimePercentage") >= $3
    `;
    
    const qualifyingMiners = await this.dataSource.query(uptimeQuery, [lastMonday, thisMonday, MIN_UPTIME_FOR_REWARDS]);
    
    // Filter out excluded wallets
    const eligibleForUptime = qualifyingMiners.filter((m: any) => !this.isWalletExcludedFromRewards(m.walletAddress));
    
    console.log(`📊 Found ${qualifyingMiners.length} miners with ${MIN_UPTIME_FOR_REWARDS}%+ uptime, ${eligibleForUptime.length} eligible`);
    
    if (eligibleForUptime.length > 0) {
      const uptimeRewardPerMiner = Math.floor(WEEKLY_UPTIME_POOL / eligibleForUptime.length);
      
      // Update uptime rewards
      for (const miner of eligibleForUptime) {
        await this.dataSource.query(`
          UPDATE somnia_dreamathon_miner_points
          SET "weeklyUptimeRewards" = $1
          WHERE "walletAddress" = $2
            AND "createdAt" >= $3 
            AND "createdAt" < $4
        `, [uptimeRewardPerMiner, miner.walletAddress, lastMonday, thisMonday]);
        
        console.log(`💰 Uptime reward: ${miner.walletAddress} = ${uptimeRewardPerMiner} $ROAST`);
      }
    }
    
    // 2. Calculate top seller bonus (1M distributed proportionally)
    const salesQuery = `
      SELECT "walletAddress", SUM("dailySalesRevenue") as total_sales
      FROM somnia_dreamathon_miner_points
      WHERE "createdAt" >= $1 AND "createdAt" < $2
      GROUP BY "walletAddress"
      HAVING SUM("dailySalesRevenue") > 0
      ORDER BY total_sales DESC
    `;
    
    const allSellers = await this.dataSource.query(salesQuery, [lastMonday, thisMonday]);
    
    // Filter out excluded wallets
    const eligibleSellers = allSellers.filter((m: any) => !this.isWalletExcludedFromRewards(m.walletAddress));
    
    if (eligibleSellers.length > 0) {
      const totalSales = eligibleSellers.reduce((sum: number, m: any) => sum + parseFloat(m.total_sales), 0);
      
      console.log(`📊 Found ${eligibleSellers.length} sellers with total sales: ${totalSales} $ROAST`);
      
      // Distribute 1M proportionally
      for (let i = 0; i < eligibleSellers.length; i++) {
        const miner = eligibleSellers[i];
        const proportion = parseFloat(miner.total_sales) / totalSales;
        const topSellerBonus = Math.round(proportion * WEEKLY_TOP_SELLER_POOL);
        
        await this.dataSource.query(`
          UPDATE somnia_dreamathon_miner_points
          SET "weeklyTopSellerBonus" = $1,
              "weeklyTopSellerRank" = $2
          WHERE "walletAddress" = $3
            AND "createdAt" >= $4 
            AND "createdAt" < $5
        `, [topSellerBonus, i + 1, miner.walletAddress, lastMonday, thisMonday]);
        
        console.log(`🏆 Rank ${i + 1}: ${miner.walletAddress} - ${miner.total_sales} sales = ${topSellerBonus} bonus`);
      }
    }
    
    console.log(`✅ Weekly rewards calculated and distributed`);
  }

  /**
   * Main execution function
   */
  async run(dryRun: boolean = false): Promise<void> {
    try {
      console.log('🚀 Starting Somnia Dreamathon Miner Points Calculation Script');
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

      // Get all miners
      const miners = await this.getMiners();
      console.log(`📊 Found ${miners.length} miners`);

      if (miners.length === 0) {
        console.log('⚠️ No miners found. Exiting.');
        return;
      }

      // Process each miner
      for (const miner of miners) {
        try {
          const calculation = await this.processMiner(miner);
          
          if (dryRun) {
            this.allCalculations.push(calculation);
            console.log(`📊 [DRY RUN] ${miner.walletAddress} | Uptime: ${calculation.dailyUptimePercentage}% | Sales: ${calculation.dailySalesRevenue}`);
          } else {
            await this.saveMinerDailyPoints(calculation);
            console.log(`✅ Processed: ${miner.walletAddress} (${calculation.dailyUptimePercentage}% uptime, ${calculation.dailySalesRevenue} sales revenue)`);
          }
        } catch (error) {
          console.error(`❌ Error processing miner ${miner.walletAddress}:`, error);
        }
      }

      // Calculate daily ranks
      if (!dryRun) {
        await this.calculateDailyRanks();
        
        // Calculate weekly rewards if it's Monday
        if (this.isWeeklyCalculationDay()) {
          console.log('\n🗓️ Monday detected - calculating weekly rewards...');
          await this.calculateWeeklyRewards();
        }
      }

      console.log(`🎉 Somnia Miner Points Calculation completed successfully!${dryRun ? ' [DRY RUN MODE]' : ''}`);

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
    entities: [SomniaDreamathonMinerPoints],
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

  const script = new SomniaDailyPointsMinerScript(AppDataSource);
  
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

export { SomniaDailyPointsMinerScript };

