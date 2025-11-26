import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_twitter_posts' })
export class DvybTwitterPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'int', nullable: true })
  generatedContentId!: number | null;

  @Column({ type: 'int', nullable: true })
  scheduleId!: number | null;

  @Column({ type: 'varchar', length: 20 })
  postType!: 'thread' | 'single' | 'quote' | 'reply';

  @Column({ type: 'text' })
  mainTweet!: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  mainTweetId!: string;

  @Column({ type: 'jsonb', nullable: true })
  tweetThread!: any | null;

  @Column({ type: 'jsonb', nullable: true })
  threadTweetIds!: any | null;

  @Column({ type: 'text', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  videoUrl!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  twitterMediaIds!: any | null;

  @Column({ type: 'jsonb', default: '{}' })
  engagementMetrics!: {
    likes?: number;
    retweets?: number;
    replies?: number;
    quotes?: number;
    views?: number;
    impressions?: number;
  };

  @Column({ type: 'timestamp', nullable: true })
  lastEngagementFetch!: Date | null;

  @Index()
  @Column({ type: 'timestamp' })
  postedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

