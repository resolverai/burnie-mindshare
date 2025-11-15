import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Campaign } from './Campaign';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ nullable: true })
  website?: string;

  @Column({ nullable: true })
  logo?: string;

  @Column({ type: 'jsonb', nullable: true })
  socialLinks?: {
    twitter?: string;
    farcaster?: string;
    website?: string;
    telegram?: string;
    discord?: string;
  };

  @Column({ type: 'jsonb', nullable: true })
  brandGuidelines?: {
    colors?: string[];
    fonts?: string[];
    tone?: string;
    keywords?: string[];
    restrictions?: string[];
  };

  @Column({ default: true })
  isActive!: boolean;

  @Column({ name: 'somnia_whitelisted', default: false })
  somniaWhitelisted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.projects)
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @Column()
  ownerId!: number;

  @OneToMany(() => Campaign, (campaign) => campaign.project)
  campaigns!: Campaign[];
} 