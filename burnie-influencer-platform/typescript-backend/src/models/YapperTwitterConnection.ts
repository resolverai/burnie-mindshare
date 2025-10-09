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

  // OAuth 1.0a credentials for video uploads
  @Column({ type: 'text', nullable: true })
  oauth1AccessToken?: string | null;

  @Column({ type: 'text', nullable: true })
  oauth1AccessTokenSecret?: string | null;

  @Column({ type: 'boolean', default: false })
  oauth1Connected!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  oauth1TokenExpiresAt?: Date | null;

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

  public hasValidOAuth1Token(): boolean {
    return this.oauth1Connected && !!this.oauth1AccessToken && !!this.oauth1AccessTokenSecret && !this.isOAuth1TokenExpired();
  }

  public isOAuth1TokenExpired(): boolean {
    if (!this.oauth1TokenExpiresAt || !this.oauth1AccessToken) return true; // Require expiration date for security
    return new Date() >= this.oauth1TokenExpiresAt;
  }

  public canUploadVideos(): boolean {
    return this.hasValidOAuth1Token() && !this.isOAuth1TokenExpired();
  }

  public canUploadImages(): boolean {
    return this.hasValidToken();
  }

  public canTweet(): boolean {
    return this.hasValidToken();
  }

  public needsReconnection(): boolean {
    // Only require OAuth 2.0 for basic functionality (images, tweets)
    // OAuth 1.0a is only required when specifically uploading videos
    const oauth2Valid = this.hasValidToken();
    return !oauth2Valid;
  }

  public needsVideoReconnection(): boolean {
    // Specifically for video uploads - requires both OAuth 2.0 and OAuth 1.0a
    const oauth2Valid = this.hasValidToken();
    const oauth1Valid = this.hasValidOAuth1Token();
    return !oauth2Valid || !oauth1Valid;
  }

  public getTokenStatus(): 'valid' | 'expired' | 'missing' {
    if (!this.accessToken || this.accessToken === null) return 'missing';
    if (this.isTokenExpired()) return 'expired';
    return 'valid';
  }

  public getOAuth1TokenStatus(): 'valid' | 'expired' | 'missing' {
    if (!this.oauth1AccessToken || this.oauth1AccessToken === null) return 'missing';
    if (this.isOAuth1TokenExpired()) return 'expired';
    return 'valid';
  }

  public getConnectionCapabilities() {
    return {
      canTweet: this.canTweet(),
      canUploadImages: this.canUploadImages(),
      canUploadVideos: this.canUploadVideos(),
      needsReconnection: this.needsReconnection(),
      needsVideoReconnection: this.needsVideoReconnection(),
      oauth2Status: this.getTokenStatus(),
      oauth1Status: this.getOAuth1TokenStatus()
    };
  }
} 