import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'dvyb_pricing_plans' })
export class DvybPricingPlan {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  planName!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  monthlyPrice!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  annualPrice!: number;

  @Column({ type: 'int', default: 0 })
  monthlyImageLimit!: number;

  @Column({ type: 'int', default: 0 })
  monthlyVideoLimit!: number;

  @Column({ type: 'int', default: 0 })
  annualImageLimit!: number;

  @Column({ type: 'int', default: 0 })
  annualVideoLimit!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  extraImagePostPrice!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  extraVideoPostPrice!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', default: false })
  isFreeTrialPlan!: boolean;

  // Stripe Integration Fields
  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeProductId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeMonthlyPriceId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeAnnualPriceId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

