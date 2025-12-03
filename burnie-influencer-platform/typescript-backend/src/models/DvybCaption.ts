import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('dvyb_captions')
@Index(['accountId', 'generatedContentId', 'postIndex', 'platform'], { unique: true })
export class DvybCaption {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  @Index()
  accountId!: number;

  @Column()
  @Index()
  generatedContentId!: number;

  @Column()
  postIndex!: number;

  @Column({ length: 50 })
  platform!: string; // 'twitter', 'instagram', 'linkedin'

  @Column({ type: 'text' })
  caption!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

