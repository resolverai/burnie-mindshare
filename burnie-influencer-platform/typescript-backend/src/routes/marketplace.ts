import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { BiddingSystem } from '../models/BiddingSystem';
import { PaymentTransaction, TransactionType, Currency } from '../models/PaymentTransaction';
import { User, UserRoleType } from '../models/User';
import { Campaign } from '../models/Campaign';
import { env } from '../config/env';
import { MoreThan, LessThan } from 'typeorm';

const router = Router();

/**
 * Automatically process expired auctions and select winners
 */
async function processExpiredAuctions(): Promise<void> {
  try {
    console.log('🕐 Processing expired auctions...');
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    
    // Find content with expired bidding periods that haven't been processed yet
    const expiredContent = await contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .where('content.isBiddable = :biddable', { biddable: true })
      .andWhere('content.biddingEndDate <= :now', { now: new Date() })
      .andWhere('content.isAvailable = :available', { available: true })
      .getMany();

    console.log(`📋 Found ${expiredContent.length} expired auctions to process`);

    for (const content of expiredContent) {
      // Get all bids for this content
      const bids = await biddingRepository
        .createQueryBuilder('bid')
        .leftJoinAndSelect('bid.bidder', 'bidder')
        .where('bid.contentId = :contentId', { contentId: content.id })
        .andWhere('bid.hasWon = :hasWon', { hasWon: false }) // Only unprocessed bids
        .orderBy('bid.bidAmount', 'DESC')
        .addOrderBy('bid.createdAt', 'ASC') // Earlier bid wins if amounts are equal
        .getMany();

      if (bids.length > 0) {
        const winningBid = bids[0];
        
        if (winningBid) {
          // Mark the winning bid
          winningBid.hasWon = true;
          winningBid.isWinning = true;
          winningBid.wonAt = new Date();
          
          // Mark all other bids as losing
          const losingBids = bids.slice(1);
          losingBids.forEach(bid => {
            bid.isWinning = false;
            bid.hasWon = false;
          });

          // Save all bid updates
          await biddingRepository.save([winningBid, ...losingBids]);

          // Mark content as no longer available for bidding (auction ended)
          content.isAvailable = false;
          content.isBiddable = false;
          await contentRepository.save(content);

          console.log(`🏆 Winner selected for content ${content.id}: User ${winningBid.bidderId} with bid ${winningBid.bidAmount} ${winningBid.bidCurrency}`);
        }
      } else {
        // No bids, just mark as ended
        content.isAvailable = false;
        content.isBiddable = false;
        await contentRepository.save(content);
        
        console.log(`⏰ Auction ended with no bids for content ${content.id}`);
      }
    }
    
    console.log('✅ Expired auction processing completed');
  } catch (error) {
    console.error('❌ Error processing expired auctions:', error);
  }
}

/**
 * @route GET /api/marketplace/content
 * @desc Get available content in marketplace with filters (with mock data for demonstration)
 */
