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
import { Miner } from './Miner';
import { Campaign } from './Campaign';
import { Block } from './Block';
import { SubmissionStatus } from '../types/index';

@Entity('submissions')
export class Submission {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.PENDING,
  })
  @Index()
  status!: SubmissionStatus;

  @Column({ type: 'bigint' })
  tokensSpent!: number;

  @Column({ nullable: true })
  transactionHash?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  humorScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  engagementScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  originalityScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  relevanceScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  personalityScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  totalScore?: number;

  @Column({ type: 'jsonb', nullable: true })
  aiAnalysis?: {
    sentiment?: string;
    keywords?: string[];
    categories?: string[];
    confidence?: number;
    explanation?: string;
  };

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    generationTime?: number;
    revisionsCount?: number;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Miner, (miner) => miner.submissions)
  @JoinColumn({ name: 'minerId' })
  miner!: Miner;

  @Column()
  minerId!: number;

  @ManyToOne(() => Campaign, (campaign) => campaign.submissions)
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  @Column()
  campaignId!: number;

  @ManyToOne(() => Block, (block) => block.submissions, { nullable: true })
  @JoinColumn({ name: 'blockId' })
  block?: Block;

  @Column({ nullable: true })
  blockId?: number;
} 