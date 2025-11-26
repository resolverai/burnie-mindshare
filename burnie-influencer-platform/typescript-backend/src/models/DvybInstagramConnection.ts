import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity({ name: 'dvyb_instagram_connections' })
@Unique(['accountId'])
export class DvybInstagramConnection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'varchar', length: 255 })
  instagramUserId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username!: string | null;

  @Column({ type: 'text' })
  accessToken!: string;

  @Column({ type: 'timestamp' })
  tokenExpiresAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  profileData!: {
    id?: string;
    username?: string;
    account_type?: string;
    media_count?: number;
    followers_count?: number;
    follows_count?: number;
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

