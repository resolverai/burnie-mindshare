import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export enum TokenSentiment {
  BULLISH = 'bullish',
  BEARISH = 'bearish',
  NEUTRAL = 'neutral'
}

export enum BadgeType {
  COOKIE_OG = 'COOKIE_OG',
  MINDSHARE_LEADER = 'MINDSHARE_LEADER',
  TOP_BULL = 'TOP_BULL',
  TOP_BEAR = 'TOP_BEAR',
  ENGAGEMENT_KING = 'ENGAGEMENT_KING',
  TRENDSETTER = 'TRENDSETTER',
  COMMUNITY_BUILDER = 'COMMUNITY_BUILDER'
}

@Entity('yapper_cookie_profile')
@Index(['twitterHandle', 'snapshotDate'])
@Index(['snapshotDate', 'mindsharePercent'])
@Index(['smartFollowers7d'])
@Index(['createdAt'])
@Unique(['twitterHandle', 'snapshotDate'])
export class YapperCookieProfile {
  @PrimaryGeneratedColumn()
  id!: number;

  // === YAPPER IDENTIFICATION ===
  @Column({ type: 'varchar', length: 100 })
  twitterHandle!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  displayName?: string;

  @Column({ type: 'date' })
  snapshotDate!: Date; // Date when this profile snapshot was taken

  // === CORE PROFILE METRICS (7D Focus) ===
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalSnaps7d?: number; // Total SNAPs in last 7 days

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalSnaps30d?: number; // Total SNAPs in last 30 days (if available)

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalSnaps90d?: number; // Total SNAPs in last 90 days (if available)

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  totalSnapsYtd?: number; // Total SNAPs year to date (if available)

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  mindsharePercent?: number; // Mindshare percentage (e.g., 0.022%)

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  mindsharePercentYtd?: number; // YTD mindshare percentage

  @Column({ type: 'integer', nullable: true })
  smartFollowers7d?: number; // Smart followers count in 7D

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  smartEngagement?: number; // Smart engagement number (e.g., 10.29K)

  // === MINDSHARE & FOLLOWERS TRENDS ===
  @Column({ type: 'jsonb', nullable: true })
  mindshareHistory?: any; // Time series data for mindshare trends

  @Column({ type: 'jsonb', nullable: true })
  smartFollowersTrend?: any; // Smart followers trend data

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  avgMindshare7d?: number; // Average mindshare over 7 days

  // === TOKEN SENTIMENT ANALYSIS ===
  @Column({ type: 'jsonb', nullable: true })
  tokenSentiments?: any; // Array of token sentiment objects
  /* Expected format:
  [
    {
      "token": "APE",
      "sentiment": "bullish",
      "confidence": 0.85,
      "mentions": 12
    },
    {
      "token": "BTC", 
      "sentiment": "bearish",
      "confidence": 0.72,
      "mentions": 8
    }
  ]
  */

  @Column({ type: 'simple-array', nullable: true })
  bullishTokens?: string[]; // Quick access array of bullish tokens

  @Column({ type: 'simple-array', nullable: true })
  bearishTokens?: string[]; // Quick access array of bearish tokens

  // === BADGES & ACHIEVEMENTS ===
  @Column({ type: 'jsonb', nullable: true })
  badges?: any; // Array of badge objects
  /* Expected format:
  [
    {
      "type": "COOKIE_OG",
      "title": "COOKIE OG", 
      "earnedOn": "2024-05-28",
      "description": "Early Cookie.fun adopter"
    },
    {
      "type": "MINDSHARE_LEADER",
      "title": "#1 MINDSHARE",
      "earnedOn": "2024-08-13", 
      "rank": 1,
      "category": "KLOUT"
    }
  ]
  */

  @Column({ type: 'integer', nullable: true })
  totalBadges?: number; // Quick count of total badges

  @Column({ type: 'simple-array', nullable: true })
  badgeTypes?: string[]; // Quick access array of badge types

  // === SOCIAL NETWORK ANALYSIS ===
  @Column({ type: 'jsonb', nullable: true })
  socialGraph?: any; // Top 20/50/100 connections from social graph
  /* Expected format:
  {
    "top_20": [
      {
        "handle": "Stellitart",
        "display_name": "Stell",
        "connection_strength": 0.85,
        "interaction_type": ["mentions", "replies", "retweets"]
      }
    ],
    "network_centrality": 0.45,
    "influence_score": 78.2
  }
  */

  @Column({ type: 'integer', nullable: true })
  socialGraphSize?: number; // Number of connections in social graph

  @Column({ type: 'decimal', precision: 5, scale: 3, nullable: true })
  networkCentrality?: number; // Network centrality score (0-1)

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  influenceScore?: number; // Overall influence score

  // === ENGAGEMENT PATTERNS ===
  @Column({ type: 'jsonb', nullable: true })
  engagementPatterns?: any; // Detailed engagement analysis
  /* Expected format:
  {
    "peak_hours": [14, 15, 16, 20, 21],
    "avg_daily_posts": 8.5,
    "engagement_rate": 4.2,
    "reply_ratio": 0.35,
    "mention_ratio": 0.25,
    "original_content_ratio": 0.40
  }
  */

