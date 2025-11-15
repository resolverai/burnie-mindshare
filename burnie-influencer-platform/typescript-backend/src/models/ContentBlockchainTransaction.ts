import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('content_blockchain_transactions')
@Index(['contentId', 'network'])
@Index(['transactionType', 'status'])
@Index(['network', 'status'])
@Index(['transactionHash'])
@Index(['creatorWalletAddress'])
export class ContentBlockchainTransaction {
  @PrimaryGeneratedColumn()
  id!: number;

  // Content Reference
  @Column({ name: 'content_id', type: 'integer' })
  contentId!: number; // References content_marketplace.id

  @Column({ name: 'blockchain_content_id', type: 'integer', nullable: true })
  blockchainContentId!: number | null; // Content ID on the blockchain (may differ from DB ID)

  // Network Information
  @Column({ name: 'network', type: 'varchar', length: 50 })
  network!: string; // 'base_mainnet', 'somnia_testnet', 'somnia_mainnet', etc.

  @Column({ name: 'chain_id', type: 'integer', nullable: true })
  chainId!: number | null; // Chain ID (e.g., 50312 for Somnia testnet)

  // Transaction Type
  @Column({ name: 'transaction_type', type: 'varchar', length: 50 })
  transactionType!: string; // 'registration', 'approval', 'purchase', 'reward_distribution', 'personalization'

  // Transaction Details
  @Column({ name: 'transaction_hash', type: 'varchar', length: 66, nullable: true })
  transactionHash!: string | null; // Blockchain transaction hash

  @Column({ name: 'status', type: 'varchar', length: 50, default: 'pending' })
  status!: string; // 'pending', 'confirmed', 'failed', 'reverted'

  @Column({ name: 'block_number', type: 'bigint', nullable: true })
  blockNumber!: string | null; // Block number where transaction was mined

  @Column({ name: 'gas_used', type: 'varchar', length: 50, nullable: true })
  gasUsed!: string | null; // Gas used for the transaction

  @Column({ name: 'gas_price', type: 'varchar', length: 50, nullable: true })
  gasPrice!: string | null; // Gas price in wei

  // Contract Addresses
  @Column({ name: 'contract_address', type: 'varchar', length: 42, nullable: true })
  contractAddress!: string | null; // Smart contract address interacted with

  // Wallet Addresses (all lowercase)
  @Column({ 
    name: 'creator_wallet_address', 
    type: 'varchar', 
    length: 42,
    transformer: {
      to: (value: string | null) => value ? value.toLowerCase() : value,
      from: (value: string | null) => value
    }
  })
  creatorWalletAddress!: string; // Content creator's wallet

  @Column({ 
    name: 'current_owner_wallet', 
    type: 'varchar', 
    length: 42,
    nullable: true,
    transformer: {
      to: (value: string | null) => value ? value.toLowerCase() : value,
      from: (value: string | null) => value
    }
  })
  currentOwnerWallet!: string | null; // Current owner (changes on purchase)

  @Column({ 
    name: 'buyer_wallet_address', 
    type: 'varchar', 
    length: 42,
    nullable: true,
    transformer: {
      to: (value: string | null) => value ? value.toLowerCase() : value,
      from: (value: string | null) => value
    }
  })
  buyerWalletAddress!: string | null; // Buyer's wallet (for purchase transactions)

  // Content & Pricing Details
  @Column({ name: 'ipfs_cid', type: 'text', nullable: true })
  ipfsCid!: string | null; // IPFS Content Identifier

  @Column({ name: 'content_type', type: 'varchar', length: 50, nullable: true })
  contentType!: string | null; // 'text', 'image', 'video', 'thread', etc.

  @Column({ name: 'price', type: 'decimal', precision: 20, scale: 8, nullable: true })
  price!: string | null; // Price in tokens (for approval/purchase transactions)

  @Column({ name: 'currency', type: 'varchar', length: 20, nullable: true })
  currency!: string | null; // 'TOAST', 'ROAST', 'USDC', etc.

  // Reward Distribution Details (for purchase transactions)
  @Column({ name: 'miner_reward', type: 'decimal', precision: 20, scale: 8, nullable: true })
  minerReward!: string | null; // 50% to miner

  @Column({ name: 'evaluator_reward', type: 'decimal', precision: 20, scale: 8, nullable: true })
  evaluatorReward!: string | null; // 20% to evaluator

  @Column({ name: 'direct_referrer_reward', type: 'decimal', precision: 20, scale: 8, nullable: true })
  directReferrerReward!: string | null; // 5-10% to direct referrer

  @Column({ name: 'grand_referrer_reward', type: 'decimal', precision: 20, scale: 8, nullable: true })
  grandReferrerReward!: string | null; // 2.5-5% to grand referrer

  @Column({ name: 'platform_fee', type: 'decimal', precision: 20, scale: 8, nullable: true })
  platformFee!: string | null; // Remaining platform fee

  @Column({ 
    name: 'direct_referrer_address', 
    type: 'varchar', 
    length: 42,
    nullable: true,
    transformer: {
      to: (value: string | null) => value ? value.toLowerCase() : value,
      from: (value: string | null) => value
    }
  })
  directReferrerAddress!: string | null;

  @Column({ 
    name: 'grand_referrer_address', 
    type: 'varchar', 
    length: 42,
    nullable: true,
    transformer: {
      to: (value: string | null) => value ? value.toLowerCase() : value,
      from: (value: string | null) => value
    }
  })
  grandReferrerAddress!: string | null;

  // Error Handling
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null; // Error message if transaction failed

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount!: number; // Number of retry attempts

  // Metadata
  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata!: any | null; // Additional transaction-specific data

  // Timestamps
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date; // When transaction was initiated

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date; // Last update

  @Column({ name: 'confirmed_at', type: 'timestamp', nullable: true })
  confirmedAt!: Date | null; // When transaction was confirmed on-chain

  @Column({ name: 'failed_at', type: 'timestamp', nullable: true })
  failedAt!: Date | null; // When transaction failed
}

