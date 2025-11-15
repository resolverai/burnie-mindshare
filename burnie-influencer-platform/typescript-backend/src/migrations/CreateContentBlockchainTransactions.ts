import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateContentBlockchainTransactions1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'content_blockchain_transactions',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          // Content Reference
          {
            name: 'content_id',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'blockchain_content_id',
            type: 'integer',
            isNullable: true,
          },
          // Network Information
          {
            name: 'network',
            type: 'varchar',
            length: '50',
            isNullable: false,
          },
          {
            name: 'chain_id',
            type: 'integer',
            isNullable: true,
          },
          // Transaction Type
          {
            name: 'transaction_type',
            type: 'varchar',
            length: '50',
            isNullable: false,
            comment: 'registration, approval, purchase, reward_distribution, personalization',
          },
          // Transaction Details
          {
            name: 'transaction_hash',
            type: 'varchar',
            length: '66',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
            comment: 'pending, confirmed, failed, reverted',
          },
          {
            name: 'block_number',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'gas_used',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'gas_price',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          // Contract Addresses
          {
            name: 'contract_address',
            type: 'varchar',
            length: '42',
            isNullable: true,
          },
          // Wallet Addresses
          {
            name: 'creator_wallet_address',
            type: 'varchar',
            length: '42',
            isNullable: false,
          },
          {
            name: 'current_owner_wallet',
            type: 'varchar',
            length: '42',
            isNullable: true,
          },
          {
            name: 'buyer_wallet_address',
            type: 'varchar',
            length: '42',
            isNullable: true,
          },
          // Content & Pricing Details
          {
            name: 'ipfs_cid',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'content_type',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'price',
            type: 'decimal',
            precision: 20,
            scale: 8,
            isNullable: true,
          },
          {
            name: 'currency',
            type: 'varchar',
            length: '20',
            isNullable: true,
          },
          // Reward Distribution Details
          {
            name: 'miner_reward',
            type: 'decimal',
            precision: 20,
            scale: 8,
            isNullable: true,
          },
          {
            name: 'evaluator_reward',
            type: 'decimal',
            precision: 20,
            scale: 8,
            isNullable: true,
          },
          {
            name: 'direct_referrer_reward',
            type: 'decimal',
            precision: 20,
            scale: 8,
            isNullable: true,
          },
          {
            name: 'grand_referrer_reward',
            type: 'decimal',
            precision: 20,
            scale: 8,
            isNullable: true,
          },
          {
            name: 'platform_fee',
            type: 'decimal',
            precision: 20,
            scale: 8,
            isNullable: true,
          },
          {
            name: 'direct_referrer_address',
            type: 'varchar',
            length: '42',
            isNullable: true,
          },
          {
            name: 'grand_referrer_address',
            type: 'varchar',
            length: '42',
            isNullable: true,
          },
          // Error Handling
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'retry_count',
            type: 'integer',
            default: 0,
          },
          // Metadata
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          // Timestamps
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'confirmed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'failed_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true
    );

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX idx_cbt_content_id_network 
      ON content_blockchain_transactions(content_id, network)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cbt_transaction_type_status 
      ON content_blockchain_transactions(transaction_type, status)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cbt_network_status 
      ON content_blockchain_transactions(network, status)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cbt_transaction_hash 
      ON content_blockchain_transactions(transaction_hash)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cbt_creator_wallet 
      ON content_blockchain_transactions(creator_wallet_address)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_cbt_buyer_wallet 
      ON content_blockchain_transactions(buyer_wallet_address) WHERE buyer_wallet_address IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('content_blockchain_transactions');
  }
}

