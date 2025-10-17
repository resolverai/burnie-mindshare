import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './Account';
import { AccountClient } from './AccountClient';
import { AccountUser } from './AccountUser';

export type Web2ContentType = 'image' | 'video';
export type Web2ContentStatus = 'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected';

@Entity('web2_generated_content')
export class Web2GeneratedContent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  account_id!: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  account_client_id?: string;

  @Column({ type: 'uuid' })
  @Index()
  created_by_user_id!: string;

  @Column({
    type: 'enum',
    enum: ['image', 'video']
  })
  content_type!: Web2ContentType;

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'text' })
  generated_url!: string;

  @Column({ type: 'text', nullable: true })
  thumbnail_url?: string;

  @Column({ type: 'jsonb', nullable: true })
  generation_metadata?: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  caption?: string;

  @Column({
    type: 'enum',
    enum: ['draft', 'pending_approval', 'approved', 'published', 'rejected'],
    default: 'draft'
  })
  @Index()
  status!: Web2ContentStatus;

  @Column({ type: 'uuid', nullable: true })
  approved_by_user_id?: string;

  @Column({ type: 'timestamp', nullable: true })
  approved_at?: Date;

  @CreateDateColumn()
  created_at!: Date;

  // Relations
  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @ManyToOne(() => AccountClient, { nullable: true })
  @JoinColumn({ name: 'account_client_id' })
  account_client?: AccountClient;

  @ManyToOne(() => AccountUser)
  @JoinColumn({ name: 'created_by_user_id' })
  created_by_user!: AccountUser;

  @ManyToOne(() => AccountUser, { nullable: true })
  @JoinColumn({ name: 'approved_by_user_id' })
  approved_by_user?: AccountUser;
}

