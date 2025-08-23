import { AppDataSource } from '../config/database';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { ContentPurchase } from '../models/ContentPurchase';
import { logger } from '../config/logger';

export interface MarketplaceContentFilters {
  search?: string;
  platform_source?: string;
  project_name?: string;
  post_type?: string;
  sort_by?: string;
  page?: number;
  limit?: number;
}

export interface MarketplaceContentResponse {
  success: boolean;
  data: any[];
  pagination: {
    currentPage: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    nextPage: number | null;
  };
}

export class MarketplaceContentService {
  private contentRepository = AppDataSource.getRepository(ContentMarketplace);
  private purchaseRepository = AppDataSource.getRepository(ContentPurchase);

  /**
   * Fetch marketplace content with enhanced search and pagination
   */
  async getMarketplaceContent(filters: MarketplaceContentFilters): Promise<MarketplaceContentResponse> {
    try {
      const {
        search,
        platform_source,
        project_name,
        post_type,
        sort_by = 'bidding_enabled',
        page = 1,
        limit = 18
      } = filters;

      logger.info(`🔍 Fetching marketplace content: page=${page}, limit=${limit}, search="${search}"`);

      // Build base query
      let query = this.contentRepository
        .createQueryBuilder('content')
        .leftJoinAndSelect('content.creator', 'creator')
        .leftJoinAndSelect('content.campaign', 'campaign')
        .where('content.approvalStatus = :status', { status: 'approved' })
        .andWhere('content.isAvailable = true')
        .andWhere('content.isBiddable = true');

      // Exclude purchased content
      query = query.andWhere(
        'NOT EXISTS (SELECT 1 FROM content_purchases cp WHERE cp.content_id = content.id AND cp.payment_status = \'completed\')'
      );

      // Apply filters
      if (platform_source) {
        query = query.andWhere('campaign.platformSource = :platform', { platform: platform_source });
      }

      if (project_name) {
        query = query.andWhere('campaign.projectName = :projectName', { projectName: project_name });
      }

      if (post_type) {
        query = query.andWhere('content.postType = :postType', { postType: post_type });
      }

      // Enhanced search covering multiple fields including platform source
      if (search && search.trim()) {
        const searchTerm = search.trim();
        query = query.andWhere(
          '(content.contentText ILIKE :search OR ' +
          'campaign.title ILIKE :search OR ' +
          'campaign.projectName ILIKE :search OR ' +
          'CAST(campaign.platformSource AS TEXT) ILIKE :search OR ' + // Convert ENUM to text for partial search
          'content.agentName ILIKE :search)',
          { search: `%${searchTerm}%` }
        );
        logger.info(`🔍 Applied search filter: "${searchTerm}"`);
      }

      // Apply sorting
      query = this.applySorting(query, sort_by);

      // Get total count for pagination
      const totalQuery = query.clone();
      const total = await totalQuery.getCount();

      // Apply pagination
      const offset = (Number(page) - 1) * Number(limit);
      query = query.skip(offset).take(Number(limit));

      // Execute query
      const contents = await query.getMany();

      logger.info(`✅ Fetched ${contents.length} content items (total: ${total})`);

      // Validate and log any content missing biddingEnabledAt
      const missingBiddingEnabledAt = contents.filter(content => 
        content.isBiddable && !content.biddingEnabledAt
      );
      
      if (missingBiddingEnabledAt.length > 0) {
        logger.warn(`⚠️ Found ${missingBiddingEnabledAt.length} biddable content items missing biddingEnabledAt field`);
        missingBiddingEnabledAt.forEach(content => {
          logger.warn(`⚠️ Content ID ${content.id} (${content.campaign?.title || 'Unknown'}) is biddable but missing biddingEnabledAt`);
        });
      }

      // Simple sorting: always by createdAt DESC (handled at database level)

      // Format content for frontend
      const formattedContents = await this.formatContentForFrontend(contents);
      
      // Log watermark image processing for debugging
      const watermarkedContent = formattedContents.filter(content => content.watermark_image);
      if (watermarkedContent.length > 0) {
        logger.info(`🔍 Found ${watermarkedContent.length} content items with watermark images`);
        watermarkedContent.forEach(content => {
          logger.info(`🔍 Content ID ${content.id}: watermark_image = ${content.watermark_image}`);
          logger.info(`🔍 Is presigned URL: ${content.watermark_image?.includes('?') && (content.watermark_image?.includes('X-Amz-Signature') || content.watermark_image?.includes('Signature'))}`);
        });
      }

      // Build pagination response
      const pagination = {
        currentPage: Number(page),
        limit: Number(limit),
        totalItems: total,
        totalPages: Math.ceil(total / Number(limit)),
        hasNextPage: Number(page) < Math.ceil(total / Number(limit)),
        nextPage: Number(page) < Math.ceil(total / Number(limit)) ? Number(page) + 1 : null
      };

      return {
        success: true,
        data: formattedContents,
        pagination
      };

    } catch (error) {
      logger.error('❌ Error in MarketplaceContentService.getMarketplaceContent:', error);
      throw error;
    }
  }