router.get('/content', async (req, res) => {
  try {
    // First, process any expired auctions to select winners
    await processExpiredAuctions();
    
    const { 
      search,
      platform_source,
      sort_by = 'quality',
      page = 1,
      limit = 20 
    } = req.query;

    // Get approved content from the database
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    let query = contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('content.approvalStatus = :status', { status: 'approved' })
      .andWhere('content.isAvailable = :available', { available: true })
      .andWhere('content.isBiddable = :biddable', { biddable: true })
      .andWhere('(content.biddingEndDate IS NULL OR content.biddingEndDate > :now)', { now: new Date() });

    if (platform_source) {
      query = query.andWhere('campaign.platformSource = :platform', { platform: platform_source });
    }

    if (search) {
      query = query.andWhere('content.contentText ILIKE :search', { search: `%${search}%` });
    }

    // Sorting
    switch (sort_by) {
      case 'quality':
        query = query.orderBy('content.qualityScore', 'DESC');
        break;
      case 'mindshare':
        query = query.orderBy('content.predictedMindshare', 'DESC');
        break;
      case 'price_low':
        query = query.orderBy('content.askingPrice', 'ASC');
        break;
      case 'price_high':
        query = query.orderBy('content.askingPrice', 'DESC');
        break;
      case 'newest':
        query = query.orderBy('content.createdAt', 'DESC');
        break;
      default:
        query = query.orderBy('content.qualityScore', 'DESC');
    }

    const [contents, total] = await query
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    // Get bidding information for each content
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const contentIds = contents.map(c => c.id);
    
    const bids = contentIds.length > 0 ? await biddingRepository
      .createQueryBuilder('bid')
      .leftJoinAndSelect('bid.bidder', 'bidder')
      .where('bid.contentId IN (:...contentIds)', { contentIds })
      .orderBy('bid.bidAmount', 'DESC')
      .getMany() : [];

    // Group bids by content ID
    const bidsByContent = bids.reduce((acc, bid) => {
      const contentId = bid.contentId;
      if (contentId && !acc[contentId]) {
        acc[contentId] = [];
      }
      if (contentId) {
        acc[contentId]!.push(bid);
      }
      return acc;
    }, {} as Record<number, any[]>);

    res.json({
      success: true,
      data: contents.map(content => {
        const contentBids = bidsByContent[content.id] || [];
        const highestBid = contentBids.length > 0 ? contentBids[0] : null;
        
        return {
          id: content.id,
          content_text: content.contentText,
          content_images: content.contentImages,
          predicted_mindshare: Number(content.predictedMindshare),
          quality_score: Number(content.qualityScore),
          asking_price: content.isBiddable && content.biddingAskPrice 
            ? Number(content.biddingAskPrice) 
            : Number(content.askingPrice),
          creator: {
            username: content.creator?.username || 'Anonymous',
            reputation_score: content.creator?.reputationScore || 0
          },
          campaign: {
            title: content.campaign?.title || 'Unknown Campaign',
            platform_source: content.campaign?.platformSource || 'unknown',
            reward_token: content.campaign?.rewardToken || 'ROAST'
          },
          bids: contentBids.map(bid => ({
            amount: Number(bid.bidAmount),
            currency: bid.bidCurrency,
            bidder: bid.bidder?.username || 'Anonymous',
            is_winning: bid.isWinning
          })),
          highest_bid: highestBid ? {
            amount: Number(highestBid.bidAmount),
            currency: highestBid.bidCurrency,
            bidder: highestBid.bidder?.username || 'Anonymous'
          } : null,
          total_bids: contentBids.length,
          agent_name: content.agentName,
          created_at: content.createdAt.toISOString(),
          approved_at: content.approvedAt?.toISOString()
        };
      }),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error) {
    console.error('❌ Error fetching marketplace content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch marketplace content'
    });
  }
});

/**
 * @route GET /api/marketplace/content-old
 * @desc Original database-based content endpoint (for future use)
 */
router.get('/content-old', async (req, res) => {
  try {
    const { 
      campaign_id, 
      min_quality_score, 
      max_price, 
      sort_by = 'predicted_mindshare',
      order = 'DESC',
      page = 1,
      limit = 20 
    } = req.query;

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const queryBuilder = contentRepository.createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('content.isAvailable = :isAvailable', { isAvailable: true });

    // Apply filters
    if (campaign_id) {
      queryBuilder.andWhere('content.campaignId = :campaignId', { campaignId: campaign_id });
    }

    if (min_quality_score) {
      queryBuilder.andWhere('content.qualityScore >= :minQuality', { minQuality: min_quality_score });
    }

    if (max_price) {
      queryBuilder.andWhere('content.askingPrice <= :maxPrice', { maxPrice: max_price });
    }

    // Sorting
    const validSortFields = ['predicted_mindshare', 'quality_score', 'asking_price', 'created_at'];
    const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'predicted_mindshare';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    queryBuilder.orderBy(`content.${sortField.replace('_', '')}`, sortOrder);

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    queryBuilder.skip(offset).take(limitNum);

    const [contents, total] = await queryBuilder.getManyAndCount();

    res.json({
      success: true,
      data: contents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching marketplace content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch marketplace content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/content/:id
 * @desc Get specific content details with bidding information
 */
router.get('/content/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(parseInt(id))) {
      res.status(400).json({
        success: false,
        message: 'Invalid content ID'
      });
      return;
    }
    
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['creator', 'campaign']
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found'
      });
      return;
    }

    // Get current bids
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const bids = await biddingRepository.find({
      where: { contentId: parseInt(id) },
      relations: ['bidder'],
      order: { bidAmount: 'DESC' }
    });

    // Get highest bid
    const highestBid = bids.length > 0 ? bids[0] : null;

    res.json({
      success: true,
      data: {
        content,
        bids: bids.map(bid => ({
          id: bid.id,
          bidAmount: bid.bidAmount,
          bidCurrency: bid.bidCurrency,
          bidderUsername: bid.bidder.username,
          createdAt: bid.createdAt,
          isWinning: bid.isWinning
        })),
        highestBid: highestBid ? {
          amount: highestBid.bidAmount,
          currency: highestBid.bidCurrency,
          bidder: highestBid.bidder.username
        } : null,
        totalBids: bids.length
      }
    });
  } catch (error) {
    console.error('Error fetching content details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content details',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/bid
 * @desc Place a bid on content
 */
router.post('/bid', async (req: Request, res: Response): Promise<void> => {
  try {
    const { content_id, bid_amount, bid_currency = 'ROAST', wallet_address } = req.body;

    // Validation
    if (!content_id || !bid_amount || !wallet_address) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: content_id, bid_amount, wallet_address'
      });
      return;
    }

    if (bid_amount < env.platform.minimumBidAmount) {
      res.status(400).json({
        success: false,
        message: `Minimum bid amount is ${env.platform.minimumBidAmount} ${bid_currency}`
      });
      return;
    }

    // Check if content exists and is available for bidding
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { 
        id: content_id, 
        isAvailable: true,
        isBiddable: true,
        biddingEndDate: MoreThan(new Date()) // Only allow bids on active auctions
      }
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found, not available for bidding, or bidding has ended'
      });
      return;
    }

    // Find or create user by wallet address
    const userRepository = AppDataSource.getRepository(User);
    let user = await userRepository.findOne({ 
      where: { walletAddress: wallet_address.toLowerCase() } 
    });

    if (!user) {
      // Create new user if they don't exist
      user = new User();
      user.walletAddress = wallet_address.toLowerCase();
      user.roleType = UserRoleType.YAPPER;
      user = await userRepository.save(user);
      console.log('✅ Created new yapper user:', user.id, user.walletAddress);
    }

    // Check user balance (simplified for MVP - assuming users have sufficient balance)
    // const hasBalance = user.canAfford(bid_amount, bid_currency as 'ROAST' | 'USDC');
    // if (!hasBalance) {
    //   res.status(400).json({
    //     success: false,
    //     message: `Insufficient ${bid_currency} balance`
    //   });
    //   return;
    // }

    // Check if user already has a bid on this content
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const existingBid = await biddingRepository.findOne({
      where: { contentId: content_id, bidderId: user.id }
    });

    if (existingBid) {
      // Update existing bid
      existingBid.bidAmount = bid_amount;
      existingBid.bidCurrency = bid_currency as any;
      // createdAt will be updated automatically by TypeORM
      await biddingRepository.save(existingBid);

      // Update winning status
      await updateWinningBids(content_id);

      res.json({
        success: true,
        message: 'Bid updated successfully',
        data: {
          ...existingBid,
          user: { 
            id: user.id, 
            walletAddress: user.walletAddress,
            username: user.username 
          }
        }
      });
    } else {
      // Create new bid
      const newBid = biddingRepository.create({
        contentId: content_id,
        bidderId: user.id,
        bidAmount: bid_amount,
        bidCurrency: bid_currency as any
      });

      await biddingRepository.save(newBid);

      // Update winning status
      await updateWinningBids(content_id);

      res.json({
        success: true,
        message: 'Bid placed successfully',
        data: {
          ...newBid,
          user: { 
            id: user.id, 
            walletAddress: user.walletAddress,
            username: user.username 
          }
        }
      });
    }

  } catch (error) {
    console.error('Error placing bid:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @route POST /api/marketplace/content/:id/purchase
 * @desc Purchase content directly (if allowed)
 */
router.post('/content/:id/purchase', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { user_id, payment_currency = 'ROAST' } = req.body;

    if (!id || isNaN(parseInt(id))) {
      res.status(400).json({
        success: false,
        message: 'Invalid content ID'
      });
      return;
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: parseInt(id), isAvailable: true },
      relations: ['creator']
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found or not available'
      });
      return;
    }

    const userRepository = AppDataSource.getRepository(User);
    const buyer = await userRepository.findOne({ where: { id: user_id } });

    if (!buyer) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Check balance
    const hasBalance = buyer.canAfford(content.askingPrice, payment_currency as 'ROAST' | 'USDC');
    if (!hasBalance) {
      res.status(400).json({
        success: false,
        message: `Insufficient ${payment_currency} balance`
      });
      return;
    }

    // Calculate platform fee
    const platformFee = content.askingPrice * (env.platform.platformFeePercentage / 100);
    const creatorAmount = content.askingPrice - platformFee;

    // Create payment transaction
    const transactionRepository = AppDataSource.getRepository(PaymentTransaction);
    const transaction = transactionRepository.create({
      fromUserId: user_id,
      toUserId: content.creatorId,
      amount: content.askingPrice,
      currency: payment_currency as Currency,
      transactionType: TransactionType.CONTENT_PURCHASE,
      platformFee: platformFee,
      metadata: {
        contentId: content.id,
        contentPreview: content.contentText.substring(0, 100)
      }
    });

    await transactionRepository.save(transaction);

    // Update user balances
    if (payment_currency === 'ROAST') {
      buyer.roastBalance -= content.askingPrice;
      content.creator.roastBalance += creatorAmount;
    } else {
      buyer.usdcBalance -= content.askingPrice;
      content.creator.usdcBalance += creatorAmount;
    }

    await userRepository.save([buyer, content.creator]);

    // Mark content as sold
    content.isAvailable = false;
    await contentRepository.save(content);

    res.json({
      success: true,
      message: 'Content purchased successfully',
      data: {
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          currency: transaction.currency,
          platformFee: transaction.platformFee,
          creatorAmount: creatorAmount
        },
        content: {
          id: content.id,
          contentText: content.contentText,
          predictedMindshare: content.predictedMindshare,
          qualityScore: content.qualityScore
        }
      }
    });

  } catch (error) {
    console.error('Error purchasing content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to purchase content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route GET /api/marketplace/my-bids/:user_id
 * @desc Get user's bidding history
 */
router.get('/my-bids/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const { status = 'all', page = 1, limit = 20 } = req.query;

    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const queryBuilder = biddingRepository.createQueryBuilder('bid')
      .leftJoinAndSelect('bid.content', 'content')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('bid.bidderId = :userId', { userId: user_id });

    if (status === 'winning') {
      queryBuilder.andWhere('bid.isWinning = :isWinning', { isWinning: true });
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    queryBuilder
      .orderBy('bid.createdAt', 'DESC')
      .skip(offset)
      .take(limitNum);

    const [bids, total] = await queryBuilder.getManyAndCount();

    res.json({
      success: true,
      data: bids,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching user bids:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user bids',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @route POST /api/marketplace/approve
 * @desc Approve content from mining interface to marketplace
 */
router.post('/approve', async (req, res) => {
  try {
    const {
      campaignId,
      agentId,
      agentName,
      walletAddress,
      contentText,
      contentImages,
      predictedMindshare,
      qualityScore,
      generationMetadata,
      askingPrice = 100 // Default asking price
    } = req.body;

    // Validate required fields
    if (!campaignId || !contentText || !walletAddress) {
      console.error('❌ Missing required fields:', { campaignId, contentText: !!contentText, walletAddress });
      res.status(400).json({
        success: false,
        error: 'Missing required fields: campaignId, contentText, walletAddress'
      });
      return;
    }

    // Save approved content to database
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const userRepository = AppDataSource.getRepository(User);
    
    // Find user by wallet address (case-insensitive) to get creatorId
    console.log('🔍 Looking for user with wallet address:', walletAddress);
    const creator = await userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .getOne();
    
    if (!creator) {
      console.error('❌ Creator not found with wallet address:', walletAddress);
      
      // Try to create a new user if they don't exist
      const newUser = new User();
      newUser.walletAddress = walletAddress;
      newUser.roleType = UserRoleType.MINER;
      
      const savedUser = await userRepository.save(newUser);
      console.log('✅ Created new user:', savedUser.id, savedUser.walletAddress);
      
      // Use the newly created user as creator
      const creatorId = savedUser.id;
      
      // Create new content entry
      const newContent = new ContentMarketplace();
      newContent.creatorId = creatorId;
      newContent.campaignId = Number(campaignId);
      newContent.contentText = contentText;
      newContent.contentImages = contentImages || null;
      newContent.predictedMindshare = Number(predictedMindshare) || 75;
      newContent.qualityScore = Number(qualityScore) || 80;
      newContent.askingPrice = Number(askingPrice);
      newContent.approvalStatus = 'approved';
      newContent.isAvailable = true;
      if (agentId) {
        newContent.agentId = Number(agentId);
      }
      if (agentName) {
        newContent.agentName = agentName;
      }
      newContent.walletAddress = walletAddress;
      newContent.approvedAt = new Date();
      newContent.generationMetadata = generationMetadata || null;

      const savedContent = await contentRepository.save(newContent);

      console.log('✅ Content approved and saved to marketplace (new user):', {
        id: savedContent.id,
        creatorId: savedContent.creatorId,
        campaignId: savedContent.campaignId,
        agentId: savedContent.agentId,
        agentName: savedContent.agentName,
        walletAddress: savedContent.walletAddress,
        contentText: savedContent.contentText.substring(0, 100) + '...',
        predictedMindshare: savedContent.predictedMindshare,
        qualityScore: savedContent.qualityScore,
        askingPrice: savedContent.askingPrice,
        approvedAt: savedContent.approvedAt
      });

      res.json({
        success: true,
        data: {
          id: savedContent.id,
          message: 'Content approved and added to marketplace (new user created)',
          marketplace_url: `/marketplace/content/${savedContent.id}`,
          approvedAt: savedContent.approvedAt
        }
      });
      return;
    }
    
    console.log('✅ Found existing user:', creator.id, creator.walletAddress);

    // Try to find existing pending content record to update instead of creating new
    let existingContent = await contentRepository.findOne({
      where: {
        campaignId: Number(campaignId),
        creatorId: creator.id,
        contentText: contentText,
        approvalStatus: 'pending'
      }
    });

    if (existingContent) {
      // UPDATE existing record
      console.log('📝 Updating existing content record:', existingContent.id);
      
      existingContent.predictedMindshare = Number(predictedMindshare) || existingContent.predictedMindshare || 75;
      existingContent.qualityScore = Number(qualityScore) || existingContent.qualityScore || 80;
      existingContent.askingPrice = Number(askingPrice) || existingContent.askingPrice;
      existingContent.approvalStatus = 'approved';
      existingContent.isAvailable = true;
      
      if (agentId) {
        existingContent.agentId = Number(agentId);
      }
      if (agentName) {
        existingContent.agentName = agentName;
      }
      if (walletAddress) {
        existingContent.walletAddress = walletAddress;
      }
      if (contentImages) {
        existingContent.contentImages = contentImages;
      }
      if (generationMetadata) {
        existingContent.generationMetadata = generationMetadata;
      }
      
      existingContent.approvedAt = new Date();

      const updatedContent = await contentRepository.save(existingContent);

      console.log('✅ Content approved and updated in marketplace:', {
        id: updatedContent.id,
        creatorId: updatedContent.creatorId,
        campaignId: updatedContent.campaignId,
        agentId: updatedContent.agentId,
        agentName: updatedContent.agentName,
        walletAddress: updatedContent.walletAddress,
        contentText: updatedContent.contentText.substring(0, 100) + '...',
        predictedMindshare: updatedContent.predictedMindshare,
        qualityScore: updatedContent.qualityScore,
        askingPrice: updatedContent.askingPrice,
        approvedAt: updatedContent.approvedAt,
        action: 'UPDATED'
      });

      res.json({
        success: true,
        data: {
          id: updatedContent.id,
          message: 'Content approved and updated in marketplace',
          marketplace_url: `/marketplace/content/${updatedContent.id}`,
          approvedAt: updatedContent.approvedAt,
          action: 'updated'
        }
      });
      return;
    } else {
      // CREATE new record (fallback for cases where initial record wasn't created)
      console.log('🆕 Creating new content record (no pending record found)');
      
      const newContent = new ContentMarketplace();
      newContent.creatorId = creator.id;
      newContent.campaignId = Number(campaignId);
      newContent.contentText = contentText;
      newContent.contentImages = contentImages || null;
      newContent.predictedMindshare = Number(predictedMindshare) || 75;
      newContent.qualityScore = Number(qualityScore) || 80;
      newContent.askingPrice = Number(askingPrice);
      newContent.approvalStatus = 'approved';
      newContent.isAvailable = true;
      if (agentId) {
        newContent.agentId = Number(agentId);
      }
      if (agentName) {
        newContent.agentName = agentName;
      }
      newContent.walletAddress = walletAddress;
      newContent.approvedAt = new Date();
      newContent.generationMetadata = generationMetadata || null;

      const savedContent = await contentRepository.save(newContent);

      console.log('✅ Content approved and saved to marketplace (new record):', {
        id: savedContent.id,
        creatorId: savedContent.creatorId,
        campaignId: savedContent.campaignId,
        agentId: savedContent.agentId,
        agentName: savedContent.agentName,
        walletAddress: savedContent.walletAddress,
        contentText: savedContent.contentText.substring(0, 100) + '...',
        predictedMindshare: savedContent.predictedMindshare,
        qualityScore: savedContent.qualityScore,
        askingPrice: savedContent.askingPrice,
        approvedAt: savedContent.approvedAt,
        action: 'CREATED'
      });

      res.json({
        success: true,
        data: {
          id: savedContent.id,
          message: 'Content approved and added to marketplace',
          marketplace_url: `/marketplace/content/${savedContent.id}`,
          approvedAt: savedContent.approvedAt,
          action: 'created'
        }
      });
      return;
    }

  } catch (error) {
    console.error('❌ Error approving content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve content'
    });
  }
});

/**
 * @route POST /api/marketplace/reject
 * @desc Reject content from mining interface
 */
router.post('/reject', async (req, res) => {
  try {
    const {
      campaignId,
      agentId,
      walletAddress,
      contentText,
      reason = 'Quality standards not met'
    } = req.body;

    // Validate required fields
    if (!campaignId || !contentText || !walletAddress) {
      console.error('❌ Missing required fields for rejection:', { campaignId, contentText: !!contentText, walletAddress });
      res.status(400).json({
        success: false,
        error: 'Missing required fields: campaignId, contentText, walletAddress'
      });
      return;
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const userRepository = AppDataSource.getRepository(User);
    
    // Find user by wallet address
    const creator = await userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .getOne();
    
    if (!creator) {
      console.error('❌ Creator not found for rejection:', walletAddress);
      res.status(400).json({
        success: false,
        error: 'Creator not found with the provided wallet address'
      });
      return;
    }

    // Try to find existing pending content record to update
    let existingContent = await contentRepository.findOne({
      where: {
        campaignId: Number(campaignId),
        creatorId: creator.id,
        contentText: contentText,
        approvalStatus: 'pending'
      }
    });

    if (existingContent) {
      // UPDATE existing record
      console.log('📝 Rejecting existing content record:', existingContent.id);
      
      existingContent.approvalStatus = 'rejected';
      existingContent.isAvailable = false;
      existingContent.rejectedAt = new Date();
      
      if (agentId) {
        existingContent.agentId = Number(agentId);
      }
      
      const updatedContent = await contentRepository.save(existingContent);

      console.log('✅ Content rejected and updated in marketplace:', {
        id: updatedContent.id,
        creatorId: updatedContent.creatorId,
        campaignId: updatedContent.campaignId,
        agentId: updatedContent.agentId,
        walletAddress: updatedContent.walletAddress,
        contentText: updatedContent.contentText.substring(0, 100) + '...',
        rejectedAt: updatedContent.rejectedAt,
        reason,
        action: 'UPDATED'
      });

      res.json({
        success: true,
        data: {
          id: updatedContent.id,
          message: 'Content rejected and updated in marketplace',
          reason,
          rejectedAt: updatedContent.rejectedAt,
          action: 'updated'
        }
      });
      return;
    } else {
      // CREATE new rejected record (fallback when no pending record found)
      console.log('📝 Creating new rejected content record for:', {
        campaignId,
        agentId,
        walletAddress,
        contentText: contentText?.substring(0, 100) + '...',
        reason
      });
      
      const newContent = new ContentMarketplace();
      newContent.creatorId = creator.id;
      newContent.campaignId = Number(campaignId);
      if (agentId) {
        newContent.agentId = Number(agentId);
      }
      newContent.walletAddress = walletAddress;
      newContent.contentText = contentText;
      newContent.approvalStatus = 'rejected';
      newContent.isAvailable = false;
      newContent.rejectedAt = new Date();
      // Set default values for required fields
      newContent.askingPrice = 0;
      newContent.predictedMindshare = 0; // Default mindshare for rejected content
      newContent.qualityScore = 0; // Default quality score for rejected content

      const savedContent = await contentRepository.save(newContent);

      console.log('✅ New rejected content record created:', {
        id: savedContent.id,
        creatorId: savedContent.creatorId,
        campaignId: savedContent.campaignId,
        agentId: savedContent.agentId,
        walletAddress: savedContent.walletAddress,
        contentText: savedContent.contentText.substring(0, 100) + '...',
        rejectedAt: savedContent.rejectedAt,
        reason,
        action: 'CREATED'
      });

      res.json({
        success: true,
        data: {
          id: savedContent.id,
          message: 'Content rejected and recorded in marketplace',
          reason,
          rejectedAt: savedContent.rejectedAt,
          action: 'created'
        }
      });
      return;
    }

  } catch (error) {
    console.error('❌ Error rejecting content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject content'
    });
  }
});

/**
 * @route GET /api/marketplace/my-content/miner/wallet/:walletAddress
 * @desc Get miner's approved content for My Content section by wallet address
 */
router.get('/my-content/miner/wallet/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const contents = await contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .orderBy('content.createdAt', 'DESC')
      .getMany();

    const formattedContents = contents.map(content => ({
      id: content.id,
      content_text: content.contentText,
      content_images: content.contentImages,
      predicted_mindshare: Number(content.predictedMindshare),
      quality_score: Number(content.qualityScore),
      asking_price: Number(content.askingPrice),
      creator: {
        username: content.creator?.username || 'Anonymous',
        reputation_score: content.creator?.reputationScore || 0
      },
      campaign: {
        title: content.campaign?.title || 'Unknown Campaign',
        platform_source: content.campaign?.platformSource || 'unknown',
        reward_token: content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: content.agentName,
      created_at: content.createdAt.toISOString(),
      approved_at: content.approvedAt?.toISOString(),
      is_biddable: content.isBiddable,
      bidding_end_date: content.biddingEndDate?.toISOString(),
      bidding_ask_price: content.biddingAskPrice ? Number(content.biddingAskPrice) : null,
      bidding_enabled_at: content.biddingEnabledAt?.toISOString()
    }));

    return res.json({
      success: true,
      data: formattedContents
    });

  } catch (error) {
    console.error('❌ Error fetching miner content by wallet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch miner content'
    });
  }
});

/**
 * @route GET /api/marketplace/my-content/miner/:userId
 * @desc Get miner's approved content for My Content section (legacy - by user ID)
 */
router.get('/my-content/miner/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const contents = await contentRepository
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('content.creatorId = :userId', { userId: parseInt(userId) })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .orderBy('content.createdAt', 'DESC')
      .getMany();

    const formattedContents = contents.map(content => ({
      id: content.id,
      content_text: content.contentText,
      content_images: content.contentImages,
      predicted_mindshare: Number(content.predictedMindshare),
      quality_score: Number(content.qualityScore),
      asking_price: Number(content.askingPrice),
      creator: {
        username: content.creator?.username || 'Anonymous',
        reputation_score: content.creator?.reputationScore || 0
      },
      campaign: {
        title: content.campaign?.title || 'Unknown Campaign',
        platform_source: content.campaign?.platformSource || 'unknown',
        reward_token: content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: content.agentName,
      created_at: content.createdAt.toISOString(),
      approved_at: content.approvedAt?.toISOString(),
      is_biddable: content.isBiddable,
      bidding_end_date: content.biddingEndDate?.toISOString(),
      bidding_ask_price: content.biddingAskPrice ? Number(content.biddingAskPrice) : null,
      bidding_enabled_at: content.biddingEnabledAt?.toISOString()
    }));

    return res.json({
      success: true,
      data: formattedContents
    });

  } catch (error) {
    console.error('❌ Error fetching miner content:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch miner content'
    });
  }
});

/**
 * @route GET /api/marketplace/my-content/yapper/wallet/:walletAddress
 * @desc Get yapper's won content for My Content section by wallet address
 */
router.get('/my-content/yapper/wallet/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wallet address'
      });
    }

    // First find the user by wallet address
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Get content where this user has the winning bid
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    
    const winningBids = await biddingRepository
      .createQueryBuilder('bid')
      .leftJoinAndSelect('bid.bidder', 'bidder')
      .leftJoinAndSelect('bid.content', 'content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('bid.bidderId = :userId', { userId: user.id })
      .andWhere('bid.hasWon = :hasWon', { hasWon: true }) // Show content actually won after auction ended
      .orderBy('bid.wonAt', 'DESC') // Order by when they won
      .addOrderBy('bid.createdAt', 'DESC')
      .getMany();

    const formattedContents = winningBids.map(bid => ({
      id: bid.content.id,
      content_text: bid.content.contentText,
      content_images: bid.content.contentImages,
      predicted_mindshare: Number(bid.content.predictedMindshare),
      quality_score: Number(bid.content.qualityScore),
      asking_price: Number(bid.content.askingPrice),
      creator: {
        username: bid.content.creator?.username || 'Anonymous',
        reputation_score: bid.content.creator?.reputationScore || 0
      },
      campaign: {
        title: bid.content.campaign?.title || 'Unknown Campaign',
        platform_source: bid.content.campaign?.platformSource || 'unknown',
        reward_token: bid.content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: bid.content.agentName,
      created_at: bid.content.createdAt.toISOString(),
      approved_at: bid.content.approvedAt?.toISOString(),
      winning_bid: {
        amount: Number(bid.bidAmount),
        currency: bid.bidCurrency,
        bid_date: bid.createdAt.toISOString()
      }
    }));

    return res.json({
      success: true,
      data: formattedContents
    });

  } catch (error) {
    console.error('❌ Error fetching yapper content by wallet:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch yapper content'
    });
  }
});

