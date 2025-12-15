import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'dvyb_promo_codes' })
export class DvybPromoCode {
  @PrimaryGeneratedColumn()
  id!: number;

  // Our promo code details
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20 })
  discountType!: 'percent' | 'fixed';

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  discountValue!: number;

  // Stripe linking
  @Column({ type: 'varchar', length: 100, nullable: true })
  stripePromotionCodeId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  stripeCouponId!: string | null;

  // Usage limits
  @Column({ type: 'int', nullable: true })
  maxRedemptions!: number | null;

  @Column({ type: 'int', default: 0 })
  timesRedeemed!: number;

  @Column({ type: 'timestamp', nullable: true })
  validFrom!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  validUntil!: Date | null;

  // Restrictions
  @Column({ type: 'boolean', default: true })
  firstMonthOnly!: boolean;

  @Column({ type: 'int', nullable: true })
  applicablePlanId!: number | null; // If null, applies to all plans

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

