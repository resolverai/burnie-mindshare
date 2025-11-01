import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'project_generated_content' })
export class ProjectGeneratedContent {
  @PrimaryGeneratedColumn()
  id!: number;

  // Project linkage
  @Index()
  @Column({ type: 'int' })
  project_id!: number;

  // Consistent identifier
  @Column({ type: 'uuid', unique: true, nullable: false })
  uuid!: string;

  // Content type (thread/shitpost/longpost/image/video,etc.)
  @Column({ type: 'varchar', length: 50 })
  @Index()
  content_type!: string;

  // Generation inputs/metadata (align to Web2 fields where applicable)
  @Column({ type: 'text', nullable: true })
  image_model?: string;

  @Column({ type: 'text', nullable: true })
  video_model?: string;

  @Column({ type: 'int', nullable: true })
  clip_duration?: number;

  @Column({ type: 'text', nullable: true })
  user_prompt?: string;

  @Column({ type: 'jsonb', nullable: true })
  user_images?: string[];

  @Column({ type: 'text', nullable: true })
  theme?: string;

  @Column({ type: 'text', nullable: true })
  workflow_type?: string;

  @Column({ type: 'text', nullable: true })
  target_platform?: string;

  // Flags
  @Column({ type: 'boolean', default: false })
  include_logo!: boolean;

  @Column({ type: 'boolean', default: false })
  no_characters!: boolean;

  @Column({ type: 'boolean', default: false })
  human_characters_only!: boolean;

  @Column({ type: 'boolean', default: false })
  web3_characters!: boolean;

  @Column({ type: 'boolean', default: true })
  use_brand_aesthetics!: boolean;

  @Column({ type: 'boolean', default: false })
  viral_trends!: boolean;

  // Generated prompts/text
  @Column({ type: 'text', nullable: true })
  image_prompt?: string;

  @Column({ type: 'text', nullable: true })
  clip_prompt?: string;

  @Column({ type: 'text', nullable: true })
  tweet_text?: string; // Legacy single tweet text (keep for backward compat)

  // All tweet texts as JSON array (for daily posts workflow)
  @Column({ type: 'jsonb', nullable: true })
  tweet_texts?: Array<{
    image_index: number;
    main_tweet: string;
    thread_array: string[];
    content_type: string;
  }>;

  // Platform-specific promotional texts (deprecated - use tweet_texts instead)
  @Column({ type: 'text', nullable: true })
  twitter_text?: string;

  // Generated media outputs
  @Column({ type: 'jsonb', nullable: true })
  generated_image_urls?: string[];

  @Column({ type: 'jsonb', nullable: true })
  generated_prompts?: string[];

  @Column({ type: 'jsonb', nullable: true })
  generated_video_urls?: string[];

  @Column({ type: 'text', nullable: true })
  generated_audio_url?: string;

  @Column({ type: 'text', nullable: true })
  final_content_url?: string;

  // Status & posting
  @Column({ type: 'varchar', length: 50, default: 'generating' })
  @Index()
  status!: string; // generating/completed/failed/scheduled/posted/draft

  @Column({ type: 'text', nullable: true })
  error_message?: string;

  @Column({ type: 'boolean', default: false })
  auto_post!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  scheduled_post_time?: Date;

  @Column({ type: 'timestamp', nullable: true })
  posted_at?: Date;

  @Column({ type: 'jsonb', nullable: true })
  post_metadata?: Record<string, any>;

  // Workflow metadata and analysis
  @Column({ type: 'jsonb', nullable: true })
  workflow_metadata?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  visual_analysis?: Record<string, any>;

  @Column({ type: 'int', nullable: true })
  num_variations?: number;

  @Column({ type: 'jsonb', nullable: true })
  per_image_metadata?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  per_video_metadata?: Record<string, any>;

  // Job tracking for daily posts workflow
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  job_id?: string;

  @Column({ type: 'int', nullable: true, default: 0 })
  progress_percent?: number;

  @Column({ type: 'text', nullable: true })
  progress_message?: string;

  // Note: date_key intentionally omitted; grouping can be computed from created_at

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}


