import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { DvybAffiliate } from './DvybAffiliate';
import { DvybAffiliateReferral } from './DvybAffiliateReferral';

@Entity({ name: 'dvyb_affiliate_commissions' })
export class DvybAffiliateCommission {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  affiliateId!: number;

  @Column({ type: 'int' })
  @Index()
  referralId!: number;

  // The referred account's subscription payment that triggered this commission
  @Column({ type: 'int', nullable: true })
  subscriptionPaymentId!: number | null;

  // Whether this is a direct (tier-1) or second-tier commission
  @Column({ type: 'varchar', length: 20, default: 'direct' })
  commissionType!: 'direct' | 'second_tier';

  // The subscription amount that was paid by the referred user
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subscriptionAmount!: number;

  // The commission rate at the time of calculation
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionRate!: number;

  // The commission amount earned
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  commissionAmount!: number;

  // Billing cycle info
  @Column({ type: 'varchar', length: 20 })
  billingCycle!: 'monthly' | 'annual';

  // Period this commission covers
  @Column({ type: 'varchar', length: 50, nullable: true })
  periodLabel!: string | null;

  // Status
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: 'pending' | 'approved' | 'paid' | 'cancelled';

  @ManyToOne(() => DvybAffiliate)
  @JoinColumn({ name: 'affiliateId' })
  affiliate!: DvybAffiliate;

  @ManyToOne(() => DvybAffiliateReferral)
  @JoinColumn({ name: 'referralId' })
  referral!: DvybAffiliateReferral;

  @CreateDateColumn()
  createdAt!: Date;
}
