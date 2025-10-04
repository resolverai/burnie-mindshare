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
import { User } from './User';
import { ContentMarketplace } from './ContentMarketplace';

export type PostType = 'shitpost' | 'longpost' | 'thread';
export type PlatformSource = 'PurchaseContentModal' | 'TweetPreviewModal' | 'YapperDashboard' | 'other';

@Entity('user_twitter_posts')
@Index(['walletAddress'])
@Index(['postedAt'])
@Index(['mainTweetId'])
export class UserTwitterPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ 
    name: 'wallet_address', 
    length: 255,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value
    }
  })
  walletAddress!: string;

  @Column({ 
    type: 'varchar', 
    length: 20, 
    name: 'post_type' 
  })
  postType!: PostType;

  @Column({ 
    type: 'text', 
    name: 'main_tweet' 
  })
  mainTweet!: string;

  @Column({ 
    name: 'main_tweet_id', 
    length: 50 
  })
  mainTweetId!: string;

  @Column({ 
    type: 'jsonb', 
    name: 'tweet_thread',
    nullable: true 
  })
  tweetThread?: string[];

  @Column({ 
    type: 'text', 
    name: 'image_url',
    nullable: true 
  })
  imageUrl?: string | null;

  @Column({ 
    type: 'text', 
    name: 'video_url',
    nullable: true 
  })
  videoUrl?: string | null;

  @Column({ 
    type: 'jsonb', 
    name: 'engagement_metrics',
    default: '{}' 
  })
  engagementMetrics!: Record<string, {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    views?: number;
    last_updated: string;
  }>;

  @Column({ 
    type: 'timestamp', 
    name: 'posted_at' 
  })
  postedAt!: Date;

  @Column({ 
    type: 'integer', 
    name: 'content_id',
    nullable: true 
  })
  contentId?: number | null;

  @Column({ 
    type: 'varchar', 
    length: 50, 
    name: 'platform_source',
    default: 'other' 
  })
  platformSource!: PlatformSource;

  @Column({ 
    type: 'jsonb', 
    name: 'thread_tweet_ids',
    nullable: true 
  })
  threadTweetIds?: string[];

  @Column({ 
    type: 'text', 
    name: 'twitter_media_id',
    nullable: true 
  })
  twitterMediaId?: string | null;

  @Column({ 
    type: 'integer', 
    name: 'thread_count',
    default: 1 
  })
  threadCount!: number;

  @Column({ 
    type: 'timestamp', 
    name: 'last_engagement_fetch',
    nullable: true 
  })
  lastEngagementFetch?: Date | null;

  // Relations
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'wallet_address', referencedColumnName: 'walletAddress' })
  user?: User;

  @ManyToOne(() => ContentMarketplace, { nullable: true })
  @JoinColumn({ name: 'content_id' })
  content?: ContentMarketplace;

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
    
    // Update if last fetch was more than 1 hour ago
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
      views: 0
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
