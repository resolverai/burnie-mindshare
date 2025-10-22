import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { Account } from './Account';
import { BrandContext } from './BrandContext';
import { AutomationSettings } from './AutomationSettings';
import { Web2GeneratedContent } from './Web2GeneratedContent';
import { ContextManagement } from './ContextManagement';

export type AccountClientStatus = 'active' | 'inactive';

@Entity('account_clients')
export class AccountClient {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', unique: true, nullable: true })
  uuid?: string;

  @Column({ type: 'int' })
  @Index()
  account_id!: number;

  @Column({ type: 'text' })
  client_name!: string;

  @Column({ type: 'text', nullable: true })
  client_industry?: string;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive'],
    default: 'active'
  })
  status!: AccountClientStatus;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Relations
  @ManyToOne(() => Account, account => account.account_clients)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @OneToMany(() => BrandContext, brandContext => brandContext.account_client)
  brand_contexts!: BrandContext[];

  @OneToMany(() => AutomationSettings, settings => settings.account_client)
  automation_settings!: AutomationSettings[];

  @OneToMany(() => Web2GeneratedContent, content => content.account_client)
  generated_contents!: Web2GeneratedContent[];

  @OneToMany(() => ContextManagement, context => context.account_client)
  context_management!: ContextManagement[];
}