/**
 * @route GET /api/marketplace/my-content/yapper/:userId
 * @desc Get yapper's won content for My Content section (legacy - by user ID)
 */
router.get('/my-content/yapper/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    // Get content where this user has the winning bid
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    
    const winningBids = await biddingRepository
      .createQueryBuilder('bid')
      .leftJoinAndSelect('bid.bidder', 'bidder')
      .leftJoinAndSelect('bid.content', 'content')
      .leftJoinAndSelect('content.creator', 'creator')
      .leftJoinAndSelect('content.campaign', 'campaign')
      .where('bid.bidderId = :userId', { userId: parseInt(userId) })
      .andWhere('bid.isWinning = :winning', { winning: true })
      .orderBy('bid.createdAt', 'DESC')
      .getMany();

    const formattedContents = winningBids.map(bid => ({
      id: bid.content.id,
      content_text: bid.content.contentText,
      content_images: bid.content.contentImages,
      predicted_mindshare: Number(bid.content.predictedMindshare),
      quality_score: Number(bid.content.qualityScore),
      asking_price: Number(bid.content.askingPrice),
      creator: {
        username: bid.content.creator?.username || 'Anonymous',
        reputation_score: bid.content.creator?.reputationScore || 0
      },
      campaign: {
        title: bid.content.campaign?.title || 'Unknown Campaign',
        platform_source: bid.content.campaign?.platformSource || 'unknown',
        reward_token: bid.content.campaign?.rewardToken || 'ROAST'
      },
      agent_name: bid.content.agentName,
      created_at: bid.content.createdAt.toISOString(),
      approved_at: bid.content.approvedAt?.toISOString(),
      winning_bid: {
        amount: Number(bid.bidAmount),
        currency: bid.bidCurrency,
        bid_date: bid.createdAt.toISOString()
      }
    }));

    return res.json({
      success: true,
      data: formattedContents
    });

  } catch (error) {
    console.error('❌ Error fetching yapper content:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch yapper content'
    });
  }
});

