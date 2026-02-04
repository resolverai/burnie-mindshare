import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'dvyb_context' })
export class DvybContext {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'int', unique: true })
  accountId!: number;

  @Column({ type: 'text', nullable: true })
  accountName!: string | null;

  @Column({ type: 'text', nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  accountType!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  industry!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  suggestedFirstTopic!: {
    title?: string;
    description?: string;
  } | null;

  @Column({ type: 'text', nullable: true })
  targetAudience!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  brandVoices!: {
    purpose?: string;
    audience?: string;
    tone?: string[];
    emotions?: string[];
    character?: string[];
    syntax?: string[];
    language?: string;
  } | null;

  @Column({ type: 'text', nullable: true })
  brandVoice!: string | null; // Keeping for backward compatibility

  @Column({ type: 'jsonb', nullable: true })
  brandStyles!: {
    visual_identity_description?: string[];
    visual_identity_keywords?: string[];
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  contentPillars!: any | null; // Array of content themes

  @Column({ type: 'text', nullable: true })
  keywords!: string | null;

  @Column({ type: 'text', nullable: true })
  competitors!: string | null;

  @Column({ type: 'text', nullable: true })
  goals!: string | null;

  @Column({ type: 'text', nullable: true })
  brandValues!: string | null;

  @Column({ type: 'text', nullable: true })
  businessOverview!: string | null;

  @Column({ type: 'text', nullable: true })
  customerDemographics!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  popularProducts!: string[] | null;

  @Column({ type: 'text', nullable: true })
  whyCustomersChoose!: string | null;

  @Column({ type: 'text', nullable: true })
  brandStory!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  colorPalette!: {
    primary?: string;
    secondary?: string;
    accent?: string;
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  socialPostColors!: {
    primary?: string;
    secondary?: string;
    accent?: string;
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  brandFonts!: {
    title?: string;
    body?: string;
  } | null;

  @Column({ type: 'jsonb', nullable: true })
  typography!: {
    heading?: string;
    body?: string;
  } | null;

  @Column({ type: 'text', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  additionalLogoUrls!: Array<{ url: string; presignedUrl: string; timestamp: string }> | null;

  @Column({ type: 'jsonb', nullable: true })
  brandImages!: string[] | null; // Array of S3 URLs

  @Column({ type: 'jsonb', nullable: true })
  brandAssets!: any | null; // Array of S3 keys

  @Column({ type: 'jsonb', nullable: true })
  documentsText!: any | null; // [{name, url, text, timestamp}]

  @Column({ type: 'jsonb', nullable: true })
  documentUrls!: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  linksJson!: any | null; // [{url, timestamp}]

  @Column({ type: 'jsonb', nullable: true })
  platformHandles!: Record<string, any> | null; // {twitter: [], linkedin: [], instagram: []}

  @Column({ type: 'text', nullable: true })
  contentGuidelines!: string | null;

  @Column({ type: 'text', nullable: true })
  contentText!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  mediaChannels!: {
    social?: string[]; // e.g., ['instagram', 'facebook', 'linkedin', 'twitter']
    video?: string[];  // e.g., ['instagramReels', 'tiktok', 'youtube']
  } | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'always' })
  crossPostFrequency!: 'always' | 'sometimes' | 'never' | null;

  @Column({ type: 'int', nullable: true, default: 7 })
  postsPerWeek!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  contentPreferences!: {
    // Design Preferences
    featuredMedia?: {
      text?: boolean;
      image?: boolean;
      video?: boolean;
    };
    brandKitMediaPriority?: 'only_brand_kit' | 'brand_kit_first' | 'only_stock';
    brandKitMediaReuse?: 'never_reuse' | 'reuse_after_3_weeks';
    alwaysIncludeBlogImages?: boolean;
    
    // Content Preferences
    contentLanguage?: string; // e.g., 'en-us'
    topicsToAvoid?: string[];
    wordsToAvoid?: string[];
    blogKeywords?: string[];
    alwaysIncludeExternalLinks?: boolean;
    externalUrlsToAvoid?: string[];
    hashtags?: {
      avoid?: string[];
      include?: string[];
    };
    hashtagFrequency?: 'never' | 'sometimes' | 'always';
    logoFrequency?: 'never' | 'sometimes' | 'always';
    
    // Call-to-Action Preferences
    ctaLinks?: string[];
    ctaCopy?: string;
    ctaFrequency?: 'never' | 'sometimes' | 'always';

    // Content Preferences (wander UI)
    preferredContentTypes?: string[]; // e.g. ['Static Images', 'Video Ads', 'Carousels', 'Stories', 'Reels']
    targetPlatforms?: string[]; // e.g. ['Instagram', 'Facebook', 'TikTok', 'LinkedIn', 'Twitter', 'YouTube']
    postingFrequency?: string; // e.g. '3-5 times per week'
    bestTimesToPost?: string; // e.g. 'Weekdays 9am-12pm, 6pm-9pm'
    hashtagStrategy?: string; // Free text for hashtag strategy
  } | null;

  // Strategy preferences from onboarding questionnaire
  @Column({ type: 'jsonb', nullable: true })
  strategyPreferences!: {
    goal?: string; // 'grow_followers' | 'get_leads' | 'drive_sales' | 'build_community'
    platforms?: string[]; // ['instagram', 'twitter', 'linkedin', 'tiktok']
    idealCustomer?: string;
    postingFrequency?: string; // 'daily' | 'few_times_week' | 'weekly'
    businessAge?: string; // 'less_than_1_year' | '1_to_3_years' | 'more_than_3_years'
    revenueRange?: string; // 'less_than_10k' | '10k_to_50k' | '50k_to_500k' | 'more_than_500k'
    completedAt?: string;
  } | null;

  // Web3 specific fields
  @Column({ type: 'text', nullable: true })
  chain!: string | null;

  @Column({ type: 'text', nullable: true })
  tokenSymbol!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

