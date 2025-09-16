import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('popular_twitter_handles')
@Index(['twitter_handle', 'posted_at'])
@Index(['twitter_handle'])
@Index(['content_category'])
export class PopularTwitterHandles {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  twitter_handle!: string; // Stored without '@'

  @Column({ type: 'varchar', length: 100, unique: true })
  tweet_id!: string;

  @Column({ type: 'text', nullable: true })
  tweet_text?: string;

  @Column({ type: 'jsonb', nullable: true })
  tweet_images?: any; // image URLs and metadata

  @Column({ type: 'boolean', default: false })
  is_thread!: boolean;

  @Column({ type: 'integer', nullable: true })
  thread_position?: number; // position in thread if applicable

  @Column({ type: 'varchar', length: 100, nullable: true })
  parent_tweet_id?: string; // if part of thread

  @Column({ type: 'jsonb', nullable: true })
  engagement_metrics?: any; // likes, retweets, replies

  @Column({ type: 'timestamp' })
  posted_at!: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  content_category?: string; // auto-classified category

  @Column({ type: 'jsonb', nullable: true })
  anthropic_analysis?: any; // Comprehensive Anthropic analysis (images + text)

  @Column({ type: 'jsonb', nullable: true })
  openai_analysis?: any; // Comprehensive OpenAI analysis (images + text) - fallback

  @CreateDateColumn()
  fetched_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}