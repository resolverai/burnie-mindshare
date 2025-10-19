import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './Account';
import { AccountClient } from './AccountClient';

@Entity('brand_context')
export class BrandContext {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', unique: true, nullable: true })
  uuid?: string;

  @Column({ type: 'int', nullable: true })
  @Index()
  account_id?: number;

  @Column({ type: 'int', nullable: true })
  @Index()
  account_client_id?: number;

  @Column({ type: 'text' })
  brand_name!: string;

  @Column({ type: 'text', nullable: true })
  brand_tagline?: string;

  @Column({ type: 'text', nullable: true })
  brand_description?: string;

  @Column({ type: 'simple-array', nullable: true })
  brand_values?: string[];

  @Column({ type: 'text', nullable: true })
  target_audience?: string;

  @Column({ type: 'simple-array', nullable: true })
  tone_of_voice?: string[];

  @Column({ type: 'jsonb', nullable: true })
  color_palette?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };

  @Column({ type: 'text', nullable: true })
  typography_preferences?: string;

  @Column({ type: 'text', nullable: true })
  logo_url?: string;

  @Column({ type: 'simple-array', nullable: true })
  product_images?: string[];

  @Column({ type: 'text', nullable: true })
  brand_aesthetics?: string;

  @Column({ type: 'text', nullable: true })
  industry?: string;

  @Column({ type: 'jsonb', nullable: true })
  industry_specific_context?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  content_preferences?: Record<string, any>;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Relations
  @ManyToOne(() => Account, account => account.brand_contexts, { nullable: true })
  @JoinColumn({ name: 'account_id' })
  account?: Account;

  @ManyToOne(() => AccountClient, accountClient => accountClient.brand_contexts, { nullable: true })
  @JoinColumn({ name: 'account_client_id' })
  account_client?: AccountClient;
}

