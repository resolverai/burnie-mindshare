import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne } from 'typeorm';

@Entity({ name: 'web3_project_accounts' })
export class Web3ProjectAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  twitterUserId!: string; // one twitter handle ↔ one project

  @Column({ type: 'varchar', length: 255 })
  twitterHandle!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  slug!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  logoS3Key!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  website!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}


