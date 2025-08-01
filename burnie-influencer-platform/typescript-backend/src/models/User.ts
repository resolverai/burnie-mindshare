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
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true, length: 42 })
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

  hasTwitterConnected(): boolean {
    return !!this.twitterHandle && !!this.twitterUserId;
  }

  canAfford(amount: number, currency: 'ROAST' | 'USDC'): boolean {
    const balance = currency === 'ROAST' ? this.roastBalance : this.usdcBalance;
    return Number(balance) >= amount;
  }

  getTotalBalance(): { roast: number; usdc: number } {
    return {
      roast: Number(this.roastBalance),
      usdc: Number(this.usdcBalance),
    };
  }
} 