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

  // Flow type - which acquisition flow this plan is for
  @Column({ 
    type: 'varchar', 
    length: 50, 
    default: 'website_analysis',
    comment: 'The flow this plan is for: website_analysis (flow 1) or product_photoshot (flow 2)'
  })
  planFlow!: 'website_analysis' | 'product_photoshot';

  // Freemium model - 7-day free trial with payment method required upfront
  @Column({ 
    type: 'boolean', 
    default: false,
    comment: 'If true, users get a free trial period before being charged'
  })
  isFreemium!: boolean;

  @Column({ 
    type: 'int', 
    default: 7,
    comment: 'Number of days for the free trial period (only applies if isFreemium is true)'
  })
  freemiumTrialDays!: number;

  // Deal / promotional pricing
  @Column({ type: 'boolean', default: false, comment: 'If true, deal prices are shown and charged. When turned off, renewals use original price.' })
  dealActive!: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, comment: 'Discounted monthly price when deal is active' })
  dealMonthlyPrice!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, comment: 'Discounted annual price when deal is active' })
  dealAnnualPrice!: number | null;

  /** Stripe Price IDs for deal pricing (created when deal is enabled) */
  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeDealMonthlyPriceId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeDealAnnualPriceId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

