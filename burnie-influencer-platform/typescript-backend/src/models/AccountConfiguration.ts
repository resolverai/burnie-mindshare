import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('account_configurations')
export class AccountConfiguration {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', unique: true, nullable: true })
  uuid?: string;

  @Column({ type: 'int' })
  @Index()
  account_id!: number;

  // Image Generation Settings
  @Column({ type: 'varchar', length: 50, default: 'seedream' })
  image_model!: string; // 'seedream' or 'nano-banana'

  // Video Generation Settings
  @Column({ type: 'varchar', length: 50, default: 'kling' })
  video_model!: string; // 'pixverse', 'sora', 'kling'

  @Column({ type: 'int', default: 5 })
  clip_duration!: number; // Duration in seconds (model-specific: pixverse 5/8, sora 4/8/12, kling 5/10)

  // Timestamps
  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}

