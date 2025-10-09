import express from 'express';
import { Repository } from 'typeorm';
import { AppDataSource } from '../config/database';
import { UserDailyPoints } from '../models/UserDailyPoints';
import { UserTiers, TierLevel } from '../models/UserTiers';
import { User } from '../models/User';
import { YapperTwitterConnection } from '../models/YapperTwitterConnection';
import { authenticateToken } from '../middleware/auth';
import { ReferralCode, LeaderTier } from '../models/ReferralCode';

const router = express.Router();

interface LeaderboardUser {
  rank: number;
  walletAddress: string;
  twitterHandle?: string;
  name?: string;
  tier: TierLevel;
  mindshare: number;
  totalReferrals: number;
  activeReferrals: number;
  totalPoints: number;
  totalRoastEarned: number;
  totalDailyRewards: number;
  totalMilestonePoints?: number; // Only for 7D and 1M periods
  profileImageUrl?: string | undefined;
  isCurrentUser?: boolean;
}

interface UserStatsResponse {
  totalPoints: number;
  totalRoastEarned: number;
  totalReferrals: number;
  activeReferrals: number;
  currentTier: TierLevel;
  mindshare: number;
  referralLink: string;
  totalDailyRewards: number;
}

interface TierProgressResponse {
  currentTier: TierLevel;
  tiers: Array<{
    name: string;
    level: TierLevel;
    requirements: string;
    isUnlocked: boolean;
    isCurrent: boolean;
  }>;
}

