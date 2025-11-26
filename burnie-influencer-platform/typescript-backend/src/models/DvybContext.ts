import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_context' })
export class DvybContext {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'int', unique: true })
  accountId!: number;

  @Column({ type: 'text', nullable: true })
  accountName!: string | null;

  @Column({ type: 'text', nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  accountType!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry!: string | null;

  @Column({ type: 'text', nullable: true })
  targetAudience!: string | null;

  @Column({ type: 'text', nullable: true })
  brandVoice!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  contentPillars!: any | null; // Array of content themes

  @Column({ type: 'text', nullable: true })
  keywords!: string | null;

  @Column({ type: 'text', nullable: true })
  competitors!: string | null;

  @Column({ type: 'text', nullable: true })
  goals!: string | null;

  @Column({ type: 'text', nullable: true })
  brandValues!: string | null;

  @Column({ type: 'text', nullable: true })
  businessOverview!: string | null;

  @Column({ type: 'text', nullable: true })
  customerDemographics!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  popularProducts!: string[] | null;

  @Column({ type: 'text', nullable: true })
  whyCustomersChoose!: string | null;

  @Column({ type: 'text', nullable: true })
  brandStory!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  colorPalette!: {
    primary?: string;
    secondary?: string;
    accent?: string;
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  socialPostColors!: {
    primary?: string;
    secondary?: string;
    accent?: string;
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  brandFonts!: {
    title?: string;
    body?: string;
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  typography!: {
    heading?: string;
    body?: string;
  } | null;

  @Column({ type: 'text', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  brandImages!: string[] | null; // Array of S3 URLs

  @Column({ type: 'jsonb', nullable: true })
  brandAssets!: any | null; // Array of S3 keys

  @Column({ type: 'jsonb', nullable: true })
  documentsText!: any | null; // [{name, url, text, timestamp}]

  @Column({ type: 'jsonb', nullable: true })
  documentUrls!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  linksJson!: any | null; // [{url, timestamp}]

  @Column({ type: 'jsonb', nullable: true })
  platformHandles!: Record<string, any> | null; // {twitter: [], linkedin: [], instagram: []}

  @Column({ type: 'text', nullable: true })
  contentGuidelines!: string | null;

  @Column({ type: 'text', nullable: true })
  contentText!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  mediaChannels!: {
    social?: string[]; // e.g., ['instagram', 'facebook', 'linkedin', 'twitter']
    video?: string[];  // e.g., ['instagramReels', 'tiktok', 'youtube']
  } | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'always' })
  crossPostFrequency!: 'always' | 'sometimes' | 'never' | null;

  @Column({ type: 'int', nullable: true, default: 7 })
  postsPerWeek!: number | null;

  // Web3 specific fields
  @Column({ type: 'text', nullable: true })
  chain!: string | null;

  @Column({ type: 'text', nullable: true })
  tokenSymbol!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

