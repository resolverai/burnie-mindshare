import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Campaign } from './Campaign';
import { PlatformSnapshot } from './PlatformSnapshot';

export enum PlatformSource {
  COOKIE_FUN = 'cookie.fun',
  YAPS_KAITO_AI = 'yaps.kaito.ai',
  YAP_MARKET = 'yap.market',
  AMPLIFI_NOW = 'amplifi.now',
  ARBUS = 'arbus',
  TRENDSAGE_XYZ = 'trendsage.xyz',
  BANTR = 'bantr',
  BURNIE = 'burnie'
}

export enum TwitterFetchStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  RATE_LIMITED = 'rate_limited'
}

@Entity('leaderboard_yapper_data')
@Index(['twitterHandle', 'campaignId', 'platformSource'])
@Index(['snapshotId', 'leaderboardPosition'])
@Index(['createdAt'])
@Index(['twitterHandle', 'snapshotDate', 'platformSource'])
@Index(['twitterFetchStatus', 'priority', 'createdAt']) // For queue processing
@Unique(['twitterHandle', 'campaignId', 'platformSource', 'snapshotDate'])
export class LeaderboardYapperData {
  @PrimaryGeneratedColumn()
  id!: number;

  // === CORE YAPPER INFORMATION ===
  @Column({ type: 'varchar', length: 100 })
  twitterHandle!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  displayName?: string;

  // === CAMPAIGN & PLATFORM ASSOCIATION ===
  @Column({ type: 'integer' })
  campaignId!: number;

  @ManyToOne(() => Campaign, { nullable: false })
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  @Column({ type: 'integer' })
  snapshotId!: number;

  @ManyToOne(() => PlatformSnapshot, { nullable: false })
  @JoinColumn({ name: 'snapshotId' })
  snapshot!: PlatformSnapshot;

  @Column({ 
    type: 'enum', 
    enum: PlatformSource,
    default: PlatformSource.COOKIE_FUN 
  })
  platformSource!: PlatformSource;

  @Column({ type: 'date' })
  snapshotDate!: Date; // Date when this snapshot was taken

  // === LEADERBOARD DATA ===
  @Column({ type: 'integer' })
  leaderboardPosition!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  totalSnaps?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  snaps24h?: number;

  @Column({ type: 'integer', nullable: true })
  smartFollowers?: number;

  @Column({ type: 'jsonb', nullable: true })
  leaderboardData?: any; // Full leaderboard entry data

  // === TWITTER FETCH QUEUE MANAGEMENT ===
  @Column({ 
    type: 'enum', 
    enum: TwitterFetchStatus,
    default: TwitterFetchStatus.PENDING 
  })
  twitterFetchStatus!: TwitterFetchStatus;

  @Column({ type: 'integer', default: 5 })
  priority!: number; // Higher number = higher priority (1-10)

  @Column({ type: 'integer', default: 0 })
  retryCount!: number;

  @Column({ type: 'integer', default: 3 })
  maxRetries!: number;

  @Column({ type: 'timestamp', nullable: true })
  scheduledAt?: Date; // When to process this item (for rate limiting)

  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date; // When it was actually processed

  @Column({ type: 'text', nullable: true })
  fetchErrorLog?: string;

  // Metadata for deduplication
  @Column({ type: 'boolean', default: false })
  isDataDuplicated!: boolean; // True if data was copied from existing record

  @Column({ type: 'integer', nullable: true })
  sourceDuplicateRecordId?: number; // ID of the record data was copied from

  // === TWITTER DATA ===
  @Column({ type: 'jsonb', nullable: true })
  twitterProfile?: any; // Profile information

  @Column({ type: 'jsonb', nullable: true })
  recentTweets?: any; // Last 20 tweets

  @Column({ type: 'text', array: true, nullable: true })
  tweetImageUrls?: string[]; // Array of image URLs from tweets

  @Column({ type: 'jsonb', nullable: true })
  anthropic_analysis?: any; // Comprehensive Anthropic analysis (images + text)

  @Column({ type: 'jsonb', nullable: true })
  openai_analysis?: any; // Comprehensive OpenAI analysis (images + text) - fallback

