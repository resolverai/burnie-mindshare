import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'user_mining_context' })
@Index(['userId', 'campaignId'], { unique: true }) // One context per user per campaign
export class UserMiningContext {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  userId!: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  walletAddress!: string; // For quick lookups

  @Index()
  @Column({ type: 'int' })
  campaignId!: number;

  @Column({ type: 'int', nullable: true })
  projectId!: number | null; // Derived from campaign

  @Column({ type: 'text', nullable: true })
  project_name!: string | null;

  @Column({ type: 'text', nullable: true })
  website!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  linksJson!: any | null; // JSONB array of link objects: [{ url: string, timestamp: string }]

  @Column({ type: 'text', nullable: true })
  chain!: string | null;

  @Column({ type: 'text', nullable: true })
  tokenSymbol!: string | null;

  @Column({ type: 'text', nullable: true })
  tone!: string | null;

  @Column({ type: 'text', nullable: true })
  category!: string | null; // Project category: defi, nft, gaming, etc.

  @Column({ type: 'text', nullable: true })
  keywords!: string | null; // free-form

  @Column({ type: 'text', nullable: true })
  competitors!: string | null;

  @Column({ type: 'text', nullable: true })
  goals!: string | null;

  // Extracted text from uploaded PDFs/DOCX
  @Column({ type: 'jsonb', nullable: true })
  documents_text!: any | null; // e.g., [{ name, url, text, timestamp }]

  // URLs of uploaded documents
  @Column({ type: 'jsonb', nullable: true })
  document_urls!: string[] | null;

  // Optional S3 URL for logo
  @Column({ type: 'text', nullable: true })
  logo_url!: string | null;

  // Rich text/long-form fields for details and content guidelines
  @Column({ type: 'text', nullable: true })
  details_text!: string | null;

  @Column({ type: 'text', nullable: true })
  content_text!: string | null;

  // Platform handles per network, e.g., { twitter: ["@handle1", "@handle2"], discord: [...], github: [...] }
  @Column({ type: 'jsonb', nullable: true })
  platform_handles!: Record<string, any> | null;

  // Brand values (long text)
  @Column({ type: 'text', nullable: true })
  brand_values!: string | null;

  // Color palette for branding
  @Column({ type: 'jsonb', nullable: true })
  color_palette!: { primary?: string; secondary?: string; accent?: string } | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

