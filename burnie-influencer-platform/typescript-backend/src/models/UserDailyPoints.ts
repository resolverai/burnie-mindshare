import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_daily_points')
@Index(['createdAt'])
@Index(['totalPoints'])
export class UserDailyPoints {
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

  // Twitter handle (nullable)
  @Column({ type: 'varchar', length: 50, nullable: true })
  twitterHandle: string | undefined;

  // Display name from Twitter (nullable)
  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | undefined;

  // Total referrals count for this snapshot
  @Column({ type: 'integer', default: 0 })
  totalReferrals!: number;

  // Active referrals count (referrals with 2+ transactions)
  @Column({ type: 'integer', default: 0 })
  activeReferrals!: number;

  @Column({ type: 'integer', default: 0 })
  dailyRewards!: number;

  // Weekly rewards distributed to users (separate from daily rewards)
  @Column({ type: 'integer', default: 0 })
  weeklyRewards!: number;

  // Total transaction value from referrals (cumulative)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalReferralTransactionsValue!: number;

  // Total ROAST earned so far (cumulative)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalRoastEarned!: number;

  // Mindshare percentage for this snapshot (up to 6 decimal places: 0.123456 = 12.3456%)
  @Column({ type: 'decimal', precision: 8, scale: 6, default: 0 })
  mindshare!: number;

  // Total points calculated for this snapshot
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalPoints!: number;

  // Daily points earned on this specific day (difference from previous day)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  dailyPointsEarned!: number;

  // === DETAILED POINT COMPONENTS ===
  // Points earned from purchases (100 points per purchase with purchase_price > 0)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  purchasePoints!: number;

  // Points earned from milestone achievements (10,000 points per 20 direct referral purchases)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  milestonePoints!: number;

  // Points earned from referral qualifications (1,000 points per qualified referral)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  referralPoints!: number;

  // Points earned from mindshare distribution (daily allocation from 25,000 pool)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  mindsharePoints!: number;

  // Purchase count for this day (incremental)
  @Column({ type: 'integer', default: 0 })
  dailyPurchaseCount!: number;

  // Milestone count achieved this day (incremental)
  @Column({ type: 'integer', default: 0 })
  dailyMilestoneCount!: number;

  // New qualified referrals this day (incremental)
  @Column({ type: 'integer', default: 0 })
  dailyNewQualifiedReferrals!: number;

  // Rank on this day (for faster leaderboard queries)
  @Column({ type: 'integer', nullable: true })
  dailyRank?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
