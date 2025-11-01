import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'project_twitter_connections' })
export class ProjectTwitterConnection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  projectId!: number;

  @Column({ type: 'varchar', length: 255 })
  twitterUserId!: string;

  @Column({ type: 'varchar', length: 255 })
  twitterHandle!: string;

  // OAuth2 tokens
  @Column({ type: 'text', nullable: true })
  oauth2AccessToken!: string | null;

  @Column({ type: 'text', nullable: true })
  oauth2RefreshToken!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  oauth2ExpiresAt!: Date | null;

  // OAuth1.0 tokens (required for video posting)
  @Column({ type: 'text', nullable: true })
  oauth1Token!: string | null;

  @Column({ type: 'text', nullable: true })
  oauth1TokenSecret!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  oauth1ExpiresAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  scopes!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}


