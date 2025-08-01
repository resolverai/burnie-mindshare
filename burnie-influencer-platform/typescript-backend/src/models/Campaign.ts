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
  ROAST = 'roast',
  MEME = 'meme',
  CREATIVE = 'creative',
  VIRAL = 'viral',
  SOCIAL = 'social',
  EDUCATIONAL = 'educational',
  TECHNICAL = 'technical',
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

  @Column({ type: 'varchar', length: 255 })
  category!: string

  // New fields for aggregated campaigns
  @Column({ type: 'varchar', length: 50, nullable: true })
  platformSource?: string // 'cookie.fun', 'yaps.kaito.ai', 'yap.market', etc.

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
    default: CampaignType.ROAST,
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

  @Column({ type: 'bigint' })
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

  // Project relationship
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