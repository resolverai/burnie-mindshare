import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User';

@Entity('user_networks')
export class UserNetwork {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'current_network', type: 'varchar', length: 50 })
  currentNetwork!: string; // 'base' or 'somnia_testnet'

  @Column({ name: 'past_network', type: 'varchar', length: 50, nullable: true })
  pastNetwork?: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

