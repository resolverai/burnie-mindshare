import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('content_ipfs_uploads')
export class ContentIpfsUpload {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'content_id' })
  contentId!: number;

  @Column({ name: 'cid', type: 'text' })
  cid!: string; // IPFS CID (Hash)

  @Column({ name: 'transaction_hash', type: 'varchar', length: 66, nullable: true })
  transactionHash?: string; // Somnia testnet transaction hash

  @Column({ name: 'file_name', type: 'text' })
  fileName!: string;

  @Column({ name: 'file_size', type: 'varchar', length: 50 })
  fileSize!: string;

  @Column({ name: 'network', type: 'varchar', length: 50, default: 'somnia_testnet' })
  network!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

