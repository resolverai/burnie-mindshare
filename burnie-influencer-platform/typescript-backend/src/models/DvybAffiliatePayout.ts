import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { DvybAffiliate } from './DvybAffiliate';

@Entity({ name: 'dvyb_affiliate_payouts' })
export class DvybAffiliatePayout {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  affiliateId!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: 'pending' | 'processing' | 'completed' | 'failed';

  // Period covered (e.g., "January 2026")
  @Column({ type: 'varchar', length: 50 })
  periodLabel!: string;

  // Payment method and reference
  @Column({ type: 'varchar', length: 50, nullable: true })
  paymentMethod!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymentReference!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt!: Date | null;

  @ManyToOne(() => DvybAffiliate)
  @JoinColumn({ name: 'affiliateId' })
  affiliate!: DvybAffiliate;

  @CreateDateColumn()
  createdAt!: Date;
}
