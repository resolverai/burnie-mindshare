import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Stores admin approval status for auto-generated content.
 * Auto-generated content must be approved by an admin before it becomes visible to users.
 * Each record represents the approval status for a specific post within a generation.
 */
@Entity('dvyb_admin_content_approvals')
@Index(['accountId', 'generatedContentId', 'postIndex'], { unique: true })
export class DvybAdminContentApproval {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  @Index()
  accountId!: number;

  @Column({ type: 'int' })
  @Index()
  generatedContentId!: number;

  @Column({ type: 'int', default: 0 })
  postIndex!: number;

  /**
   * Content type: 'image' or 'video'
   */
  @Column({ type: 'varchar', length: 20 })
  contentType!: 'image' | 'video';

  /**
   * Approval status: pending (default), approved, or rejected
   */
  @Column({ 
    type: 'varchar', 
    length: 20, 
    default: 'pending' 
  })
  @Index()
  status!: 'pending' | 'approved' | 'rejected';

  /**
   * Admin identifier who approved/rejected the content
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedById!: string | null;

  /**
   * Admin notes/comments about the approval or rejection
   */
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /**
   * Timestamp when content was approved
   */
  @Column({ type: 'timestamp', nullable: true })
  approvedAt!: Date | null;

  /**
   * Timestamp when content was rejected
   */
  @Column({ type: 'timestamp', nullable: true })
  rejectedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