// Get current user's reward stats
router.get('/user-stats/:walletAddress', async (req, res) => {
  try {
    const walletAddress = req.params.walletAddress?.toLowerCase();
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const userDailyPointsRepo: Repository<UserDailyPoints> = AppDataSource.getRepository(UserDailyPoints);
    const userTiersRepo: Repository<UserTiers> = AppDataSource.getRepository(UserTiers);
    const userRepo: Repository<User> = AppDataSource.getRepository(User);

    // Get latest daily points for user
    const latestPoints = await userDailyPointsRepo.findOne({
      where: { walletAddress },
      order: { createdAt: 'DESC' }
    });

    // Get current tier from user_tiers table
    const currentTierRecord = await userTiersRepo.findOne({
      where: { walletAddress },
      order: { createdAt: 'DESC' }
    });

    // Get user's referral code for generating referral link and get tier from referral_codes table
    const user = await userRepo.findOne({ where: { walletAddress } });
    const referralCodeRepo: Repository<ReferralCode> = AppDataSource.getRepository(ReferralCode);
    const referralCode = await referralCodeRepo.findOne({
      where: { leaderWalletAddress: walletAddress }
    });

    // Use tier from user_tiers table as primary source for display consistency
    // Fall back to referral_codes table if user_tiers doesn't have a tier
    // Convert LeaderTier to TierLevel since they have the same string values
    const currentTier = currentTierRecord?.tier || (referralCode?.tier as unknown as TierLevel) || TierLevel.SILVER;

    // Calculate total daily rewards earned by this user
    const dailyRewardsQuery = `
      SELECT COALESCE(SUM("dailyRewards"), 0) as total_daily_rewards
      FROM user_daily_points
      WHERE "walletAddress" = $1
    `;
    const dailyRewardsResult = await AppDataSource.query(dailyRewardsQuery, [walletAddress]);
    const totalDailyRewards = parseInt(dailyRewardsResult[0]?.total_daily_rewards || '0');

    const response: UserStatsResponse = {
      totalPoints: latestPoints?.totalPoints || 0,
      totalRoastEarned: latestPoints?.totalRoastEarned || 0,
      totalReferrals: latestPoints?.totalReferrals || 0,
      activeReferrals: latestPoints?.activeReferrals || 0,
      currentTier: currentTier,
      mindshare: latestPoints?.mindshare || 0,
      referralLink: referralCode ? `${process.env.FRONTEND_URL || 'http://localhost:3004'}?ref=${referralCode.code}` : '',
      totalDailyRewards: totalDailyRewards
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
  return;
});

// Get user's tier progression
router.get('/tier-progress/:walletAddress', async (req, res) => {
  try {
    const walletAddress = req.params.walletAddress?.toLowerCase();
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const userTiersRepo: Repository<UserTiers> = AppDataSource.getRepository(UserTiers);
    const userDailyPointsRepo: Repository<UserDailyPoints> = AppDataSource.getRepository(UserDailyPoints);

    // Get current tier
    const currentTierRecord = await userTiersRepo.findOne({
      where: { walletAddress },
      order: { createdAt: 'DESC' }
    });

    // Get latest points for calculating progress
    const latestPoints = await userDailyPointsRepo.findOne({
      where: { walletAddress },
      order: { createdAt: 'DESC' }
    });

    const currentTier = currentTierRecord?.tier || TierLevel.SILVER;
    const userPoints = latestPoints?.totalPoints || 0;
    const userReferrals = latestPoints?.totalReferrals || 0;

    // Define tier requirements (these should match your business logic)
    const tierRequirements = [
      { name: 'Tier 1: Silver', level: TierLevel.SILVER, pointsRequired: 0, referralsRequired: 0 },
      { name: 'Tier 2: Gold', level: TierLevel.GOLD, pointsRequired: 10000, referralsRequired: 10 },
      { name: 'Tier 3: Platinum', level: TierLevel.PLATINUM, pointsRequired: 20000, referralsRequired: 20 },
      { name: 'Tier 4: Emerald', level: TierLevel.EMERALD, pointsRequired: 50000, referralsRequired: 50 },
      { name: 'Tier 5: Diamond', level: TierLevel.DIAMOND, pointsRequired: 100000, referralsRequired: 100 },
      { name: 'Tier 6: Unicorn', level: TierLevel.UNICORN, pointsRequired: 500000, referralsRequired: 500 }
    ];

    const tiers = tierRequirements.map(tier => {
      const isUnlocked = userPoints >= tier.pointsRequired || userReferrals >= tier.referralsRequired;
      const isCurrent = tier.level === currentTier;
      
      return {
        name: tier.name,
        level: tier.level,
        requirements: `${tier.referralsRequired} Referrals or ${tier.pointsRequired.toLocaleString()} points`,
        isUnlocked,
        isCurrent
      };
    });

    const response: TierProgressResponse = {
      currentTier,
      tiers
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching tier progress:', error);
    res.status(500).json({ error: 'Failed to fetch tier progress' });
  }
  return;
});

// Get leaderboard data
router.get('/leaderboard', async (req, res) => {
  try {
    const { period = 'now', limit = 50, page = 1 } = req.query;
    const currentUserWallet = req.user?.walletAddress?.toLowerCase();

    const userDailyPointsRepo: Repository<UserDailyPoints> = AppDataSource.getRepository(UserDailyPoints);
    const yapperTwitterRepo: Repository<YapperTwitterConnection> = AppDataSource.getRepository(YapperTwitterConnection);

    let dateFilter = '';
    const today = new Date();
    
    switch (period) {
      case '7d':
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 7);
        dateFilter = `AND "createdAt" >= '${sevenDaysAgo.toISOString()}'`;
        break;
      case '1m':
        const oneMonthAgo = new Date(today);
        oneMonthAgo.setMonth(today.getMonth() - 1);
        dateFilter = `AND "createdAt" >= '${oneMonthAgo.toISOString()}'`;
        break;
      case 'now':
      default:
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        dateFilter = `AND "createdAt" >= '${todayStart.toISOString()}' AND "createdAt" < '${todayEnd.toISOString()}'`;
        break;
    }

    // Aggregate points based on period, but get latest referral values
    // Include milestone points only for 7D and 1M periods
    const milestonePointsSelect = (period === '7d' || period === '1m') 
      ? ', SUM(udp."milestonePoints") as total_milestone_points' 
      : ', 0 as total_milestone_points';
    
    const aggregatedData = await userDailyPointsRepo.query(`
      WITH latest_referral_data AS (
        SELECT DISTINCT ON ("walletAddress")
          "walletAddress",
          "totalReferrals",
          "activeReferrals", 
          "totalRoastEarned"
        FROM user_daily_points
        ORDER BY "walletAddress", "createdAt" DESC
      )
      SELECT 
        udp."walletAddress" as wallet_address,
        udp."twitterHandle" as twitter_handle,
        udp.name,
        SUM(udp."dailyPointsEarned") as total_points,
        lrd."totalReferrals" as total_referrals,
        lrd."activeReferrals" as active_referrals,
        lrd."totalRoastEarned" as total_roast_earned,
        SUM(udp."dailyRewards") as total_daily_rewards,
        AVG(udp.mindshare) as avg_mindshare,
        MAX(udp."createdAt") as latest_created_at
        ${milestonePointsSelect}
      FROM user_daily_points udp
      JOIN latest_referral_data lrd ON udp."walletAddress" = lrd."walletAddress"
      WHERE 1=1 ${dateFilter}
      GROUP BY udp."walletAddress", udp."twitterHandle", udp.name, lrd."totalReferrals", lrd."activeReferrals", lrd."totalRoastEarned"
      ORDER BY total_points DESC, avg_mindshare DESC
      LIMIT ${limit} OFFSET ${((page as number) - 1) * (limit as number)}
    `);

    // Get tier information for each user
    const userTiersRepo: Repository<UserTiers> = AppDataSource.getRepository(UserTiers);
    const leaderboardUsers: LeaderboardUser[] = [];

    for (let i = 0; i < aggregatedData.length; i++) {
      const userData = aggregatedData[i];
      
      // Get latest tier
      const tierRecord = await userTiersRepo.findOne({
        where: { walletAddress: userData.wallet_address },
        order: { createdAt: 'DESC' }
      });

      // Get profile image from Twitter connections
      const twitterConnection = await yapperTwitterRepo.findOne({
        where: { twitterUsername: userData.twitter_handle }
      });

      const leaderboardUser: LeaderboardUser = {
        rank: i + 1,
        walletAddress: userData.wallet_address,
        twitterHandle: userData.twitter_handle,
        name: userData.name,
        tier: tierRecord?.tier || TierLevel.SILVER,
        mindshare: parseFloat(userData.avg_mindshare) || 0,
        totalReferrals: parseInt(userData.total_referrals) || 0,
        activeReferrals: parseInt(userData.active_referrals) || 0,
        totalPoints: parseFloat(userData.total_points) || 0,
        totalRoastEarned: parseFloat(userData.total_roast_earned) || 0,
        totalDailyRewards: parseFloat(userData.total_daily_rewards) || 0,
        profileImageUrl: twitterConnection?.profileImageUrl || undefined,
        isCurrentUser: userData.wallet_address === currentUserWallet
      };

      // Add milestone points only for 7D and 1M periods
      if (period === '7d' || period === '1m') {
        leaderboardUser.totalMilestonePoints = parseFloat(userData.total_milestone_points) || 0;
      }

      leaderboardUsers.push(leaderboardUser);
    }

    res.json({
      users: leaderboardUsers,
      pagination: {
        page: page as number,
        limit: limit as number,
        total: leaderboardUsers.length
      }
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard data' });
  }
});

// Get top 3 users for podium
router.get('/leaderboard/top-three', async (req, res) => {
  try {
    const { period = 'now' } = req.query;
    
    const userDailyPointsRepo: Repository<UserDailyPoints> = AppDataSource.getRepository(UserDailyPoints);
    const yapperTwitterRepo: Repository<YapperTwitterConnection> = AppDataSource.getRepository(YapperTwitterConnection);

    let dateFilter = '';
    const today = new Date();
    
    switch (period) {
      case '7d':
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 7);
        dateFilter = `AND "createdAt" >= '${sevenDaysAgo.toISOString()}'`;
        break;
      case '1m':
        const oneMonthAgo = new Date(today);
        oneMonthAgo.setMonth(today.getMonth() - 1);
        dateFilter = `AND "createdAt" >= '${oneMonthAgo.toISOString()}'`;
        break;
      case 'now':
      default:
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        dateFilter = `AND "createdAt" >= '${todayStart.toISOString()}' AND "createdAt" < '${todayEnd.toISOString()}'`;
        break;
    }

    // Get top 3 users with latest referral values
    // Include milestone points only for 7D and 1M periods
    const milestonePointsSelectTop3 = (period === '7d' || period === '1m') 
      ? ', SUM(udp."milestonePoints") as total_milestone_points' 
      : ', 0 as total_milestone_points';
    
    const topThreeData = await userDailyPointsRepo.query(`
      WITH latest_referral_data AS (
        SELECT DISTINCT ON ("walletAddress")
          "walletAddress",
          "totalReferrals",
          "activeReferrals", 
          "totalRoastEarned"
        FROM user_daily_points
        ORDER BY "walletAddress", "createdAt" DESC
      )
      SELECT 
        udp."walletAddress" as wallet_address,
        udp."twitterHandle" as twitter_handle,
        udp.name,
        SUM(udp."dailyPointsEarned") as total_points,
        lrd."totalReferrals" as total_referrals,
        lrd."activeReferrals" as active_referrals,
        lrd."totalRoastEarned" as total_roast_earned,
        SUM(udp."dailyRewards") as total_daily_rewards,
        AVG(udp.mindshare) as avg_mindshare
        ${milestonePointsSelectTop3}
      FROM user_daily_points udp
      JOIN latest_referral_data lrd ON udp."walletAddress" = lrd."walletAddress"
      WHERE 1=1 ${dateFilter}
      GROUP BY udp."walletAddress", udp."twitterHandle", udp.name, lrd."totalReferrals", lrd."activeReferrals", lrd."totalRoastEarned"
      ORDER BY total_points DESC, avg_mindshare DESC
      LIMIT 3
    `);

    // Get tier and profile info
    const userTiersRepo: Repository<UserTiers> = AppDataSource.getRepository(UserTiers);
    const topThree: LeaderboardUser[] = [];

    for (let i = 0; i < topThreeData.length; i++) {
      const userData = topThreeData[i];
      
      const tierRecord = await userTiersRepo.findOne({
        where: { walletAddress: userData.wallet_address },
        order: { createdAt: 'DESC' }
      });

      const twitterConnection = await yapperTwitterRepo.findOne({
        where: { twitterUsername: userData.twitter_handle }
      });

      const topThreeUser: LeaderboardUser = {
        rank: i + 1,
        walletAddress: userData.wallet_address,
        twitterHandle: userData.twitter_handle,
        name: userData.name,
        tier: tierRecord?.tier || TierLevel.SILVER,
        mindshare: parseFloat(userData.avg_mindshare) || 0,
        totalReferrals: parseInt(userData.total_referrals) || 0,
        activeReferrals: parseInt(userData.active_referrals) || 0,
        totalPoints: parseFloat(userData.total_points) || 0,
        totalRoastEarned: parseFloat(userData.total_roast_earned) || 0,
        totalDailyRewards: parseFloat(userData.total_daily_rewards) || 0,
        profileImageUrl: twitterConnection?.profileImageUrl || undefined
      };

      // Add milestone points only for 7D and 1M periods
      if (period === '7d' || period === '1m') {
        topThreeUser.totalMilestonePoints = parseFloat(userData.total_milestone_points) || 0;
      }

      topThree.push(topThreeUser);
    }

    res.json(topThree);
  } catch (error) {
    console.error('Error fetching top three:', error);
    res.status(500).json({ error: 'Failed to fetch top three users' });
  }
});

// Calculate potential monthly earnings (calculator function)
router.post('/calculate-earnings', async (req, res) => {
  try {
    const { tierLevel, referralCount, isRunningNode } = req.body;

    // Define commission rates per tier
    const commissionRates: Record<TierLevel, number> = {
      [TierLevel.SILVER]: 0.05,    // 5%
      [TierLevel.GOLD]: 0.075,     // 7.5%
      [TierLevel.PLATINUM]: 0.10,  // 10%
      [TierLevel.EMERALD]: 0.125,  // 12.5%
      [TierLevel.DIAMOND]: 0.15,   // 15%
      [TierLevel.UNICORN]: 0.20    // 20%
    };

    // Assume average monthly purchase per referral (configurable)
    const avgMonthlyPurchasePerReferral = 5; // $5 per referral per month
    
    // Base earnings calculation
    const commissionRate = commissionRates[tierLevel as TierLevel] || commissionRates[TierLevel.SILVER];
    const baseEarnings = referralCount * avgMonthlyPurchasePerReferral * commissionRate;
    
    // Node running bonus (applicable for Tier 4 and above)
    const isEligibleForNodeBonus = [TierLevel.EMERALD, TierLevel.DIAMOND, TierLevel.UNICORN].includes(tierLevel);
    const nodeBonus = (isRunningNode && isEligibleForNodeBonus) ? baseEarnings * 0.1 : 0; // 10% bonus
    
    const totalEarnings = baseEarnings + nodeBonus;

    res.json({
      baseEarnings: baseEarnings.toFixed(2),
      nodeBonus: nodeBonus.toFixed(2),
      totalEarnings: totalEarnings.toFixed(2),
      commissionRate: (commissionRate * 100).toFixed(1) + '%',
      avgPurchasePerReferral: avgMonthlyPurchasePerReferral
    });
  } catch (error) {
    console.error('Error calculating earnings:', error);
    res.status(500).json({ error: 'Failed to calculate earnings' });
  }
});

// Calculate potential monthly earnings
router.post('/calculate-potential-earnings', async (req, res) => {
  try {
    const { walletAddress, tierLevel, referralCount, isRunningNode } = req.body;

    if (!walletAddress || !tierLevel || typeof referralCount !== 'number') {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Commission rates based on tier
    const commissionRates = {
      'SILVER': 0.05,    // 5%
      'GOLD': 0.075,     // 7.5%
      'PLATINUM': 0.10,  // 10%
      'EMERALD': 0.10,   // 10%
      'DIAMOND': 0.10,   // 10%
      'UNICORN': 0.10    // 10%
    };

    const commissionRate = commissionRates[tierLevel as keyof typeof commissionRates] || 0.05;
    
    // Base calculation: referrals × $5 × commission_rate
    const baseEarnings = referralCount * 5 * commissionRate;
    
    // Node bonus (if applicable) - multiply by 5 for running node on Tier 4 and above
    const tierOrder = ['SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'UNICORN'];
    const tierIndex = tierOrder.indexOf(tierLevel);
    
    let totalEarnings = baseEarnings;
    let nodeBonus = 0;
    
    if (isRunningNode && tierIndex >= 3) { // Tier 4 (Emerald) and above
      totalEarnings = baseEarnings * 5; // Multiply by 5
      nodeBonus = totalEarnings - baseEarnings; // Calculate the bonus amount
    }

    res.json({
      baseEarnings: baseEarnings.toFixed(2),
      nodeBonus: nodeBonus.toFixed(2),
      totalEarnings: totalEarnings.toFixed(2),
      commissionRate: `${(commissionRate * 100).toFixed(1)}%`,
      calculation: {
        referrals: referralCount,
        pricePerReferral: 5,
        commissionRate: commissionRate,
        isRunningNode: isRunningNode,
        nodeBonusApplicable: tierIndex >= 3
      }
    });
  } catch (error) {
    console.error('Error calculating potential earnings:', error);
    res.status(500).json({ error: 'Failed to calculate potential earnings' });
  }
  return;
});

// Get user's current tier and approved miner status for potential earnings
router.get('/user-context/:walletAddress', async (req, res) => {
  try {
    const walletAddress = req.params.walletAddress?.toLowerCase();
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const userDailyPointsRepo: Repository<UserDailyPoints> = AppDataSource.getRepository(UserDailyPoints);
    const userTiersRepo: Repository<UserTiers> = AppDataSource.getRepository(UserTiers);
    
    // Get latest user stats
    const latestPoints = await userDailyPointsRepo.findOne({
      where: { walletAddress },
      order: { createdAt: 'DESC' }
    });

    // Get current tier
    const currentTierRecord = await userTiersRepo.findOne({
      where: { walletAddress },
      order: { createdAt: 'DESC' }
    });

    // Check if user is an approved miner
    const approvedMinerQuery = `
      SELECT COUNT(*) as count 
      FROM approved_miners 
      WHERE LOWER(wallet_address) = LOWER($1)
    `;
    const approvedMinerResult = await AppDataSource.query(approvedMinerQuery, [walletAddress]);
    const isApprovedMiner = parseInt(approvedMinerResult[0]?.count || '0') > 0;

    // Get user's tier from referral_codes table
    const referralCodeQuery = `
      SELECT tier 
      FROM referral_codes 
      WHERE LOWER("leaderWalletAddress") = LOWER($1)
    `;
    const referralCodeResult = await AppDataSource.query(referralCodeQuery, [walletAddress]);
    const userTierFromReferral = referralCodeResult[0]?.tier;

    const response = {
      currentTier: currentTierRecord?.tier || userTierFromReferral || TierLevel.SILVER,
      totalReferrals: latestPoints?.totalReferrals || 0,
      isRunningNode: isApprovedMiner,
      availableTiers: ['SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'UNICORN']
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching user context:', error);
    res.status(500).json({ error: 'Failed to fetch user context' });
  }
  return;
});

export default router;
