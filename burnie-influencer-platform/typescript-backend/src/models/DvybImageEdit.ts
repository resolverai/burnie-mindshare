import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Represents a single text/emoji overlay on an image
 */
export interface ImageOverlay {
  id: string;
  text: string;
  // Position as percentage (0-100) - top-left corner
  x: number;
  y: number;
  // Size as percentage (0-100)
  width: number;
  height: number;
  // Rotation in degrees
  rotation: number;
  // Font properties
  fontSize: number; // Base font size in pixels (at 450px reference width)
  fontFamily: string;
  color: string; // Hex color code
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  // Type indicator
  isEmoji?: boolean;
  isSticker?: boolean;
}

/**
 * Stores user edits to generated content images
 * Each record represents all overlays for a specific post
 */
@Entity('dvyb_image_edits')
@Index(['accountId', 'generatedContentId', 'postIndex'], { unique: true })
export class DvybImageEdit {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  accountId!: number;

  @Column({ type: 'int' })
  @Index()
  generatedContentId!: number;

  @Column({ type: 'int', default: 0 })
  postIndex!: number;

  /**
   * Original image URL (S3 key) before edits
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  originalImageUrl!: string | null;

  /**
   * Regenerated image URL (S3 key) from chat-based regeneration
   * If present, overlays will be applied to this instead of originalImageUrl
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  regeneratedImageUrl!: string | null;

  /**
   * Edited/processed image URL (S3 key) after applying overlays
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  editedImageUrl!: string | null;

  /**
   * Array of overlay objects with position, text, styling info
   * Stored as JSON
   */
  @Column({ type: 'jsonb', default: [] })
  overlays!: ImageOverlay[];

  /**
   * Reference image width used when setting overlay positions
   * Used to calculate scaling when applying overlays to actual image
   */
  @Column({ type: 'int', default: 450 })
  referenceWidth!: number;

  /**
   * Status of the edit processing
   */
  @Column({ 
    type: 'varchar', 
    length: 50, 
    default: 'pending' 
  })
  status!: 'pending' | 'processing' | 'completed' | 'failed';

  /**
   * Error message if processing failed
   */
  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

