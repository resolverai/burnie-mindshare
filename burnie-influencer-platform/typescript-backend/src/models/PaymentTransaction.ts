import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './User';

export enum TransactionType {
  CONTENT_PURCHASE = 'content_purchase',
  STAKING_REWARD = 'staking_reward',
  PLATFORM_FEE = 'platform_fee',
  WITHDRAWAL = 'withdrawal',
  DEPOSIT = 'deposit',
  COMMISSION = 'commission',
  REFUND = 'refund',
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum Currency {
  ROAST = 'ROAST',
  USDC = 'USDC',
}

@Entity('payment_transactions')
@Index(['fromUserId'])
@Index(['toUserId'])
@Index(['status'])
@Index(['transactionType'])
@Index(['currency'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer', nullable: true })
  fromUserId?: number;

  @Column({ type: 'integer', nullable: true })
  toUserId?: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  amount!: number;

  @Column({
    type: 'enum',
    enum: Currency,
  })
  currency!: Currency;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  transactionType!: TransactionType;

  @Column({ type: 'varchar', length: 66, nullable: true })
  transactionHash?: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  platformFee?: number;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status!: TransactionStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  // Relations
  @ManyToOne(() => User, user => user.id, { nullable: true })
  @JoinColumn({ name: 'fromUserId' })
  fromUser?: User;

  @ManyToOne(() => User, user => user.id, { nullable: true })
  @JoinColumn({ name: 'toUserId' })
  toUser?: User;

  @CreateDateColumn()
  createdAt!: Date;

  // Helper methods
  getAmount(): number {
    return Number(this.amount);
  }

  getPlatformFee(): number {
    return Number(this.platformFee) || 0;
  }

  getNetAmount(): number {
    return this.getAmount() - this.getPlatformFee();
  }

  isROASTTransaction(): boolean {
    return this.currency === Currency.ROAST;
  }

  isUSDCTransaction(): boolean {
    return this.currency === Currency.USDC;
  }

  isPending(): boolean {
    return this.status === TransactionStatus.PENDING;
  }

  isConfirmed(): boolean {
    return this.status === TransactionStatus.CONFIRMED;
  }

  isFailed(): boolean {
    return this.status === TransactionStatus.FAILED;
  }

  confirm(): void {
    this.status = TransactionStatus.CONFIRMED;
  }

  fail(): void {
    this.status = TransactionStatus.FAILED;
  }

  cancel(): void {
    this.status = TransactionStatus.CANCELLED;
  }

  addTransactionHash(hash: string): void {
    this.transactionHash = hash;
  }

  getFormattedAmount(): string {
    return `${this.getAmount().toLocaleString()} ${this.currency}`;
  }

  getTransactionAge(): number {
    return Date.now() - this.createdAt.getTime();
  }

  addMetadata(data: any): void {
    this.metadata = { ...this.metadata, ...data };
  }

  static calculatePlatformFee(amount: number, feePercentage: number = 12.5): number {
    return amount * (feePercentage / 100);
  }
} 