import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('mindshare_training_data')
@Index(['platformSource', 'scrapedAt'])
@Unique(['platformSource', 'contentHash'])
export class MindshareTrainingData {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  platformSource!: string; // 'cookie.fun', 'yaps.kaito.ai', etc.

  @Column({ type: 'varchar', length: 64 })
  contentHash!: string; // Unique hash of content

  @Column({ type: 'text', nullable: true })
  contentText?: string;

  @Column({ type: 'jsonb', nullable: true })
  contentImages?: any;

  @Column({ type: 'jsonb', nullable: true })
  engagementMetrics?: any;

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  mindshareScore?: number;

  @Column({ type: 'timestamp', nullable: true })
  timestampPosted?: Date;

  @Column({ type: 'jsonb', nullable: true })
  campaignContext?: any;

  @CreateDateColumn()
  scrapedAt!: Date;

  // Helper methods
  getEngagementMetrics(): any {
    return this.engagementMetrics || {};
  }

  getMindshareScore(): number {
    return Number(this.mindshareScore) || 0;
  }

  addCampaignContext(context: any): void {
    this.campaignContext = { ...this.campaignContext, ...context };
  }

  hasHighMindshare(threshold: number = 80): boolean {
    return this.getMindshareScore() >= threshold;
  }

  getContentFeatures(): any {
    const features = {
      textLength: this.contentText?.length || 0,
      hasImages: !!(this.contentImages && Object.keys(this.contentImages).length > 0),
      engagementRate: this.engagementMetrics?.engagementRate || 0,
      mindshareScore: this.getMindshareScore(),
      platform: this.platformSource,
      timePosted: this.timestampPosted,
    };

    return features;
  }
} 