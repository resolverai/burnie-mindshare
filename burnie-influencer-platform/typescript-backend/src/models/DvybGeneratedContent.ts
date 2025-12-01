import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_generated_content' })
export class DvybGeneratedContent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'uuid', unique: true })
  uuid!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  jobId!: string | null;

  // Generation type: on_demand (ad-hoc) or scheduled (weekly)
  @Index()
  @Column({ 
    type: 'varchar', 
    length: 50, 
    default: 'on_demand' 
  })
  generationType!: string; // on_demand, scheduled

  // Topic for this generation
  @Column({ type: 'varchar', length: 255, nullable: true })
  topic!: string | null;

  // User-provided instructions (for ad-hoc generation)
  @Column({ type: 'text', nullable: true })
  userPrompt!: string | null;

  // User-uploaded images (presigned S3 URLs)
  @Column({ type: 'jsonb', nullable: true })
  userImages!: string[] | null;

  // Number of posts requested (for ad-hoc generation)
  @Column({ type: 'int', nullable: true })
  numberOfPosts!: number | null;

  // Platforms selected by user for this generation (for "Post Now" targeting)
  @Column({ type: 'jsonb', nullable: true })
  requestedPlatforms!: string[] | null;

  // All platform-specific texts (one entry per post)
  // Structure: [{ post_index: 0, platforms: { instagram: "text", twitter: "text" }, topic: "..." }]
  @Column({ type: 'jsonb', nullable: true })
  platformTexts!: Array<{
    post_index: number;
    platforms: Record<string, string>;
    topic: string;
    post_date: string;
    post_time: string;
    content_type: string; // 'image' or 'video'
  }> | null;

  // Generated media URLs (stored as arrays)
  @Column({ type: 'jsonb', nullable: true })
  generatedImageUrls!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  generatedVideoUrls!: string[] | null;

  // Prompts used for generation
  @Column({ type: 'jsonb', nullable: true })
  framePrompts!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  clipPrompts!: string[] | null;

  // Status & Progress
  @Index()
  @Column({ 
    type: 'varchar', 
    length: 50, 
    default: 'generating' 
  })
  status!: string; // generating/completed/failed/scheduled/posted

  @Column({ type: 'int', default: 0 })
  progressPercent!: number;

  @Column({ type: 'text', nullable: true })
  progressMessage!: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @Column({ type: 'boolean', default: false })
  autoPost!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  scheduledPostTime!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  postedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
