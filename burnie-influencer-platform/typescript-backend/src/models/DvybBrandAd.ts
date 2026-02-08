import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { DvybBrand } from './DvybBrand';

@Entity({ name: 'dvyb_brand_ads' })
@Index(['brandId', 'metaAdId'], { unique: true })
export class DvybBrandAd {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  brandId!: number;

  @ManyToOne(() => DvybBrand, (b) => b.ads, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brandId' })
  brand!: DvybBrand;

  /** Meta/FB/IG ad library id - unique per brand */
  @Column({ type: 'varchar', length: 255 })
  metaAdId!: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  adSnapshotUrl!: string | null;

  /** Ad platform: meta, google, youtube, tiktok - determines "View on X" label and link */
  @Column({ type: 'varchar', length: 32, default: 'meta' })
  platform!: string;

  /** S3 key for creative image (presigned URL generated when serving) */
  @Column({ type: 'varchar', length: 512, nullable: true })
  creativeImageS3Key!: string | null;

  /** S3 key for creative video (presigned URL generated when serving) */
  @Column({ type: 'varchar', length: 512, nullable: true })
  creativeVideoS3Key!: string | null;

  /** @deprecated Use creativeImageS3Key + presigned URL. Kept for backward compat. */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  creativeImageUrl!: string | null;

  /** @deprecated Use creativeVideoS3Key + presigned URL. Kept for backward compat. */
  @Column({ type: 'varchar', length: 2048, nullable: true })
  creativeVideoUrl!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'image' })
  mediaType!: 'image' | 'video';

  @Column({ type: 'varchar', length: 255 })
  brandName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pageId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  /** approved = visible on Discover; pending_approval = admin must approve */
  @Column({ type: 'varchar', length: 20, default: 'pending_approval' })
  approvalStatus!: 'approved' | 'pending_approval';

  @Column({ type: 'varchar', length: 50, nullable: true })
  runtime!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  firstSeen!: string | null;

  /** JSON: { bodies, titles, descriptions, captions } */
  @Column({ type: 'jsonb', nullable: true })
  adCopy!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'en' })
  targetLanguage!: string;

  /** JSON array of country names */
  @Column({ type: 'jsonb', nullable: true })
  targetCountries!: string[] | null;

  /** JSON array */
  @Column({ type: 'jsonb', nullable: true })
  targetAges!: string[] | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  targetGender!: string | null;

  /** JSON array */
  @Column({ type: 'jsonb', nullable: true })
  publisherPlatforms!: string[] | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  landingPage!: string | null;

  /** JSON: { eu_total_reach, total_reach_by_location } */
  @Column({ type: 'jsonb', nullable: true })
  reach!: Record<string, unknown> | null;

  /** JSON array */
  @Column({ type: 'jsonb', nullable: true })
  beneficiaryPayers!: unknown[] | null;

  /** Grok inventory analysis: full analysis of products/items in ad image (e.g. objects, description, subcategory context) */
  @Column({ type: 'jsonb', nullable: true })
  inventoryAnalysis!: Record<string, unknown> | null;

  /** Subcategory of the ad (e.g. sportswear→shoes, bra; fashion→dress, scarf). Used for inspiration matching. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  subcategory!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
