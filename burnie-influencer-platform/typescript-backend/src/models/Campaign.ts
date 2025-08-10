import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm'
import { Project } from './Project'
import { Submission } from './Submission'
import { Block } from './Block'

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'pending_approval',
  ACTIVE = 'ACTIVE',
  PAUSED = 'paused',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'cancelled',
}

export enum CampaignType {
  FEATURE_LAUNCH = 'feature_launch',
  SHOWCASE = 'showcase', 
  AWARENESS = 'awareness',
  ROAST = 'roast',
  MEME = 'meme',
  CREATIVE = 'creative',
  VIRAL = 'viral',
  SOCIAL = 'social',
  EDUCATIONAL = 'educational',
  TECHNICAL = 'technical',
}

export enum CampaignCategory {
  DEFI = 'defi',
  NFT = 'nft',
  GAMING = 'gaming',
  METAVERSE = 'metaverse',
  DAO = 'dao',
  INFRASTRUCTURE = 'infrastructure',
  LAYER1 = 'layer1',
  LAYER2 = 'layer2',
  TRADING = 'trading',
  MEME_COINS = 'meme_coins',
  SOCIAL_FI = 'social_fi',
  AI_CRYPTO = 'ai_crypto',
  RWA = 'rwa',
  PREDICTION_MARKETS = 'prediction_markets',
  PRIVACY = 'privacy',
  CROSS_CHAIN = 'cross_chain',
  YIELD_FARMING = 'yield_farming',
  LIQUID_STAKING = 'liquid_staking',
  DERIVATIVES = 'derivatives',
  PAYMENTS = 'payments',
  IDENTITY = 'identity',
  SECURITY = 'security',
  TOOLS = 'tools',
  ANALYTICS = 'analytics',
  EDUCATION = 'education',
  OTHER = 'other'
}

export enum PlatformSource {
  BURNIE = 'burnie',
  COOKIE_FUN = 'cookie.fun',
  YAPS_KAITO = 'yaps.kaito.ai',
  YAP_MARKET = 'yap.market',
  AMPLIFI_NOW = 'amplifi.now',
  ARBUS = 'arbus',
  TRENDSAGE = 'trendsage.xyz'
}

@Entity('campaigns')
@Index(['status'])
@Index(['campaignType'])
@Index(['platformSource', 'isActive'])
@Index(['externalCampaignId'], { unique: true })
export class Campaign {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ type: 'varchar', length: 255 })
  title!: string

  @Column({ type: 'text' })
  description!: string

  // Project Name (instead of projectId relationship)
  @Column({ type: 'varchar', length: 255, nullable: true })
  projectName?: string

  // Project Logo S3 URL
  @Column({ type: 'text', nullable: true })
  projectLogo?: string

  @Column({
    type: 'enum',
    enum: CampaignCategory,
    default: CampaignCategory.OTHER,
  })
  category!: CampaignCategory

  // Token information
  @Column({ type: 'varchar', length: 20, nullable: true })
  tokenTicker?: string // e.g., 'ROAST', 'USDC', 'ETH'

  // Max yappers for reward distribution
  @Column({ type: 'integer', default: 100 })
  maxYappers!: number

  // New fields for aggregated campaigns
  @Column({
    type: 'enum',
    enum: PlatformSource,
    default: PlatformSource.BURNIE,
  })
  platformSource!: PlatformSource

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  externalCampaignId?: string // ID from external platform

  @Column({ type: 'varchar', length: 10, nullable: true })
  rewardToken?: string // 'KAITO', 'SNAP', 'BURNIE', 'ROAST'

  @Column({ type: 'text', nullable: true })
  targetAudience?: string

  @Column({ type: 'text', nullable: true })
  brandGuidelines?: string

  @Column({ type: 'decimal', precision: 10, scale: 4, nullable: true })
  predictedMindshare?: number

  @Column({ type: 'jsonb', nullable: true })
  mindshareRequirements?: any

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  @Column({
    type: 'enum',
    enum: CampaignType,
    default: CampaignType.AWARENESS,
  })
  campaignType!: CampaignType

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.DRAFT,
  })
  status!: CampaignStatus

  @Column({ type: 'bigint' })
  rewardPool!: number

  @Column({ type: 'bigint', default: 0 })
  entryFee!: number

  @Column({ type: 'integer', default: 1500 })
  maxSubmissions!: number

  @Column({ type: 'integer', default: 0 })
  currentSubmissions!: number

  @Column({ type: 'timestamp' })
  startDate!: Date

  @Column({ type: 'timestamp' })
  endDate!: Date

  @Column({ type: 'jsonb', nullable: true })
  requirements?: any

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any

  @Column({ type: 'integer' })
  creatorId!: number

  @Column({ type: 'integer', nullable: true })
  projectId?: number

  // Keep project relationship for backwards compatibility
  @ManyToOne(() => Project, project => project.campaigns)
  @JoinColumn({ name: 'projectId' })
  project?: Project

  // Relationships
  @OneToMany(() => Submission, submission => submission.campaign)
  submissions!: Submission[]

  @OneToMany(() => Block, block => block.campaign)
  blocks!: Block[]

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date

  // Helper methods
  isActiveCampaign(): boolean {
    const now = new Date()
    return (
      this.isActive &&
      this.status === CampaignStatus.ACTIVE &&
      this.startDate <= now &&
      this.endDate > now &&
      this.currentSubmissions < this.maxSubmissions
    )
  }

  canAcceptSubmissions(): boolean {
    return (
      this.isActiveCampaign() &&
      this.currentSubmissions < this.maxSubmissions
    )
  }

  getRemainingSubmissions(): number {
    return Math.max(0, this.maxSubmissions - this.currentSubmissions)
  }

  getCompletionPercentage(): number {
    if (this.maxSubmissions === 0) return 0
    return Math.min(100, (this.currentSubmissions / this.maxSubmissions) * 100)
  }

  getTimeRemaining(): number {
    return Math.max(0, this.endDate.getTime() - Date.now())
  }

  getDaysRemaining(): number {
    return Math.ceil(this.getTimeRemaining() / (1000 * 60 * 60 * 24))
  }

  // New methods for aggregated campaigns
  isAggregatedCampaign(): boolean {
    return !!this.platformSource && !!this.externalCampaignId
  }

  getMindshareScore(): number {
    return this.predictedMindshare || 0
  }
} 