import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Campaign } from './Campaign';

@Entity('dedicated_miner_executions')
@Index(['minerWalletAddress', 'status']) // Index for efficient queries
@Index(['campaignId', 'postType', 'status']) // Index for campaign-specific queries
export class DedicatedMinerExecution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'miner_wallet_address', type: 'varchar', length: 42 })
  minerWalletAddress!: string;

  @Column({ name: 'campaign_id', type: 'integer' })
  campaignId!: number;

  @Column({ name: 'post_type', type: 'varchar', length: 20 })
  postType!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['queued', 'generating', 'completed', 'failed'],
    default: 'queued'
  })
  status!: 'queued' | 'generating' | 'completed' | 'failed';

  @Column({ name: 'execution_started_at', type: 'timestamp', nullable: true })
  executionStartedAt!: Date | null;

  @Column({ name: 'execution_completed_at', type: 'timestamp', nullable: true })
  executionCompletedAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  // Helper methods
  public isActive(): boolean {
    return this.status === 'generating' || this.status === 'queued';
  }

  public isCompleted(): boolean {
    return this.status === 'completed' || this.status === 'failed';
  }

  public markAsStarted(): void {
    this.status = 'generating';
    this.executionStartedAt = new Date();
  }

  public markAsCompleted(): void {
    this.status = 'completed';
    this.executionCompletedAt = new Date();
  }

  public markAsFailed(errorMessage?: string): void {
    this.status = 'failed';
    this.executionCompletedAt = new Date();
    this.errorMessage = errorMessage || null;
  }
}
