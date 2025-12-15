import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { DvybAccount } from './DvybAccount';
import { DvybAccountSubscription } from './DvybAccountSubscription';

@Entity({ name: 'dvyb_account_payments' })
export class DvybAccountPayment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  accountId!: number;

  @Column({ type: 'int', nullable: true })
  subscriptionId!: number | null;

  @ManyToOne(() => DvybAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @ManyToOne(() => DvybAccountSubscription, { nullable: true })
  @JoinColumn({ name: 'subscriptionId' })
  subscription!: DvybAccountSubscription | null;

  // Stripe Payment Data
  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  stripePaymentIntentId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  stripeInvoiceId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeChargeId!: string | null;

  // Amount Details
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column({ type: 'varchar', length: 10, default: 'usd' })
  currency!: string;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status!: 'succeeded' | 'pending' | 'failed' | 'refunded' | 'partially_refunded';

  @Column({ type: 'varchar', length: 30 })
  paymentType!: 'subscription' | 'one_time' | 'proration' | 'refund';

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Promo Code Tracking
  @Column({ type: 'varchar', length: 100, nullable: true })
  stripePromotionCodeId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  promoCodeName!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discountAmount!: number;

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}

