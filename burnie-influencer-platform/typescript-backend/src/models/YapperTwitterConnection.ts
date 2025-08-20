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

@Entity('yapper_twitter_connections')
@Index(['userId'])
@Unique(['twitterUserId'])
export class YapperTwitterConnection {
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

  @Column({ type: 'text', nullable: true })
  accessToken?: string | null;

  @Column({ type: 'text', nullable: true })
  refreshToken?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  tokenExpiresAt?: Date | null;

  @Column({ type: 'boolean', default: true })
  isConnected!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  yapperData?: any; // Yapper-specific data (engagement metrics, content preferences, etc.)

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

  public isTokenExpired(): boolean {
    if (!this.tokenExpiresAt || !this.accessToken) return true;
    return new Date() >= this.tokenExpiresAt;
  }

  public hasValidToken(): boolean {
    return this.isConnected && !!this.accessToken && !this.isTokenExpired();
  }

  public getTokenStatus(): 'valid' | 'expired' | 'missing' {
    if (!this.accessToken || this.accessToken === null) return 'missing';
    if (this.isTokenExpired()) return 'expired';
    return 'valid';
  }
} 