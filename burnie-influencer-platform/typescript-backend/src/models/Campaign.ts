import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Project } from './Project';
import { Submission } from './Submission';
import { CampaignType, CampaignStatus } from '../types/index';

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column()
  category!: string;

  @Column({
    type: 'enum',
    enum: CampaignType,
    default: CampaignType.ROAST,
  })
  @Index()
  campaignType!: CampaignType;

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.DRAFT,
  })
  @Index()
  status!: CampaignStatus;

  @Column({ type: 'bigint' })
  rewardPool!: number;

  @Column({ type: 'bigint' })
  entryFee!: number;

  @Column({ default: 1500 })
  maxSubmissions!: number;

  @Column({ default: 0 })
  currentSubmissions!: number;

  @Column({ type: 'timestamp' })
  startDate!: Date;

  @Column({ type: 'timestamp' })
  endDate!: Date;

  @Column({ type: 'jsonb', nullable: true })
  requirements?: {
    minStake?: number;
    maxSubmissionsPerMiner?: number;
    allowedPersonalities?: string[];
    requiredSocialVerification?: string[];
  };

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    tags?: string[];
    difficulty?: string;
    targetAudience?: string;
    brandGuidelines?: string;
    examples?: string[];
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.campaigns)
  @JoinColumn({ name: 'creatorId' })
  creator!: User;

  @Column()
  creatorId!: number;

  @ManyToOne(() => Project, (project) => project.campaigns, { nullable: true })
  @JoinColumn({ name: 'projectId' })
  project?: Project;

  @Column({ nullable: true })
  projectId?: number;

  @OneToMany(() => Submission, (submission) => submission.campaign)
  submissions!: Submission[];
} 