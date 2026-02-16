import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_affiliates' })
export class DvybAffiliate {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index()
  email!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  profilePicture!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleId!: string | null;

  @Column({ type: 'varchar', length: 50, unique: true })
  @Index()
  referralCode!: string;

  // Commission tier: founding (40% lifetime) or standard (25% for 12 months)
  @Column({ type: 'varchar', length: 20, default: 'standard' })
  commissionTier!: 'founding' | 'standard';

  // Commission rate as a percentage (e.g., 40 for 40%)
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 25 })
  commissionRate!: number;

  // Second-tier override rate (for affiliates who recruit other affiliates)
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  secondTierRate!: number;

  // Commission duration in months (0 = lifetime/uncapped)
  @Column({ type: 'int', default: 12 })
  commissionDurationMonths!: number;

  // Parent affiliate (for second-tier referrals)
  @Column({ type: 'int', nullable: true })
  parentAffiliateId!: number | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  // Totals (denormalized for fast dashboard queries)
  @Column({ type: 'int', default: 0 })
  totalClicks!: number;

  @Column({ type: 'int', default: 0 })
  totalSignups!: number;

  @Column({ type: 'int', default: 0 })
  totalPaidConversions!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalCommissionEarned!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalCommissionPaid!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
