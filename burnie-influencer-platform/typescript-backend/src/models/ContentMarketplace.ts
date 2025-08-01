import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { User } from './User';
import { Campaign } from './Campaign';

@Entity('content_marketplace')
@Index(['isAvailable', 'predictedMindshare'])
@Index(['creatorId'])
@Index(['campaignId'])
export class ContentMarketplace {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  creatorId!: number;

  @Column({ type: 'integer' })
  campaignId!: number;

  @Column({ type: 'text' })
  contentText!: string;

  @Column({ type: 'jsonb', nullable: true })
  contentImages?: any;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  predictedMindshare!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  qualityScore!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  askingPrice!: number;

  @Column({ type: 'boolean', default: true })
  isAvailable!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  generationMetadata?: any;

  // Relations
  @ManyToOne(() => User, user => user.id)
  @JoinColumn({ name: 'creatorId' })
  creator!: User;

  @ManyToOne(() => Campaign, campaign => campaign.id)
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  @CreateDateColumn()
  createdAt!: Date;

  // Helper methods
  getPredictedMindshare(): number {
    return Number(this.predictedMindshare);
  }

  getQualityScore(): number {
    return Number(this.qualityScore);
  }

  getAskingPrice(): number {
    return Number(this.askingPrice);
  }

  getPerformanceScore(): number {
    // Combine mindshare and quality for overall performance score
    return (this.getPredictedMindshare() * 0.6) + (this.getQualityScore() * 4); // Scale quality to 40
  }

  isHighQuality(threshold: number = 85): boolean {
    return this.getQualityScore() >= threshold;
  }

  isHighMindshare(threshold: number = 80): boolean {
    return this.getPredictedMindshare() >= threshold;
  }

  markAsSold(): void {
    this.isAvailable = false;
  }

  getGenerationDetails(): any {
    return this.generationMetadata || {};
  }

  getContentPreview(maxLength: number = 100): string {
    return this.contentText.length > maxLength 
      ? this.contentText.substring(0, maxLength) + '...'
      : this.contentText;
  }

  getValueScore(): number {
    // Calculate value score based on predicted performance vs asking price
    const performanceScore = this.getPerformanceScore();
    const price = this.getAskingPrice();
    return price > 0 ? performanceScore / price : performanceScore;
  }
} 