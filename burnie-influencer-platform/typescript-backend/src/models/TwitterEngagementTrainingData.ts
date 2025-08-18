import { 
  Entity, 
  Column, 
  PrimaryGeneratedColumn, 
  CreateDateColumn, 
  UpdateDateColumn,
  Index,
  Unique
} from 'typeorm';

@Entity('twitter_engagement_training_data')
@Index(['platform_source', 'created_at'])
@Index(['yapper_twitter_handle', 'platform_source'])
@Index(['tweet_id'])
@Unique(['tweet_id']) // Prevent duplicate training data
export class TwitterEngagementTrainingData {
  @PrimaryGeneratedColumn()
  id!: number;

  // === YAPPER IDENTIFICATION ===
  @Column({ type: 'varchar', length: 100 })
  yapper_twitter_handle!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  yapper_display_name?: string;

  @Column({ type: 'varchar', length: 50, default: 'cookie.fun' })
  platform_source!: string;

  // === TWEET DATA ===
  @Column({ type: 'varchar', length: 100 })
  tweet_id!: string;

  @Column({ type: 'text' })
  tweet_text!: string;

  @Column({ type: 'timestamp' })
  posted_at!: Date;

  // === ENGAGEMENT TARGETS (24-48h after posting) ===
  @Column({ type: 'integer', default: 0 })
  likes_count!: number;

  @Column({ type: 'integer', default: 0 })
  retweets_count!: number;

  @Column({ type: 'integer', default: 0 })
  replies_count!: number;

  @Column({ type: 'integer', default: 0 })
  quotes_count!: number;

  @Column({ type: 'integer', default: 0 })
  total_engagement!: number; // sum of above

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  engagement_rate!: number; // total_engagement / follower_count

  // === PRE-COMPUTED LLM FEATURES ===
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_content_quality?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_viral_potential?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_engagement_potential?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_originality?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_clarity?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_emotional_impact?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_call_to_action_strength?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_trending_relevance?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_humor_level?: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  llm_content_type?: string; // educational, promotional, personal, meme

  @Column({ type: 'varchar', length: 50, nullable: true })
  llm_target_audience?: string; // beginners, experts, traders, builders

  // === BASIC CONTENT FEATURES ===
  @Column({ type: 'integer' })
  char_length!: number;

  @Column({ type: 'integer' })
  word_count!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  sentiment_polarity!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  sentiment_subjectivity!: number;

  @Column({ type: 'integer' })
  hashtag_count!: number;

  @Column({ type: 'integer' })
  mention_count!: number;

  @Column({ type: 'integer' })
  url_count!: number;

  @Column({ type: 'integer' })
  emoji_count!: number;

  @Column({ type: 'integer' })
  question_count!: number;

  @Column({ type: 'integer' })
  exclamation_count!: number;

  @Column({ type: 'boolean', default: false })
  has_media!: boolean;

  @Column({ type: 'boolean', default: false })
  is_thread!: boolean;

  @Column({ type: 'boolean', default: false })
  is_reply!: boolean;

  // === YAPPER PROFILE FEATURES (at time of posting) ===
  @Column({ type: 'integer' })
  yapper_followers_count!: number;

  @Column({ type: 'integer' })
  yapper_following_count!: number;

  @Column({ type: 'integer' })
  yapper_tweet_count!: number;

  @Column({ type: 'boolean', default: false })
  yapper_verified!: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  yapper_avg_engagement_rate?: number;

  // === TEMPORAL FEATURES ===
  @Column({ type: 'integer' })
  hour_of_day!: number;

  @Column({ type: 'integer' })
  day_of_week!: number;

  @Column({ type: 'boolean', default: false })
  is_weekend!: boolean;

  @Column({ type: 'boolean', default: false })
  is_prime_social_time!: boolean;

  // === CRYPTO/WEB3 FEATURES ===
  @Column({ type: 'integer', default: 0 })
  crypto_keyword_count!: number;

  @Column({ type: 'integer', default: 0 })
  trading_keyword_count!: number;

  @Column({ type: 'integer', default: 0 })
  technical_keyword_count!: number;

  // === METADATA ===
  @Column({ type: 'varchar', length: 50, default: 'anthropic' })
  llm_provider!: string;

  @Column({ type: 'text', nullable: true })
  raw_llm_response?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
