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
import { DvybBrand } from './DvybBrand';

@Entity({ name: 'dvyb_brands_follow' })
@Index(['accountId', 'brandId'], { unique: true })
export class DvybBrandFollow {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'int' })
  brandId!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => DvybAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @ManyToOne(() => DvybBrand, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brandId' })
  brand!: DvybBrand;
}