  /**
   * Apply sorting to the query - using random order for better campaign distribution
   */
  private applySorting(query: any, sortBy: string): any {
    // Use random sorting to show content from different campaigns spread throughout
    return query.orderBy('RANDOM()');
  }

  /**
   * Format content for frontend consumption
   */
  private async formatContentForFrontend(contents: ContentMarketplace[]): Promise<any[]> {
    return contents.map(content => ({
      id: content.id,
      content_text: content.contentText,
      tweet_thread: content.tweetThread || null,
      content_images: content.contentImages || [],
      watermark_image: content.watermarkImage || null,
      predicted_mindshare: Number(content.predictedMindshare || 0),
      quality_score: Number(content.qualityScore || 0),
      asking_price: Number(content.biddingAskPrice || content.askingPrice || 0),
      post_type: content.postType || 'thread',
      creator: {
        id: content.creator?.id,
        username: content.creator?.username || 'Anonymous',
        reputation_score: Number(content.creator?.reputationScore || 0),
        wallet_address: content.creator?.walletAddress
      },
      campaign: {
        id: content.campaign?.id,
        title: content.campaign?.title || 'Unknown Campaign',
        project_name: content.campaign?.projectName || content.campaign?.title || 'Unknown Project',
        platform_source: content.campaign?.platformSource || 'unknown',
        reward_token: content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: content.agentName,
      created_at: content.createdAt.toISOString(),
      approved_at: content.approvedAt?.toISOString(),
      bidding_enabled_at: content.biddingEnabledAt?.toISOString() || 
        (content.isBiddable ? content.createdAt.toISOString() : null), // Fallback to createdAt if biddable but missing
      // For immediate purchase system - no bidding data needed
      current_highest_bid: null,
      total_bids: 0,
      bids: []
    }));
  }

  /**
   * Get search suggestions based on available campaigns and projects
   */
  async getSearchSuggestions(): Promise<{
    platforms: string[];
    projects: string[];
    postTypes: string[];
  }> {
    try {
      const platforms = await this.contentRepository
        .createQueryBuilder('content')
        .leftJoin('content.campaign', 'campaign')
        .select('DISTINCT campaign.platformSource', 'platform')
        .where('content.approvalStatus = :status', { status: 'approved' })
        .andWhere('content.isAvailable = true')
        .andWhere('campaign.platformSource IS NOT NULL')
        .getRawMany();

      const projects = await this.contentRepository
        .createQueryBuilder('content')
        .leftJoin('content.campaign', 'campaign')
        .select('DISTINCT campaign.projectName', 'project')
        .where('content.approvalStatus = :status', { status: 'approved' })
        .andWhere('content.isAvailable = true')
        .andWhere('campaign.projectName IS NOT NULL')
        .getRawMany();

      const postTypes = await this.contentRepository
        .createQueryBuilder('content')
        .select('DISTINCT content.postType', 'postType')
        .where('content.approvalStatus = :status', { status: 'approved' })
        .andWhere('content.isAvailable = true')
        .andWhere('content.postType IS NOT NULL')
        .getRawMany();

      return {
        platforms: platforms.map(p => p.platform).filter(Boolean),
        projects: projects.map(p => p.project).filter(Boolean),
        postTypes: postTypes.map(p => p.postType).filter(Boolean)
      };
    } catch (error) {
      logger.error('❌ Error getting search suggestions:', error);
      return { platforms: [], projects: [], postTypes: [] };
    }
  }
}
