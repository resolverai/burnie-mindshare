import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { BiddingSystem } from '../models/BiddingSystem';
import { PaymentTransaction, TransactionType, Currency } from '../models/PaymentTransaction';
import { User } from '../models/User';
import { Campaign } from '../models/Campaign';
import { env } from '../config/env';

const router = Router();

/**
 * @route GET /api/marketplace/content
 * @desc Get available content in marketplace with filters (with mock data for demonstration)
 */
router.get('/content', async (req, res) => {
  try {
    const { 
      search,
      platform_source,
      sort_by = 'quality',
      page = 1,
      limit = 20 
    } = req.query;

    // Mock data representing AI-generated content from mining interface
    const mockContent = [
      {
        id: 1,
        content_text: "🚀 The future of DeFi is here! @BurnieProtocol just revolutionized yield farming with their multi-chain approach. Early adopters are seeing 300%+ APY on their staked tokens. Don't miss out on this gem! 💎 #DeFi #Crypto #YieldFarming #BurnieProtocol",
        predicted_mindshare: 94.5,
        quality_score: 91,
        asking_price: 1500,
        creator: {
          username: "CryptoMiner_AI",
          reputation_score: 96
        },
        campaign: {
          title: "Burnie Protocol Launch Campaign",
          platform_source: "yaps.kaito.ai",
          reward_token: "ROAST"
        },
        bids: [
          { amount: 1200, currency: "ROAST", bidder: "YapperPro1", is_winning: false },
          { amount: 1350, currency: "ROAST", bidder: "ContentHunter", is_winning: true }
        ],
        highest_bid: { amount: 1350, currency: "ROAST", bidder: "ContentHunter" },
        total_bids: 2,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        is_liked: false
      },
      {
        id: 2,
        content_text: "🍪 Cookie.fun just dropped their latest meme coin! 'BiscuitBucks' ($BISCUIT) is trending with massive community support. The tokenomics look solid with 2% reflections to holders. Could this be the next 100x? 🚀 #MemeCoins #Cookie #BiscuitBucks",
        predicted_mindshare: 87.2,
        quality_score: 89,
        asking_price: 800,
        creator: {
          username: "MemeGenius_Bot",
          reputation_score: 88
        },
        campaign: {
          title: "Cookie Fun Viral Marketing",
          platform_source: "cookie.fun",
          reward_token: "COOKIE"
        },
        bids: [
          { amount: 650, currency: "ROAST", bidder: "MemeLord", is_winning: true }
        ],
        highest_bid: { amount: 650, currency: "ROAST", bidder: "MemeLord" },
        total_bids: 1,
        created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
        is_liked: true
      },
      {
        id: 3,
        content_text: "⚡ BREAKING: Major institutions are quietly accumulating $ETH before the next upgrade. On-chain data shows whale wallets adding 50K+ ETH in the past week. Smart money is positioning for the next bull run. Are you? 🐋📈 #Ethereum #WhaleWatch #Crypto",
        predicted_mindshare: 92.8,
        quality_score: 94,
        asking_price: 2200,
        creator: {
          username: "WhaleTracker_AI",
          reputation_score: 93
        },
        campaign: {
          title: "Ethereum Analytics Campaign",
          platform_source: "yaps.kaito.ai",
          reward_token: "KAITO"
        },
        bids: [
          { amount: 1800, currency: "ROAST", bidder: "CryptoAnalyst", is_winning: false },
          { amount: 2000, currency: "ROAST", bidder: "WhaleSpotter", is_winning: true }
        ],
        highest_bid: { amount: 2000, currency: "ROAST", bidder: "WhaleSpotter" },
        total_bids: 2,
        created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
        is_liked: false
      },
      {
        id: 4,
        content_text: "🎯 New strategy alert! Combining liquidity mining with perpetual futures hedging can protect your downside while maximizing yields. Here's the step-by-step: 1) Provide LP on @UniswapV3 2) Open short perps 3) Collect fees risk-free ⚡ #DeFiStrategy #LP #Hedging",
        predicted_mindshare: 89.3,
        quality_score: 87,
        asking_price: 1200,
        creator: {
          username: "DeFiStrategist_Bot",
          reputation_score: 91
        },
        campaign: {
          title: "DeFi Education Series",
          platform_source: "yaps.kaito.ai",
          reward_token: "ROAST"
        },
        bids: [],
        total_bids: 0,
        created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        is_liked: false
      },
      {
        id: 5,
        content_text: "🔥 When your portfolio is down 50% but you keep buying the dip because 'it's not a loss until you sell' 😅 Stay strong diamond hands! 💎🙌 The market rewards patience and pizza money DCA. #HODL #DiamondHands #CryptoCommunity #BuyTheDip",
        predicted_mindshare: 82.1,
        quality_score: 85,
        asking_price: 600,
        creator: {
          username: "CryptoMemer_AI",
          reputation_score: 79
        },
        campaign: {
          title: "Crypto Meme Community Building",
          platform_source: "cookie.fun",
          reward_token: "COOKIE"
        },
        bids: [
          { amount: 450, currency: "ROAST", bidder: "MemeCollector", is_winning: true }
        ],
        highest_bid: { amount: 450, currency: "ROAST", bidder: "MemeCollector" },
        total_bids: 1,
        created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
        is_liked: true
      },
      {
        id: 6,
        content_text: "🌟 AI is revolutionizing content creation! From generating viral tweets to predicting engagement, machine learning models are helping creators optimize their reach. The future is human+AI collaboration, not replacement. What's your take? 🤖✨ #AI #ContentCreation #Future",
        predicted_mindshare: 90.7,
        quality_score: 92,
        asking_price: 1800,
        creator: {
          username: "AIContentGuru",
          reputation_score: 95
        },
        campaign: {
          title: "AI Innovation Showcase",
          platform_source: "yaps.kaito.ai",
          reward_token: "TECH"
        },
        bids: [
          { amount: 1400, currency: "ROAST", bidder: "TechEnthusiast", is_winning: false },
          { amount: 1600, currency: "ROAST", bidder: "AIResearcher", is_winning: true }
        ],
        highest_bid: { amount: 1600, currency: "ROAST", bidder: "AIResearcher" },
        total_bids: 2,
        created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
        is_liked: false
      }
    ];

    // Apply filters
    let filteredContent = mockContent;

    if (search) {
      const searchLower = (search as string).toLowerCase();
      filteredContent = filteredContent.filter(item => 
        item.content_text.toLowerCase().includes(searchLower) ||
        item.campaign.title.toLowerCase().includes(searchLower)
      );
    }

    if (platform_source && platform_source !== 'all') {
      filteredContent = filteredContent.filter(item => 
        item.campaign.platform_source === platform_source
      );
    }

    // Apply sorting
    switch (sort_by) {
      case 'quality':
        filteredContent.sort((a, b) => b.quality_score - a.quality_score);
        break;
      case 'mindshare':
        filteredContent.sort((a, b) => b.predicted_mindshare - a.predicted_mindshare);
        break;
      case 'price_low':
        filteredContent.sort((a, b) => a.asking_price - b.asking_price);
        break;
      case 'price_high':
        filteredContent.sort((a, b) => b.asking_price - a.asking_price);
        break;
      case 'recent':
        filteredContent.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      default:
        filteredContent.sort((a, b) => b.quality_score - a.quality_score);
    }

    // Apply pagination
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedContent = filteredContent.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedContent,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: filteredContent.length,
        pages: Math.ceil(filteredContent.length / limitNum)
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
    const { content_id, bid_amount, bid_currency = 'ROAST', user_id } = req.body;

    // Validation
    if (!content_id || !bid_amount || !user_id) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: content_id, bid_amount, user_id'
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

    // Check if content exists and is available
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: content_id, isAvailable: true }
    });

    if (!content) {
      res.status(404).json({
        success: false,
        message: 'Content not found or not available for bidding'
      });
      return;
    }

    // Check if user exists and has sufficient balance
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id: user_id } });

    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    // Check user balance
    const hasBalance = user.canAfford(bid_amount, bid_currency as 'ROAST' | 'USDC');
    if (!hasBalance) {
      res.status(400).json({
        success: false,
        message: `Insufficient ${bid_currency} balance`
      });
      return;
    }

    // Check if user already has a bid on this content
    const biddingRepository = AppDataSource.getRepository(BiddingSystem);
    const existingBid = await biddingRepository.findOne({
      where: { contentId: content_id, bidderId: user_id }
    });

    if (existingBid) {
      // Update existing bid
      existingBid.bidAmount = bid_amount;
      existingBid.bidCurrency = bid_currency as any;
      await biddingRepository.save(existingBid);

      // Update winning status
      await updateWinningBids(content_id);

      res.json({
        success: true,
        message: 'Bid updated successfully',
        data: existingBid
      });
    } else {
      // Create new bid
      const newBid = biddingRepository.create({
        contentId: content_id,
        bidderId: user_id,
        bidAmount: bid_amount,
        bidCurrency: bid_currency as any
      });

      await biddingRepository.save(newBid);

      // Update winning status
      await updateWinningBids(content_id);

      res.json({
        success: true,
        message: 'Bid placed successfully',
        data: newBid
      });
    }

  } catch (error) {
    console.error('Error placing bid:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to place bid',
      error: error instanceof Error ? error.message : 'Unknown error'
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

export default router; 