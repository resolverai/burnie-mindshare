import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('twitter_handle_metadata')
@Index(['twitter_handle'], { unique: true })
@Index(['status', 'priority'])
export class TwitterHandleMetadata {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  twitter_handle!: string; // stored without '@'

  @Column({ type: 'varchar', length: 200, nullable: true })
  display_name?: string;

  @Column({ type: 'integer', default: 0 })
  followers_count!: number;

  @Column({ type: 'integer', default: 0 })
  following_count!: number;

  @Column({ type: 'integer', default: 0 })
  tweet_count!: number;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ type: 'text', nullable: true })
  profile_image_url?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  last_tweet_id?: string; // For incremental updates

  @Column({ type: 'timestamp', nullable: true })
  last_fetch_at?: Date;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string; // pending, active, suspended, error, processing

  @Column({ type: 'text', nullable: true })
  error_message?: string;

  @Column({ type: 'integer', default: 0 })
  fetch_count!: number;

  @Column({ type: 'integer', default: 5 })
  priority!: number; // 1-10, higher number = higher priority

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
