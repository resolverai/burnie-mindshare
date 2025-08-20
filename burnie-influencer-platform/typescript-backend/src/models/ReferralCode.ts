import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { UserReferral } from './UserReferral';

export enum LeaderTier {
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM'
}

@Entity('referral_codes')
export class ReferralCode {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  communityName!: string;

  @Column({ type: 'varchar', length: 255 })
  leaderName!: string;

  @Column({ type: 'varchar', length: 42 })
  leaderWalletAddress!: string;

  @Column({
    type: 'enum',
    enum: LeaderTier,
    default: LeaderTier.SILVER
  })
  tier!: LeaderTier;

  @Column({ type: 'int', default: 500 })
  maxUses!: number;

  @Column({ type: 'int', default: 0 })
  currentUses!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalVolumeGenerated!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  totalCommissionsEarned!: number;

  @OneToMany(() => UserReferral, referral => referral.referralCode)
  referrals!: UserReferral[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Helper methods
  isExpired(): boolean {
    return !!(this.expiresAt && new Date() > this.expiresAt);
  }

  isMaxUsesReached(): boolean {
    return this.currentUses >= this.maxUses;
  }

  canBeUsed(): boolean {
    return this.isActive && !this.isExpired() && !this.isMaxUsesReached();
  }

  getCommissionRate(): number {
    switch (this.tier) {
      case LeaderTier.PLATINUM:
        return 0.10; // 10%
      case LeaderTier.GOLD:
        return 0.075; // 7.5%
      case LeaderTier.SILVER:
      default:
        return 0.05; // 5%
    }
  }

  getGrandReferrerRate(): number {
    return this.getCommissionRate() / 2;
  }
}
