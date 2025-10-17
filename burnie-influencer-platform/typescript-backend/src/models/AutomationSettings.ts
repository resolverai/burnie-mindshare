import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './Account';
import { AccountClient } from './AccountClient';

export type AutomationFrequency = 'daily' | 'weekly' | 'custom';

@Entity('automation_settings')
export class AutomationSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  account_id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  account_client_id?: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({
    type: 'enum',
    enum: ['daily', 'weekly', 'custom'],
    default: 'daily'
  })
  frequency!: AutomationFrequency;

  @Column({ type: 'time', nullable: true })
  preferred_time?: string;

  @Column({ type: 'simple-array', nullable: true })
  content_types?: string[];

  @Column({ type: 'simple-array', nullable: true })
  platforms?: string[];

  @Column({ type: 'boolean', default: true })
  requires_approval!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Relations
  @ManyToOne(() => Account, account => account.automation_settings)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @ManyToOne(() => AccountClient, accountClient => accountClient.automation_settings, { nullable: true })
  @JoinColumn({ name: 'account_client_id' })
  account_client?: AccountClient;
}

