import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ContentMarketplace } from './ContentMarketplace';

@Entity('admin_content_approvals')
export class AdminContentApproval {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'admin_wallet_address', type: 'varchar', length: 42 })
  adminWalletAddress!: string;

  @Column({ name: 'content_id', type: 'uuid' })
  contentId!: string;

  @Column({ name: 'miner_wallet_address', type: 'varchar', length: 42 })
  minerWalletAddress!: string;

  @Column({ 
    name: 'status', 
    type: 'enum', 
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  })
  status!: 'pending' | 'approved' | 'rejected';

  @Column({ name: 'bidding_enabled', type: 'boolean', default: false })
  biddingEnabled!: boolean;

  @Column({ name: 'admin_notes', type: 'text', nullable: true })
  adminNotes!: string | null;

  @Column({ name: 'assigned_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  assignedAt!: Date;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // Relationship with ContentMarketplace
  @ManyToOne(() => ContentMarketplace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'content_id' })
  content!: ContentMarketplace;
}
