import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Miner } from './Miner';
import { Campaign } from './Campaign';
import { Project } from './Project';

export enum UserRoleType {
  MINER = 'miner',
  YAPPER = 'yapper',
  BOTH = 'both',
  ADMIN = 'admin',
}

export enum UserAccessStatus {
  PENDING_REFERRAL = 'PENDING_REFERRAL',
  PENDING_WAITLIST = 'PENDING_WAITLIST',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  // Ensure wallet addresses are always lowercase
  @Column({ 
    unique: true, 
    length: 42,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value
    }
  })
  @Index()
  walletAddress!: string;

  @Column({ unique: true, nullable: true })
  username?: string;

  @Column({ nullable: true })
  email?: string;

  // Twitter Integration
  @Column({ type: 'varchar', length: 50, nullable: true })
  twitterHandle?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  twitterUserId?: string;

  @Column({ type: 'text', nullable: true })
  twitterOauthToken?: string;

  // Role Management
  @Column({
    type: 'enum',
    enum: UserRoleType,
    default: UserRoleType.BOTH,
  })
  roleType!: UserRoleType;

  // Balance Management
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  roastBalance!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  usdcBalance!: number;

  @Column({ type: 'integer', default: 0 })
  reputationScore!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalEarnings!: number;

  @Column({ default: false })
  isVerified!: boolean;

  @Column({ default: false })
  isAdmin!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  profile?: {
    displayName?: string;
    bio?: string;
    avatar?: string;
    website?: string;
    location?: string;
  };

  @Column({ type: 'jsonb', nullable: true })
  preferences?: {
    notifications?: boolean;
    newsletter?: boolean;
    theme?: string;
    language?: string;
  };

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt?: Date;

  // Referral and Access Control
  @Column({
    type: 'enum',
    enum: UserAccessStatus,
    default: UserAccessStatus.PENDING_REFERRAL
  })
  accessStatus!: UserAccessStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  referralCode?: string; // The code they used to join

  @Column({ type: 'int', nullable: true })
  referredByUserId?: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalReferralEarnings!: number;

  @Column({ type: 'int', default: 0 })
  referralCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @OneToMany(() => Miner, (miner) => miner.user)
  miners!: Miner[];

  @OneToMany(() => Project, (project) => project.owner)
  projects!: Project[];

  // Helper methods
  isMiner(): boolean {
    return this.roleType === UserRoleType.MINER || this.roleType === UserRoleType.BOTH;
  }

  isYapper(): boolean {
    return this.roleType === UserRoleType.YAPPER || this.roleType === UserRoleType.BOTH;
  }

  isAdminRole(): boolean {
    return this.roleType === UserRoleType.ADMIN || this.isAdmin;
  }

  hasTwitterConnected(): boolean {
    return !!this.twitterHandle && !!this.twitterUserId;
  }

  canAfford(amount: number, currency: 'ROAST' | 'USDC'): boolean {
    const balance = currency === 'ROAST' ? this.roastBalance : this.usdcBalance;
    return Number(balance) >= amount;
  }

  hasMarketplaceAccess(): boolean {
    return this.accessStatus === UserAccessStatus.APPROVED;
  }

  isPendingAccess(): boolean {
    return this.accessStatus === UserAccessStatus.PENDING_REFERRAL || 
           this.accessStatus === UserAccessStatus.PENDING_WAITLIST;
  }

  getTotalBalance(): { roast: number; usdc: number } {
    return {
      roast: Number(this.roastBalance),
      usdc: Number(this.usdcBalance),
    };
  }
} 