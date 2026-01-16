import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { DvybAccount } from './DvybAccount';
import { DvybPricingPlan } from './DvybPricingPlan';

@Entity({ name: 'dvyb_account_subscriptions' })
export class DvybAccountSubscription {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  accountId!: number;

  @Column({ type: 'int' })
  planId!: number;

  @ManyToOne(() => DvybAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @ManyToOne(() => DvybPricingPlan)
  @JoinColumn({ name: 'planId' })
  plan!: DvybPricingPlan;

  // Stripe Subscription Data
  @Column({ type: 'varchar', length: 100 })
  @Index()
  stripeSubscriptionId!: string;

  @Column({ type: 'varchar', length: 100 })
  stripePriceId!: string;

  @Column({ type: 'varchar', length: 20, default: 'monthly' })
  selectedFrequency!: 'monthly' | 'annual';

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'unpaid' | 'paused';

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodStart!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd!: Date | null;

  // Freemium trial tracking
  @Column({ type: 'timestamp', nullable: true })
  trialStart!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  trialEnd!: Date | null;

  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  canceledAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt!: Date | null;

  // For scheduled downgrades
  @Column({ type: 'int', nullable: true })
  pendingPlanId!: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  pendingFrequency!: 'monthly' | 'annual' | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