  // === METADATA ===
  @Column({ type: 'varchar', length: 500, nullable: true })
  profileImageUrl?: string; // URL to profile image from snapshot

  @Column({ type: 'text', nullable: true })
  bio?: string; // Profile bio/description if captured

  @Column({ type: 'jsonb', nullable: true })
  rawSnapshotData?: any; // Raw data extracted from snapshot for debugging

  @Column({ type: 'varchar', length: 50, default: 'completed' })
  processingStatus!: string; // Status of data extraction

  @Column({ type: 'text', nullable: true })
  extractionNotes?: string; // Any notes from LLM extraction

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // === HELPER METHODS ===

  /**
   * Get dominant sentiment for this yapper
   */
  getDominantSentiment(): TokenSentiment {
    if (!this.tokenSentiments || !Array.isArray(this.tokenSentiments)) {
      return TokenSentiment.NEUTRAL;
    }

    const sentimentCounts = this.tokenSentiments.reduce((acc: any, token: any) => {
      acc[token.sentiment] = (acc[token.sentiment] || 0) + (token.confidence || 1);
      return acc;
    }, {});

    const dominant = Object.keys(sentimentCounts).reduce((a, b) => 
      sentimentCounts[a] > sentimentCounts[b] ? a : b
    );

    return dominant as TokenSentiment;
  }

  /**
   * Get top N most mentioned tokens
   */
  getTopTokens(limit: number = 5): any[] {
    if (!this.tokenSentiments || !Array.isArray(this.tokenSentiments)) {
      return [];
    }

    return this.tokenSentiments
      .sort((a: any, b: any) => (b.mentions || 0) - (a.mentions || 0))
      .slice(0, limit);
  }

  /**
   * Get mindshare growth rate (if historical data available)
   */
  getMindshareGrowthRate(): number | null {
    if (!this.mindshareHistory || !Array.isArray(this.mindshareHistory) || this.mindshareHistory.length < 2) {
      return null;
    }

    const latest = this.mindshareHistory[this.mindshareHistory.length - 1];
    const previous = this.mindshareHistory[this.mindshareHistory.length - 2];

    if (!latest?.value || !previous?.value) return null;

    return ((latest.value - previous.value) / previous.value) * 100;
  }

  /**
   * Check if yapper has specific badge type
   */
  hasBadge(badgeType: BadgeType): boolean {
    return this.badgeTypes?.includes(badgeType) || false;
  }

  /**
   * Get engagement category based on smart engagement
   */
  getEngagementCategory(): string {
    if (!this.smartEngagement) return 'unknown';

    const engagement = parseFloat(this.smartEngagement.toString());
    
    if (engagement >= 50000) return 'mega_influencer';
    if (engagement >= 10000) return 'macro_influencer';
    if (engagement >= 1000) return 'micro_influencer';
    if (engagement >= 100) return 'nano_influencer';
    return 'emerging';
  }

  /**
   * Calculate overall profile score
   */
  getProfileScore(): number {
    let score = 0;

    // Mindshare contribution (0-40 points)
    if (this.mindsharePercent) {
      score += Math.min(this.mindsharePercent * 10000, 40); // Scale up percentage
    }

    // Engagement contribution (0-30 points)
    if (this.smartEngagement) {
      const engagement = parseFloat(this.smartEngagement.toString());
      score += Math.min(Math.log10(engagement + 1) * 10, 30);
    }

    // Badge contribution (0-20 points)
    if (this.totalBadges) {
      score += Math.min(this.totalBadges * 5, 20);
    }

    // Social network contribution (0-10 points)
    if (this.influenceScore) {
      score += Math.min(this.influenceScore / 10, 10);
    }

    return Math.round(score);
  }

  /**
   * Check if profile data is fresh (within last 7 days)
   */
  isDataFresh(): boolean {
    const now = new Date();
    const daysDiff = (now.getTime() - this.snapshotDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysDiff <= 7;
  }

  /**
   * Get key insights for content optimization
   */
  getContentInsights(): string[] {
    const insights: string[] = [];

    // Token sentiment insights
    const dominantSentiment = this.getDominantSentiment();
    if (dominantSentiment !== TokenSentiment.NEUTRAL) {
      insights.push(`Primarily ${dominantSentiment} on crypto tokens`);
    }

    // Engagement insights
    const engagementCategory = this.getEngagementCategory();
    insights.push(`${engagementCategory.replace('_', ' ')} engagement level`);

    // Badge insights
    if (this.hasBadge(BadgeType.MINDSHARE_LEADER)) {
      insights.push('Recognized mindshare leader');
    }

    if (this.hasBadge(BadgeType.COOKIE_OG)) {
      insights.push('Early platform adopter');
    }

    // Network insights
    if (this.networkCentrality && this.networkCentrality > 0.7) {
      insights.push('High network centrality - key connector');
    }

    return insights;
  }
}
