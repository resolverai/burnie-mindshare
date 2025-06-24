import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { MetricType, TimeGranularity } from '../types/index';

@Entity('analytics')
export class Analytics {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'enum',
    enum: MetricType,
  })
  @Index()
  metricType!: MetricType;

  @Column({
    type: 'enum',
    enum: TimeGranularity,
  })
  @Index()
  granularity!: TimeGranularity;

  @Column({ type: 'timestamp' })
  @Index()
  periodStart!: Date;

  @Column({ type: 'timestamp' })
  @Index()
  periodEnd!: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  value!: number;

  @Column({ nullable: true })
  @Index()
  minerId?: number;

  @Column({ nullable: true })
  @Index()
  campaignId?: number;

  @Column({ nullable: true })
  @Index()
  projectId?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    breakdown?: Record<string, number>;
    context?: Record<string, any>;
    source?: string;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 