/**
 * @route PUT /api/marketplace/content/:id/bidding
 * @desc Enable/disable bidding for content and set pricing
 */
router.put('/content/:id/bidding', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { is_biddable, bidding_end_date, bidding_ask_price, wallet_address } = req.body;
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content ID'
      });
    }

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }

    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    
    const content = await contentRepository.findOne({
      where: { id: parseInt(id) },
      relations: ['creator']
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Verify ownership by wallet address
    if (!content.walletAddress || content.walletAddress.toLowerCase() !== wallet_address.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You can only modify your own content'
      });
    }

    // Update bidding settings
    content.isBiddable = is_biddable;
    if (is_biddable) {
      content.biddingEndDate = bidding_end_date ? new Date(bidding_end_date) : null;
      content.biddingAskPrice = bidding_ask_price ? parseFloat(bidding_ask_price) : null;
      content.biddingEnabledAt = new Date();
    } else {
      content.biddingEndDate = null;
      content.biddingAskPrice = null;
      content.biddingEnabledAt = null;
    }

    const updatedContent = await contentRepository.save(content);

    return res.json({
      success: true,
      data: {
        id: updatedContent.id,
        is_biddable: updatedContent.isBiddable,
        bidding_end_date: updatedContent.biddingEndDate?.toISOString(),
        bidding_ask_price: updatedContent.biddingAskPrice ? Number(updatedContent.biddingAskPrice) : null,
        bidding_enabled_at: updatedContent.biddingEnabledAt?.toISOString()
      },
      message: is_biddable ? 'Content enabled for bidding' : 'Content disabled for bidding'
    });

  } catch (error) {
    console.error('❌ Error updating bidding settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update bidding settings'
    });
  }
});

/**
 * Helper function to update winning bid status
 */
async function updateWinningBids(contentId: number) {
  const biddingRepository = AppDataSource.getRepository(BiddingSystem);
  
  // Reset all bids for this content
  await biddingRepository.update({ contentId }, { isWinning: false });
  
  // Find highest bid
  const highestBid = await biddingRepository.findOne({
    where: { contentId },
    order: { bidAmount: 'DESC' }
  });

  if (highestBid) {
    highestBid.isWinning = true;
    await biddingRepository.save(highestBid);
  }
}

// Analytics endpoints for real dashboard data

/**
 * GET /api/marketplace/analytics/content-stats/:walletAddress
 * Get comprehensive content statistics for a miner
 */
