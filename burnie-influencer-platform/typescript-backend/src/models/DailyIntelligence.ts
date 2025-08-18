import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('daily_intelligence')
@Index(['platformSource', 'intelligenceDate'])
@Unique(['platformSource', 'intelligenceDate'])
export class DailyIntelligence {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  platformSource!: string;

  @Column({ type: 'date' })
  intelligenceDate!: Date;

  @Column({ 
    type: 'varchar', 
    length: 10, 
    default: '24H',
    comment: 'Always based on 24H snapshot data'
  })
  timeframeBasis!: string;

  @Column({ type: 'jsonb', nullable: true })
  trendingTopics?: any;

  @Column({ type: 'jsonb', nullable: true })
  algorithmPatterns?: any;

  @Column({ 
    type: 'jsonb', 
    nullable: true,
    comment: '24H position changes and momentum'
  })
  leaderboardChanges?: any;

  @Column({ type: 'jsonb', nullable: true })
  contentThemes?: any;

  @Column({ type: 'jsonb', nullable: true })
  processingSummary?: any;

  @Column({ 
    type: 'jsonb', 
    nullable: true,
    comment: 'Multi-timeframe predictions: {next_24h, next_7d, next_1m}'
  })
  predictionWindows?: any;

  @Column({ type: 'jsonb', nullable: true })
  competitiveAnalysis?: any;

  @Column({ type: 'jsonb', nullable: true })
  performanceMetrics?: any;

  @CreateDateColumn()
  createdAt!: Date;

  // Helper methods
  getTrendingTopicsCount(): number {
    return this.trendingTopics?.topics?.length || 0;
  }

  getAlgorithmConfidence(): number {
    return this.algorithmPatterns?.confidence || 0;
  }

  getTopPerformers(): any[] {
    return this.leaderboardChanges?.topPerformers || [];
  }

  getDailyInsights(): string[] {
    return this.processingSummary?.insights || [];
  }

  getContentRecommendations(): any[] {
    return this.contentThemes?.recommendations || [];
  }
}
