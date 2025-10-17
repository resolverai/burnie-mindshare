import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { Account } from './Account';
import { BrandContext } from './BrandContext';
import { AutomationSettings } from './AutomationSettings';

export type AccountClientStatus = 'active' | 'inactive';

@Entity('account_clients')
export class AccountClient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  account_id!: string;

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
}

