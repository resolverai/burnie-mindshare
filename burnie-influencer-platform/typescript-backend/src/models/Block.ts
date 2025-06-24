import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Submission } from './Submission';
import { Reward } from './Reward';
import { BlockStatus } from '../types/index';

@Entity('blocks')
export class Block {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  @Index()
  blockNumber!: number;

  @Column({ nullable: true })
  hash?: string;

  @Column({
    type: 'enum',
    enum: BlockStatus,
    default: BlockStatus.PENDING,
  })
  @Index()
  status!: BlockStatus;

  @Column({ type: 'jsonb' })
  minerIds!: number[];

  @Column({ default: 0 })
  submissionCount!: number;

  @Column({ type: 'bigint' })
  totalRewards!: number;

  @Column({ type: 'timestamp' })
  minedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    difficulty?: number;
    gasUsed?: number;
    transactionHash?: string;
    validatorSignatures?: string[];
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @OneToMany(() => Submission, (submission) => submission.block)
  submissions!: Submission[];

  @OneToMany(() => Reward, (reward) => reward.block)
  rewards!: Reward[];
} 