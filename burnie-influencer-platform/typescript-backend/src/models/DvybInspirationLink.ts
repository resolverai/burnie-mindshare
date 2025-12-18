import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * DvybInspirationLink - Stores inspiration links from social platforms
 * Used by admins to curate content for AI content generation
 */
@Entity('dvyb_inspiration_links')
@Index(['platform', 'category'])
export class DvybInspirationLink {
  @PrimaryGeneratedColumn()
  id!: number;

  /**
   * Platform where the inspiration content is from
   */
  @Column({ type: 'varchar', length: 50 })
  @Index()
  platform!: 'youtube' | 'instagram' | 'twitter' | 'tiktok' | 'custom';

  /**
   * For custom uploads - the S3 URL of the uploaded media file
   */
  @Column({ type: 'text', nullable: true })
  mediaUrl!: string | null;

  /**
   * Category for organizing inspiration content (e.g., "Fashion", "Tech", "Food")
   */
  @Column({ type: 'varchar', length: 255 })
  @Index()
  category!: string;

  /**
   * The URL of the inspiration content
   */
  @Column({ type: 'text' })
  url!: string;

  /**
   * Optional title/description for the inspiration
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  title!: string | null;

  /**
   * Admin user who added this inspiration (optional - for tracking)
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  addedBy!: string | null;

  /**
   * Type of media content (image or video)
   */
  @Column({ type: 'varchar', length: 20, default: 'image' })
  @Index()
  mediaType!: 'image' | 'video';

  /**
   * Whether this inspiration link is active/visible
   */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

