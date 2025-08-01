import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from './User';

@Entity('twitter_user_connections')
@Index(['userId'])
@Unique(['twitterUserId'])
export class TwitterUserConnection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'varchar', length: 50 })
  twitterUserId!: string;

  @Column({ type: 'varchar', length: 50 })
  twitterUsername!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  twitterDisplayName?: string;

  @Column({ type: 'text', nullable: true })
  profileImageUrl?: string | null;

  @Column({ type: 'text' })
  accessToken!: string;

  @Column({ type: 'text', nullable: true })
  refreshToken?: string | null;

  @Column({ type: 'boolean', default: true })
  isConnected!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  learningData?: any;

  // Relations
  @ManyToOne(() => User, user => user.id)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper methods
  public isActive(): boolean {
    return this.isConnected;
  }

  public needsRefresh(): boolean {
    if (!this.lastSyncAt) return true;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return this.lastSyncAt < oneHourAgo;
  }
} 