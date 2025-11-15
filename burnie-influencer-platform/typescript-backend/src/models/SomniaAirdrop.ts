import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User';

@Entity('somnia_airdrops')
export class SomniaAirdrop {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'wallet_address', type: 'varchar', length: 42 })
  walletAddress!: string;

  @Column({ name: 'airdrop_amount', type: 'decimal', precision: 20, scale: 8 })
  airdropAmount!: number;

  @Column({ name: 'transaction_hash', type: 'varchar', length: 66 })
  transactionHash!: string;

  @Column({ name: 'network', type: 'varchar', length: 50 })
  network!: string; // 'somnia_testnet'

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

