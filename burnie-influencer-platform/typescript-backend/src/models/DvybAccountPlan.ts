import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { DvybAccount } from './DvybAccount';
import { DvybPricingPlan } from './DvybPricingPlan';

@Entity({ name: 'dvyb_account_plans' })
export class DvybAccountPlan {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  accountId!: number;

  @Column({ type: 'int' })
  planId!: number;

  @ManyToOne(() => DvybAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @ManyToOne(() => DvybPricingPlan)
  @JoinColumn({ name: 'planId' })
  plan!: DvybPricingPlan;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  startDate!: Date;

  @Column({ type: 'timestamp', nullable: true })
  endDate!: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'monthly' })
  selectedFrequency!: 'monthly' | 'annual';

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'cancelled' | 'expired';

  @Column({ type: 'varchar', length: 20, default: 'initial' })
  changeType!: 'initial' | 'upgrade' | 'downgrade' | 'renewal';

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

