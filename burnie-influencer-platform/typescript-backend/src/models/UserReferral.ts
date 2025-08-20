import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { User } from './User';
import { ReferralCode } from './ReferralCode';
import { ReferralPayout } from './ReferralPayout';

export enum ReferralStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

@Entity('user_referrals')
export class UserReferral {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  userId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'int' })
  referralCodeId!: number;

  @ManyToOne(() => ReferralCode, code => code.referrals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referralCodeId' })
  referralCode!: ReferralCode;

  @Column({ type: 'int', nullable: true })
  directReferrerId?: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'directReferrerId' })
  directReferrer?: User;

  @Column({ type: 'int', nullable: true })
  grandReferrerId?: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'grandReferrerId' })
  grandReferrer?: User;

  @Column({
    type: 'enum',
    enum: ReferralStatus,
    default: ReferralStatus.APPROVED
  })
  status!: ReferralStatus;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalVolumeGenerated!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalCommissionsEarned!: number;

  @Column({ type: 'int', default: 0 })
  transactionCount!: number;

  @OneToMany(() => ReferralPayout, payout => payout.userReferral)
  payouts!: ReferralPayout[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
