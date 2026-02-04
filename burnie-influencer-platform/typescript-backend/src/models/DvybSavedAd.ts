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
import { DvybBrandAd } from './DvybBrandAd';

@Entity({ name: 'dvyb_saved_ads' })
@Index(['accountId', 'adId'], { unique: true })
export class DvybSavedAd {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'int' })
  adId!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => DvybAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @ManyToOne(() => DvybBrandAd, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'adId' })
  ad!: DvybBrandAd;
}
