import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_affiliate_banking_details' })
export class DvybAffiliateBankingDetails {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', unique: true })
  @Index()
  affiliateId!: number;

  // Bank account holder name
  @Column({ type: 'varchar', length: 255, nullable: true })
  accountHolderName!: string | null;

  // Bank name
  @Column({ type: 'varchar', length: 255, nullable: true })
  bankName!: string | null;

  // Account number (encrypted/masked in responses)
  @Column({ type: 'varchar', length: 255, nullable: true })
  accountNumber!: string | null;

  // Routing number / IFSC / SWIFT
  @Column({ type: 'varchar', length: 100, nullable: true })
  routingNumber!: string | null;

  // Account type
  @Column({ type: 'varchar', length: 20, nullable: true })
  accountType!: 'checking' | 'savings' | null;

  // Country
  @Column({ type: 'varchar', length: 100, nullable: true })
  country!: string | null;

  // Currency preference
  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency!: string;

  // PayPal email as alternative
  @Column({ type: 'varchar', length: 255, nullable: true })
  paypalEmail!: string | null;

  // Preferred payout method
  @Column({ type: 'varchar', length: 20, default: 'bank_transfer' })
  preferredMethod!: 'bank_transfer' | 'paypal';

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
