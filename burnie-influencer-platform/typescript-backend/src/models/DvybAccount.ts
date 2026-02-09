import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_accounts' })
export class DvybAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  accountName!: string;

  @Column({ type: 'varchar', length: 255, nullable: false, unique: true })
  @Index()
  primaryEmail!: string;

  @Column({ 
    type: 'varchar', 
    length: 50,
    default: 'web2'
  })
  accountType!: 'web3' | 'web2' | 'agency' | 'influencer';

  @Column({ type: 'varchar', length: 255, nullable: true })
  slug!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  logoS3Key!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // Auto-generation settings
  @Column({ type: 'boolean', default: false })
  autoGenerationEnabled!: boolean;

  @Column({ type: 'date', nullable: true })
  lastAutoGenerationDate!: Date | null;

  @Column({ type: 'time', nullable: true })
  autoGenerationTime!: string | null; // Staggered time slot (e.g., "08:30:00")

  @Column({ type: 'varchar', length: 50, nullable: true })
  autoGenerationStatus!: 'pending' | 'generating' | 'completed' | 'failed' | 'skipped' | null;

  @Column({ type: 'text', nullable: true })
  lastAutoGenerationError!: string | null;

  @Column({ type: 'int', default: 0 })
  autoGenerationRetryCount!: number;

  // Customer Acquisition Segment - set once on first login, never updated
  @Column({ 
    type: 'varchar', 
    length: 50, 
    nullable: true,
    comment: 'The flow through which the customer first signed up: website_analysis (flow 1) or product_photoshot (flow 2)'
  })
  initialAcquisitionFlow!: 'website_analysis' | 'product_photoshot' | null;

  // Free trial edit limit: user can edit and save design once after visiting discover
  @Column({ type: 'boolean', default: false })
  hasVisitedDiscover!: boolean;

  @Column({ type: 'int', default: 0 })
  freeTrialEditSaveCount!: number;

  // Stripe Integration
  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeCustomerId!: string | null;

  @Column({ type: 'int', nullable: true })
  currentPlanId!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

