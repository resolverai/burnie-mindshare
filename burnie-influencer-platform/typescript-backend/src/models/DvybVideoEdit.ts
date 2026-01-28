import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Represents a clip on the timeline
 */
export interface VideoClip {
  id: string;
  trackId: string;
  name: string;
  startTime: number; // Start position on timeline (in seconds)
  duration: number; // Duration of clip (in seconds)
  sourceStart: number; // Start position in source media (for trimming)
  sourceDuration: number; // Total duration of source media
  src: string; // S3 URL or asset ID
  type: 'video' | 'audio' | 'music' | 'voiceover' | 'captions' | 'overlay';
  thumbnail?: string;
  
  // Transform properties
  transform?: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    opacity: number;
  };
  
  // Audio properties
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  muted?: boolean;
  
  // Filter/color properties
  filters?: {
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    blur: number;
    sharpen: number;
    vignette: number;
    grain: number;
  };
  filterPreset?: string;
  
  // Transitions
  transitionIn?: string;
  transitionOut?: string;
  transitionInDuration?: number;
  transitionOutDuration?: number;
  
  // Text properties (for caption clips)
  text?: {
    content: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    color: string;
    backgroundColor?: string;
    textAlign: 'left' | 'center' | 'right';
    verticalAlign: 'top' | 'middle' | 'bottom';
    animation: string;
    shadow: boolean;
    outline: boolean;
  };
  
  // Image overlay properties
  blendMode?: string;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  cornerRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

/**
 * Represents a track on the timeline
 */
export interface VideoTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'music' | 'voiceover' | 'captions' | 'overlay';
  clips: VideoClip[];
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

/**
 * Stores user edits to generated video content
 * Each record represents the complete timeline state for a specific video post
 */
@Entity('dvyb_video_edits')
@Index(['accountId', 'generatedContentId', 'postIndex'], { unique: true })
export class DvybVideoEdit {
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
   * Original video URL (S3 key) before edits
   * Store S3 key, not full presigned URL
   */
  @Column({ type: 'text', nullable: true })
  originalVideoUrl!: string | null;

  /**
   * Edited/processed video URL (S3 key) after applying all edits
   * Store S3 key, not full presigned URL
   */
  @Column({ type: 'text', nullable: true })
  editedVideoUrl!: string | null;

  /**
   * Complete timeline state - tracks and clips
   */
  @Column({ type: 'jsonb', default: [] })
  tracks!: VideoTrack[];

  /**
   * Project duration in seconds
   */
  @Column({ type: 'float', default: 30 })
  duration!: number;

  /**
   * Aspect ratio of the video
   */
  @Column({ type: 'varchar', length: 10, default: '9:16' })
  aspectRatio!: string;

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

  /**
   * Processing job ID from Python backend
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  processingJobId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
