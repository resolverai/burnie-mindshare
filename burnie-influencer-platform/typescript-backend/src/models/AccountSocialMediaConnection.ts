import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './Account';

export type SocialPlatform = 'twitter' | 'linkedin' | 'youtube' | 'instagram';
export type ConnectionStatus = 'active' | 'expired' | 'revoked';

@Entity('account_social_media_connections')
export class AccountSocialMediaConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  account_id!: string;

  @Column({
    type: 'enum',
    enum: ['twitter', 'linkedin', 'youtube', 'instagram']
  })
  @Index()
  platform!: SocialPlatform;

  @Column({ type: 'text', nullable: true })
  platform_user_id?: string;

  @Column({ type: 'text', nullable: true })
  platform_username?: string;

  @Column({ type: 'text', nullable: true })
  access_token?: string;

  @Column({ type: 'text', nullable: true })
  refresh_token?: string;

  @Column({ type: 'timestamp', nullable: true })
  token_expires_at?: Date;

  // OAuth 1.0a fields (for Twitter direct video upload)
  @Column({ type: 'text', nullable: true })
  oauth1_access_token?: string;

  @Column({ type: 'text', nullable: true })
  oauth1_access_token_secret?: string;

  @Column({
    type: 'enum',
    enum: ['active', 'expired', 'revoked'],
    default: 'active'
  })
  status!: ConnectionStatus;

  @CreateDateColumn()
  connected_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_used_at?: Date;

  // Relations
  @ManyToOne(() => Account, account => account.social_media_connections)
  @JoinColumn({ name: 'account_id' })
  account!: Account;
}

