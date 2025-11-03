import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from './Project';
import { Web3PostsSchedule } from './Web3PostsSchedule';

export type PostType = 'shitpost' | 'longpost' | 'thread';

@Entity('web3_project_twitter_posts')
@Index(['projectId', 'postedAt'])
@Index(['mainTweetId'])
export class Web3ProjectTwitterPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  projectId!: number;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  @Column({ type: 'int', nullable: true })
  scheduleId!: number | null; // FK to web3_posts_schedule, or -1 if using global schedule

  @ManyToOne(() => Web3PostsSchedule, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'scheduleId' })
  schedule?: Web3PostsSchedule | null;

  @Column({ type: 'varchar', length: 20 })
  postType!: PostType;

  @Column({ type: 'text' })
  mainTweet!: string;

  @Column({ type: 'varchar', length: 50 })
  mainTweetId!: string;

  @Column({ type: 'jsonb', nullable: true })
  tweetThread?: string[];

  @Column({ type: 'text', nullable: true })
  imageUrl?: string | null;

  @Column({ type: 'text', nullable: true })
  videoUrl?: string | null;

  @Column({ type: 'text', nullable: true })
  twitterMediaId?: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  engagementMetrics!: Record<string, {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    views?: number;
    last_updated: string;
  }>;

  @Column({ type: 'timestamp' })
  postedAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  threadTweetIds?: string[];

  @Column({ type: 'integer', default: 1 })
  threadCount!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastEngagementFetch?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper methods
  public isThread(): boolean {
    return this.postType === 'thread' && (this.tweetThread?.length || 0) > 0;
  }

  public getTotalTweets(): number {
    return this.threadCount;
  }

  public hasEngagementData(): boolean {
    return Object.keys(this.engagementMetrics).length > 0;
  }

  public needsEngagementUpdate(): boolean {
    if (!this.lastEngagementFetch) return true;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return this.lastEngagementFetch < oneHourAgo;
  }

  public getTotalEngagement(): {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    views: number;
  } {
    const total = {
      likes: 0,
      retweets: 0,
      replies: 0,
      quotes: 0,
      views: 0,
    };

    Object.values(this.engagementMetrics).forEach(metrics => {
      total.likes += metrics.likes || 0;
      total.retweets += metrics.retweets || 0;
      total.replies += metrics.replies || 0;
      total.quotes += metrics.quotes || 0;
      total.views += metrics.views || 0;
    });

    return total;
  }
}

