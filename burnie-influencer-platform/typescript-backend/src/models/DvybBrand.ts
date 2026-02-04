import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { DvybBrandAd } from './DvybBrandAd';

/** Country selection: { code: string, name: string } */
export interface CountrySelection {
  code: string;
  name: string;
}

/** Gemini enrichment: similar competitor from get_competitor_json */
export interface SimilarCompetitor {
  name: string;
  website: string;
  instagram_handle?: string;
  annual_revenue_usd?: string;
  reason?: string;
  tier?: string;
}

@Entity({ name: 'dvyb_brands' })
export class DvybBrand {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Derived from domain or user input; can be empty for user requests */
  @Column({ type: 'varchar', length: 255, default: '' })
  brandName!: string;

  @Column({ type: 'varchar', length: 512 })
  @Index()
  brandDomain!: string;

  /** user = requested from dvyb Brands page; admin = submitted from admin dashboard */
  @Column({ type: 'varchar', length: 20, default: 'user' })
  source!: 'user' | 'admin';

  /** approved = approved by admin (fetch can run); pending_approval = user-requested, awaiting admin */
  @Column({ type: 'varchar', length: 20, default: 'pending_approval' })
  approvalStatus!: 'approved' | 'pending_approval';

  /** Optional: dvyb_account_id if requested by logged-in user */
  @Column({ type: 'int', nullable: true })
  requestedByAccountId!: number | null;

  /** Countries to fetch ads for: [{ code: "US", name: "United States" }]. Empty = All (no country filter). */
  @Column({ type: 'jsonb', nullable: true })
  countries!: CountrySelection[] | null;

  /** Media type for ad fetch: image | video | both. Default image. Used when admin approves user request. */
  @Column({ type: 'varchar', length: 10, default: 'image' })
  mediaType!: 'image' | 'video' | 'both';

  /** pending | fetching | completed | failed */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  fetchStatus!: 'pending' | 'fetching' | 'completed' | 'failed';

  @Column({ type: 'text', nullable: true })
  fetchError!: string | null;

  /** Last time ads were successfully fetched for this brand */
  @Column({ type: 'timestamptz', nullable: true })
  lastAdsFetchedAt!: Date | null;

  /** Gemini enrichment: category (e.g. "E-Commerce") */
  @Column({ type: 'varchar', length: 128, nullable: true })
  category!: string | null;

  /** Gemini enrichment: similar competitors with name, website, instagram_handle, annual_revenue_usd, reason, tier */
  @Column({ type: 'jsonb', nullable: true })
  similarCompetitors!: SimilarCompetitor[] | null;

  /** Gemini enrichment: search brand Instagram handle (e.g. "@flipkart") */
  @Column({ type: 'varchar', length: 128, nullable: true })
  instagramHandle!: string | null;

  /** Gemini enrichment: search brand estimated revenue (e.g. "5.5B") */
  @Column({ type: 'varchar', length: 64, nullable: true })
  searchBrandRevenue!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => DvybBrandAd, (ad) => ad.brand)
  ads!: DvybBrandAd[];
}
