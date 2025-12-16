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
  id: number;

  @Column()
  accountId: number;

  @Column({ type: 'date' })
  date: string; // "2025-01-20"

  @Column()
  platform: string; // "instagram" | "twitter" | "linkedin" | "tiktok"

  @Column()
  contentType: string; // "image" | "video" | "text"

  @Column()
  topic: string; // Main topic for this content

  @Column({ nullable: true })
  weekTheme: string; // Theme for the week this belongs to

  @Column({ type: 'int' })
  weekNumber: number; // 1, 2, 3, or 4

  @Column({ type: 'jsonb', nullable: true })
  metadata: ContentStrategyMetadata;

  @Column({ default: 'suggested' })
  status: string; // "suggested" | "deleted" | "generated"

  @Column({ nullable: true })
  generatedContentId: number; // Link when content is generated (future)

  @Column({ nullable: true })
  strategyMonth: string; // "2025-01" - for grouping strategies by month

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

