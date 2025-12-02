import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DvybAccount } from './DvybAccount';

@Entity({ name: 'dvyb_upgrade_requests' })
export class DvybUpgradeRequest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  accountId!: number;

  @ManyToOne(() => DvybAccount)
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  accountName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  currentPlan!: string | null;

  @Column({ type: 'int', default: 0 })
  currentImageUsage!: number;

  @Column({ type: 'int', default: 0 })
  currentVideoUsage!: number;

  @Column({ type: 'int', default: 0 })
  imageLimit!: number;

  @Column({ type: 'int', default: 0 })
  videoLimit!: number;

  @Column({ type: 'enum', enum: ['pending', 'contacted', 'upgraded', 'rejected'], default: 'pending' })
  status!: 'pending' | 'contacted' | 'upgraded' | 'rejected';

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn()
  requestedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

