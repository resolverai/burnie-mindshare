import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('somnia_dreamathon_yapper_points')
@Index(['createdAt'])
@Index(['totalPoints'])
@Index(['projectId'])
@Index(['walletAddress', 'projectId'])
export class SomniaDreamathonYapperPoints {
  @PrimaryGeneratedColumn()
  id!: number;

  // Wallet address (required, lowercase)
  @Column({ 
    type: 'varchar', 
    length: 42,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value
    }
  })
  @Index()
  walletAddress!: string;

  // Project ID - tracks which Somnia Dreamathon project the points are associated with
  @Column({ type: 'integer', nullable: true })
  projectId: number | null = null;

  // Twitter handle (nullable)
  @Column({ type: 'varchar', length: 50, nullable: true })
  twitterHandle: string | undefined;

  // Display name from Twitter (nullable)
  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | undefined;

  // Total referrals count for this snapshot
  @Column({ type: 'integer', default: 0 })
  totalReferrals!: number;

  // Active referrals count (referrals with qualified purchases)
  @Column({ type: 'integer', default: 0 })
  activeReferrals!: number;

  // Total points calculated for this snapshot
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalPoints!: number;

  // Daily points earned on this specific day
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  dailyPointsEarned!: number;

  // === DETAILED POINT COMPONENTS (Season 2) ===
  
  // Points earned from Dreamathon content posts (100 points per post, max 300 daily per project)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  dreamathonContentPoints!: number;

  // Points earned from referral qualifications (500 points per qualified referral)
  // Qualified = new user + 3 purchases on mainnet OR 10 on Somnia testnet
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  referralPoints!: number;

  // Points earned from transaction milestones (10,000 points per 20 referral purchases)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  transactionMilestonePoints!: number;

  // Points earned from champion bonus (10,000 points for top 5 in project leaderboard)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  championBonusPoints!: number;

  // Points earned from impressions (share of 2M daily pool among top 100)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  impressionsPoints!: number;

  // === IMPRESSION DATA ===
  // Total impressions for this day (from Twitter API)
  @Column({ type: 'bigint', default: 0 })
  totalImpressions!: number;

  // === COUNTS (Incremental) ===
  // Dreamathon content posts count for this day
  @Column({ type: 'integer', default: 0 })
  dailyDreamathonPostsCount!: number;

  // New qualified referrals this day
  @Column({ type: 'integer', default: 0 })
  dailyNewQualifiedReferrals!: number;

  // Transaction milestones achieved this day
  @Column({ type: 'integer', default: 0 })
  dailyMilestoneCount!: number;

  // === REWARDS ===
  // Weekly rewards (600K distributed to Top 50 every Sunday)
  @Column({ type: 'integer', default: 0 })
  weeklyRewards!: number;

  // Grand prize rewards (1.2M to Top 10 overall at end of campaign)
  @Column({ type: 'integer', default: 0 })
  grandPrizeRewards!: number;

  // Project champion bonus (2.4M split equally among top yapper of each winning project)
  @Column({ type: 'integer', default: 0 })
  bonusChampion!: number;

  // === LEADERBOARD DATA ===
  // Weekly points accumulated for the week (Sunday to Sunday)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  weeklyPoints!: number;

  // Rank on this day for overall leaderboard
  @Column({ type: 'integer', nullable: true })
  dailyRank?: number;

  // Rank for weekly leaderboard
  @Column({ type: 'integer', default: 0 })
  weeklyRank!: number;

  // Rank within specific project leaderboard
  @Column({ type: 'integer', nullable: true })
  projectRank?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

