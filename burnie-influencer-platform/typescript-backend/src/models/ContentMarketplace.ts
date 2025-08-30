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
  tweetThread!: string[] | null; // Array of tweet thread messages

  @Column({ type: 'jsonb', nullable: true })
  contentImages!: any | null;

  @Column({ type: 'text', nullable: true })
  watermarkImage!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 4 })
  predictedMindshare!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  qualityScore!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  askingPrice!: number;

  @Column({ type: 'boolean', default: true })
  isAvailable!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  generationMetadata!: any | null;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  approvalStatus!: string; // 'pending', 'approved', 'rejected'

  @Column({ type: 'integer', nullable: true })
  agentId!: number | null; // ID of the agent used for content generation

  @Column({ type: 'varchar', length: 255, nullable: true })
  agentName!: string | null; // Name of the agent used

  @Column({ type: 'varchar', length: 255, nullable: true })
  walletAddress!: string | null; // Wallet address of the miner who created this content

  @Column({ type: 'varchar', length: 20, default: 'thread' })
  postType!: string; // Type of post: 'shitpost', 'longpost', or 'thread'

  @Column({ type: 'timestamp', nullable: true })
  approvedAt!: Date | null; // When the content was approved

  @Column({ type: 'timestamp', nullable: true })
  rejectedAt!: Date | null; // When the content was rejected

  @Column({ type: 'boolean', default: false })
  isBiddable!: boolean; // Whether content is available for bidding

  @Column({ type: 'timestamp', nullable: true })
  biddingEndDate!: Date | null; // When bidding ends for this content

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  biddingAskPrice!: number | null; // Miner's ask price for bidding

  @Column({ name: 'bidding_enabled_at', type: 'timestamp', nullable: true })
  biddingEnabledAt!: Date | null // When bidding was enabled

  @Column({ name: 'source', length: 50, default: 'mining_interface' })
  source!: string // 'mining_interface' or 'yapper_interface'

  // Purchase Flow Control - Prevents race conditions
  @Column({ name: 'in_purchase_flow', type: 'boolean', default: false })
  inPurchaseFlow!: boolean

  @Column({ name: 'purchase_flow_initiated_by', type: 'varchar', length: 255, nullable: true })
  purchaseFlowInitiatedBy!: string | null // Wallet address of user in purchase flow

  @Column({ name: 'purchase_flow_initiated_at', type: 'timestamp', nullable: true })
  purchaseFlowInitiatedAt!: Date | null

  // Text-Only Regeneration Support
  @Column({ name: 'image_prompt', type: 'text', nullable: true })
  imagePrompt!: string | null // Store the prompt that generated the original image

  @Column({ name: 'updated_tweet', type: 'text', nullable: true })
  updatedTweet!: string | null // Store the regenerated main tweet text

  @Column({ name: 'updated_thread', type: 'jsonb', nullable: true })
  updatedThread!: string[] | null // Store the regenerated thread items (similar to tweetThread)

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