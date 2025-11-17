import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('somnia_dreamathon_miner_points')
@Index(['createdAt'])
@Index(['projectId'])
@Index(['walletAddress', 'projectId'])
export class SomniaDreamathonMinerPoints {
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

  // Project ID - tracks which Somnia Dreamathon project the content is for
  @Column({ type: 'integer', nullable: true })
  projectId: number | null = null;

  // Display name (nullable)
  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | undefined;

  // === DAILY METRICS ===
  
  // Node uptime percentage for this day (0-100)
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  dailyUptimePercentage!: number;

  // Number of content pieces generated this day
  @Column({ type: 'integer', default: 0 })
  dailyContentGenerated!: number;

  // Number of content pieces sold this day
  @Column({ type: 'integer', default: 0 })
  dailyContentSold!: number;

  // Total sales revenue this day (in $ROAST)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  dailySalesRevenue!: number;

  // Revenue share earned this day (70% of sales)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  dailyRevenueShare!: number;

  // === REWARDS ===
  
  // Weekly uptime rewards (450K distributed equally among qualifying nodes)
  @Column({ type: 'integer', default: 0 })
  weeklyUptimeRewards!: number;

  // Weekly top seller bonus (600K distributed to Top 5)
  @Column({ type: 'integer', default: 0 })
  weeklyTopSellerBonus!: number;

  // Grand prize rewards (1.65M to Top 5 overall at end of campaign)
  @Column({ type: 'integer', default: 0 })
  grandPrizeRewards!: number;

  // === LEADERBOARD DATA ===
  
  // Rank for daily sales
  @Column({ type: 'integer', nullable: true })
  dailySalesRank?: number;

  // Rank for weekly top sellers
  @Column({ type: 'integer', default: 0 })
  weeklyTopSellerRank!: number;

  // Overall rank (based on total sales + uptime)
  @Column({ type: 'integer', nullable: true })
  overallRank?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

