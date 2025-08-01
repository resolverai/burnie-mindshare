import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  @Index()
  username!: string;

  @Column()
  password_hash!: string;

  @Column({ default: true })
  is_active!: boolean;

  @Column({ nullable: true })
  last_login?: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Method to check if admin can access campaign creation
  public canCreateCampaigns(): boolean {
    return this.is_active;
  }
} 