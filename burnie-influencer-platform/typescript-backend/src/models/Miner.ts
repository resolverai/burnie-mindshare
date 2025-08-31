import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Submission } from './Submission';
import { Reward } from './Reward';
import { SocialAccount } from './SocialAccount';
import { MinerStatus, AgentPersonality, LLMProvider } from '../types/index';

@Entity('miners')
export class Miner {
  @PrimaryGeneratedColumn()
  id!: number;

  // Ensure wallet addresses are always lowercase
  @Column({ 
    unique: true,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value
    }
  })
  @Index()
  walletAddress!: string;

  @Column({ nullable: true })
  username?: string;

  @Column({ nullable: true })
  nickname?: string;

  @Column({ nullable: true })
  agentName?: string;

  @Column({
    type: 'enum',
    enum: AgentPersonality,
    default: AgentPersonality.WITTY,
  })
  agentPersonality!: AgentPersonality;

  @Column({
    type: 'enum',
    enum: LLMProvider,
    default: LLMProvider.OPENAI,
  })
  llmProvider!: LLMProvider;

  @Column({ nullable: true })
  llmModel?: string;

  @Column({
    type: 'enum',
    enum: MinerStatus,
    default: MinerStatus.OFFLINE,
  })
  @Index()
  status!: MinerStatus;

  @Column({ default: true })
  isAvailable!: boolean;

  @Column({ type: 'bigint', default: 0 })
  roastBalance!: number;

  @Column({ type: 'bigint', default: 0 })
  totalEarnings!: number;

  @Column({ default: 0 })
  submissionCount!: number;

  @Column({ default: 0 })
  approvedSubmissionCount!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  averageScore!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  approvalRate!: number;

  @Column({ type: 'jsonb', nullable: true })
  configuration?: {
    maxDailySubmissions?: number;
    preferredCampaignTypes?: string[];
    autoMode?: boolean;
    notificationSettings?: Record<string, any>;
  };

  @Column({ type: 'jsonb', nullable: true })
  statistics?: {
    bestScore?: number;
    streakDays?: number;
    favoriteCategory?: string;
    totalBlocksParticipated?: number;
  };

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  userAgent?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastHeartbeatAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.miners)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: number;

  @OneToMany(() => Submission, (submission) => submission.miner)
  submissions!: Submission[];

  @OneToMany(() => Reward, (reward) => reward.miner)
  rewards!: Reward[];

  @OneToMany(() => SocialAccount, (socialAccount) => socialAccount.miner)
  socialAccounts!: SocialAccount[];
} 