import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './Account';

export type AccountUserRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type AccountUserStatus = 'active' | 'inactive';

@Entity('account_users')
export class AccountUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  account_id!: string;

  @Column({ type: 'text', unique: true })
  @Index()
  email!: string;

  @Column({ type: 'text', nullable: true })
  password_hash?: string;

  @Column({ type: 'text', nullable: true })
  full_name?: string;

  @Column({
    type: 'enum',
    enum: ['owner', 'admin', 'editor', 'viewer'],
    default: 'owner'
  })
  role!: AccountUserRole;

  @Column({ type: 'boolean', default: false })
  is_primary!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  last_login?: Date;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive'],
    default: 'active'
  })
  status!: AccountUserStatus;

  // Twitter OAuth fields (for Web2 authentication)
  @Column({ type: 'text', nullable: true })
  @Index()
  twitter_user_id?: string;

  @Column({ type: 'text', nullable: true })
  twitter_username?: string;

  @Column({ type: 'text', nullable: true })
  twitter_access_token?: string;

  @Column({ type: 'text', nullable: true })
  twitter_refresh_token?: string;

  @Column({ type: 'timestamp', nullable: true })
  twitter_token_expires_at?: Date;

  @CreateDateColumn()
  created_at!: Date;

  // Relations
  @ManyToOne(() => Account, account => account.account_users)
  @JoinColumn({ name: 'account_id' })
  account!: Account;
}

