import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { DvybAffiliate } from './DvybAffiliate';
import { DvybAccount } from './DvybAccount';

@Entity({ name: 'dvyb_affiliate_referrals' })
export class DvybAffiliateReferral {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  affiliateId!: number;

  // The DvybAccount that was referred (signed up via affiliate link)
  @Column({ type: 'int', unique: true })
  @Index()
  referredAccountId!: number;

  // Status of the referral
  @Column({ type: 'varchar', length: 20, default: 'signed_up' })
  status!: 'signed_up' | 'subscribed' | 'churned';

  // The referral code used at signup
  @Column({ type: 'varchar', length: 50 })
  referralCode!: string;

  @ManyToOne(() => DvybAffiliate)
  @JoinColumn({ name: 'affiliateId' })
  affiliate!: DvybAffiliate;

  @ManyToOne(() => DvybAccount)
  @JoinColumn({ name: 'referredAccountId' })
  referredAccount!: DvybAccount;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
