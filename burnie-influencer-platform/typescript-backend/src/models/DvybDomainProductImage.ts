import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Cache of product/brand images fetched from domains during website analysis.
 * When multiple users analyze the same domain, we reuse cached images.
 */
@Entity({ name: 'dvyb_domain_product_images' })
@Index(['domain'])
export class DvybDomainProductImage {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Normalized domain (e.g. example.com, www stripped) */
  @Column({ type: 'varchar', length: 255 })
  domain!: string;

  /** S3 key for the image */
  @Column({ type: 'varchar', length: 512 })
  s3Key!: string;

  /** Source label (og:image, featured, etc.) - for debugging */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceLabel!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
