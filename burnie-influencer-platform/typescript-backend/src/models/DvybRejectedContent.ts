import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index, Unique } from 'typeorm';
import { DvybAccount } from './DvybAccount';
import { DvybGeneratedContent } from './DvybGeneratedContent';

@Entity('dvyb_rejected_content')
@Unique(['accountId', 'generatedContentId', 'postIndex'])
@Index(['accountId'])
@Index(['generatedContentId'])
export class DvybRejectedContent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  accountId!: number;

  @Column()
  generatedContentId!: number;

  @Column()
  postIndex!: number;

  @ManyToOne(() => DvybAccount, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account!: DvybAccount;

  @ManyToOne(() => DvybGeneratedContent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'generatedContentId' })
  generatedContent!: DvybGeneratedContent;

  @CreateDateColumn()
  createdAt!: Date;
}

