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
import { ContentMarketplace } from './ContentMarketplace';
import { User } from './User';

@Entity('snap_predictions')
@Index(['contentId', 'yapperId'])
@Index(['createdAt'])
export class SNAPPrediction {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  contentId!: number;

  @ManyToOne(() => ContentMarketplace)
  @JoinColumn({ name: 'contentId' })
  content!: ContentMarketplace;

  @Column({ type: 'integer' })
  yapperId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'yapperId' })
  yapper!: User;

  @Column({ type: 'varchar', length: 50, default: 'cookie.fun' })
  platformSource!: string;

  @Column({ type: 'integer', nullable: true })
  predictedSnapEarnings?: number;

  @Column({ type: 'integer', nullable: true })
  predictedPositionChange?: number;

  @Column({ type: 'decimal', precision: 4, scale: 2 })
  confidenceLevel!: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  roiEstimate?: number;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  successProbability?: number;

  @Column({ type: 'jsonb', nullable: true })
  predictionFactors?: any;

  @Column({ type: 'jsonb', nullable: true })
  fomoElements?: any;

  @Column({ type: 'varchar', length: 200, nullable: true })
  competitiveAdvantage?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  predictionModel?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  validatedAt?: Date;

  @Column({ type: 'integer', nullable: true })
  actualSnapEarnings?: number;

  @Column({ type: 'integer', nullable: true })
  actualPositionChange?: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  actualRoi?: number;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper methods
  isValidated(): boolean {
    return this.validatedAt !== null;
  }

  getPredictionAccuracy(): number | null {
    if (!this.isValidated() || !this.actualSnapEarnings || !this.predictedSnapEarnings) {
      return null;
    }
    
    const error = Math.abs(this.actualSnapEarnings - this.predictedSnapEarnings);
    const accuracy = Math.max(0, 100 - (error / this.predictedSnapEarnings) * 100);
    return Number(accuracy.toFixed(2));
  }

  getConfidenceLevelDisplay(): string {
    if (this.confidenceLevel >= 0.9) return 'Very High';
    if (this.confidenceLevel >= 0.75) return 'High';
    if (this.confidenceLevel >= 0.6) return 'Medium';
    if (this.confidenceLevel >= 0.4) return 'Low';
    return 'Very Low';
  }

  getROIDisplay(): string {
    if (!this.roiEstimate) return 'N/A';
    return `${this.roiEstimate > 0 ? '+' : ''}${this.roiEstimate.toFixed(2)}%`;
  }

  getFomoMessage(): string {
    if (!this.fomoElements) return '';
    return this.fomoElements.primaryMessage || '';
  }
}
