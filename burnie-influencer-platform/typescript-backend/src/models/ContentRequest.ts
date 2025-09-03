import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User';

export enum ContentRequestStatus {
  REQUESTED = 'REQUESTED',
  INPROGRESS = 'INPROGRESS',
  COMPLETED = 'COMPLETED'
}

@Entity('content_requests')
export class ContentRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  projectName!: string;

  @Column({ type: 'varchar', length: 100 })
  platform!: string;

  @Column({ type: 'text', nullable: true })
  campaignLinks?: string;

  @Column({ type: 'varchar', length: 100, default: ContentRequestStatus.REQUESTED })
  status!: ContentRequestStatus;

  @Column({ type: 'varchar', length: 42, nullable: true })
  walletAddress?: string;

  @Column({ type: 'text', nullable: true })
  adminNotes?: string;

  @Column({ type: 'text', nullable: true })
  generatedContent?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'uuid', nullable: true })
  userId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
