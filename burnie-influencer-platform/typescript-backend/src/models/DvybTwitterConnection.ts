import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_twitter_connections' })
export class DvybTwitterConnection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'varchar', length: 255 })
  twitterUserId!: string;

  @Column({ type: 'varchar', length: 255 })
  twitterHandle!: string;

  @Column({ type: 'text', nullable: true })
  oauth2AccessToken!: string | null;

  @Column({ type: 'text', nullable: true })
  oauth2RefreshToken!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  oauth2ExpiresAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  oauth1Token!: string | null;

  @Column({ type: 'text', nullable: true })
  oauth1TokenSecret!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  oauth1ExpiresAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  scopes!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