  @Column({ type: 'integer', nullable: true })
  followersCount?: number;

  @Column({ type: 'integer', nullable: true })
  followingCount?: number;

  @Column({ type: 'integer', nullable: true })
  tweetsCount?: number;

  @Column({ type: 'timestamp', nullable: true })
  lastTwitterFetch?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // === QUEUE MANAGEMENT HELPER METHODS ===
  canProcess(): boolean {
    return this.twitterFetchStatus === TwitterFetchStatus.PENDING && 
           this.retryCount < this.maxRetries &&
           (!this.scheduledAt || this.scheduledAt <= new Date());
  }

  needsRetry(): boolean {
    return (this.twitterFetchStatus === TwitterFetchStatus.FAILED || 
            this.twitterFetchStatus === TwitterFetchStatus.RATE_LIMITED) &&
           this.retryCount < this.maxRetries;
  }

  markAsInProgress(): void {
    this.twitterFetchStatus = TwitterFetchStatus.IN_PROGRESS;
    this.processedAt = new Date();
  }

  markAsCompleted(): void {
    this.twitterFetchStatus = TwitterFetchStatus.COMPLETED;
    this.processedAt = new Date();
  }

  markAsFailed(error: string): void {
    this.twitterFetchStatus = TwitterFetchStatus.FAILED;
    this.fetchErrorLog = error;
    this.retryCount += 1;
    this.processedAt = new Date();
    
    // Schedule retry with exponential backoff
    if (this.retryCount < this.maxRetries) {
      const backoffMinutes = Math.pow(2, this.retryCount) * 5; // 5, 10, 20 minutes
      this.scheduledAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      this.twitterFetchStatus = TwitterFetchStatus.PENDING;
    }
  }

  markAsRateLimited(): void {
    this.twitterFetchStatus = TwitterFetchStatus.RATE_LIMITED;
    this.retryCount += 1;
    this.processedAt = new Date();
    
    // Schedule retry after 15 minutes (typical Twitter rate limit window)
    this.scheduledAt = new Date(Date.now() + 15 * 60 * 1000);
    if (this.retryCount < this.maxRetries) {
      this.twitterFetchStatus = TwitterFetchStatus.PENDING;
    }
  }

  markAsSkipped(reason: string, sourceRecordId?: number): void {
    this.twitterFetchStatus = TwitterFetchStatus.SKIPPED;
    this.fetchErrorLog = reason;
    this.processedAt = new Date();
    
    if (sourceRecordId) {
      this.isDataDuplicated = true;
      this.sourceDuplicateRecordId = sourceRecordId;
    }
  }

  // === TWITTER DATA HELPER METHODS ===
  hasTwitterData(): boolean {
    return this.twitterFetchStatus === TwitterFetchStatus.COMPLETED && !!this.recentTweets;
  }

  getTweetCount(): number {
    return this.recentTweets?.length || 0;
  }

  getImageCount(): number {
    return this.tweetImageUrls?.length || 0;
  }

  needsTwitterRefresh(): boolean {
    if (!this.lastTwitterFetch) return true;
    
    const now = new Date();
    const daysSinceLastFetch = (now.getTime() - this.lastTwitterFetch.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceLastFetch > 1; // Refresh if older than 1 day
  }

  getEngagementRate(): number {
    if (!this.recentTweets || !this.followersCount) return 0;
    
    const totalEngagement = this.recentTweets.reduce((sum: number, tweet: any) => {
      return sum + (tweet.likes || 0) + (tweet.retweets || 0) + (tweet.replies || 0);
    }, 0);
    
    return totalEngagement / (this.recentTweets.length * this.followersCount) * 100;
  }

  getQueuePosition(): string {
    return `${this.platformSource}-${this.campaignId}-${this.twitterHandle}-${this.snapshotDate}`;
  }

  calculateNextProcessTime(currentProcessingCount: number): Date {
    // 1 minute cooling period between API calls
    const cooldownMs = 60 * 1000; // 1 minute
    return new Date(Date.now() + (currentProcessingCount * cooldownMs));
  }
}
