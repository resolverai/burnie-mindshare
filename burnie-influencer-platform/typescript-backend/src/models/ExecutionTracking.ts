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
import { User } from './User';
import { Campaign } from './Campaign';

@Entity('execution_tracking')
@Index(['executionId'])
@Index(['userId'])
@Index(['status'])
@Index(['source'])
export class ExecutionTracking {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  executionId!: string; // Unique execution identifier

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'integer' })
  campaignId!: number;

  @Column({ type: 'varchar', length: 50 })
  source!: string; // 'yapper_interface' or 'mining_interface'

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: string; // 'pending', 'processing', 'completed', 'failed', 'cancelled'

  @Column({ type: 'integer', default: 0 })
  progress!: number; // Progress percentage (0-100)

  @Column({ type: 'jsonb', nullable: true })
  resultData?: any; // Generated content result

  @Column({ type: 'text', nullable: true })
  errorMessage?: string; // Error message if failed

  @Column({ type: 'varchar', length: 50, nullable: true })
  postType?: string; // 'shitpost', 'longpost', or 'thread'

  @Column({ type: 'boolean', default: false })
  includeBrandLogo?: boolean; // Whether to include brand logo

  @Column({ type: 'varchar', length: 255, nullable: true })
  selectedYapperHandle?: string; // Twitter handle of selected yapper for pattern

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  price?: number; // Price in ROAST for the content
  
  @Column({ type: 'integer', nullable: true })
  contentId?: number; // ID of generated content in content_marketplace

  // Relations
  @ManyToOne(() => User, user => user.id)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne(() => Campaign, campaign => campaign.id)
  @JoinColumn({ name: 'campaignId' })
  campaign!: Campaign;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date; // When execution completed

  // Helper methods
  isCompleted(): boolean {
    return this.status === 'completed';
  }

  isFailed(): boolean {
    return this.status === 'failed';
  }

  isProcessing(): boolean {
    return this.status === 'processing';
  }

  isPending(): boolean {
    return this.status === 'pending';
  }
}
