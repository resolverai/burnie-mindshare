import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum TierLevel {
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  EMERALD = 'EMERALD',
  DIAMOND = 'DIAMOND',
  UNICORN = 'UNICORN'
}

@Entity('user_tiers')
@Index(['walletAddress', 'createdAt'])
@Index(['createdAt'])
@Index(['tier'])
export class UserTiers {
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
  walletAddress!: string;

  // Twitter handle (nullable)
  @Column({ type: 'varchar', length: 50, nullable: true })
  twitterHandle: string | undefined;

  // Display name from Twitter (nullable)
  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | undefined;

  // User's tier level
  @Column({
    type: 'enum',
    enum: TierLevel,
    default: TierLevel.SILVER
  })
  tier!: TierLevel;

  // Previous tier (for tracking tier progression)
  @Column({
    type: 'enum',
    enum: TierLevel,
    nullable: true
  })
  previousTier?: TierLevel;

  // Points/referrals when tier was achieved (for tracking progress)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  pointsAtTierChange!: number;

  @Column({ type: 'integer', default: 0 })
  referralsAtTierChange!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
