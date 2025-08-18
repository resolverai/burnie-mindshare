import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './User';

@Entity('twitter_learning_data')
@Index(['userId', 'processedAt'])
@Unique(['tweetId'])
export class TwitterLearningData {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'integer', nullable: true })
  agentId?: number;

  @Column({ type: 'varchar', length: 50 })
  tweetId!: string;

  @Column({ type: 'text', nullable: true })
  tweetText?: string;

  @Column({ type: 'jsonb', nullable: true })
  engagementMetrics?: any;

  @Column({ type: 'timestamp', nullable: true })
  postingTime?: Date;

  @Column({ type: 'jsonb', nullable: true })
  analyzedFeatures?: any;

  @Column({ type: 'jsonb', nullable: true })
  learningInsights?: any;

  @Column({ type: 'varchar', length: 100, nullable: true })
  analysisType?: string;

  @Column({ type: 'integer', nullable: true })
  confidence?: number;

  @Column({ type: 'jsonb', nullable: true })
  insights?: any;

  // New columns for enhanced ML intelligence
  @Column({ type: 'jsonb', nullable: true })
  tweet_images?: any; // array of image URLs and metadata

  @Column({ type: 'boolean', default: false })
  is_thread?: boolean; // whether this tweet is part of a thread

  @Column({ type: 'integer', nullable: true })
  thread_position?: number; // position within thread if applicable

  @Column({ type: 'varchar', length: 50, nullable: true })
  parent_tweet_id?: string; // parent tweet ID if part of thread

  @Column({ type: 'jsonb', nullable: true })
  raw_tweet_data?: any; // complete raw tweet data from Twitter API

  @Column({ type: 'jsonb', nullable: true })
  anthropic_analysis?: any; // Comprehensive Anthropic analysis (images + text)

  @Column({ type: 'jsonb', nullable: true })
  openai_analysis?: any; // Comprehensive OpenAI analysis (images + text) - fallback

  // Relations
  @ManyToOne(() => User, user => user.id)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @CreateDateColumn()
  processedAt!: Date;

  // Helper methods
  getEngagementMetrics(): any {
    return this.engagementMetrics || {};
  }

  getEngagementRate(): number {
    const metrics = this.getEngagementMetrics();
    const impressions = metrics.impressions || 0;
    const totalEngagements = (metrics.likes || 0) + (metrics.retweets || 0) + (metrics.replies || 0);
    
    return impressions > 0 ? (totalEngagements / impressions) * 100 : 0;
  }

  getLearningInsights(): any {
    return this.learningInsights || {};
  }

  addLearningInsight(key: string, value: any): void {
    if (!this.learningInsights) {
      this.learningInsights = {};
    }
    this.learningInsights[key] = value;
  }

  getAnalyzedFeatures(): any {
    return this.analyzedFeatures || {};
  }

  addAnalyzedFeature(feature: string, value: any): void {
    if (!this.analyzedFeatures) {
      this.analyzedFeatures = {};
    }
    this.analyzedFeatures[feature] = value;
  }

  isHighPerformance(threshold: number = 2.0): boolean {
    return this.getEngagementRate() >= threshold;
  }

  getContentLength(): number {
    return this.tweetText?.length || 0;
  }

  hasHashtags(): boolean {
    return !!(this.tweetText && this.tweetText.includes('#'));
  }

  hasMentions(): boolean {
    return !!(this.tweetText && this.tweetText.includes('@'));
  }

  hasMedia(): boolean {
    const features = this.getAnalyzedFeatures();
    return features.hasImages || features.hasVideo || false;
  }

  getTweetAge(): number {
    if (!this.postingTime) return 0;
    return Date.now() - this.postingTime.getTime();
  }

  getProcessingAge(): number {
    return Date.now() - this.processedAt.getTime();
  }

  extractContentFeatures(): any {
    const text = this.tweetText || '';
    const engagement = this.getEngagementMetrics();
    
    return {
      textLength: text.length,
      wordCount: text.split(/\s+/).length,
      hashtagCount: (text.match(/#\w+/g) || []).length,
      mentionCount: (text.match(/@\w+/g) || []).length,
      urlCount: (text.match(/https?:\/\/\S+/g) || []).length,
      hasEmojis: /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/u.test(text),
      engagementRate: this.getEngagementRate(),
      totalLikes: engagement.likes || 0,
      totalRetweets: engagement.retweets || 0,
      totalReplies: engagement.replies || 0,
      postingHour: this.postingTime ? this.postingTime.getHours() : null,
      dayOfWeek: this.postingTime ? this.postingTime.getDay() : null,
    };
  }
} 