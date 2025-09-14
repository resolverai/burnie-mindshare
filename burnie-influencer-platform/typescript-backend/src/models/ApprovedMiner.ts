import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('approved_miners')
@Index(['walletAddress'], { unique: true }) // Ensure unique wallet addresses
export class ApprovedMiner {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'wallet_address', type: 'varchar', length: 42 })
  walletAddress!: string;

  @Column({ name: 'approved_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  approvedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // Helper methods
  public isActive(): boolean {
    return true; // All approved miners are active unless explicitly removed
  }

  public static normalizeWalletAddress(walletAddress: string): string {
    return walletAddress.toLowerCase().trim();
  }
}
