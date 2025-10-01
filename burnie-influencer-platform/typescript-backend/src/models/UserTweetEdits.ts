import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ContentMarketplace } from './ContentMarketplace';

export enum EditStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

@Entity('user_tweet_edits')
export class UserTweetEdits {
  @PrimaryGeneratedColumn()
  id!: number;

  // Ensure wallet addresses are always lowercase
  @Column({ 
    type: 'varchar', 
    length: 255, 
    nullable: false,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value
    }
  })
  walletAddress!: string;

  @Column({ type: 'int', nullable: false })
  contentId!: number;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  executionId!: string;

  @Column({ type: 'text', nullable: true })
  originalImagePrompt?: string;

  @Column({ type: 'text', nullable: true })
  originalTweetText?: string;

  @Column({ type: 'jsonb', nullable: true })
  originalThread?: string[];

  @Column({ type: 'text', nullable: true })
  newTweetText?: string;

  @Column({ type: 'jsonb', nullable: true })
  newThread?: string[];

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarImageUrl?: string;

  @Column({ type: 'text', nullable: true })
  newImagePrompt?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  newImageUrl?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  newWatermarkImageUrl?: string;

  @Column({ type: 'text', nullable: false })
  userRequest!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  transactionHash?: string;

  @Column({
    type: 'enum',
    enum: EditStatus,
    default: EditStatus.PENDING
  })
  status!: EditStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  roastAmount?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relationship with ContentMarketplace
  @ManyToOne(() => ContentMarketplace)
  @JoinColumn({ name: 'contentId' })
  content?: ContentMarketplace;
}
