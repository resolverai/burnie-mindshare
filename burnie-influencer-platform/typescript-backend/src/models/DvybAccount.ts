import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_accounts' })
export class DvybAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  accountName!: string;

  @Column({ type: 'varchar', length: 255, nullable: false, unique: true })
  @Index()
  primaryEmail!: string;

  @Column({ 
    type: 'varchar', 
    length: 50,
    default: 'web2'
  })
  accountType!: 'web3' | 'web2' | 'agency' | 'influencer';

  @Column({ type: 'varchar', length: 255, nullable: true })
  slug!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  logoS3Key!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

