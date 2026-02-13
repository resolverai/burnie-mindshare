import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type DvybExtensionSaveQueueStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

@Entity({ name: 'dvyb_extension_save_queue' })
@Index(['accountId', 'metaAdId'], { unique: true })
@Index(['status'])
export class DvybExtensionSaveQueue {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'varchar', length: 255 })
  metaAdId!: string;

  /** From extension: brand name visible on the ad card (e.g. "Bershka") */
  @Column({ type: 'varchar', length: 255, nullable: true })
  brandName!: string | null;

  /** From extension: brand domain (main domain from external CTA link, e.g. "bershka.com") */
  @Column({ type: 'varchar', length: 255, nullable: true })
  brandDomain!: string | null;

  /** From extension: Facebook page handle from CTA link (e.g. facebook.com/SomePage → "SomePage"). Used to find existing brand. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  facebookHandle!: string | null;

  /** From extension: Instagram handle from CTA link (e.g. instagram.com/bershka → "bershka"). Used to find existing brand. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  instagramHandle!: string | null;

  /** From extension: run time text (e.g. "Started running on Jan 15, 2025"); worker may normalize to "Nd" for ad.runtime */
  @Column({ type: 'varchar', length: 255, nullable: true })
  runtime!: string | null;

  /** From extension: first seen date YYYY-MM-DD (parsed from runtime text or sent directly) */
  @Column({ type: 'varchar', length: 20, nullable: true })
  firstSeen!: string | null;

  /** From extension: ad copy { bodies, titles, descriptions, captions } for dvyb_brand_ads.adCopy */
  @Column({ type: 'jsonb', nullable: true })
  adCopy!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: DvybExtensionSaveQueueStatus;

  /** Set when status = completed; references dvyb_brand_ads.id */
  @Column({ type: 'int', nullable: true })
  adId!: number | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
