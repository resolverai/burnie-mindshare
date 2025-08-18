import { 
  Entity, 
  Column, 
  PrimaryGeneratedColumn, 
  CreateDateColumn, 
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
import { Campaign } from './Campaign';

@Entity('campaign_mindshare_data')
@Index(['campaignId', 'snapshotDate'], { unique: true }) // One record per campaign per day
export class CampaignMindshareData {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('integer')
  @Index()
  campaignId!: number;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  @Column('varchar', { length: 50, default: 'cookie.fun' })
  @Index()
  platformSource!: string;

  @Column('date')
  @Index()
  snapshotDate!: Date;

  // Project Mindshare Metrics
  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  mindsharePercentage!: number | null;

  @Column('integer', { nullable: true })
  totalSnaps!: number | null;

  @Column('integer', { nullable: true })
  activeParticipants!: number | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  growth24h!: number | null;

  // Market Sentiment
  @Column('decimal', { precision: 3, scale: 2, nullable: true })
  sentimentScore!: number | null;

  @Column('varchar', { length: 50, nullable: true })
  sentimentLabel!: string | null;

  @Column('varchar', { length: 100, nullable: true })
  communityMood!: string | null;

  @Column('json', { nullable: true })
  socialSignals!: string[] | null;

  // Trending & Engagement
  @Column('json', { nullable: true })
  trendingTopics!: string[] | null;

  @Column('json', { nullable: true })
  engagementSignals!: string[] | null;

  // Data Quality & Metadata
  @Column('decimal', { precision: 3, scale: 2, default: 0.0 })
  extractionConfidence!: number;

  @Column('varchar', { length: 20, default: 'medium' })
  dataQuality!: string;

  @Column('integer', { default: 1 })
  screenshotsAnalyzed!: number;

  @Column('varchar', { length: 50, nullable: true })
  llmProvider!: string | null;

  @Column('varchar', { length: 20, default: 'completed' })
  processingStatus!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
