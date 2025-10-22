import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './Account';
import { AccountClient } from './AccountClient';

@Entity('context_management')
export class ContextManagement {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', unique: true, nullable: true })
  uuid?: string;

  @Column({ type: 'int', nullable: false })
  @Index()
  account_id!: number;

  @Column({ type: 'int', nullable: true })
  @Index()
  account_client_id?: number;

  // ===== BRAND ASSETS TAB =====
  @Column({ type: 'text', nullable: true })
  brand_logo_url?: string;

  @Column({ type: 'jsonb', nullable: true })
  brand_colors?: {
    primary?: string;
    secondary?: string;
    additional?: string[];
  };

  @Column({ type: 'text', nullable: true })
  brand_voice?: string;

  @Column({ type: 'text', nullable: true })
  brand_guidelines_pdf_url?: string;

  // Generic file storage for Brand Assets tab
  @Column({ type: 'jsonb', nullable: true })
  brand_assets_files?: Array<{
    filename: string;
    s3_url: string;
    file_type: string;
    uploaded_at: string;
  }>;

  // ===== VISUAL REFERENCES TAB =====
  @Column({ type: 'jsonb', nullable: true })
  product_photos?: Array<{
    filename: string;
    s3_url: string;
    uploaded_at: string;
  }>;

  @Column({ type: 'jsonb', nullable: true })
  inspiration_images?: Array<{
    filename: string;
    s3_url: string;
    uploaded_at: string;
  }>;

  @Column({ type: 'jsonb', nullable: true })
  past_content_images?: Array<{
    filename: string;
    s3_url: string;
    uploaded_at: string;
  }>;

  // Generic visual storage
  @Column({ type: 'jsonb', nullable: true })
  generic_visuals?: Array<{
    filename: string;
    s3_url: string;
    uploaded_at: string;
  }>;

  // ===== TEXT & CONTENT TAB =====
  @Column({ type: 'text', nullable: true })
  brand_story?: string;

  @Column({ type: 'text', nullable: true })
  key_messages?: string;

  @Column({ type: 'text', nullable: true })
  target_audience?: string;

  @Column({ type: 'text', nullable: true })
  dos_and_donts?: string;

  @Column({ type: 'text', nullable: true })
  custom_text?: string;

  // ===== PLATFORM HANDLES TAB =====
  @Column({ type: 'text', nullable: true })
  twitter_handle?: string;

  @Column({ type: 'text', nullable: true })
  linkedin_url?: string;

  @Column({ type: 'text', nullable: true })
  youtube_url?: string;

  @Column({ type: 'text', nullable: true })
  instagram_handle?: string;

  @Column({ type: 'jsonb', nullable: true })
  additional_reference_urls?: string[];

  // ===== EXTRACTED TEXT CONTEXT =====
  // This column stores extracted text from ALL uploaded documents (PDF, DOCX, CSV)
  @Column({ type: 'text', nullable: true })
  extra_context?: string;

  // ===== METADATA =====
  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  // Relations
  @ManyToOne(() => Account, account => account.context_management, { nullable: false })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @ManyToOne(() => AccountClient, accountClient => accountClient.context_management, { nullable: true })
  @JoinColumn({ name: 'account_client_id' })
  account_client?: AccountClient;
}

