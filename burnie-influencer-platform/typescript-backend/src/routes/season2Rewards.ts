import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { SomniaDreamathonYapperPoints } from '../models/SomniaDreamathonYapperPoints';
import { SomniaDreamathonMinerPoints } from '../models/SomniaDreamathonMinerPoints';
import { Project } from '../models/Project';
import { logger } from '../config/logger';

const router = Router();

/**
 * Get Somnia whitelisted projects with active campaigns
 * GET /api/projects/somnia-whitelisted
 */
router.get('/projects/somnia-whitelisted', async (req: Request, res: Response) => {
  try {
    // Get projects that are Somnia whitelisted AND have active campaigns
    const query = `
      SELECT DISTINCT p.id, p.name
      FROM projects p
      INNER JOIN campaigns c ON p.id = c."projectId"
      WHERE p.somnia_whitelisted = true
        AND c."isActive" = true
      ORDER BY p.name ASC
    `;
    
    const projects = await AppDataSource.query(query);

    logger.info(`Fetched ${projects.length} Somnia whitelisted projects with active campaigns`);
    res.json(projects);
  } catch (error) {
    logger.error('Error fetching Somnia whitelisted projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * Get Season 2 Yapper Leaderboard
 * GET /api/rewards/season2/yapper-leaderboard?period=7d&projectId=1
 */
router.get('/rewards/season2/yapper-leaderboard', async (req: Request, res: Response) => {
  try {
    const { period = '7d', projectId } = req.query;
    const yapperPointsRepo = AppDataSource.getRepository(SomniaDreamathonYapperPoints);

    // Calculate date range based on period
    const now = new Date();
    const startDate = new Date();
    if (period === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === '1m') {
      startDate.setMonth(now.getMonth() - 1);
    }

    // Build query
    let query = yapperPointsRepo
      .createQueryBuilder('yapper')
      .where('yapper.createdAt >= :startDate', { startDate })
      .andWhere('yapper.createdAt <= :endDate', { endDate: now });

    // Filter by project if provided
    if (projectId && projectId !== 'null') {
      query = query.andWhere('yapper.projectId = :projectId', { projectId: Number(projectId) });
    } else if (!projectId) {
      // For "All Projects", we need to handle global points (referral & milestone) specially
      // to avoid double counting across project records
    }

    // Group by wallet address and aggregate points
    const leaderboardData = await query
      .select('yapper.walletAddress', 'walletAddress')
      .addSelect('yapper.twitterHandle', 'twitterHandle')
      .addSelect('yapper.name', 'name')
      .addSelect('SUM(yapper.dreamathonContentPoints)', 'dreamathonContentPoints')
      .addSelect('MAX(yapper.referralPoints)', 'referralPoints') // MAX to avoid double-counting global points
      .addSelect('MAX(yapper.transactionMilestonePoints)', 'transactionMilestonePoints') // MAX to avoid double-counting
      .addSelect('SUM(yapper.championBonusPoints)', 'championBonusPoints')
      .addSelect('SUM(yapper.impressionsPoints)', 'impressionsPoints')
      .addSelect('SUM(yapper.totalImpressions)', 'totalImpressions')
      .addSelect('SUM(yapper.weeklyRewards)', 'weeklyRewards')
      .addSelect('SUM(yapper.grandPrizeRewards)', 'grandPrizeRewards')
      .addSelect('MAX(yapper.updatedAt)', 'lastUpdated')
      .groupBy('yapper.walletAddress')
      .addGroupBy('yapper.twitterHandle')
      .addGroupBy('yapper.name')
      .getRawMany();

    // Calculate totalPoints correctly (content + referral + milestone + champion + impressions)
    const leaderboardWithTotals = leaderboardData.map((entry: any) => ({
      ...entry,
      totalPoints: 
        parseFloat(entry.dreamathonContentPoints || 0) +
        parseFloat(entry.referralPoints || 0) +
        parseFloat(entry.transactionMilestonePoints || 0) +
        parseFloat(entry.championBonusPoints || 0) +
        parseFloat(entry.impressionsPoints || 0)
    }));

    // Sort by totalPoints descending
    leaderboardWithTotals.sort((a, b) => b.totalPoints - a.totalPoints);

    // Limit to top 100
    const topLeaderboard = leaderboardWithTotals.slice(0, 100);

    // Get user tiers for each wallet
    const walletAddresses = topLeaderboard.map((entry: any) => entry.walletAddress);
    const userTiersQuery = await AppDataSource.query(
      `SELECT DISTINCT ON ("walletAddress") "walletAddress", tier 
       FROM user_tiers 
       WHERE LOWER("walletAddress") = ANY($1::text[])
       ORDER BY "walletAddress", "createdAt" DESC`,
      [walletAddresses.map((addr: string) => addr.toLowerCase())]
    );

    const tierMap: { [key: string]: string } = {};
    userTiersQuery.forEach((row: any) => {
      tierMap[row.walletAddress.toLowerCase()] = row.tier;
    });

    // Get active referrals for each wallet
    const referralsQuery = await AppDataSource.query(
      `SELECT LOWER(u."walletAddress") as "walletAddress", COUNT(DISTINCT ur."userId") as "activeReferrals"
       FROM users u
       LEFT JOIN user_referrals ur ON u.id = ur."directReferrerId"
       WHERE LOWER(u."walletAddress") = ANY($1::text[])
       GROUP BY LOWER(u."walletAddress")`,
      [walletAddresses.map((addr: string) => addr.toLowerCase())]
    );

    const referralsMap: { [key: string]: number } = {};
    referralsQuery.forEach((row: any) => {
      referralsMap[row.walletAddress] = parseInt(row.activeReferrals || '0');
    });

    // Format leaderboard with ranks
    const users = topLeaderboard.map((entry: any, index: number) => ({
      rank: index + 1,
      walletAddress: entry.walletAddress,
      twitterHandle: entry.twitterHandle,
      name: entry.name,
      tier: tierMap[entry.walletAddress.toLowerCase()] || 'SILVER',
      totalPoints: Math.round(entry.totalPoints),
      dreamathonContentPoints: Math.round(parseFloat(entry.dreamathonContentPoints || 0)),
      referralPoints: Math.round(parseFloat(entry.referralPoints || 0)),
      transactionMilestonePoints: Math.round(parseFloat(entry.transactionMilestonePoints || 0)),
      championBonusPoints: Math.round(parseFloat(entry.championBonusPoints || 0)),
      impressionsPoints: Math.round(parseFloat(entry.impressionsPoints || 0)),
      mindshare: parseFloat(entry.totalImpressions || '0') / 1000000, // Convert to percentage
      activeReferrals: referralsMap[entry.walletAddress.toLowerCase()] || 0,
      totalReferrals: referralsMap[entry.walletAddress.toLowerCase()] || 0,
      totalRoastEarned: parseFloat(entry.weeklyRewards || '0') + parseFloat(entry.grandPrizeRewards || '0'),
      totalDailyRewards: parseFloat(entry.weeklyRewards || '0') + parseFloat(entry.grandPrizeRewards || '0'),
    }));

    // Get top 3 for podium
    const topThree = users.slice(0, 3);

    res.json({
      users,
      topThree,
      period,
      projectId: projectId ? Number(projectId) : null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching yapper leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * Get Season 2 Miner Leaderboard
 * GET /api/rewards/season2/miner-leaderboard?period=7d
 */
router.get('/rewards/season2/miner-leaderboard', async (req: Request, res: Response) => {
  try {
    const { period = '7d' } = req.query;
    const minerPointsRepo = AppDataSource.getRepository(SomniaDreamathonMinerPoints);

    // Calculate date range based on period
    const now = new Date();
    const startDate = new Date();
    if (period === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === '1m') {
      startDate.setMonth(now.getMonth() - 1);
    }

    // Build query
    const leaderboardData = await minerPointsRepo
      .createQueryBuilder('miner')
      .where('miner.createdAt >= :startDate', { startDate })
      .andWhere('miner.createdAt <= :endDate', { endDate: now })
      .select('miner.walletAddress', 'walletAddress')
      .addSelect('miner.name', 'name')
      .addSelect('SUM(miner.dailyContentGenerated)', 'contentCreated')
      .addSelect('SUM(miner.dailyContentSold)', 'contentSold')
      .addSelect('SUM(miner.dailySalesRevenue)', 'totalValueSold')
      .addSelect('SUM(miner.dailyRevenueShare)', 'revShare')
      .addSelect('SUM(miner.dailyRevenueShare)', 'earnings')
      .addSelect('SUM(miner.weeklyTopSellerBonus)', 'bonus')
      .addSelect('SUM(miner.weeklyUptimeRewards) + SUM(miner.weeklyTopSellerBonus) + SUM(miner.grandPrizeRewards)', 'rewards')
      .addSelect('AVG(miner.dailyUptimePercentage)', 'avgUptime')
      .addSelect('MAX(miner.updatedAt)', 'lastUpdated')
      .groupBy('miner.walletAddress')
      .addGroupBy('miner.name')
      .orderBy('totalValueSold', 'DESC')
      .limit(100)
      .getRawMany();

    // Get user tiers for each wallet
    const walletAddresses = leaderboardData.map((entry: any) => entry.walletAddress);
    const userTiersQuery = await AppDataSource.query(
      `SELECT DISTINCT ON ("walletAddress") "walletAddress", tier 
       FROM user_tiers 
       WHERE LOWER("walletAddress") = ANY($1::text[])
       ORDER BY "walletAddress", "createdAt" DESC`,
      [walletAddresses.map((addr: string) => addr.toLowerCase())]
    );

    const tierMap: { [key: string]: string } = {};
    userTiersQuery.forEach((row: any) => {
      tierMap[row.walletAddress.toLowerCase()] = row.tier;
    });

    // Format leaderboard with ranks
    const users = leaderboardData.map((entry: any, index: number) => ({
      rank: index + 1,
      walletAddress: entry.walletAddress,
      name: entry.name,
      tier: tierMap[entry.walletAddress.toLowerCase()] || 'PLATINUM',
      contentCreated: parseInt(entry.contentCreated || '0'),
      contentSold: parseInt(entry.contentSold || '0'),
      totalValueSold: parseFloat(entry.totalValueSold || '0'),
      revShare: parseFloat(entry.revShare || '0'),
      earnings: parseFloat(entry.earnings || '0'),
      bonus: parseFloat(entry.bonus || '0'),
      rewards: parseFloat(entry.rewards || '0'),
      avgUptime: parseFloat(entry.avgUptime || '0'),
    }));

    // Get top 3 for podium
    const topThree = users.slice(0, 3);

    res.json({
      users,
      topThree,
      period,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching miner leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/**
 * Get Season 2 Points Breakdown for a specific user
 * GET /api/rewards/season2/points-breakdown?walletAddress=0x...
 */
router.get('/rewards/season2/points-breakdown', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const yapperPointsRepo = AppDataSource.getRepository(SomniaDreamathonYapperPoints);

    // Get all daily records for this user, grouped by date
    const dailyRecords = await yapperPointsRepo
      .createQueryBuilder('yapper')
      .where('LOWER(yapper.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select('DATE(yapper.createdAt)', 'date')
      .addSelect('SUM(yapper.dreamathonContentPoints)', 'dreamathonContentPoints')
      .addSelect('MAX(yapper.referralPoints)', 'referralPoints') // MAX to avoid double-counting global points
      .addSelect('MAX(yapper.transactionMilestonePoints)', 'transactionMilestonePoints') // MAX to avoid double-counting
      .addSelect('SUM(yapper.impressionsPoints)', 'impressionsPoints')
      .addSelect('SUM(yapper.championBonusPoints)', 'championBonusPoints')
      .groupBy('DATE(yapper.createdAt)')
      .orderBy('DATE(yapper.createdAt)', 'DESC')
      .getRawMany();

    // Format daily points and calculate correct totals
    const dailyPoints = dailyRecords.map((record: any) => {
      const dreamathonContentPoints = parseInt(record.dreamathonContentPoints || '0');
      const referralPoints = parseInt(record.referralPoints || '0');
      const transactionMilestonePoints = parseInt(record.transactionMilestonePoints || '0');
      const impressionsPoints = parseInt(record.impressionsPoints || '0');
      const championBonusPoints = parseInt(record.championBonusPoints || '0');
      
      // Calculate correct daily total (content + referral + milestone + impressions + champion)
      const dailyPointsEarned = dreamathonContentPoints + referralPoints + transactionMilestonePoints + impressionsPoints + championBonusPoints;
      
      return {
        date: record.date,
        dreamathonContentPoints,
        referralPoints,
        transactionMilestonePoints,
        impressionsPoints,
        championBonusPoints,
        dailyPointsEarned
      };
    });

    // Calculate total points (sum of all daily points)
    const totalPoints = dailyPoints.reduce((sum, record) => sum + record.dailyPointsEarned, 0);

    return res.json({
      dailyPoints,
      totalPoints: Math.round(totalPoints),
    });
  } catch (error) {
    logger.error('Error fetching Season 2 points breakdown:', error);
    return res.status(500).json({ error: 'Failed to fetch points breakdown' });
  }
});

export default router;

