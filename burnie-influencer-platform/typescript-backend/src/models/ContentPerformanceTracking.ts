import { 
  Entity, 
  Column, 
  PrimaryGeneratedColumn, 
  CreateDateColumn, 
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn
} from 'typeorm';

@Entity('content_performance_tracking')
@Index(['platform_source', 'created_at'])
@Index(['yapper_id', 'platform_source'])
@Index(['campaign_id'])
@Index(['content_category'])
export class ContentPerformanceTracking {
  @PrimaryGeneratedColumn()
  id!: number;

  // === CONTENT IDENTIFICATION ===
  @Column({ type: 'integer', nullable: true })
  yapper_id?: number; // References users(id)

  @Column({ type: 'integer', nullable: true })
  content_id?: number; // References content_marketplace(id)

  @Column({ type: 'text' })
  content_text!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  content_category?: string;

  @Column({ type: 'varchar', length: 50 })
  platform_source!: string; // where content was used

  // === ACTUAL PERFORMANCE RESULTS ===
  @Column({ type: 'integer', nullable: true })
  snap_earned?: number; // actual SNAP earned

  @Column({ type: 'integer', nullable: true })
  position_change?: number; // actual leaderboard movement

  @Column({ type: 'jsonb', nullable: true })
  twitter_metrics?: any; // actual Twitter performance

  @Column({ type: 'timestamp', nullable: true })
  posted_at?: Date;

  // === CAMPAIGN CONTEXT ===
  @Column({ type: 'integer', nullable: true })
  campaign_id?: number; // References campaigns(id)

  // === ROI CALCULATION ===
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  content_cost?: number; // what the yapper paid for content

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  platform_rewards_earned?: number; // actual rewards from platform

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  roi_actual?: number; // calculated actual ROI percentage

  // === PREDICTION ACCURACY TRACKING ===
  @Column({ type: 'jsonb', nullable: true })
  prediction_accuracy?: any; // how accurate our predictions were

  @Column({ type: 'jsonb', nullable: true })
  ml_predictions?: any; // what our models predicted

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  snap_prediction_accuracy?: number; // percentage accuracy of SNAP prediction

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  position_prediction_accuracy?: number; // percentage accuracy of position prediction

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  roi_prediction_accuracy?: number; // percentage accuracy of ROI prediction

  // === VALIDATION METRICS ===
  @Column({ type: 'jsonb', nullable: true })
  model_performance_metrics?: any; // detailed performance analysis for model improvement

  @Column({ type: 'boolean', default: false })
  validated!: boolean; // whether this data has been used for model training

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  validation_status!: string; // pending, validated, excluded

  // === METADATA ===
  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}