router.get('/analytics/content-stats/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);

    // First, get miner's content
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    const contentIds = minerContent.map(c => c.id);
    
    // Calculate basic content stats
    const totalContent = minerContent.length;
    const biddableContent = minerContent.filter(c => c.isBiddable).length;
    const avgQualityScore = minerContent.length > 0 
      ? minerContent.reduce((sum, c) => sum + (Number(c.qualityScore) || 0), 0) / minerContent.length 
      : 0;

    if (contentIds.length === 0) {
      return res.json({ 
        data: {
          totalContent: 0,
          totalBids: 0,
          totalRevenue: 0,
          contentReputation: Math.round(avgQualityScore),
          biddableContent: 0,
          avgBidAmount: 0
        }
      });
    }

    // Use raw SQL since TypeORM query seems to have issues
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        COUNT(b.id) as "totalBids",
        COUNT(DISTINCT b."bidderId") as "uniqueBidders",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "totalRevenue",
        AVG(b."bidAmount") as "avgBidAmount"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
    `, [contentIds]);

    const bidStats = bidStatsRaw[0] || {};

    // Calculate content reputation: quality_score + bid_trust_factor
    const bidActivity = parseInt(bidStats.totalBids) || 0;
    const uniqueBidders = parseInt(bidStats.uniqueBidders) || 0;
    const bidTrustFactor = (uniqueBidders * 10) + (bidActivity * 2);
    const contentReputation = Math.min(100, Math.round(avgQualityScore + bidTrustFactor));

    const result = {
      totalContent,
      totalBids: parseInt(bidStats.totalBids) || 0,
      totalRevenue: parseFloat(bidStats.totalRevenue) || 0,
      contentReputation: contentReputation > 0 ? contentReputation : Math.round(avgQualityScore),
      biddableContent,
      avgBidAmount: parseFloat(bidStats.avgBidAmount) || 0
    };

    return res.json({ data: result });
  } catch (error) {
    console.error('Error fetching content stats:', error);
    return res.status(500).json({ error: 'Failed to fetch content stats' });
  }
});

/**
 * GET /api/marketplace/analytics/bidding-trends/:walletAddress
 * Get real bidding trends for a miner's content over the last 30 days
 */
router.get('/analytics/bidding-trends/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get bidding trends for the last 30 days using raw SQL - simplified approach
    const rawData = await AppDataSource.query(`
      SELECT 
        TO_CHAR(DATE(b."createdAt"), 'YYYY-MM-DD') as date,
        COUNT(*) as "bidCount",
        SUM(b."bidAmount") as "totalRevenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY DATE(b."createdAt")
      ORDER BY DATE(b."createdAt") ASC
    `, [contentIds]);

    // Fill in missing days with zero values for the last 30 days
    const trends = [];
    const today = new Date();
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = rawData.find((d: any) => d.date === dateStr);
      
      trends.push({
        date: dateStr,
        bidCount: dayData ? parseInt(dayData.bidCount) : 0,
        revenue: dayData ? parseFloat(dayData.totalRevenue) : 0
      });
    }

    return res.json({ data: trends });
  } catch (error) {
    console.error('Error fetching bidding trends:', error);
    return res.status(500).json({ error: 'Failed to fetch bidding trends' });
  }
});

/**
 * GET /api/marketplace/analytics/top-content/:walletAddress
 * Get top performing content with real bid data
 */
router.get('/analytics/top-content/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    if (minerContent.length === 0) {
      return res.json({ data: [] });
    }

    // Get bid statistics for all content using raw SQL
    const contentIds = minerContent.map(c => c.id);
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        b."contentId",
        COUNT(b.id) as "bidCount",
        MAX(b."bidAmount") as "maxBid",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "revenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY b."contentId"
    `, [contentIds]);

    // Create lookup map for bid stats
    const bidStatsMap = bidStatsRaw.reduce((map: any, stats: any) => {
      map[stats.contentId] = stats;
      return map;
    }, {});

    // Combine content with bid statistics
    const contentWithBids = minerContent.map((content) => {
      const bidStats = bidStatsMap[content.id] || {};
      
      // Extract title from content text (first 50 characters)
      let title = content.contentText || 'Untitled Content';
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }

      return {
        id: content.id,
        title,
        bidCount: parseInt(bidStats.bidCount) || 0,
        maxBid: parseFloat(bidStats.maxBid) || 0,
        qualityScore: Number(content.qualityScore) || 0,
        revenue: parseFloat(bidStats.revenue) || 0
      };
    });

    // Sort by revenue, then maxBid, then bidCount
    const result = contentWithBids
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        if (b.maxBid !== a.maxBid) return b.maxBid - a.maxBid;
        return b.bidCount - a.bidCount;
      })
      .slice(0, 5);

    return res.json({ data: result });
  } catch (error) {
    console.error('Error fetching top content:', error);
    return res.status(500).json({ error: 'Failed to fetch top content' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper-engagement/:walletAddress
 * Get real yapper engagement data for a miner's content
 */
router.get('/analytics/yapper-engagement/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ data: [] });
    }

    // Get yapper engagement data using raw SQL
    const engagementRaw = await AppDataSource.query(`
      SELECT 
        u.id as "bidderId",
        u."walletAddress",
        u.username,
        COUNT(b.id) as "totalBids",
        SUM(b."bidAmount") as "totalAmount",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "wonContent"
      FROM bidding_system b
      INNER JOIN users u ON b."bidderId" = u.id
      WHERE b."contentId" = ANY($1)
      GROUP BY u.id, u."walletAddress", u.username
      ORDER BY "totalAmount" DESC
      LIMIT 10
    `, [contentIds]);

    const yappers = engagementRaw.map((data: any) => ({
      walletAddress: data.walletAddress || 'Unknown',
      username: data.username || `User${data.bidderId}`,
      totalBids: parseInt(data.totalBids) || 0,
      totalAmount: parseFloat(data.totalAmount) || 0,
      wonContent: parseInt(data.wonContent) || 0
    }));

    return res.json({ data: yappers });
  } catch (error) {
    console.error('Error fetching yapper engagement:', error);
    return res.status(500).json({ error: 'Failed to fetch yapper engagement' });
  }
});

/**
 * GET /api/marketplace/analytics/agent-performance/:walletAddress
 * Get real agent performance data for a miner
 */
