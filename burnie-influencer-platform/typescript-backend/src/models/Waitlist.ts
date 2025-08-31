import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User';

export enum WaitlistStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

@Entity('waitlist')
export class Waitlist {
  @PrimaryGeneratedColumn()
  id!: number;

  // Ensure wallet addresses are always lowercase
  @Column({ 
    type: 'varchar', 
    length: 42, 
    unique: true,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value
    }
  })
  walletAddress!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  username?: string;

  @Column({ type: 'text', nullable: true })
  reason?: string; // Why they want to join

  @Column({ type: 'varchar', length: 255, nullable: true })
  twitterHandle?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  discordHandle?: string;

  @Column({
    type: 'enum',
    enum: WaitlistStatus,
    default: WaitlistStatus.PENDING
  })
  status!: WaitlistStatus;

  @Column({ type: 'int', nullable: true })
  approvedByUserId?: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approvedByUserId' })
  approvedBy?: User;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt?: Date;

  @Column({ type: 'text', nullable: true })
  adminNotes?: string;

  @Column({ type: 'int', default: 0 })
  priority!: number; // Higher number = higher priority

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
