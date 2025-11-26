import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_linkedin_posts' })
export class DvybLinkedInPost {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'int', nullable: true })
  generatedContentId!: number | null;

  @Column({ type: 'text' })
  postText!: string;

  @Column({ type: 'text', nullable: true })
  mediaUrl!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  mediaType!: string | null; // 'image', 'video', 'document', 'article'

  @Column({ type: 'varchar', length: 255, nullable: true })
  linkedInPostId!: string | null; // LinkedIn's post ID after posting

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'draft' })
  status!: string; // 'draft', 'scheduled', 'posted', 'failed'

  @Column({ type: 'timestamp', nullable: true })
  scheduledAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  engagementMetrics!: {
    reactions?: number;
    comments?: number;
    shares?: number;
    impressions?: number;
    clicks?: number;
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

