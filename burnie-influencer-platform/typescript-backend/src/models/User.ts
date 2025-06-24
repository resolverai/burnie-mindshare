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

  @Column({ type: 'bigint', default: 0 })
  totalEarnings!: number;

  @Column({ type: 'bigint', default: 0 })
  roastBalance!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @OneToMany(() => Miner, (miner) => miner.user)
  miners!: Miner[];

  @OneToMany(() => Campaign, (campaign) => campaign.creator)
  campaigns!: Campaign[];

  @OneToMany(() => Project, (project) => project.owner)
  projects!: Project[];
} 