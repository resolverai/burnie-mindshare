import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export interface ContentStrategyMetadata {
  captionHint?: string;
  hashtags?: string[];
  callToAction?: string;
  targetAudience?: string;
  contentGoal?: string;
  visualStyle?: string;
  toneOfVoice?: string;
  keyMessages?: string[];
}

@Entity('dvyb_content_strategy')
@Index(['accountId', 'date'])
export class DvybContentStrategy {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'date', nullable: true })
  date!: string | null; // "2025-01-20"

  @Column({ type: 'varchar', length: 50, default: 'instagram' })
  platform!: string; // "instagram" | "twitter" | "linkedin" | "tiktok"

  @Column({ type: 'varchar', length: 50, default: 'image' })
  contentType!: string; // "image" | "video" | "text"

  @Column({ type: 'text', default: '' })
  topic!: string; // Main topic for this content

  @Column({ type: 'text', nullable: true })
  weekTheme!: string | null; // Theme for the week this belongs to

  @Column({ type: 'int', default: 1 })
  weekNumber!: number; // 1, 2, 3, or 4

  @Column({ type: 'jsonb', nullable: true })
  metadata!: ContentStrategyMetadata | null;

  @Column({ type: 'varchar', length: 50, default: 'suggested' })
  status!: string; // "suggested" | "deleted" | "generated"

  @Column({ type: 'int', nullable: true })
  generatedContentId!: number | null; // Link when content is generated (future)

  @Column({ type: 'varchar', length: 10, nullable: true })
  strategyMonth!: string | null; // "2025-01" - for grouping strategies by month

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

