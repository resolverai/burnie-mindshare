import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Project } from './Project';

@Entity('web3_posts_schedule')
@Index(['projectId', 'mediaS3Url'])
export class Web3PostsSchedule {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  projectId!: number;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project!: Project;

  // Media S3 URL - used as the key to identify which post this schedule is for
  @Column({ type: 'varchar', length: 500, nullable: false })
  @Index()
  mediaS3Url!: string;

  // Media type: 'image' or 'video'
  @Column({ type: 'varchar', length: 20, nullable: false })
  mediaType!: 'image' | 'video';

  // Tweet content as JSON
  // Structure: { main_tweet: string, thread_array?: string[], content_type: 'thread' | 'shitpost' | 'longpost' }
  @Column({ type: 'jsonb', nullable: false })
  tweetText!: {
    main_tweet: string;
    thread_array?: string[];
    content_type: 'thread' | 'shitpost' | 'longpost';
  };

  // Scheduled date and time for this single post
  // This is a one-time schedule (not recurring)
  @Column({ type: 'timestamp', nullable: false })
  @Index()
  scheduledAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

