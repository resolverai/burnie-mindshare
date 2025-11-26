import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity({ name: 'dvyb_tiktok_connections' })
@Unique(['accountId'])
export class DvybTikTokConnection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'varchar', length: 255 })
  openId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  unionId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  displayName!: string | null;

  @Column({ type: 'text' })
  accessToken!: string;

  @Column({ type: 'text' })
  refreshToken!: string;

  @Column({ type: 'timestamp' })
  tokenExpiresAt!: Date;

  @Column({ type: 'timestamp' })
  refreshTokenExpiresAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  profileData!: {
    open_id?: string;
    union_id?: string;
    display_name?: string;
    avatar_url?: string;
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

