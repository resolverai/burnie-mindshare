import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_instagram_posts' })
export class DvybInstagramPost {
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
  mediaUrl!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  mediaType!: string | null; // 'image', 'video', 'carousel', 'reel', 'story'

  @Column({ type: 'varchar', length: 255, nullable: true })
  instagramMediaId!: string | null; // Instagram's media ID after posting

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
    saves?: number;
    reach?: number;
    impressions?: number;
    plays?: number; // for videos/reels
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

