import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('web3_project_configurations')
export class Web3ProjectConfiguration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  project_id!: number;

  // Image Generation Settings (from Web2)
  @Column({ type: 'varchar', length: 50, default: 'nano-banana' })
  image_model!: string; // 'flux-pro-kontext', 'seedream', or 'nano-banana'

  // Video Generation Settings (from Web2)
  @Column({ type: 'varchar', length: 50, default: 'kling' })
  video_model!: string; // 'pixverse', 'sora', or 'kling'

  @Column({ type: 'int', default: 5 })
  clip_duration!: number; // Duration in seconds (model-specific: pixverse 5/8, sora 4/8/12, kling 5/10)

  // Web3 Project Specific Settings
  @Column({ type: 'int', default: 10 })
  daily_posts_count!: number; // Number of daily posts to generate

  // Content Mix Configuration (JSONB)
  // Structure: { shitpost: number, threads: number, longpost: number }
  // These should sum to 100 or represent counts
  @Column({ type: 'jsonb', nullable: true })
  content_mix!: {
    shitpost: number;
    threads: number;
    longpost: number;
  } | null;

  // Schedule Configuration (JSONB)
  // Structure: { frequency: 'daily' | 'weekly' | 'thrice_week' | 'custom', days: number[], time: string }
  // days: Array of day numbers (0=Sunday, 1=Monday, ..., 6=Saturday)
  // time: HH:mm format in server timezone
  @Column({ type: 'jsonb', nullable: true })
  schedule_config!: {
    frequency: 'daily' | 'weekly' | 'thrice_week' | 'custom';
    days: number[]; // Day numbers (0-6)
    time: string; // HH:mm format
  } | null;

  // Timestamps
  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}

