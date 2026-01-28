import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Asset types available in the editor
 */
export type AssetType = 'video' | 'image' | 'audio' | 'music' | 'voiceover' | 'effect' | 'overlay' | 'sticker' | 'transition';

/**
 * Stores assets available in the video editor library
 * Admin assets are available to all users, user assets are private
 */
@Entity('dvyb_assets')
@Index(['accountId', 'isAdminAsset'])
@Index(['type', 'isAdminAsset'])
export class DvybAsset {
  @PrimaryGeneratedColumn()
  id!: number;

  /**
   * Account ID - null for admin assets, set for user-uploaded assets
   */
  @Column({ type: 'int', nullable: true })
  @Index()
  accountId!: number | null;

  /**
   * Asset name/title
   */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /**
   * Asset type
   */
  @Column({ 
    type: 'varchar', 
    length: 50 
  })
  @Index()
  type!: AssetType;

  /**
   * S3 key for the asset file
   */
  @Column({ type: 'varchar', length: 500 })
  s3Key!: string;

  /**
   * S3 key for thumbnail (for videos/images)
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnailS3Key!: string | null;

  /**
   * Duration in seconds (for video/audio assets)
   */
  @Column({ type: 'float', nullable: true })
  duration!: number | null;

  /**
   * Tags for categorization and search
   */
  @Column({ type: 'jsonb', default: [] })
  tags!: string[];

  /**
   * Category for organization (e.g., "intro", "outro", "transition", "music", "sfx")
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  category!: string | null;

  /**
   * Whether this is an admin asset (available to all) or user asset (private)
   */
  @Column({ type: 'boolean', default: false })
  @Index()
  isAdminAsset!: boolean;

  /**
   * Additional metadata (e.g., waveform data for audio, dimensions for images)
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  /**
   * Whether the asset is active/visible
   */
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
