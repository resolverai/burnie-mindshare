import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_schedules' })
export class DvybSchedule {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'int', nullable: true })
  generatedContentId!: number | null;

  @Index()
  @Column({ type: 'timestamp' })
  scheduledFor!: Date;

  @Column({ type: 'varchar', length: 100, default: 'UTC' })
  timezone!: string;

  @Column({ type: 'varchar', length: 50, default: 'twitter' })
  platform!: string;

  @Index()
  @Column({ 
    type: 'varchar', 
    length: 50, 
    default: 'pending' 
  })
  status!: 'pending' | 'posted' | 'failed' | 'cancelled';

  @Column({ type: 'jsonb', nullable: true })
  postMetadata!: any | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

