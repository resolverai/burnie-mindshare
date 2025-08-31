import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UserReferral } from './UserReferral';
import { ContentPurchase } from './ContentPurchase';

export enum PayoutType {
  DIRECT_REFERRER = 'DIRECT_REFERRER',
  GRAND_REFERRER = 'GRAND_REFERRER'
}

export enum PayoutStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED'
}

@Entity('referral_payouts')
export class ReferralPayout {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  userReferralId!: number;

  @ManyToOne(() => UserReferral, referral => referral.payouts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userReferralId' })
  userReferral!: UserReferral;

  @Column({ type: 'int' })
  contentPurchaseId!: number;

  @ManyToOne(() => ContentPurchase, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contentPurchaseId' })
  contentPurchase!: ContentPurchase;

  // Ensure wallet addresses are always lowercase
  @Column({ 
    type: 'varchar', 
    length: 42,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value
    }
  })
  payoutWalletAddress!: string;

  @Column({
    type: 'enum',
    enum: PayoutType
  })
  payoutType!: PayoutType;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  roastAmount!: number;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  commissionRate!: number; // e.g., 0.05 for 5%

  @Column({ type: 'varchar', length: 66, nullable: true })
  transactionHash?: string;

  @Column({
    type: 'enum',
    enum: PayoutStatus,
    default: PayoutStatus.PENDING
  })
  status!: PayoutStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'timestamp', nullable: true })
  paidAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
