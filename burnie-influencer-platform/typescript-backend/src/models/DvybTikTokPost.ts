import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_tiktok_posts' })
export class DvybTikTokPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'int', nullable: true })
  generatedContentId!: number | null;

  @Column({ type: 'text' })
  caption!: string;

  @Column({ type: 'text', nullable: true })
  videoUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  coverImageUrl!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tiktokVideoId!: string | null; // TikTok's video ID after posting

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'draft' })
  status!: string; // 'draft', 'scheduled', 'posted', 'failed'

  @Column({ type: 'timestamp', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  engagementMetrics!: {
    likes?: number;
    comments?: number;
    shares?: number;
    views?: number;
    favorites?: number;
    playTime?: number; // average watch time in seconds
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  hashtags!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

