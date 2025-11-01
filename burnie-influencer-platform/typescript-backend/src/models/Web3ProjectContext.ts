import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'web3_project_context' })
export class Web3ProjectContext {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  projectId!: number;

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

  // Optional S3 URL for current logo (can differ from account table)
  @Column({ type: 'text', nullable: true })
  logo_url!: string | null;

  // Rich text/long-form fields for details and content guidelines
  @Column({ type: 'text', nullable: true })
  details_text!: string | null;

  @Column({ type: 'text', nullable: true })
  content_text!: string | null;

  // Platform handles per network, e.g., { twitter: "@proj", discord: "invite", github: "repo" }
  @Column({ type: 'jsonb', nullable: true })
  platform_handles!: Record<string, any> | null;

  // Brand values (long text instead of JSON array)
  @Column({ type: 'text', nullable: true })
  brand_values!: string | null;

  // Color palette similar to Web2
  @Column({ type: 'jsonb', nullable: true })
  color_palette!: {
    primary?: string;
    secondary?: string;
    accent?: string;
  } | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}


