import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm'
import { ContentMarketplace } from './ContentMarketplace'
import { User } from './User'

@Entity('content_purchases')
export class ContentPurchase {
  @PrimaryGeneratedColumn()
  id!: number

  @Column({ name: 'content_id' })
  contentId!: number

  @Column({ name: 'buyer_wallet_address', length: 255 })
  buyerWalletAddress!: string

  @Column({ name: 'miner_wallet_address', length: 255 })
  minerWalletAddress!: string

  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'purchase_price' })
  purchasePrice!: number

  @Column({ type: 'varchar', length: 20, default: 'ROAST', name: 'currency' })
  currency!: string

  @Column({ type: 'varchar', length: 20, name: 'payment_currency' })
  paymentCurrency!: string // Currency actually paid by yapper (ROAST/USDC)

  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'conversion_rate' })
  conversionRate!: number // ROAST to USD rate at time of purchase

  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'original_roast_price' })
  originalRoastPrice!: number // Original asking price in ROAST (from bidding)

  @Column({ name: 'transaction_hash', length: 255, nullable: true })
  transactionHash!: string

  @Column({ type: 'varchar', length: 50, default: 'pending', name: 'payment_status' })
  paymentStatus!: 'pending' | 'completed' | 'failed' | 'refunded'

  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'platform_fee', default: 0 })
  platformFee!: number // Always in payment currency

  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'miner_payout', default: 0 })
  minerPayout!: number // Always in ROAST (80% of original asking price)

  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'miner_payout_roast', default: 0 })
  minerPayoutRoast!: number // Explicit ROAST amount for miner (for clarity)

  @Column({ name: 'treasury_transaction_hash', length: 255, nullable: true })
  treasuryTransactionHash!: string

  @Column({ type: 'varchar', length: 50, default: 'pending', name: 'payout_status' })
  payoutStatus!: 'pending' | 'completed' | 'failed'

  // Referral Payout Fields
  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'direct_referrer_payout', default: 0 })
  directReferrerPayout!: number // ROAST amount paid to direct referrer

  @Column({ type: 'decimal', precision: 20, scale: 8, name: 'grand_referrer_payout', default: 0 })
  grandReferrerPayout!: number // ROAST amount paid to grand referrer

  @Column({ name: 'direct_referrer_tx_hash', length: 255, nullable: true })
  directReferrerTxHash?: string

  @Column({ name: 'grand_referrer_tx_hash', length: 255, nullable: true })
  grandReferrerTxHash?: string

  @Column({ type: 'varchar', length: 50, default: 'pending', name: 'referral_payout_status' })
  referralPayoutStatus!: 'pending' | 'completed' | 'failed' | 'not_applicable'

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date

  @Column({ name: 'purchased_at', type: 'timestamp', nullable: true })
  purchasedAt!: Date

  // Relations
  @ManyToOne(() => ContentMarketplace)
  @JoinColumn({ name: 'content_id' })
  content!: ContentMarketplace

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'buyer_wallet_address', referencedColumnName: 'walletAddress' })
  buyer!: User

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'miner_wallet_address', referencedColumnName: 'walletAddress' })
  miner!: User
} 