import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { DvybAccount } from './DvybAccount';

/**
 * Tracks which domain product images an account has chosen to hide from their My Products list.
 * Domain products are shared by domain; hiding only affects this account's view.
 */
@Entity({ name: 'dvyb_account_hidden_domain_products' })
@Index(['accountId', 'domainProductImageId'], { unique: true })
export class DvybAccountHiddenDomainProduct {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'int' })
  domainProductImageId!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => DvybAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;
}
