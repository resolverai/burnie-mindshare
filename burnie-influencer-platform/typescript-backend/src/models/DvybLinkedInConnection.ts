import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity({ name: 'dvyb_linkedin_connections' })
@Unique(['accountId'])
export class DvybLinkedInConnection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'varchar', length: 255 })
  linkedInUserId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'text' })
  accessToken!: string;

  @Column({ type: 'text', nullable: true })
  refreshToken!: string | null;

  @Column({ type: 'timestamp' })
  tokenExpiresAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  profileData!: {
    sub?: string;
    name?: string;
    email?: string;
    email_verified?: boolean;
    picture?: string;
  } | null;

  @Column({ type: 'varchar', length: 50, default: 'active' })
  status!: string; // 'active', 'expired', 'revoked', 'error'

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

