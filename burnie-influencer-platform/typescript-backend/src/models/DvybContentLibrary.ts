import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_content_library' })
export class DvybContentLibrary {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  contentType!: 'template' | 'image' | 'video' | 'text';

  @Column({ type: 'varchar', length: 1024, nullable: true })
  s3Key!: string | null;

  @Column({ type: 'text', nullable: true })
  thumbnailUrl!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  tags!: any | null; // Array of tags

  @Column({ type: 'jsonb', nullable: true })
  metadata!: any | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

