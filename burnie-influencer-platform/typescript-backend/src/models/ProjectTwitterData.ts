import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Project } from './Project';

@Entity('project_twitter_data')
@Index(['projectId', 'createdAt']) // For efficient querying of recent posts by project
@Index(['twitterHandle', 'createdAt']) // For efficient querying by handle
@Index(['tweetId'], { unique: true }) // Ensure no duplicate tweets
export class ProjectTwitterData {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'project_id' })
  projectId!: number;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'twitter_handle', length: 100 })
  twitterHandle!: string; // @username format

  @Column({ name: 'tweet_id', length: 50 })
  tweetId!: string; // Twitter's unique tweet ID

  @Column({ name: 'conversation_id', length: 50, nullable: true })
  conversationId?: string; // For grouping threads

  @Column({ name: 'content_type', length: 20, default: 'single' })
  contentType!: string; // 'single', 'thread_start', 'thread_reply'

  @Column({ name: 'tweet_text', type: 'text' })
  tweetText!: string; // Main tweet content

  @Column({ name: 'thread_position', nullable: true })
  threadPosition?: number; // Position in thread (1 = main tweet, 2+ = replies)

  @Column({ name: 'is_thread_start', default: false })
  isThreadStart!: boolean; // True if this tweet starts a thread

  @Column({ name: 'thread_tweets', type: 'json', nullable: true })
  threadTweets?: string[]; // Array of thread tweets (only stored in thread_start record)

  @Column({ name: 'hashtags_used', type: 'json', nullable: true })
  hashtagsUsed?: string[]; // Extracted hashtags

  @Column({ name: 'engagement_metrics', type: 'json', nullable: true })
  engagementMetrics?: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  };

  @Column({ name: 'posted_at', type: 'timestamp' })
  postedAt!: Date; // When the tweet was posted on Twitter

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date; // When we fetched/stored this data

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'fetch_session_id', length: 100, nullable: true })
  fetchSessionId?: string; // To group tweets fetched in the same session

  @Column({ name: 'is_latest_batch', default: true })
  isLatestBatch!: boolean; // Mark latest fetched tweets for easy querying
} 