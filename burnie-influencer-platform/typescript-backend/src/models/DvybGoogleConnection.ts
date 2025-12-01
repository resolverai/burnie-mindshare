import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('dvyb_google_connections')
export class DvybGoogleConnection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  @Index()
  accountId!: number;

  @Column({ nullable: false, unique: true })
  @Index()
  googleId!: string;

  @Column({ nullable: false })
  @Index()
  email!: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true })
  profilePicture?: string;

  @Column({ type: 'text', nullable: true })
  accessToken?: string;

  @Column({ type: 'text', nullable: true })
  refreshToken?: string;

  @Column({ type: 'timestamp', nullable: true })
  tokenExpiry?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

