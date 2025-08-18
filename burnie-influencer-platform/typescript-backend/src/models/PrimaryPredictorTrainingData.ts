import { 
  Entity, 
  Column, 
  PrimaryGeneratedColumn, 
  CreateDateColumn, 
  UpdateDateColumn,
  Index,
  Unique
} from 'typeorm';

@Entity('primary_predictor_training_data')
@Index(['platform_source', 'created_at'])
@Index(['yapper_twitter_handle', 'platform_source'])
@Index(['leaderboard_position_before', 'platform_source'])
@Index(['training_status', 'platform_source'])
@Unique(['tweet_id']) // Prevent duplicate training data
export class PrimaryPredictorTrainingData {
  @PrimaryGeneratedColumn()
  id!: number;

  // === YAPPER IDENTIFICATION ===
  @Column({ type: 'varchar', length: 100 })
  yapper_twitter_handle!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  yapper_display_name?: string;

  @Column({ type: 'varchar', length: 50, default: 'cookie.fun' })
  platform_source!: string; // cookie.fun, kaito, etc.

  // === CONTENT DATA ===
  @Column({ type: 'text' })
  content_text!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  tweet_id?: string;

  @Column({ type: 'timestamp', nullable: true })
  posted_at?: Date;

  // === PRE-LEADERBOARD STATE ===
  @Column({ type: 'integer', nullable: true })
  leaderboard_position_before?: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  total_snaps_before?: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  snaps_24h_before?: number;

  @Column({ type: 'integer', nullable: true })
  smart_followers_before?: number;

  // === POST-LEADERBOARD STATE (24-48h later) ===
  @Column({ type: 'integer', nullable: true })
  leaderboard_position_after?: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  total_snaps_after?: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  snaps_24h_after?: number;

  @Column({ type: 'integer', nullable: true })
  smart_followers_after?: number;

  // === DELTA TARGETS (WHAT WE PREDICT) ===
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  delta_snaps?: number; // snaps_after - snaps_before

  @Column({ type: 'integer', nullable: true })
  position_change?: number; // position_before - position_after (positive = climb up)

  // === PRE-COMPUTED LLM FEATURES ===
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_content_quality?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_viral_potential?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_engagement_potential?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_originality?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_clarity?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_emotional_impact?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_trending_relevance?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_technical_depth?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_humor_level?: number; // 0-10

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_controversy_level?: number; // 0-10

  @Column({ type: 'varchar', length: 50, nullable: true })
  llm_category_classification?: string; // gaming, defi, nft, meme, education

  @Column({ type: 'varchar', length: 50, nullable: true })
  llm_sentiment_classification?: string; // bullish, bearish, neutral

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_crypto_relevance?: number; // 0-10

  // === LLM PREDICTION SCORES ===
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_predicted_snap_impact?: number; // 0-10 LLM's SNAP earning prediction

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_predicted_position_impact?: number; // 0-10 LLM's position change prediction

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  llm_predicted_twitter_engagement?: number; // 0-10 LLM's Twitter engagement prediction

  // === LLM CONTENT CLASSIFICATIONS ===
  @Column({ type: 'varchar', length: 50, nullable: true })
  llm_content_type?: string; // educational, promotional, personal, meme, news, analysis

  @Column({ type: 'varchar', length: 50, nullable: true })
  llm_target_audience?: string; // beginners, experts, traders, builders, general

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
  question_count!: number;

  @Column({ type: 'integer' })
  exclamation_count!: number;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  uppercase_ratio!: number;

  @Column({ type: 'integer' })
  emoji_count!: number;

  // === YAPPER PROFILE FEATURES ===
  @Column({ type: 'integer', nullable: true })
  yapper_followers_count?: number;

  @Column({ type: 'integer', nullable: true })
  yapper_following_count?: number;

  @Column({ type: 'integer', nullable: true })
  yapper_tweet_count?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  yapper_engagement_rate?: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  yapper_mindshare_percent?: number;

  // === TEMPORAL FEATURES ===
  @Column({ type: 'integer' })
  hour_of_day!: number;

  @Column({ type: 'integer' })
  day_of_week!: number; // 0=Monday, 6=Sunday

  @Column({ type: 'boolean', default: false })
  is_weekend!: boolean;

  @Column({ type: 'boolean', default: false })
  is_prime_social_time!: boolean; // 12-13, 19-21

  // === CAMPAIGN CONTEXT ===
  @Column({ type: 'integer', nullable: true })
  campaign_id?: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  campaign_reward_pool?: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  campaign_category?: string;

  @Column({ type: 'integer', nullable: true })
  competition_level?: number; // estimated number of active participants

  // === CRYPTO/WEB3 FEATURES ===
  @Column({ type: 'integer', default: 0 })
  crypto_keyword_count!: number; // Crypto-related keywords

  @Column({ type: 'integer', default: 0 })
  trading_keyword_count!: number; // Trading-related keywords

  @Column({ type: 'integer', default: 0 })
  technical_keyword_count!: number; // Technical analysis keywords

  // === ADDITIONAL CONTENT FEATURES ===
  @Column({ type: 'integer', default: 0 })
  url_count!: number; // Number of URLs in content

  // === METADATA ===
  @Column({ type: 'varchar', length: 50, default: 'anthropic' })
  llm_provider!: string; // anthropic or openai

  @Column({ type: 'text', nullable: true })
  raw_llm_response?: string; // for debugging

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  training_status!: string; // pending, completed, error

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
