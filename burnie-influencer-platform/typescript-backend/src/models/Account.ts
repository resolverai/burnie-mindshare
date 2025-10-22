import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { AccountUser } from './AccountUser';
import { AccountClient } from './AccountClient';
import { BrandContext } from './BrandContext';
import { AccountSocialMediaConnection } from './AccountSocialMediaConnection';
import { AutomationSettings } from './AutomationSettings';
import { Web2GeneratedContent } from './Web2GeneratedContent';
import { ContextManagement } from './ContextManagement';

export type AccountType = 'individual' | 'business' | 'agency';
export type AccountStatus = 'active' | 'inactive' | 'suspended';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', unique: true, nullable: true })
  uuid?: string;

  @Column({
    type: 'enum',
    enum: ['individual', 'business', 'agency'],
    default: 'individual'
  })
  account_type!: AccountType;

  @Column({ type: 'text', nullable: true })
  business_name?: string;

  @Column({ type: 'text', nullable: true })
  industry?: string;

  @Column({ type: 'simple-array', nullable: true })
  use_case?: string[];

  @Column({ type: 'text', nullable: true })
  subscription_tier?: string;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  })
  status!: AccountStatus;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Relations
  @OneToMany(() => AccountUser, accountUser => accountUser.account)
  account_users!: AccountUser[];

  @OneToMany(() => AccountClient, accountClient => accountClient.account)
  account_clients!: AccountClient[];

  @OneToMany(() => BrandContext, brandContext => brandContext.account)
  brand_contexts!: BrandContext[];

  @OneToMany(() => AccountSocialMediaConnection, connection => connection.account)
  social_media_connections!: AccountSocialMediaConnection[];

  @OneToMany(() => AutomationSettings, settings => settings.account)
  automation_settings!: AutomationSettings[];

  @OneToMany(() => Web2GeneratedContent, content => content.account)
  generated_contents!: Web2GeneratedContent[];

  @OneToMany(() => ContextManagement, context => context.account)
  context_management!: ContextManagement[];
}

