import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { DvybAccount } from './DvybAccount';
import { DvybGeneratedContent } from './DvybGeneratedContent';

/**
 * Stores history of image regenerations using AI (nano-banana edit).
 * Each regeneration creates a new entry - entries are NOT overwritten.
 * This allows tracking the full history of regenerations for a post.
 */
@Entity('dvyb_image_regeneration')
@Index(['accountId', 'generatedContentId', 'postIndex'])
export class DvybImageRegeneration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  @Index()
  accountId!: number;

  @Column()
  @Index()
  generatedContentId!: number;

  @Column()
  postIndex!: number;

  @Column({ type: 'text' })
  prompt!: string; // The user prompt used for regeneration

  @Column({ type: 'text' })
  sourceImageS3Key!: string; // The starting image (original OR previously regenerated)

  @Column({ type: 'text', nullable: true })
  regeneratedImageS3Key!: string | null; // The result image after regeneration

  @Column({ length: 50, default: 'pending' })
  status!: 'pending' | 'processing' | 'completed' | 'failed';

  @Column({ length: 20, default: 'user' })
  @Index()
  regeneratedBy!: 'user' | 'admin'; // Track who performed the regeneration

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'json', nullable: true })
  metadata!: {
    model?: string;
    aspectRatio?: string;
    processingTimeMs?: number;
    falRequestId?: string;
  } | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @ManyToOne(() => DvybAccount)
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @ManyToOne(() => DvybGeneratedContent)
  @JoinColumn({ name: 'generatedContentId' })
  generatedContent!: DvybGeneratedContent;
}

