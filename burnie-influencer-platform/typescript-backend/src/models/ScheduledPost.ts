import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Web2GeneratedContent } from './Web2GeneratedContent';

export type ScheduledPostStatus = 'scheduled' | 'published' | 'failed' | 'cancelled';

@Entity('scheduled_posts')
export class ScheduledPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', unique: true, nullable: true })
  uuid?: string;

  @Column({ type: 'int' })
  @Index()
  generated_content_id!: number;

  @Column({ type: 'simple-array' })
  platforms!: string[];

  @Column({ type: 'timestamp' })
  @Index()
  scheduled_time!: Date;

  @Column({
    type: 'enum',
    enum: ['scheduled', 'published', 'failed', 'cancelled'],
    default: 'scheduled'
  })
  @Index()
  status!: ScheduledPostStatus;

  @Column({ type: 'timestamp', nullable: true })
  published_at?: Date;

  @Column({ type: 'text', nullable: true })
  error_message?: string;

  @Column({ type: 'jsonb', nullable: true })
  platform_post_ids?: Record<string, string>;

  @CreateDateColumn()
  created_at!: Date;

  // Relations
  @ManyToOne(() => Web2GeneratedContent)
  @JoinColumn({ name: 'generated_content_id' })
  generated_content!: Web2GeneratedContent;
}

