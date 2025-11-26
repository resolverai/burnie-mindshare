import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export interface TopicWithExample {
  topic: string;
  example: {
    title: string;
    subtitle: string;
  };
}

@Entity({ name: 'dvyb_brand_topics' })
export class DvybBrandTopics {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'int' })
  accountId!: number;

  @Column({ type: 'jsonb' })
  generatedTopics!: TopicWithExample[]; // Array of all generated topics with examples

  @Column({ type: 'jsonb', default: [] })
  usedTopics!: string[]; // Array of topic texts that have been used for content generation

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

