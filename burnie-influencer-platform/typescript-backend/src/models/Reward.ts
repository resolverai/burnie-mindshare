import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Miner } from './Miner';
import { Block } from './Block';
import { RewardType } from '../types/index';

@Entity('rewards')
export class Reward {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'enum',
    enum: RewardType,
    default: RewardType.MINING,
  })
  @Index()
  type!: RewardType;

  @Column({ type: 'bigint' })
  amount!: number;

  @Column({ nullable: true })
  transactionHash?: string;

  @Column({ default: false })
  isPaid!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  calculation?: {
    baseReward?: number;
    qualityBonus?: number;
    speedBonus?: number;
    participationBonus?: number;
    breakdown?: Record<string, number>;
  };

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    campaignId?: number;
    submissionId?: number;
    reason?: string;
    notes?: string;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Miner, (miner) => miner.rewards)
  @JoinColumn({ name: 'minerId' })
  miner!: Miner;

  @Column()
  minerId!: number;

  @ManyToOne(() => Block, (block) => block.rewards, { nullable: true })
  @JoinColumn({ name: 'blockId' })
  block?: Block;

  @Column({ nullable: true })
  blockId?: number;
} 