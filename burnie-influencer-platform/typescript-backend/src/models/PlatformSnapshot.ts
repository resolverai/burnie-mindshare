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
import { User } from './User';

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  VALIDATED = 'validated'
}

export enum SnapshotType {
  LEADERBOARD = 'leaderboard',
  CAMPAIGN = 'campaign', 
  PROFILE = 'profile',
  GENERAL = 'general',
  YAPPER_PROFILE = 'yapper_profile'  // NEW: Individual yapper profile snapshots
}

export enum SnapshotTimeframe {
  TWENTY_FOUR_HOURS = '24H'
}

@Entity('platform_snapshots')
@Index(['platformSource', 'uploadTimestamp'])
@Index(['campaignId', 'platformSource'])
@Index(['platformSource', 'campaignId', 'snapshotDate'])
@Index(['filePath'], { unique: true })
export class PlatformSnapshot {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50, default: 'cookie.fun' })
  platformSource!: string;

  @Column({ type: 'varchar', length: 500 })
  filePath!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  s3Url?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  originalFileName?: string;

  @Column({ type: 'varchar', length: 20, default: ProcessingStatus.PENDING })
  processingStatus!: ProcessingStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  snapshotType?: SnapshotType;

  @Column({ 
    type: 'varchar', 
    length: 10, 
    default: SnapshotTimeframe.TWENTY_FOUR_HOURS,
    comment: 'Always 24H - most granular data for ML models'
  })
  snapshotTimeframe!: SnapshotTimeframe;

  @Column({ 
    type: 'date',
    comment: 'Date for which 24H data was captured'
  })
  snapshotDate!: Date;

  @Column({ type: 'integer', nullable: true })
  campaignId?: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  yapperTwitterHandle?: string; // For yapper profile snapshots

  @ManyToOne(() => Campaign, { nullable: true })
  @JoinColumn({ name: 'campaignId' })
  campaign?: Campaign;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @Column({ type: 'jsonb', nullable: true })
  processedData?: any;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  confidenceScore?: number;

  @Column({ type: 'integer', nullable: true })
  createdBy?: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'createdBy' })
  creator?: User;

  @Column({ type: 'timestamp', nullable: true })
  processedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  cleanedUpAt?: Date;

  @Column({ type: 'text', nullable: true })
  errorLog?: string;

  @CreateDateColumn()
  uploadTimestamp!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper methods
  isProcessed(): boolean {
    return this.processingStatus === ProcessingStatus.COMPLETED || 
           this.processingStatus === ProcessingStatus.VALIDATED;
  }

  getProcessingProgress(): number {
    switch (this.processingStatus) {
      case ProcessingStatus.PENDING: return 0;
      case ProcessingStatus.PROCESSING: return 50;
      case ProcessingStatus.COMPLETED: return 90;
      case ProcessingStatus.VALIDATED: return 100;
      case ProcessingStatus.FAILED: return 0;
      default: return 0;
    }
  }

  getStatusDisplay(): string {
    switch (this.processingStatus) {
      case ProcessingStatus.PENDING: return 'Waiting to process';
      case ProcessingStatus.PROCESSING: return 'Processing screenshot...';
      case ProcessingStatus.COMPLETED: return 'Processing completed';
      case ProcessingStatus.VALIDATED: return 'Data validated';
      case ProcessingStatus.FAILED: return 'Processing failed';
      default: return 'Unknown status';
    }
  }
}