router.get('/analytics/agent-performance/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content grouped by agent
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .andWhere('content.agentName IS NOT NULL')
      .getMany();

    if (minerContent.length === 0) {
      return res.json({ data: [] });
    }

    // Group content by agent
    const agentGroups: Record<string, any[]> = minerContent.reduce((groups: Record<string, any[]>, content) => {
      const agentName = content.agentName || 'Default Agent';
      if (!groups[agentName]) {
        groups[agentName] = [];
      }
      groups[agentName].push(content);
      return groups;
    }, {});

    // Get bid statistics for all content using raw SQL
    const contentIds = minerContent.map(c => c.id);
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        b."contentId",
        COUNT(b.id) as "bidCount",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "revenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY b."contentId"
    `, [contentIds]);

    // Create lookup map for bid stats
    const bidStatsMap = bidStatsRaw.reduce((map: any, stats: any) => {
      map[stats.contentId] = stats;
      return map;
    }, {});

    // Calculate performance for each agent
    const agentPerformance = Object.entries(agentGroups).map(([agentName, contents]) => {
      // Calculate total bid count and revenue for this agent's content
      let totalBidCount = 0;
      let totalRevenue = 0;
      
      contents.forEach(content => {
        const bidStats = bidStatsMap[content.id];
        if (bidStats) {
          totalBidCount += parseInt(bidStats.bidCount) || 0;
          totalRevenue += parseFloat(bidStats.revenue) || 0;
        }
      });

      // Calculate average quality
      const avgQuality = contents.reduce((sum, c) => sum + (Number(c.qualityScore) || 0), 0) / contents.length;

      return {
        agentName,
        contentCount: contents.length,
        bidCount: totalBidCount,
        revenue: totalRevenue,
        avgQuality: Math.round(avgQuality)
      };
    });

    return res.json({ data: agentPerformance });
  } catch (error) {
    console.error('Error fetching agent performance:', error);
    return res.status(500).json({ error: 'Failed to fetch agent performance' });
  }
});

/**
 * GET /api/marketplace/analytics/time-analysis/:walletAddress
 * Get real time-based bidding analysis for a miner's content
 */
router.get('/analytics/time-analysis/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content IDs
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .select(['content.id'])
      .getMany();

    const contentIds = minerContent.map(c => c.id);

    if (contentIds.length === 0) {
      return res.json({ 
        data: {
          heatmap: [],
          peakTimes: []
        }
      });
    }

    // Get hourly bidding patterns using proper PostgreSQL EXTRACT functions
    const heatmapData = await biddingRepository
      .createQueryBuilder('bid')
      .select([
        'EXTRACT(DOW FROM bid.createdAt) as day',
        'EXTRACT(HOUR FROM bid.createdAt) as hour',
        'COUNT(*) as bidCount'
      ])
      .where('bid.contentId IN (:...contentIds)', { contentIds })
      .groupBy('EXTRACT(DOW FROM bid.createdAt), EXTRACT(HOUR FROM bid.createdAt)')
      .getRawMany();

    // Convert to heatmap format
    const maxBids = Math.max(...heatmapData.map(d => Number(d.bidcount) || 0), 1);
    const heatmap = heatmapData.map(data => ({
      day: Number(data.day),
      hour: Number(data.hour),
      bidCount: Number(data.bidcount) || 0,
      intensity: (Number(data.bidcount) || 0) / maxBids
    }));

    // Calculate peak times
    const hourlyStats = await biddingRepository
      .createQueryBuilder('bid')
      .select([
        'EXTRACT(HOUR FROM bid.createdAt) as hour',
        'COUNT(*) as bidCount'
      ])
      .where('bid.contentId IN (:...contentIds)', { contentIds })
      .groupBy('EXTRACT(HOUR FROM bid.createdAt)')
      .orderBy('bidCount', 'DESC')
      .limit(4)
      .getRawMany();

    const totalBids = heatmapData.reduce((sum, d) => sum + (Number(d.bidcount) || 0), 0);
    const peakTimes = hourlyStats.map(stat => {
      const hour = Number(stat.hour);
      const bidCount = Number(stat.bidcount) || 0;
      const activity = totalBids > 0 ? Math.round((bidCount / totalBids) * 100) : 0;
      
      return {
        timeRange: `${hour}:00-${hour + 1}:00`,
        bidActivity: activity
      };
    });

    return res.json({ 
      data: {
        heatmap,
        peakTimes
      }
    });
  } catch (error) {
    console.error('Error fetching time analysis:', error);
    return res.status(500).json({ error: 'Failed to fetch time analysis' });
  }
});

/**
 * GET /api/marketplace/analytics/content-categories/:walletAddress
 * Get real content category performance for a miner
 */
router.get('/analytics/content-categories/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get miner's content
    const minerContent = await contentRepository
      .createQueryBuilder('content')
      .where('LOWER(content.walletAddress) = LOWER(:walletAddress)', { walletAddress })
      .andWhere('content.approvalStatus = :status', { status: 'approved' })
      .getMany();

    if (minerContent.length === 0) {
      return res.json({ data: [] });
    }

    // Get bid statistics for all content using raw SQL
    const contentIds = minerContent.map(c => c.id);
    const bidStatsRaw = await AppDataSource.query(`
      SELECT 
        b."contentId",
        COUNT(b.id) as "bidCount",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "revenue"
      FROM bidding_system b 
      WHERE b."contentId" = ANY($1)
      GROUP BY b."contentId"
    `, [contentIds]);

    // Create lookup map for bid stats
    const bidStatsMap = bidStatsRaw.reduce((map: any, stats: any) => {
      map[stats.contentId] = stats;
      return map;
    }, {});

    // Categorize content based on text patterns
    const categories: any = {
      memes: [],
      techAnalysis: [],
      marketInsights: [],
      newsCommentary: [],
      communityUpdates: []
    };

    minerContent.forEach((content) => {
      const text = (content.contentText || '').toLowerCase();
      
      if (text.includes('meme') || text.includes('😂') || text.includes('🔥') || text.includes('lol') || text.includes('funny')) {
        categories.memes.push(content);
      } else if (text.includes('analysis') || text.includes('technical') || text.includes('data') || text.includes('chart')) {
        categories.techAnalysis.push(content);
      } else if (text.includes('market') || text.includes('price') || text.includes('trading') || text.includes('crypto')) {
        categories.marketInsights.push(content);
      } else if (text.includes('news') || text.includes('update') || text.includes('breaking') || text.includes('announcement')) {
        categories.newsCommentary.push(content);
      } else {
        categories.communityUpdates.push(content);
      }
    });

    // Calculate performance for each category
    const categoryData = [
      { name: 'Memes', contents: categories.memes },
      { name: 'Tech Analysis', contents: categories.techAnalysis },
      { name: 'Market Insights', contents: categories.marketInsights },
      { name: 'News Commentary', contents: categories.newsCommentary },
      { name: 'Community Updates', contents: categories.communityUpdates }
    ];

    const categoryPerformance = categoryData
      .filter(({ contents }) => contents.length > 0)
      .map(({ name, contents }) => {
        // Calculate total bid count and revenue for this category
        let totalBidCount = 0;
        let totalRevenue = 0;
        
        contents.forEach((content: any) => {
          const bidStats = bidStatsMap[content.id];
          if (bidStats) {
            totalBidCount += parseInt(bidStats.bidCount) || 0;
            totalRevenue += parseFloat(bidStats.revenue) || 0;
          }
        });

        // Show actual average with 1 decimal place instead of rounding to integer
        const avgBids = contents.length > 0 ? parseFloat((totalBidCount / contents.length).toFixed(1)) : 0;

        return {
          category: name,
          count: contents.length,
          avgBids,
          revenue: Math.round(totalRevenue)
        };
      });

    return res.json({ data: categoryPerformance });
  } catch (error) {
    console.error('Error fetching content categories:', error);
    return res.status(500).json({ error: 'Failed to fetch content categories' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/financial/:walletAddress
 * Get comprehensive financial analytics for a yapper
 */
router.get('/analytics/yapper/financial/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    // Find user by wallet address
    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get all bids by this yapper using raw SQL
    const financialData = await AppDataSource.query(`
      SELECT 
        COUNT(*) as "totalBids",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "wonBids",
        SUM(b."bidAmount") as "totalSpent",
        SUM(CASE WHEN b."hasWon" = true THEN b."bidAmount" ELSE 0 END) as "totalInvestment",
        AVG(b."bidAmount") as "avgBidAmount",
        MAX(b."bidAmount") as "maxBid",
        MIN(b."bidAmount") as "minBid"
      FROM bidding_system b 
      WHERE b."bidderId" = $1
    `, [user.id]);

    // Get spending trends over last 30 days
    const spendingTrends = await AppDataSource.query(`
      SELECT 
        DATE(b."createdAt") as date,
        COUNT(*) as "bidsPlaced",
        SUM(b."bidAmount") as "amountSpent",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "bidsWon"
      FROM bidding_system b 
      WHERE b."bidderId" = $1
        AND b."createdAt" >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(b."createdAt")
      ORDER BY date ASC
    `, [user.id]);

    // Calculate ROI and profit metrics
    const stats = financialData[0];
    const totalSpent = parseFloat(stats?.totalInvestment) || 0;
    
    // Simulate mindshare value earned (would come from platform APIs in production)
    const mindshareValue = totalSpent * (1.2 + Math.random() * 0.8); // 20-100% potential return
    const netProfit = mindshareValue - totalSpent;
    const roiPercentage = totalSpent > 0 ? (netProfit / totalSpent) * 100 : 0;

    return res.json({
      data: {
        overview: {
          totalSpent: parseFloat(stats?.totalSpent) || 0,
          totalInvestment: totalSpent,
          totalBids: parseInt(stats?.totalBids) || 0,
          wonBids: parseInt(stats?.wonBids) || 0,
          winRate: (stats?.totalBids && stats.totalBids > 0) ? (stats.wonBids / stats.totalBids * 100) : 0,
          avgBidAmount: parseFloat(stats?.avgBidAmount) || 0,
          maxBid: parseFloat(stats?.maxBid) || 0,
          minBid: parseFloat(stats?.minBid) || 0
        },
        profitability: {
          mindshareValue: Math.round(mindshareValue),
          netProfit: Math.round(netProfit),
          roiPercentage: parseFloat(roiPercentage.toFixed(1)),
          costPerMindshare: totalSpent > 0 ? (totalSpent / (mindshareValue - totalSpent + totalSpent)) : 0
        },
        trends: spendingTrends.map((trend: any) => ({
          date: trend.date,
          bidsPlaced: parseInt(trend.bidsPlaced),
          amountSpent: parseFloat(trend.amountSpent),
          bidsWon: parseInt(trend.bidsWon)
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching yapper financial analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch financial analytics' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/bidding/:walletAddress
 * Get bidding performance analytics for a yapper
 */
router.get('/analytics/yapper/bidding/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get bidding competition analysis
    const competitionData = await AppDataSource.query(`
      SELECT 
        b."contentId",
        b."bidAmount" as "myBid",
        MAX(other_bids."bidAmount") as "maxBid",
        COUNT(other_bids.id) as "totalBidders",
        b."hasWon"
      FROM bidding_system b
      LEFT JOIN bidding_system other_bids ON b."contentId" = other_bids."contentId" 
        AND other_bids."bidderId" != b."bidderId"
      WHERE b."bidderId" = $1
      GROUP BY b."contentId", b."bidAmount", b."hasWon", b.id
      ORDER BY b."createdAt" DESC
      LIMIT 50
    `, [user.id]);

    // Get bidding patterns by time
    const timePatterns = await AppDataSource.query(`
      SELECT 
        EXTRACT(hour FROM b."createdAt") as hour,
        COUNT(*) as "bidCount",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "winCount",
        AVG(b."bidAmount") as "avgBid"
      FROM bidding_system b 
      WHERE b."bidderId" = $1
      GROUP BY EXTRACT(hour FROM b."createdAt")
      ORDER BY hour
    `, [user.id]);

    // Analyze content category preferences
    const categoryPreferences = await AppDataSource.query(`
      SELECT 
        CASE 
          WHEN LOWER(c."contentText") LIKE '%meme%' OR LOWER(c."contentText") LIKE '%😂%' 
            OR LOWER(c."contentText") LIKE '%🔥%' THEN 'Memes'
          WHEN LOWER(c."contentText") LIKE '%analysis%' OR LOWER(c."contentText") LIKE '%technical%' 
            OR LOWER(c."contentText") LIKE '%data%' THEN 'Tech Analysis'
          WHEN LOWER(c."contentText") LIKE '%market%' OR LOWER(c."contentText") LIKE '%price%' 
            OR LOWER(c."contentText") LIKE '%trading%' THEN 'Market Insights'
          WHEN LOWER(c."contentText") LIKE '%news%' OR LOWER(c."contentText") LIKE '%update%' 
            OR LOWER(c."contentText") LIKE '%breaking%' THEN 'News Commentary'
          ELSE 'Community Updates'
        END as category,
        COUNT(*) as "bidCount",
        COUNT(CASE WHEN b."hasWon" = true THEN 1 END) as "winCount",
        AVG(b."bidAmount") as "avgBid"
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id
      WHERE b."bidderId" = $1
      GROUP BY category
      ORDER BY "bidCount" DESC
    `, [user.id]);

    return res.json({
      data: {
        competition: competitionData.map((comp: any) => ({
          contentId: comp.contentId,
          myBid: parseFloat(comp.myBid),
          maxBid: parseFloat(comp.maxBid) || 0,
          totalBidders: parseInt(comp.totalBidders) || 0,
          hasWon: comp.hasWon,
          outbidBy: comp.hasWon ? 0 : Math.max(0, parseFloat(comp.maxBid) - parseFloat(comp.myBid))
        })),
        timePatterns: timePatterns.map((pattern: any) => ({
          hour: parseInt(pattern.hour),
          bidCount: parseInt(pattern.bidCount),
          winCount: parseInt(pattern.winCount),
          avgBid: parseFloat(pattern.avgBid),
          winRate: pattern.bidCount > 0 ? (pattern.winCount / pattern.bidCount * 100) : 0
        })),
        categoryPreferences: categoryPreferences.map((cat: any) => ({
          category: cat.category,
          bidCount: parseInt(cat.bidCount),
          winCount: parseInt(cat.winCount),
          avgBid: parseFloat(cat.avgBid),
          winRate: cat.bidCount > 0 ? (cat.winCount / cat.bidCount * 100) : 0
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching yapper bidding analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch bidding analytics' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/mindshare/:walletAddress
 * Get mindshare tracking and growth analytics for a yapper
 */
router.get('/analytics/yapper/mindshare/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get user's content portfolio for mindshare calculation base
    const portfolio = await AppDataSource.query(`
      SELECT COUNT(*) as "totalContent"
      FROM bidding_system b
      WHERE b."bidderId" = $1 AND b."hasWon" = true
    `, [user.id]);

    const contentCount = parseInt(portfolio[0]?.totalContent) || 0;
    
    // Simulate mindshare data (in production, this would come from platform APIs)
    const generateMindshareData = (platform: string, baseMultiplier: number) => {
      const data = [];
      const currentDate = new Date();
      let baseScore = 1000 + (contentCount * 50 * baseMultiplier);
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date(currentDate);
        date.setDate(date.getDate() - i);
        
        // Simulate realistic growth with some volatility
        const growth = (Math.random() - 0.3) * 20 + (contentCount > 0 ? 5 : 0);
        baseScore = Math.max(baseScore + growth, baseScore * 0.95);
        
        data.push({
          date: date.toISOString().split('T')[0],
          score: Math.round(baseScore),
          platform
        });
      }
      return data;
    };

    // Generate platform-specific mindshare data
    const cookieFunData = generateMindshareData('cookie.fun', 1.2);
    const kaitoData = generateMindshareData('yaps.kaito.ai', 0.8);
    const twitterData = generateMindshareData('twitter', 1.0);

    // Calculate current scores and growth
    const platforms = [
      {
        name: 'cookie.fun',
        currentScore: cookieFunData[29]?.score || 0,
        monthlyGrowth: cookieFunData[29] && cookieFunData[0] ? ((cookieFunData[29].score - cookieFunData[0].score) / cookieFunData[0].score * 100) : 0,
        data: cookieFunData,
        rewards: Math.floor((cookieFunData[29]?.score || 0) / 100),
        ranking: Math.max(1, Math.floor(5000 - (cookieFunData[29]?.score || 0) / 2))
      },
      {
        name: 'yaps.kaito.ai',
        currentScore: kaitoData[29]?.score || 0,
        monthlyGrowth: kaitoData[29] && kaitoData[0] ? ((kaitoData[29].score - kaitoData[0].score) / kaitoData[0].score * 100) : 0,
        data: kaitoData,
        rewards: Math.floor((kaitoData[29]?.score || 0) / 80),
        ranking: Math.max(1, Math.floor(3000 - (kaitoData[29]?.score || 0) / 3))
      },
      {
        name: 'twitter',
        currentScore: twitterData[29]?.score || 0,
        monthlyGrowth: twitterData[29] && twitterData[0] ? ((twitterData[29].score - twitterData[0].score) / twitterData[0].score * 100) : 0,
        data: twitterData,
        rewards: Math.floor((twitterData[29]?.score || 0) / 120),
        ranking: Math.max(1, Math.floor(10000 - (twitterData[29]?.score || 0) / 1.5))
      }
    ];

    // Generate heatmap data for calendar view
    const heatmapData = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const totalGrowth = platforms.reduce((sum, p) => {
        const dayData = p.data.find(d => d.date === date.toISOString().split('T')[0]);
        const dayIndex = p.data.indexOf(dayData!);
        const prevData = dayIndex > 0 ? p.data[dayIndex - 1] : null;
        return sum + (dayData && prevData ? ((dayData.score - prevData.score) / prevData.score * 100) : 0);
      }, 0);

      heatmapData.push({
        date: date.toISOString().split('T')[0],
        day: date.getDate(),
        growth: totalGrowth,
        intensity: Math.min(100, Math.max(0, totalGrowth + 50)) // Normalize for color intensity
      });
    }

    return res.json({
      data: {
        overview: {
          totalMindshare: platforms.reduce((sum, p) => sum + p.currentScore, 0),
          avgGrowth: platforms.length > 0 ? platforms.reduce((sum, p) => sum + p.monthlyGrowth, 0) / platforms.length : 0,
          totalRewards: platforms.reduce((sum, p) => sum + p.rewards, 0),
          bestPlatform: platforms.length > 0 ? 
            platforms.sort((a, b) => b.monthlyGrowth - a.monthlyGrowth)[0]?.name || 'none' : 'none'
        },
        platforms,
        heatmap: heatmapData,
        predictions: {
          nextWeekGrowth: (Math.random() * 10 + 2).toFixed(1),
          nextMonthTarget: Math.round(platforms.reduce((sum, p) => sum + p.currentScore, 0) * 1.15),
          optimalPostingTimes: ['09:00', '13:00', '18:00', '21:00']
        }
      }
    });
  } catch (error) {
    console.error('Error fetching yapper mindshare analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch mindshare analytics' });
  }
});

/**
 * GET /api/marketplace/analytics/yapper/portfolio/:walletAddress
 * Get content portfolio and usage analytics for a yapper
 */
router.get('/analytics/yapper/portfolio/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }
    
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.json({ data: null });
    }

    // Get detailed portfolio information
    const portfolioData = await AppDataSource.query(`
      SELECT 
        c.id,
        c."contentText",
        c."contentImages",
        c."qualityScore",
        c."predictedMindshare",
        c."agentName",
        b."bidAmount",
        b."createdAt" as "purchaseDate",
        b."wonAt"
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id
      WHERE b."bidderId" = $1 AND b."hasWon" = true
      ORDER BY b."wonAt" DESC
    `, [user.id]);

    // Simulate usage tracking (in production, this would track actual posts)
    const portfolioWithUsage = portfolioData.map((item: any) => {
      const daysSincePurchase = Math.floor((new Date().getTime() - new Date(item.purchaseDate).getTime()) / (1000 * 3600 * 24));
      const hasBeenUsed = Math.random() > 0.3; // 70% usage rate
      const performance = hasBeenUsed ? {
        engagementRate: (Math.random() * 8 + 2).toFixed(1), // 2-10%
        mindshareGain: Math.round(parseFloat(item.predictedMindshare) * (0.8 + Math.random() * 0.4)),
        platformReach: Math.round(Math.random() * 50000 + 10000),
        posted: hasBeenUsed,
        postDate: hasBeenUsed ? new Date(Date.now() - Math.random() * daysSincePurchase * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null
      } : {
        engagementRate: '0.0',
        mindshareGain: 0,
        platformReach: 0,
        posted: false,
        postDate: null
      };

      return {
        id: item.id,
        title: item.contentText.slice(0, 50) + '...',
        fullContent: item.contentText,
        images: item.contentImages,
        qualityScore: parseFloat(item.qualityScore),
        predictedMindshare: parseFloat(item.predictedMindshare),
        agentName: item.agentName,
        purchasePrice: parseFloat(item.bidAmount),
        purchaseDate: item.purchaseDate,
        daysSincePurchase,
        ...performance
      };
    });

    // Calculate portfolio metrics
    const totalInvestment = portfolioWithUsage.reduce((sum: number, item: any) => sum + item.purchasePrice, 0);
    const totalMindshareGained = portfolioWithUsage.reduce((sum: number, item: any) => sum + item.mindshareGain, 0);
    const usedContent = portfolioWithUsage.filter((item: any) => item.posted);
    const unusedContent = portfolioWithUsage.filter((item: any) => !item.posted);

    // Content performance ranking
    const topPerformers = [...portfolioWithUsage]
      .filter((item: any) => item.posted)
      .sort((a, b) => b.mindshareGain - a.mindshareGain)
      .slice(0, 5);

    // Category analysis
    const categoryBreakdown = portfolioWithUsage.reduce((acc: any, item: any) => {
      const text = item.fullContent.toLowerCase();
      let category = 'Community Updates';
      
      if (text.includes('meme') || text.includes('😂') || text.includes('🔥')) {
        category = 'Memes';
      } else if (text.includes('analysis') || text.includes('technical') || text.includes('data')) {
        category = 'Tech Analysis';
      } else if (text.includes('market') || text.includes('price') || text.includes('trading')) {
        category = 'Market Insights';
      } else if (text.includes('news') || text.includes('update') || text.includes('breaking')) {
        category = 'News Commentary';
      }

      if (!acc[category]) {
        acc[category] = { count: 0, totalInvestment: 0, totalGain: 0, usageRate: 0 };
      }
      
      acc[category].count++;
      acc[category].totalInvestment += item.purchasePrice;
      acc[category].totalGain += item.mindshareGain;
      acc[category].usageRate += item.posted ? 1 : 0;
      
      return acc;
    }, {});

    // Finalize category metrics
    Object.keys(categoryBreakdown).forEach(category => {
      const data = categoryBreakdown[category];
      data.usageRate = (data.usageRate / data.count * 100).toFixed(1);
      data.avgROI = data.totalInvestment > 0 ? ((data.totalGain / data.totalInvestment - 1) * 100).toFixed(1) : '0.0';
    });

    return res.json({
      data: {
        overview: {
          totalContent: portfolioData.length,
          usedContent: usedContent.length,
          unusedContent: unusedContent.length,
          usageRate: portfolioData.length > 0 ? (usedContent.length / portfolioData.length * 100) : 0,
          totalInvestment: Math.round(totalInvestment),
          totalMindshareGained,
          avgContentValue: portfolioData.length > 0 ? totalInvestment / portfolioData.length : 0,
          portfolioROI: totalInvestment > 0 ? ((totalMindshareGained / totalInvestment - 1) * 100) : 0
        },
        content: portfolioWithUsage,
        topPerformers,
        categoryBreakdown,
        insights: {
          bestCategory: Object.entries(categoryBreakdown).reduce((best: any, [category, data]: [string, any]) => 
            parseFloat(data.avgROI) > parseFloat(best.avgROI || '0') ? { category, ...data } : best, {}),
          avgTimeToUse: usedContent.length > 0 ? 
            usedContent.reduce((sum: number, item: any) => sum + item.daysSincePurchase, 0) / usedContent.length : 0,
          contentVelocity: usedContent.length / Math.max(1, Math.ceil((Date.now() - new Date(portfolioData[0]?.purchaseDate || Date.now()).getTime()) / (1000 * 3600 * 24 * 7))) // content per week
        }
      }
    });
  } catch (error) {
    console.error('Error fetching yapper portfolio analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch portfolio analytics' });
  }
});

/**
 * GET /api/marketplace/analytics/miner/portfolio/:walletAddress
 * Get token portfolio and earnings analytics for a miner
 */
router.get('/analytics/miner/portfolio/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Get earnings by token from winning bids
    const tokenEarnings = await AppDataSource.query(`
      SELECT 
        b."bidCurrency" as token,
        COUNT(b.id) as totalSales,
        SUM(CAST(b."bidAmount" AS DECIMAL)) as totalAmount,
        AVG(CAST(b."bidAmount" AS DECIMAL)) as avgAmount,
        MAX(CAST(b."bidAmount" AS DECIMAL)) as maxAmount,
        MIN(CAST(b."bidAmount" AS DECIMAL)) as minAmount
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id 
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND b."hasWon" = true
      GROUP BY b."bidCurrency"
      ORDER BY totalAmount DESC
    `, [walletAddress]);

    // Get recent transactions
    const recentTransactions = await AppDataSource.query(`
      SELECT 
        b."bidCurrency" as token,
        CAST(b."bidAmount" AS DECIMAL) as amount,
        b."wonAt" as date,
        c."contentText",
        c."agentName",
        u."walletAddress" as buyerWallet
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id 
      JOIN users u ON b."bidderId" = u.id
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND b."hasWon" = true
      ORDER BY b."wonAt" DESC
      LIMIT 20
    `, [walletAddress]);

    // Get content performance by token
    const contentByToken = await AppDataSource.query(`
      SELECT 
        b."bidCurrency" as token,
        c.id as contentId,
        c."contentText",
        c."agentName",
        c."predictedMindshare",
        c."qualityScore",
        CAST(b."bidAmount" AS DECIMAL) as salePrice,
        b."wonAt" as saleDate,
        COUNT(allBids.id) as totalBids
      FROM bidding_system b
      JOIN content_marketplace c ON b."contentId" = c.id 
      LEFT JOIN bidding_system allBids ON allBids."contentId" = c.id
      WHERE LOWER(c."walletAddress") = LOWER($1)
        AND b."hasWon" = true
      GROUP BY b."bidCurrency", c.id, c."contentText", c."agentName", c."predictedMindshare", 
               c."qualityScore", b."bidAmount", b."wonAt"
      ORDER BY b."wonAt" DESC
    `, [walletAddress]);

    // Calculate token rates (mock rates for now)
    const tokenRates = {
      ROAST: 0.1,
      USDC: 1.0,
      KAITO: 0.25,
      COOKIE: 0.15,
      AXR: 0.08,
      NYKO: 0.12,
    };

    // Process token earnings with USD values
    const processedEarnings = tokenEarnings.map((earning: any) => ({
      token: earning.token,
      amount: Number(earning.totalamount) || 0,
      totalSales: Number(earning.totalsales) || 0,
      avgSalePrice: Number(earning.avgamount) || 0,
      maxSalePrice: Number(earning.maxamount) || 0,
      minSalePrice: Number(earning.minamount) || 0,
      usdValue: (Number(earning.totalamount) || 0) * (tokenRates[earning.token as keyof typeof tokenRates] || 0),
      pricePerToken: tokenRates[earning.token as keyof typeof tokenRates] || 0,
    }));

    // Calculate portfolio metrics
    const totalUSDValue = processedEarnings.reduce((sum: number, earning: any) => sum + earning.usdValue, 0);
    const totalSales = processedEarnings.reduce((sum: number, earning: any) => sum + earning.totalSales, 0);
    const uniqueTokens = processedEarnings.length;

    // Get top performing token
    const topToken = processedEarnings.length > 0 ? 
      processedEarnings.reduce((top: any, current: any) => 
        current.usdValue > top.usdValue ? current : top
      ) : null;

    // Calculate portfolio distribution
    const distribution = processedEarnings.map((earning: any) => ({
      token: earning.token,
      percentage: totalUSDValue > 0 ? (earning.usdValue / totalUSDValue * 100) : 0,
      usdValue: earning.usdValue,
    }));

    // Process recent transactions
    const processedTransactions = recentTransactions.map((tx: any) => ({
      ...tx,
      amount: Number(tx.amount) || 0,
      usdValue: (Number(tx.amount) || 0) * (tokenRates[tx.token as keyof typeof tokenRates] || 0),
      contentPreview: tx.contentText ? tx.contentText.substring(0, 100) + '...' : '',
    }));

    // Group content by token
    const contentGroupedByToken = contentByToken.reduce((acc: any, content: any) => {
      if (!acc[content.token]) {
        acc[content.token] = [];
      }
      acc[content.token].push({
        ...content,
        saleprice: Number(content.saleprice) || 0,
        totalbids: Number(content.totalbids) || 0,
        usdValue: (Number(content.saleprice) || 0) * (tokenRates[content.token as keyof typeof tokenRates] || 0),
      });
      return acc;
    }, {});

    return res.json({
      portfolio: {
        totalUSDValue,
        totalSales,
        uniqueTokens,
        topToken: topToken ? {
          token: topToken.token,
          usdValue: topToken.usdValue,
          changePercent: 0, // TODO: Calculate actual change
        } : null,
      },
      earnings: processedEarnings,
      distribution,
      recentTransactions: processedTransactions,
      contentByToken: contentGroupedByToken,
      tokenRates,
    });

  } catch (error) {
    console.error('Error fetching miner portfolio analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch portfolio analytics' });
  }
});

// Add endpoint for pre-signed URL generation for marketplace content
router.post('/content/:id/presigned-url', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Content ID is required' });
    }
    
    const contentId = parseInt(id);
    if (isNaN(contentId)) {
      return res.status(400).json({ error: 'Invalid content ID' });
    }
    
    // Get content item to extract S3 key
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: contentId }
    });
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Extract S3 key from content images or text
    let s3Key: string | null = null;
    
    // Try to extract S3 key from content_images first
    if (content.contentImages && Array.isArray(content.contentImages)) {
      for (const image of content.contentImages) {
        if (image && image.url && image.url.includes('ai-generated/')) {
          // Extract S3 key from URL
          const urlParts = image.url.split('/');
          const aiGeneratedIndex = urlParts.findIndex((part: string) => part === 'ai-generated');
          if (aiGeneratedIndex !== -1) {
            s3Key = urlParts.slice(aiGeneratedIndex).join('/').split('?')[0]; // Remove query params
            break;
          }
        }
      }
    }
    
    // If not found in contentImages, try to extract from contentText
    if (!s3Key && content.contentText) {
      const s3UrlMatch = content.contentText.match(/https?:\/\/[^\/]+\/([^?\s]+)/);
      if (s3UrlMatch && s3UrlMatch[1] && s3UrlMatch[1].includes('ai-generated/')) {
        s3Key = s3UrlMatch[1];
      }
    }
    
    if (!s3Key) {
      return res.status(400).json({ 
        error: 'No S3 content found for this item',
        message: 'This content does not contain S3-stored images'
      });
    }
    
    // Call Python AI backend to generate pre-signed URL
    const pythonBackendUrl = process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
    
    try {
      const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          s3_key: s3Key,
          expiration: 3600 // 1 hour
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Python backend responded with ${response.status}`);
      }
      
      const presignedResult = await response.json() as {
        status: string;
        presigned_url?: string;
        details?: {
          expires_at: string;
          expires_in_seconds: number;
        };
        error?: string;
      };
      
      if (presignedResult.status === 'success' && presignedResult.presigned_url) {
        return res.json({
          success: true,
          presigned_url: presignedResult.presigned_url,
          expires_at: presignedResult.details?.expires_at,
          expires_in_seconds: presignedResult.details?.expires_in_seconds,
          s3_key: s3Key,
          content_id: id
        });
      } else {
        return res.status(500).json({
          error: 'Failed to generate pre-signed URL',
          details: presignedResult.error
        });
      }
      
    } catch (fetchError) {
      console.error('Error calling Python backend for pre-signed URL:', fetchError);
      return res.status(503).json({
        error: 'Unable to generate pre-signed URL',
        message: 'Python AI backend is not available',
        fallback: 'Original URLs may be used as fallback'
      });
    }
    
  } catch (error) {
    console.error('Error generating pre-signed URL for content:', error);
    return res.status(500).json({ error: 'Failed to process pre-signed URL request' });
  }
});

export default router; 