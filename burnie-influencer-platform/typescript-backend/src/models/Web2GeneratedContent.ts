import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './Account';
import { AccountClient } from './AccountClient';

@Entity('web2_generated_content')
export class Web2GeneratedContent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', unique: true, nullable: false })
  uuid!: string;

  @Column({ type: 'int' })
  @Index()
  account_id!: number;

  @Column({ type: 'int', nullable: true })
  @Index()
  account_client_id?: number;

  // Content type
  @Column({ type: 'varchar', length: 50 })
  @Index()
  content_type!: string; // 'image', 'video', 'audio', 'voiceover', 'tweet'

  // Generation parameters
  @Column({ type: 'text', nullable: true })
  image_model?: string; // 'flux-pro-kontext', 'seedream', 'nano-banana'

  @Column({ type: 'text', nullable: true })
  video_model?: string; // 'pixverse', 'sora', 'kling'

  @Column({ type: 'int', nullable: true })
  clip_duration?: number; // Duration in seconds for clips

  // User inputs
  @Column({ type: 'text', nullable: true })
  user_prompt?: string; // User's high-level instructions

  @Column({ type: 'jsonb', nullable: true })
  user_images?: string[]; // S3 URLs of user-uploaded reference images

  @Column({ type: 'text', nullable: true })
  theme?: string; // Theme or campaign context

  @Column({ type: 'text', nullable: true })
  workflow_type?: string; // 'social_post', 'ad_campaign', 'product_showcase', etc.

  @Column({ type: 'text', nullable: true })
  target_platform?: string; // 'twitter', 'linkedin', 'youtube', 'instagram'

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

  // Generated prompts (from Grok)
  @Column({ type: 'text', nullable: true })
  image_prompt?: string; // Generated prompt for image generation

  @Column({ type: 'text', nullable: true })
  clip_prompt?: string; // Generated prompt for video generation

  @Column({ type: 'text', nullable: true })
  tweet_text?: string; // Generated tweet or message text

  @Column({ type: 'text', nullable: true })
  audio_prompt?: string; // Generated prompt for audio/music

  @Column({ type: 'text', nullable: true })
  voiceover_prompt?: string; // Generated prompt for voiceover

  // Platform-specific promotional texts (NEW)
  @Column({ type: 'text', nullable: true })
  twitter_text?: string; // Twitter/X promotional text (280 chars)

  @Column({ type: 'text', nullable: true })
  youtube_description?: string; // YouTube description (detailed)

  @Column({ type: 'text', nullable: true })
  instagram_caption?: string; // Instagram caption (with emojis/hashtags)

  @Column({ type: 'text', nullable: true })
  linkedin_post?: string; // LinkedIn post (professional tone)

  // Generated content URLs (stored in S3)
  @Column({ type: 'simple-array', nullable: true })
  generated_image_urls?: string[]; // S3 URLs of generated images

  @Column({ type: 'text', nullable: true })
  generated_video_url?: string; // S3 URL of generated video/clip

  @Column({ type: 'text', nullable: true })
  generated_audio_url?: string; // S3 URL of generated audio

  @Column({ type: 'text', nullable: true })
  generated_voiceover_url?: string; // S3 URL of generated voiceover

  // Final composition
  @Column({ type: 'text', nullable: true })
  final_content_url?: string; // S3 URL of final composed content (if applicable)

  // Status
  @Column({ type: 'varchar', length: 50, default: 'generating' })
  @Index()
  status!: string; // 'generating', 'completed', 'failed', 'scheduled', 'posted'

  @Column({ type: 'text', nullable: true })
  error_message?: string; // Error message if generation failed

  // Posting information
  @Column({ type: 'boolean', default: false })
  auto_post!: boolean; // Whether to auto-post this content

  @Column({ type: 'timestamp', nullable: true })
  scheduled_post_time?: Date; // When to post if scheduled

  @Column({ type: 'timestamp', nullable: true })
  posted_at?: Date; // When this content was actually posted

  @Column({ type: 'jsonb', nullable: true })
  post_metadata?: Record<string, any>; // Platform-specific post metadata (tweet ID, etc.)

  // Workflow-specific metadata
  @Column({ type: 'jsonb', nullable: true })
  workflow_metadata?: Record<string, any>; // All workflow-specific form data (product categories, colors, styles, contexts, etc.)

  @Column({ type: 'jsonb', nullable: true })
  visual_analysis?: Record<string, any>; // Results from Grok visual pattern analysis

  @Column({ type: 'int', nullable: true })
  num_variations?: number; // Number of variations requested (1-5)

  @Column({ type: 'text', nullable: true })
  industry?: string; // Account industry for context

  @Column({ type: 'jsonb', nullable: true })
  brand_context?: Record<string, any>; // Brand context data used for generation

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Relations
  @ManyToOne(() => Account, account => account.generated_contents, { nullable: false })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @ManyToOne(() => AccountClient, accountClient => accountClient.generated_contents, { nullable: true })
  @JoinColumn({ name: 'account_client_id' })
  account_client?: AccountClient;
}
