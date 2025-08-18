import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('platform_yapper_twitter_profiles')
@Index(['yapper_id'], { unique: true })
@Index(['twitter_handle'])
export class PlatformYapperTwitterProfile {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', unique: true })
  yapper_id!: number;

  // Note: No direct User import to avoid circular dependencies
  // yapper_id references users table

  @Column({ type: 'varchar', length: 100 })
  twitter_handle!: string;

  @Column({ type: 'integer', default: 0 })
  followers_count!: number;

  @Column({ type: 'integer', default: 0 })
  following_count!: number;

  @Column({ type: 'integer', default: 0 })
  tweet_count!: number;

  @Column({ type: 'timestamp', nullable: true })
  account_created_at?: Date;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  engagement_rate!: number;

  @Column({ type: 'jsonb', nullable: true })
  optimal_posting_times?: any;

  @Column({ type: 'jsonb', nullable: true })
  content_style_analysis?: any;

  @Column({ type: 'jsonb', nullable: true })
  performance_patterns?: any;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  last_updated!: Date;
}
