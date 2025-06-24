import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
} from 'typeorm';
import { Miner } from './Miner';
import { VerificationStatus } from '../types/index';

@Entity('social_accounts')
export class SocialAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  @Index()
  platform!: string; // 'twitter', 'farcaster', etc.

  @Column()
  username!: string;

  @Column({ nullable: true })
  displayName?: string;

  @Column({ nullable: true })
  profileUrl?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({
    type: 'enum',
    enum: VerificationStatus,
    default: VerificationStatus.UNVERIFIED,
  })
  @Index()
  verificationStatus!: VerificationStatus;

  @Column({ nullable: true })
  accessToken?: string;

  @Column({ nullable: true })
  refreshToken?: string;

  @Column({ type: 'timestamp', nullable: true })
  tokenExpiresAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  profileData?: {
    followers?: number;
    following?: number;
    verified?: boolean;
    bio?: string;
    website?: string;
    location?: string;
  };

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Miner, (miner) => miner.socialAccounts)
  @JoinColumn({ name: 'minerId' })
  miner!: Miner;

  @Column()
  minerId!: number;
} 