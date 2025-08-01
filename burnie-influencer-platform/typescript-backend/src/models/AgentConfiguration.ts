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

export enum AgentType {
  DATA_ANALYST = 'data_analyst',
  CONTENT_STRATEGIST = 'content_strategist',
  TEXT_CONTENT = 'text_content',
  VISUAL_CREATOR = 'visual_creator',
  ORCHESTRATOR = 'orchestrator',
}

export enum PersonalityType {
  WITTY = 'WITTY',
  SAVAGE = 'SAVAGE',
  CHAOTIC = 'CHAOTIC',
  LEGENDARY = 'LEGENDARY',
}

@Entity('agent_configurations')
@Index(['userId', 'agentType'])
export class AgentConfiguration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'varchar', length: 100 })
  agentName!: string;

  @Column({
    type: 'enum',
    enum: AgentType,
    default: AgentType.TEXT_CONTENT,
  })
  agentType!: AgentType;

  @Column({
    type: 'enum',
    enum: PersonalityType,
    default: PersonalityType.WITTY,
  })
  personalityType!: PersonalityType;

  @Column({ type: 'text', nullable: true })
  systemMessage?: string;

  @Column({ type: 'jsonb', nullable: true })
  configuration?: any;

  @Column({ type: 'jsonb', nullable: true })
  aiProviders?: any;

  @Column({ type: 'jsonb', nullable: true })
  toneSettings?: any;

  @Column({ type: 'jsonb', nullable: true })
  creativitySettings?: any;

  @Column({ type: 'jsonb', nullable: true })
  behavioralPatterns?: any;

  @Column({ type: 'jsonb', nullable: true })
  twitterConfig?: any;

  @Column({ type: 'jsonb', nullable: true })
  personalitySettings?: any;

  @Column({ type: 'jsonb', nullable: true })
  learningData?: any;

  @Column({ type: 'jsonb', nullable: true })
  performanceMetrics?: any;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // Relations
  @ManyToOne(() => User, user => user.id)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper methods
  public isReady(): boolean {
    return this.isActive && !!this.systemMessage;
  }

  public updatePerformanceMetrics(metrics: any): void {
    this.performanceMetrics = {
      ...this.performanceMetrics,
      ...metrics,
      lastUpdated: new Date(),
    };
  }
} 