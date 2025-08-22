import { Repository, Not, IsNull } from 'typeorm';
import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import { TwitterLearningData } from '../models/TwitterLearningData';
import { TwitterUserConnection } from '../models/TwitterUserConnection';
import { AgentConfiguration, AgentType } from '../models/AgentConfiguration';
import { logger } from '../config/logger';

// Twitter OAuth 2.0 configuration for token refresh
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';

interface TwitterTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

interface TwitterAPIResponse {
  data?: TwitterTweet[];
  meta?: {
    oldest_id?: string;
    newest_id?: string;
    result_count?: number;
    next_token?: string;
  };
}

interface TwitterTweet {
  id: string;
  text: string;
  created_at: string;
  conversation_id?: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
    impression_count?: number;
  };
  context_annotations?: any[];
  entities?: {
    hashtags?: { tag: string }[];
    mentions?: { username: string }[];
    urls?: { expanded_url: string }[];
    media?: { media_key: string; type: string }[];
    cashtags?: { tag: string }[];
  };
  attachments?: {
    media_keys?: string[];
  };
}

interface LearningInsights {
  writingStyle: {
    averageLength: number;
    hashtagUsage: number;
    mentionUsage: number;
    emojiUsage: number;
    urlUsage: number;
  };
  engagementPatterns: {
    bestPerformingLength: number;
    optimalPostingTimes: number[];
    topHashtags: string[];
    averageEngagementRate: number;
  };
  contentThemes: {
    cryptoKeywords: string[];
    frequentTopics: string[];
    sentimentPattern: string;
  };
  personalityTraits: {
    tone: 'professional' | 'casual' | 'humorous' | 'technical';
    formality: 'formal' | 'informal' | 'mixed';
    engagement_style: 'conversational' | 'informative' | 'promotional';
  };
}

export class TwitterLearningService {
  private userRepository: Repository<User>;
  private twitterLearningRepository: Repository<TwitterLearningData>;
  private agentConfigRepository: Repository<AgentConfiguration>;

  constructor() {
    this.userRepository = AppDataSource.getRepository(User);
    this.twitterLearningRepository = AppDataSource.getRepository(TwitterLearningData);
    this.agentConfigRepository = AppDataSource.getRepository(AgentConfiguration);
  }

  /**
   * Main method to run continuous Twitter learning for all connected users
   */
  async runContinuousLearning(): Promise<void> {
    try {
      logger.info('🧠 Starting continuous Twitter learning process...');
      
      // Get all users with connected Twitter accounts
      const usersWithTwitter = await this.userRepository.find({
        where: {
          twitterHandle: Not(IsNull()),
          twitterUserId: Not(IsNull()),
        },
        select: ['id', 'walletAddress', 'twitterHandle', 'twitterUserId', 'twitterOauthToken'],
      });

      if (usersWithTwitter.length === 0) {
        logger.info('📭 No users with connected Twitter accounts found');
        return;
      }

      logger.info(`🔍 Found ${usersWithTwitter.length} users with connected Twitter accounts`);

      // Process each user's Twitter data
      for (const user of usersWithTwitter) {
        try {
          const result = await this.processUserTwitterData(user);
          if (result.success) {
            logger.info(`✅ Processed ${result.tweetsProcessed} tweets for user ${user.id}`);
          } else {
            logger.warn(`⚠️ Learning update failed for user ${user.id}: ${result.error}`);
          }
          
          // Add delay between users to respect rate limits
          await this.delay(2000);
        } catch (error) {
          logger.error(`❌ Error processing Twitter data for user ${user.id}:`, error);
        }
      }

      logger.info('✅ Continuous Twitter learning process completed');
    } catch (error) {
      logger.error('❌ Error in continuous Twitter learning:', error);
      throw error;
    }
  }

  /**
   * Check if Twitter data was already processed today for a creator/miner
   */
  private async wasDataProcessedToday(userId: number): Promise<boolean> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const count = await this.twitterLearningRepository
        .createQueryBuilder("learning")
        .where("learning.userId = :userId", { userId })
        .andWhere("learning.processedAt >= :today", { today })
        .andWhere("learning.processedAt < :tomorrow", { tomorrow })
        .getCount();

      return count > 0;
    } catch (error) {
      logger.error(`❌ Error checking daily processing status for user ${userId}:`, error);
      return true; // Return true to prevent duplicate attempts on error
    }
  }

  /**
   * Process individual user's Twitter data
   */
  public async processUserTwitterData(user: User): Promise<{success: boolean, tweetsProcessed: number, error?: string}> {
    try {
      logger.info(`🧠 Starting comprehensive Twitter learning for user ${user.id}...`);

      // Check if data was already processed today
      const alreadyProcessedToday = await this.wasDataProcessedToday(user.id);
      if (alreadyProcessedToday) {
        logger.info(`⏭️ Skipping Twitter data processing for user ${user.id} (@${user.twitterHandle}) - already processed today`);
        return {
          success: true,
          tweetsProcessed: 0
        };
      }

      // Fetch user tweets
      const tweets = await this.fetchUserTweets(user);
      
      if (tweets.length === 0) {
        logger.info(`📭 No tweets to process for user ${user.id}`);
        return { success: false, tweetsProcessed: 0, error: 'No tweets available - Twitter API may have failed or user has no tweets' };
      }

      logger.info(`📊 Processing ${tweets.length} tweets for comprehensive AI training...`);

      // Generate comprehensive insights for all 5 agent types
      const agentInsights = await this.generateAgentSpecificInsights(tweets, user);
      
      // Get user's agent configurations to map agent types to agent IDs
      const userAgents = await this.getUserAgentConfigurations(user.id);
      const agentTypeToIdMap = new Map<string, number>();
      
      // Create mapping from agent type to agent ID
      userAgents.forEach(agent => {
        if (agent.agentType) {
          agentTypeToIdMap.set(agent.agentType.toUpperCase(), agent.id);
        }
      });
      
      logger.info(`📋 Found ${userAgents.length} active agents for user ${user.id}`);
      
      // Calculate overall learning metrics
      const overallMetrics = this.calculateOverallMetrics(tweets);

      // Save detailed learning data for each agent type
      const learningDataRepository = AppDataSource.getRepository(TwitterLearningData);
      
      // Store individual tweet data first with enhanced fields
      await this.storeIndividualTweetData(tweets, user, overallMetrics);
      
      // Create comprehensive learning records for each agent type
      for (const [agentType, insights] of Object.entries(agentInsights)) {
        const learningData = new TwitterLearningData();
        learningData.userId = user.id;
        
        // Map agent type to actual agent ID from user's configurations
        const agentId = agentTypeToIdMap.get(agentType.toUpperCase());
        if (agentId) {
          learningData.agentId = agentId;
          logger.info(`🎯 Associating learning data with agent ID ${agentId} (${agentType})`);
        } else {
          logger.warn(`⚠️ No agent ID found for type ${agentType} - storing without agent association`);
        }

        learningData.tweetId = `bulk_analysis_${agentType}_${Date.now()}`;
        learningData.tweetText = `Comprehensive analysis of ${tweets.length} tweets for ${agentType} agent`;
        learningData.analysisType = 'comprehensive_agent_training';
        
        // Store comprehensive insights and training data
        learningData.insights = {
          agentType: agentType,
          role: (insights as any).role,
          insights: (insights as any).insights,
          trainingData: (insights as any).trainingData,
          totalTweetsAnalyzed: tweets.length,
          analysisTimestamp: new Date().toISOString(),
          overallMetrics: overallMetrics,
          
          // Include sample tweets for context
          sampleTweets: tweets.slice(0, 5).map(t => ({
            text: t.text.substring(0, 200),
            engagement: {
              likes: t.public_metrics?.like_count || 0,
              retweets: t.public_metrics?.retweet_count || 0,
              replies: t.public_metrics?.reply_count || 0
            },
            created_at: t.created_at
          }))
        };

        learningData.confidence = this.calculateConfidenceScore(tweets.length, overallMetrics.avgEngagement);
        learningData.processedAt = new Date();

        await learningDataRepository.save(learningData);
        logger.info(`✅ Saved comprehensive learning data for ${agentType} agent`);
      }

      // Create a master summary record
      const masterSummary = new TwitterLearningData();
      masterSummary.userId = user.id;
      masterSummary.tweetId = `master_summary_${Date.now()}`;
      masterSummary.tweetText = `Master learning summary for all 5 agents from ${tweets.length} tweets`;
      masterSummary.analysisType = 'master_agent_constellation';
      
      masterSummary.insights = {
        totalAgentsTrained: 5,
        totalTweetsProcessed: tweets.length,
        overallMetrics: overallMetrics,
        agentConstellationReady: true,
        learningCompletionStatus: {
          dataAnalyst: 'trained',
          contentStrategist: 'trained', 
          textContent: 'trained',
          visualCreator: 'trained',
          orchestrator: 'trained'
        },
        personalizedAgentCapabilities: {
          contentGeneration: 'Ready',
          strategyOptimization: 'Ready',
          engagementPrediction: 'Ready',
          visualContentPlanning: 'Ready',
          crossPlatformCoordination: 'Ready'
        },
        nextSteps: [
          'Agent constellation is fully trained and ready for content generation',
          'User can start mining with personalized AI assistance',
          'All 5 agents will work together to maximize mindshare'
        ]
      };

      masterSummary.confidence = this.calculateConfidenceScore(tweets.length, overallMetrics.avgEngagement);
      masterSummary.processedAt = new Date();

      await learningDataRepository.save(masterSummary);

      // **UPDATE AGENT LEARNING PROGRESS**
      await this.updateAgentLearningProgress(user.id, tweets.length);

      logger.info(`🎉 Comprehensive Twitter learning completed for user ${user.id}`);
      logger.info(`📈 Trained 5-agent constellation with ${tweets.length} tweets`);
      logger.info(`🤖 All agents ready for personalized content generation`);

      return { success: true, tweetsProcessed: tweets.length };

    } catch (error) {
      logger.error(`❌ Error processing Twitter data for user ${user.id}:`, error);
      
      // Provide more specific error messages for different types of failures
      let errorMessage = 'Unknown error';
      
      if (error instanceof Error) {
        const errorText = error.message.toLowerCase();
        
        if (errorText.includes('unauthorized') || errorText.includes('401')) {
          errorMessage = 'Twitter API unauthorized - token may be expired or invalid';
        } else if (errorText.includes('forbidden') || errorText.includes('403')) {
          errorMessage = 'Twitter API forbidden - account may be private or suspended';
        } else if (errorText.includes('rate limit') || errorText.includes('429')) {
          errorMessage = 'Twitter API rate limit exceeded - please try again later';
        } else if (errorText.includes('twitter') || errorText.includes('token')) {
          errorMessage = `Twitter API error: ${error.message}`;
        } else {
          errorMessage = error.message;
        }
      }
      
      logger.error(`🔍 Categorized error for user ${user.id}: ${errorMessage}`);
      
      return { success: false, tweetsProcessed: 0, error: errorMessage };
    }
  }

  /**
   * Refresh Twitter access token using refresh token
   */
  private async refreshTwitterToken(twitterConnection: TwitterUserConnection): Promise<TwitterUserConnection | null> {
    try {
      logger.info(`🔄 Attempting to refresh Twitter token for user ${twitterConnection.userId}`);
      logger.info(`🔧 Current access token (last 10 chars): ...${twitterConnection.accessToken.slice(-10)}`);
      logger.info(`🔧 Refresh token available: ${twitterConnection.refreshToken ? 'YES' : 'NO'}`);

      if (!twitterConnection.refreshToken) {
        logger.error(`❌ No refresh token available for user ${twitterConnection.userId}`);
        return null;
      }

      // Twitter OAuth 2.0 token refresh endpoint
      const tokenUrl = 'https://api.twitter.com/2/oauth2/token';
      const tokenData = {
        grant_type: 'refresh_token',
        refresh_token: twitterConnection.refreshToken,
        client_id: TWITTER_CLIENT_ID
      };

      // Create Basic Authentication header
      const authHeader = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

      logger.info(`📤 Making token refresh request to Twitter...`);
      logger.info(`🔧 Request payload: grant_type=refresh_token, client_id=${TWITTER_CLIENT_ID ? 'SET' : 'MISSING'}`);

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authHeader}`,
          'User-Agent': 'BurnieAI/1.0'
        },
        body: new URLSearchParams(tokenData)
      });

      logger.info(`📨 Twitter refresh response status: ${tokenResponse.status}`);

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        logger.error(`❌ Token refresh failed: ${tokenResponse.status}`, errorData);
        logger.error(`🔧 Full Twitter API error response: ${errorData}`);
        logger.error(`🔧 Request details: grant_type=refresh_token, client_id=${TWITTER_CLIENT_ID ? 'SET' : 'MISSING'}, refresh_token=${twitterConnection.refreshToken ? 'SET' : 'MISSING'}`);
        
        // If refresh token is invalid, mark connection as disconnected
        if (tokenResponse.status === 400 || tokenResponse.status === 401) {
          logger.error(`🔑 Refresh token invalid or expired for user ${twitterConnection.userId} - marking as disconnected`);
          twitterConnection.isConnected = false;
          await AppDataSource.getRepository(TwitterUserConnection).save(twitterConnection);
        }
        
        return null;
      }

      const tokenResult = await tokenResponse.json() as TwitterTokenResponse;
      logger.info(`✅ Successfully refreshed access token for user ${twitterConnection.userId}`);
      logger.info(`🔧 New access token (last 10 chars): ...${tokenResult.access_token.slice(-10)}`);
      logger.info(`🔧 New refresh token provided: ${tokenResult.refresh_token ? 'YES' : 'NO'}`);

      // Update the connection with new tokens
      const oldAccessToken = twitterConnection.accessToken;
      twitterConnection.accessToken = tokenResult.access_token;
      if (tokenResult.refresh_token) {
        twitterConnection.refreshToken = tokenResult.refresh_token;
      }
      twitterConnection.lastSyncAt = new Date();

      // Save updated connection
      const updatedConnection = await AppDataSource.getRepository(TwitterUserConnection).save(twitterConnection);
      logger.info(`💾 Updated Twitter connection tokens for user ${twitterConnection.userId}`);
      logger.info(`🔧 Database update successful - Access token changed: ${oldAccessToken !== updatedConnection.accessToken}`);

      return updatedConnection;

    } catch (error) {
      logger.error(`❌ Error refreshing Twitter token for user ${twitterConnection.userId}:`, error);
      return null;
    }
  }

  /**
   * Make authenticated Twitter API request with automatic token refresh on 401
   */
  private async makeTwitterAPIRequest(url: string, twitterConnection: TwitterUserConnection, maxRetries: number = 1): Promise<Response | null> {
    try {
      logger.info(`🌐 Making Twitter API request for user ${twitterConnection.userId}`);
      logger.info(`🔧 Using access token (last 10 chars): ...${twitterConnection.accessToken.slice(-10)}`);
      logger.info(`🔧 Retries remaining: ${maxRetries}`);

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${twitterConnection.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'BurnieAI/1.0'
        },
      });

      logger.info(`📨 Twitter API response status: ${response.status}`);

      // If 401 Unauthorized, attempt token refresh
      if (response.status === 401 && maxRetries > 0) {
        logger.warn(`🔑 Access token expired for user ${twitterConnection.userId}, attempting refresh...`);
        
        const refreshedConnection = await this.refreshTwitterToken(twitterConnection);
        if (refreshedConnection) {
          logger.info(`🔄 Token refreshed successfully, retrying API request...`);
          logger.info(`🔧 Retrying with new token (last 10 chars): ...${refreshedConnection.accessToken.slice(-10)}`);
          
          // Retry the request with refreshed token
          return await this.makeTwitterAPIRequest(url, refreshedConnection, maxRetries - 1);
        } else {
          logger.error(`❌ Failed to refresh token for user ${twitterConnection.userId}`);
          return null;
        }
      }

      if (response.status === 401) {
        logger.error(`🔑 401 Unauthorized - No retries left for user ${twitterConnection.userId}`);
      }

      return response;

    } catch (error) {
      logger.error(`❌ Error making Twitter API request:`, error);
      return null;
    }
  }

  /**
   * Fetch user tweets from Twitter API with automatic token refresh
   */
  private async fetchUserTweets(user: User): Promise<TwitterTweet[]> {
    try {
      logger.info(`📡 Fetching real tweets for user ${user.id} (@${user.twitterHandle})`);

      // Always get the latest Twitter connection (don't cache)
      const twitterConnection = await AppDataSource.getRepository(TwitterUserConnection).findOne({
        where: { userId: user.id, isConnected: true },
        order: { updatedAt: 'DESC' } // Get the most recently updated connection
      });

      if (!twitterConnection || !twitterConnection.accessToken) {
        logger.error(`❌ No valid Twitter access token for user ${user.id}`);
        logger.error(`   Connection exists: ${!!twitterConnection}`);
        logger.error(`   Access token exists: ${!!(twitterConnection?.accessToken)}`);
        logger.error(`   Is connected: ${twitterConnection?.isConnected}`);
        throw new Error('No valid Twitter connection or access token found');
      }

      logger.info(`🔐 Using Twitter connection for user ${user.id}:`);
      logger.info(`   Twitter User ID: ${twitterConnection.twitterUserId}`);
      logger.info(`   Username: @${twitterConnection.twitterUsername}`);
      logger.info(`   Connection ID: ${twitterConnection.id}`);
      logger.info(`   Access Token (last 10): ...${twitterConnection.accessToken.slice(-10)}`);
      logger.info(`   Last updated: ${twitterConnection.updatedAt}`);

      const url = `https://api.twitter.com/2/users/${twitterConnection.twitterUserId}/tweets`;
      const params = new URLSearchParams({
        'max_results': '50',
        'tweet.fields': 'created_at,public_metrics,context_annotations,entities,attachments,author_id,conversation_id',
        'exclude': 'retweets,replies',
        'expansions': 'attachments.media_keys',
        'media.fields': 'type,url,preview_image_url'
      });

      const fullUrl = `${url}?${params.toString()}`;
      logger.info(`🔗 Making Twitter API request: ${fullUrl}`);

      const response = await this.makeTwitterAPIRequest(fullUrl, twitterConnection);

      if (!response || !response.ok) {
        const errorText = await response?.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText || '');
        } catch {
          errorData = { error: errorText || '' };
        }
        
        logger.error(`❌ Twitter API error for user ${user.id} (${response?.status || 'N/A'}):`, errorData);
        
        if (response?.status === 401) {
          logger.error(`🔑 Invalid or expired access token for user ${user.id}`);
          throw new Error('Twitter API unauthorized - access token may be expired or invalid');
        } else if (response?.status === 429) {
          logger.error(`⏰ Rate limit exceeded for user ${user.id}`);
          throw new Error('Twitter API rate limit exceeded - please try again later');
        } else if (response?.status === 403) {
          logger.error(`🚫 Access forbidden for user ${user.id} - account may be private`);
          throw new Error('Twitter API forbidden - account may be private or suspended');
        } else {
          throw new Error(`Twitter API error: ${response?.status || 'Unknown'} - ${errorData.error || 'Unknown error'}`);
        }
      }

      const data = await response.json() as TwitterAPIResponse;
      const tweets = data.data || [];

      if (tweets.length === 0) {
        logger.info(`📭 No tweets found on user ${user.id}'s timeline (@${twitterConnection.twitterUsername})`);
        logger.info(`   This could mean:`);
        logger.info(`   • User has no original tweets (only retweets/replies)`);
        logger.info(`   • Account is private and token lacks permission`);
        logger.info(`   • User has deleted all their tweets`);
        return [];
      }

      // Filter tweets for better learning data
      const filteredTweets = tweets.filter(tweet => {
        if (tweet.text.length < 20) return false;
        const mentionCount = (tweet.entities?.mentions?.length || 0);
        const wordCount = tweet.text.split(/\s+/).length;
        if (mentionCount > wordCount / 3) return false;
        const urlCount = (tweet.entities?.urls?.length || 0);
        if (urlCount > 0 && tweet.text.replace(/https?:\/\/\S+/g, '').trim().length < 20) return false;
        return true;
      });

      logger.info(`✅ Fetched ${tweets.length} tweets, filtered to ${filteredTweets.length} quality tweets for user ${user.id}`);
      
      if (filteredTweets.length === 0) {
        logger.info(`📋 All tweets were filtered out for user ${user.id} - they may not contain substantial original content`);
      }

      return filteredTweets;

    } catch (error) {
      logger.error(`❌ Error fetching real tweets for user ${user.id}:`, error);
      if (error instanceof Error) {
        logger.error(`   Error details: ${error.message}`);
        // Re-throw the error so it can be handled by the calling method
        throw error;
      } else {
        throw new Error('Unknown error occurred while fetching tweets');
      }
    }
  }

  /**
   * Generate comprehensive learning insights for all 5 agent types
   */
  private async generateAgentSpecificInsights(tweets: TwitterTweet[], user: User): Promise<any> {
    logger.info(`🧠 Generating agent-specific insights for ${tweets.length} tweets...`);

    const allText = tweets.map(t => t.text).join(' ');
    const textLengths = tweets.map(t => t.text.length);
    const avgLength = textLengths.reduce((a, b) => a + b, 0) / textLengths.length;

    // Calculate engagement metrics
    const totalLikes = tweets.reduce((sum, t) => sum + (t.public_metrics?.like_count || 0), 0);
    const totalRetweets = tweets.reduce((sum, t) => sum + (t.public_metrics?.retweet_count || 0), 0);
    const totalReplies = tweets.reduce((sum, t) => sum + (t.public_metrics?.reply_count || 0), 0);

    const avgLikes = totalLikes / tweets.length;
    const avgRetweets = totalRetweets / tweets.length;
    const avgReplies = totalReplies / tweets.length;

    // Analyze content patterns with safe optional chaining
    const hashtagUsage = tweets.filter(t => t.entities?.hashtags && t.entities.hashtags.length > 0).length / tweets.length;
    const mentionUsage = tweets.filter(t => t.entities?.mentions && t.entities.mentions.length > 0).length / tweets.length;
    const urlUsage = tweets.filter(t => t.entities?.urls && t.entities.urls.length > 0).length / tweets.length;

    // Extract frequent topics with proper type annotation
    const words = allText.toLowerCase().match(/\b\w+\b/g) || [];
    const wordCount: Record<string, number> = {};
    words.forEach(word => {
      if (word.length > 3) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }
    });
    const topWords = Object.entries(wordCount)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([word]) => word);

    // Identify crypto/tech keywords
    const cryptoKeywords = ['bitcoin', 'eth', 'crypto', 'defi', 'blockchain', 'nft', 'web3', 'token', 'dex', 'yield', 'staking', 'protocol', 'dao', 'metaverse'];
    const techKeywords = ['ai', 'ml', 'python', 'javascript', 'react', 'node', 'api', 'database', 'cloud', 'aws', 'docker'];
    
    const foundCrypto = cryptoKeywords.filter(keyword => allText.toLowerCase().includes(keyword));
    const foundTech = techKeywords.filter(keyword => allText.toLowerCase().includes(keyword));

    // Analyze posting times with proper type annotation
    const postingHours = tweets.map(t => new Date(t.created_at).getHours());
    const hourCounts: Record<number, number> = {};
    postingHours.forEach(hour => {
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    // Generate insights for each agent type
    const agentInsights = {
      dataAnalyst: {
        role: 'Data analysis and trend identification',
        insights: {
          averageEngagement: Math.round((avgLikes + avgRetweets + avgReplies) * 10) / 10,
          bestPerformingLength: this.findBestPerformingLength(tweets),
          optimalPostingTimes: Object.entries(hourCounts)
            .sort(([,a], [,b]) => (b as number) - (a as number))
            .slice(0, 3)
            .map(([hour, count]) => `${hour}:00 (${count} posts)`),
          contentThatEngages: this.analyzeHighEngagementPatterns(tweets),
          recommendedMetrics: [
            'Track engagement rate by post length',
            'Monitor hashtag effectiveness',
            'Analyze optimal posting frequency'
          ]
        },
        trainingData: {
          avgPostLength: Math.round(avgLength),
          engagementPattern: avgLikes > avgRetweets ? 'like-focused' : 'share-focused',
          contentVolume: tweets.length
        }
      },

      contentStrategist: {
        role: 'Content strategy and planning',
        insights: {
          contentThemes: [...foundCrypto, ...foundTech, ...topWords.slice(0, 5)],
          hashtagStrategy: `Use hashtags in ${Math.round(hashtagUsage * 100)}% of posts`,
          mentionStrategy: `Include mentions in ${Math.round(mentionUsage * 100)}% of posts`,
          contentMix: {
            textOnly: tweets.filter(t => !t.entities?.urls?.length && !t.entities?.media?.length).length,
            withLinks: tweets.filter(t => t.entities?.urls && t.entities.urls.length > 0).length,
            withMedia: tweets.filter(t => t.entities?.media && t.entities.media.length > 0).length
          },
          recommendedStrategy: [
            `Focus on ${foundCrypto.length > foundTech.length ? 'crypto/DeFi' : 'tech/development'} topics`,
            `Maintain ${Math.round(avgLength)} character average for optimal engagement`,
            `Post primarily during ${this.getBestPostingHour(hourCounts)}:00 hour`
          ]
        },
        trainingData: {
          topicExpertise: foundCrypto.length > 0 ? 'crypto' : (foundTech.length > 0 ? 'tech' : 'general'),
          contentStyle: hashtagUsage > 0.5 ? 'hashtag-heavy' : 'minimal-hashtags',
          audienceEngagement: avgReplies > avgLikes ? 'conversation-driven' : 'broadcast-style'
        }
      },

      textContent: {
        role: 'Text content creation and writing',
        insights: {
          writingStyle: {
            averageLength: Math.round(avgLength),
            preferredTone: this.analyzeTone(allText),
            punctuationStyle: this.analyzePunctuation(allText),
            emojiUsage: this.analyzeEmojiUsage(tweets)
          },
          vocabularyPatterns: {
            technicalTerms: [...foundCrypto, ...foundTech],
            commonPhrases: this.extractCommonPhrases(tweets),
            questionUsage: tweets.filter(t => t.text.includes('?')).length / tweets.length
          },
          recommendedTemplates: [
            `${Math.round(avgLength)}-character posts with ${this.analyzeTone(allText)} tone`,
            `Include ${Math.round(hashtagUsage * 3)} hashtags per post`,
            `${this.analyzeEmojiUsage(tweets) > 0.3 ? 'Use emojis frequently' : 'Minimal emoji usage'}`
          ]
        },
        trainingData: {
          writingPersonality: this.inferPersonality(allText),
          sentenceStructure: this.analyzeSentenceStructure(allText),
          vocabularyComplexity: this.analyzeVocabularyComplexity(allText)
        }
      },

      visualCreator: {
        role: 'Visual content creation and media',
        insights: {
          mediaUsage: {
            withMedia: tweets.filter(t => t.entities?.media && t.entities.media.length > 0).length,
            withLinks: tweets.filter(t => t.entities?.urls && t.entities.urls.length > 0).length,
            textOnly: tweets.filter(t => !t.entities?.urls?.length && !t.entities?.media?.length).length
          },
          visualStrategy: tweets.filter(t => t.entities?.media && t.entities.media.length > 0).length > 0 
            ? 'Media-enhanced content creator'
            : 'Text-focused with strategic link sharing',
          recommendedVisuals: [
            avgLikes > 10 ? 'Create engaging infographics' : 'Use simple visual elements',
            foundCrypto.length > 0 ? 'Crypto chart visualizations' : 'Tech concept illustrations',
            `Visual content performs ${tweets.filter(t => t.entities?.media && t.entities.media.length > 0).length > 0 ? 'well' : 'needs testing'}`
          ]
        },
        trainingData: {
          mediaPreference: tweets.filter(t => t.entities?.media && t.entities.media.length > 0).length > tweets.length * 0.3 ? 'high-visual' : 'low-visual',
          linkSharingBehavior: urlUsage > 0.5 ? 'frequent-sharer' : 'selective-sharer',
          visualThemes: [...foundCrypto, ...foundTech].slice(0, 5)
        }
      },

      orchestrator: {
        role: 'Content coordination and optimization',
        insights: {
          postingStrategy: {
            frequency: `${tweets.length} posts analyzed`,
            optimalTiming: this.getBestPostingHour(hourCounts) + ':00',
            engagementOptimization: `Focus on ${avgLikes > avgRetweets ? 'likeable' : 'shareable'} content`
          },
          contentCoordination: {
            bestPerformingType: this.findBestContentType(tweets),
            audienceResonance: topWords.slice(0, 5),
            crossPlatformStrategy: 'Optimize for Twitter engagement patterns'
          },
          systemRecommendations: [
            `Deploy content at ${this.getBestPostingHour(hourCounts)}:00 for maximum visibility`,
            `Use ${Math.round(avgLength)}-character format for optimal performance`,
            `Incorporate ${foundCrypto.length > 0 ? 'crypto' : 'tech'} themes for audience alignment`
          ]
        },
        trainingData: {
          coordinationStyle: avgReplies > avgLikes * 0.5 ? 'engagement-focused' : 'reach-focused',
          contentMixRatio: {
            informational: tweets.filter(t => t.text.includes('?') || foundTech.some(k => t.text.toLowerCase().includes(k))).length,
            promotional: tweets.filter(t => t.entities?.urls && t.entities.urls.length > 0).length,
            conversational: tweets.filter(t => t.entities?.mentions && t.entities.mentions.length > 0 || t.text.includes('@')).length
          },
          performanceBaseline: {
            likes: avgLikes,
            retweets: avgRetweets,
            replies: avgReplies
          }
        }
      }
    };

    logger.info(`✅ Generated comprehensive insights for all 5 agent types`);
    return agentInsights;
  }

  /**
   * Helper methods for comprehensive tweet analysis
   */
  private findBestPerformingLength(tweets: TwitterTweet[]): string {
    const engagementByLength: Record<number, { total: number; count: number }> = {};
    tweets.forEach(tweet => {
      const length = Math.floor(tweet.text.length / 50) * 50;
      const engagement = (tweet.public_metrics?.like_count || 0) + 
                       (tweet.public_metrics?.retweet_count || 0) + 
                       (tweet.public_metrics?.reply_count || 0);
      
      if (!engagementByLength[length]) {
        engagementByLength[length] = { total: 0, count: 0 };
      }
      engagementByLength[length].total += engagement;
      engagementByLength[length].count += 1;
    });

    const bestRange = Object.entries(engagementByLength)
      .map(([length, data]: [string, any]) => ({
        length: parseInt(length),
        avgEngagement: data.total / data.count
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement)[0];

    return bestRange ? `${bestRange.length}-${bestRange.length + 50} characters` : '100-150 characters';
  }

  private analyzeHighEngagementPatterns(tweets: TwitterTweet[]): string[] {
    const highEngagement = tweets
      .filter(t => {
        const engagement = (t.public_metrics?.like_count || 0) + 
                         (t.public_metrics?.retweet_count || 0) + 
                         (t.public_metrics?.reply_count || 0);
        return engagement > 5;
      })
      .map(t => t.text);

    const patterns: string[] = [];
    
    if (highEngagement.some(text => text.includes('?'))) {
      patterns.push('Questions generate engagement');
    }
    if (highEngagement.some(text => text.includes('#'))) {
      patterns.push('Hashtags boost visibility');
    }
    if (highEngagement.some(text => text.includes('@'))) {
      patterns.push('Mentions increase interaction');
    }
    
    return patterns.length > 0 ? patterns : ['Focus on clear, valuable content'];
  }

  private analyzeTone(text: string): string {
    const positiveWords = ['great', 'awesome', 'excited', 'love', 'amazing', 'fantastic', 'excellent', 'good'];
    const technicalWords = ['protocol', 'algorithm', 'data', 'analysis', 'system', 'framework', 'implementation'];
    const casualWords = ['lol', 'haha', 'tbh', 'imo', 'btw', 'omg', 'wow'];

    const positiveCount = positiveWords.filter(word => text.toLowerCase().includes(word)).length;
    const technicalCount = technicalWords.filter(word => text.toLowerCase().includes(word)).length;
    const casualCount = casualWords.filter(word => text.toLowerCase().includes(word)).length;

    if (technicalCount > positiveCount && technicalCount > casualCount) return 'technical';
    if (casualCount > positiveCount && casualCount > technicalCount) return 'casual';
    if (positiveCount > 0) return 'positive';
    return 'neutral';
  }

  private analyzePunctuation(text: string): string {
    const exclamationCount = (text.match(/!/g) || []).length;
    const questionCount = (text.match(/\?/g) || []).length;
    const periodCount = (text.match(/\./g) || []).length;

    if (exclamationCount > questionCount && exclamationCount > periodCount) return 'enthusiastic';
    if (questionCount > exclamationCount && questionCount > periodCount) return 'inquisitive';
    return 'standard';
  }

  private analyzeEmojiUsage(tweets: TwitterTweet[]): number {
    const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/gu;
    const emojiCount = tweets.filter(t => emojiRegex.test(t.text)).length;
    return emojiCount / tweets.length;
  }

  private extractCommonPhrases(tweets: TwitterTweet[]): string[] {
    const phrases: string[] = [];
    tweets.forEach(tweet => {
      const words = tweet.text.toLowerCase().split(' ');
      for (let i = 0; i < words.length - 1; i++) {
        const phrase = `${words[i]} ${words[i + 1]}`;
        if (phrase.length > 5 && !phrase.includes('http') && !phrase.includes('@')) {
          phrases.push(phrase);
        }
      }
    });

    const phraseCount: Record<string, number> = {};
    phrases.forEach(phrase => {
      phraseCount[phrase] = (phraseCount[phrase] || 0) + 1;
    });

    return Object.entries(phraseCount)
      .filter(([_, count]) => (count as number) > 1)
      .sort(([_, a], [__, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([phrase]) => phrase);
  }

  private inferPersonality(text: string): string {
    const traits = {
      analytical: ['data', 'analysis', 'think', 'consider', 'research', 'study'].filter(w => text.includes(w)).length,
      creative: ['create', 'design', 'art', 'beautiful', 'inspiration', 'imagine'].filter(w => text.includes(w)).length,
      social: ['community', 'together', 'team', 'everyone', 'we', 'us'].filter(w => text.includes(w)).length,
      technical: ['code', 'dev', 'build', 'system', 'tech', 'protocol'].filter(w => text.includes(w)).length
    };

    const dominantTrait = Object.entries(traits)
      .sort(([_, a], [__, b]) => (b as number) - (a as number))[0];

    return dominantTrait ? dominantTrait[0] : 'general';
  }

  private analyzeSentenceStructure(text: string): string {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgLength = sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length;

    if (avgLength > 50) return 'complex';
    if (avgLength > 25) return 'moderate';
    return 'concise';
  }

  private analyzeVocabularyComplexity(text: string): string {
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const complexWords = words.filter(word => word.length > 6);
    const complexity = complexWords.length / words.length;

    if (complexity > 0.3) return 'advanced';
    if (complexity > 0.15) return 'intermediate';
    return 'accessible';
  }

  private findBestContentType(tweets: TwitterTweet[]): string {
    const types = {
      informational: tweets.filter(t => t.text.includes('?') || t.text.toLowerCase().includes('how')).length,
      promotional: tweets.filter(t => t.entities?.urls && t.entities.urls.length > 0).length,
      conversational: tweets.filter(t => t.entities?.mentions && t.entities.mentions.length > 0).length,
      educational: tweets.filter(t => t.text.toLowerCase().includes('learn') || t.text.toLowerCase().includes('tip')).length
    };

    const dominantType = Object.entries(types)
      .sort(([_, a], [__, b]) => (b as number) - (a as number))[0];

    return dominantType ? dominantType[0] : 'general';
  }

  private getBestPostingHour(hourCounts: Record<number, number>): string {
    const bestHour = Object.entries(hourCounts)
      .sort(([,a], [,b]) => (b as number) - (a as number))[0];
    
    return bestHour ? bestHour[0] : '12';
  }

  private calculateOverallMetrics(tweets: TwitterTweet[]): any {
    const totalLikes = tweets.reduce((sum, t) => sum + (t.public_metrics?.like_count || 0), 0);
    const totalRetweets = tweets.reduce((sum, t) => sum + (t.public_metrics?.retweet_count || 0), 0);
    const totalReplies = tweets.reduce((sum, t) => sum + (t.public_metrics?.reply_count || 0), 0);
    const totalEngagement = totalLikes + totalRetweets + totalReplies;

    const textLengths = tweets.map(t => t.text.length);
    const avgLength = textLengths.reduce((a, b) => a + b, 0) / textLengths.length;

    return {
      avgLikes: Math.round((totalLikes / tweets.length) * 10) / 10,
      avgRetweets: Math.round((totalRetweets / tweets.length) * 10) / 10,
      avgReplies: Math.round((totalReplies / tweets.length) * 10) / 10,
      avgEngagement: Math.round((totalEngagement / tweets.length) * 10) / 10,
      avgLength: Math.round(avgLength),
      totalTweets: tweets.length,
      engagementRate: Math.round((totalEngagement / (tweets.length * 100)) * 10000) / 100
    };
  }

  private calculateConfidenceScore(tweetCount: number, avgEngagement: number): number {
    let confidence = Math.min(tweetCount * 2, 100);
    
    if (avgEngagement > 10) confidence = Math.min(confidence + 10, 100);
    if (avgEngagement > 5) confidence = Math.min(confidence + 5, 100);
    
    return Math.round(confidence);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Public method to manually trigger learning for a specific user
   */
  async learnFromUser(userId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    await this.processUserTwitterData(user);
  }

  /**
   * Get learning insights for a specific user
   */
  async getUserLearningInsights(userId: number): Promise<any> {
    const recentLearningData = await this.twitterLearningRepository.find({
      where: { userId },
      order: { processedAt: 'DESC' },
      take: 50,
    });

    return recentLearningData;
  }

  /**
   * Get agent configurations for a user
   */
  async getUserAgentConfigurations(userId: number): Promise<AgentConfiguration[]> {
    return this.agentConfigRepository.find({
      where: { userId, isActive: true }
    });
  }

  /**
   * Update agent learning progress after Twitter learning is completed
   */
  async updateAgentLearningProgress(userId: number, tweetCount: number): Promise<void> {
    try {
      logger.info(`📈 Updating agent learning progress for user ${userId} with ${tweetCount} tweets processed`);

      // Get all active agents for this user
      const agents = await this.agentConfigRepository.find({
        where: { userId, isActive: true }
      });

      if (agents.length === 0) {
        logger.info(`📭 No active agents found for user ${userId}, skipping progress update`);
        return;
      }

      // Calculate learning progress based on tweet count
      // 2% per tweet, capped at 100%
      const learningProgress = Math.min(tweetCount * 2, 100);

      // Update all agents' learning progress
      for (const agent of agents) {
        if (!agent.performanceMetrics) {
          agent.performanceMetrics = {
            level: 1,
            experience: 0,
            qualityScore: 0,
            alignment: 50,
            learningProgress: 0,
            totalDeployments: 0,
            successRate: 0,
            lastUpdated: new Date(),
            learningAccuracy: 0
          };
        }

        agent.performanceMetrics.learningProgress = learningProgress;
        agent.performanceMetrics.learningAccuracy = this.calculateConfidenceScore(tweetCount, 0);
        agent.performanceMetrics.lastUpdated = new Date();

        await this.agentConfigRepository.save(agent);
        
        logger.info(`✅ Updated learning progress for agent ${agent.id}: ${learningProgress}%`);
      }

      logger.info(`🎉 Successfully updated learning progress for ${agents.length} agents to ${learningProgress}%`);

    } catch (error) {
      logger.error(`❌ Error updating agent learning progress for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Store individual tweet data with enhanced raw data fields
   */
  private async storeIndividualTweetData(tweets: TwitterTweet[], user: User, overallMetrics: any): Promise<void> {
    try {
      logger.info(`💾 Storing individual tweet data for ${tweets.length} tweets with enhanced fields...`);

      const learningDataRepository = AppDataSource.getRepository(TwitterLearningData);
      
      // Array to collect tweets for batch LLM analysis
      const tweetsForBatchAnalysis: {
        learningDataId: number;
        tweetId: string;
        tweetText: string;
        imageUrls: string[];
      }[] = [];

      for (const tweet of tweets) {
        // Extract image URLs from tweet attachments
        const tweetImages: any[] = [];
        let conversationData = null;

        // Check if tweet is part of a thread
        const isThread = tweet.conversation_id !== tweet.id;
        let threadPosition = null;
        let parentTweetId = null;

        if (isThread) {
          parentTweetId = tweet.conversation_id;
          // For now, we can't determine exact thread position without additional API calls
          // We'll set it as null and can enhance this later
          threadPosition = null;
        }

        // Extract actual image URLs and perform AI analysis
        const imageUrls = this.extractImageUrlsFromTweet(tweet);
        let anthropicAnalysis = null;

        if (imageUrls.length > 0) {
          // Store image URLs
          tweetImages.push(...imageUrls.map(url => ({ url, type: 'image' })));
          
          // Perform comprehensive LLM analysis (images + text)
          try {
            logger.info(`🔍 Performing comprehensive LLM analysis for tweet ${tweet.id}`);
            // This will be handled by the Python backend via API call
            // The comprehensive analysis will be stored in anthropic_analysis or openai_analysis columns
          } catch (error) {
            logger.error(`❌ Comprehensive analysis setup failed for tweet ${tweet.id}:`, error);
          }
        } else if (tweet.attachments?.media_keys) {
          // Fallback: Store media keys if no direct URLs found
          tweetImages.push({
            media_keys: tweet.attachments.media_keys,
            note: 'Media keys available but URLs not expanded'
          });
        }

        // Create individual tweet learning record
        const learningData = new TwitterLearningData();
        learningData.userId = user.id;
        learningData.tweetId = tweet.id;
        learningData.tweetText = tweet.text;
        learningData.analysisType = 'individual_tweet';

        // Populate engagement metrics
        learningData.engagementMetrics = {
          likes: tweet.public_metrics?.like_count || 0,
          retweets: tweet.public_metrics?.retweet_count || 0,
          replies: tweet.public_metrics?.reply_count || 0,
          quotes: tweet.public_metrics?.quote_count || 0,
          impressions: tweet.public_metrics?.impression_count || null
        };

        if (tweet.created_at) {
          learningData.postingTime = new Date(tweet.created_at);
        }

        // Populate the new enhanced fields
        learningData.tweet_images = tweetImages.length > 0 ? tweetImages : null;
        learningData.is_thread = isThread;
        if (threadPosition !== null) {
          learningData.thread_position = threadPosition;
        }
        if (parentTweetId) {
          learningData.parent_tweet_id = parentTweetId;
        }
        // Store comprehensive LLM analysis (will be set by Python backend)
        learningData.raw_tweet_data = {
          original_tweet: tweet,
          context_annotations: tweet.context_annotations,
          entities: tweet.entities,
          conversation_id: tweet.conversation_id,
          author_id: tweet.author_id
        };

        // Calculate features for this specific tweet
        const tweetFeatures = this.extractTweetSpecificFeatures(tweet);
        learningData.analyzedFeatures = {
          ...tweetFeatures,
          overall_user_metrics: {
            avg_engagement: overallMetrics.avgEngagement,
            avg_likes: overallMetrics.avgLikes,
            avg_retweets: overallMetrics.avgRetweets
          }
        };

        // Generate insights for this specific tweet
        learningData.learningInsights = {
          tweet_performance: this.analyzeTweetPerformance(tweet, overallMetrics),
          content_analysis: this.analyzeTweetContent(tweet),
          engagement_factors: this.identifyEngagementFactors(tweet, tweetFeatures)
        };

        // Calculate confidence based on engagement
        const tweetEngagement = (tweet.public_metrics?.like_count || 0) + 
                               (tweet.public_metrics?.retweet_count || 0) + 
                               (tweet.public_metrics?.reply_count || 0);
        learningData.confidence = Math.min(Math.max(tweetEngagement * 10, 20), 100);

        // Save the learning data first to get the ID
        const savedLearningData = await learningDataRepository.save(learningData);

        // Collect tweet data for batch processing
        tweetsForBatchAnalysis.push({
          learningDataId: savedLearningData.id,
          tweetId: tweet.id,
          tweetText: tweet.text,
          imageUrls: imageUrls
        });
      }

      logger.info(`✅ Stored ${tweets.length} individual tweet records with enhanced raw data`);
      
      // Trigger batch LLM analysis for all tweets
      if (tweetsForBatchAnalysis.length > 0) {
        logger.info(`🧠 Triggering batch LLM analysis for ${tweetsForBatchAnalysis.length} tweets`);
        this.triggerBatchComprehensiveLLMAnalysis(user.id, tweetsForBatchAnalysis).catch(error => {
          logger.error(`❌ Error triggering batch LLM analysis:`, error);
        });
      }

    } catch (error) {
      logger.error(`❌ Error storing individual tweet data:`, error);
      throw error;
    }
  }

  /**
   * Extract tweet-specific features for analysis
   */
  private extractTweetSpecificFeatures(tweet: TwitterTweet): any {
    const text = tweet.text || '';
    
    return {
      text_length: text.length,
      word_count: text.split(/\s+/).length,
      hashtag_count: (text.match(/#\w+/g) || []).length,
      mention_count: (text.match(/@\w+/g) || []).length,
      url_count: (text.match(/https?:\/\/\S+/g) || []).length,
      has_emojis: /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/u.test(text),
      has_media: !!(tweet.attachments?.media_keys?.length),
      is_conversation_starter: tweet.conversation_id === tweet.id || !tweet.conversation_id,
      posting_hour: tweet.created_at ? new Date(tweet.created_at).getHours() : null,
      posting_day_of_week: tweet.created_at ? new Date(tweet.created_at).getDay() : null,
      entities_present: {
        hashtags: tweet.entities?.hashtags?.length || 0,
        mentions: tweet.entities?.mentions?.length || 0,
        urls: tweet.entities?.urls?.length || 0,
        cashtags: tweet.entities?.cashtags?.length || 0
      }
    };
  }

  /**
   * Analyze individual tweet performance
   */
  private analyzeTweetPerformance(tweet: TwitterTweet, overallMetrics: any): any {
    const tweetLikes = tweet.public_metrics?.like_count || 0;
    const tweetRetweets = tweet.public_metrics?.retweet_count || 0;
    const tweetReplies = tweet.public_metrics?.reply_count || 0;
    const tweetEngagement = tweetLikes + tweetRetweets + tweetReplies;

    const avgEngagement = overallMetrics.avgEngagement || 1;
    const performanceRatio = tweetEngagement / avgEngagement;

    return {
      total_engagement: tweetEngagement,
      performance_vs_average: performanceRatio,
      performance_category: performanceRatio > 1.5 ? 'high' : performanceRatio > 0.8 ? 'average' : 'low',
      like_to_retweet_ratio: tweetRetweets > 0 ? tweetLikes / tweetRetweets : tweetLikes,
      engagement_type: tweetLikes > tweetRetweets ? 'like_focused' : 'share_focused',
      conversation_starter: tweetReplies > (tweetLikes + tweetRetweets) * 0.1
    };
  }

  /**
   * Analyze tweet content characteristics
   */
  private analyzeTweetContent(tweet: TwitterTweet): any {
    const text = tweet.text || '';
    
    // Identify content themes
    const cryptoKeywords = ['crypto', 'bitcoin', 'eth', 'defi', 'nft', 'blockchain', 'web3'];
    const techKeywords = ['ai', 'ml', 'python', 'javascript', 'react', 'api'];
    const emotionalWords = ['excited', 'amazing', 'love', 'hate', 'frustrated', 'happy'];

    const foundCrypto = cryptoKeywords.filter(kw => text.toLowerCase().includes(kw));
    const foundTech = techKeywords.filter(kw => text.toLowerCase().includes(kw));
    const foundEmotional = emotionalWords.filter(kw => text.toLowerCase().includes(kw));

    return {
      content_themes: {
        crypto_related: foundCrypto.length > 0,
        tech_related: foundTech.length > 0,
        emotional_tone: foundEmotional.length > 0
      },
      content_structure: {
        has_question: text.includes('?'),
        has_exclamation: text.includes('!'),
        is_statement: !text.includes('?') && !text.includes('!'),
        sentence_count: text.split(/[.!?]+/).filter(s => s.trim().length > 0).length
      },
      writing_style: {
        formal_tone: /\b(however|therefore|furthermore|nevertheless)\b/i.test(text),
        casual_tone: /\b(lol|haha|tbh|imo|btw)\b/i.test(text),
        professional_language: foundTech.length > foundEmotional.length
      }
    };
  }

  /**
   * Identify factors that contributed to engagement
   */
  private identifyEngagementFactors(tweet: TwitterTweet, features: any): any {
    const engagement = (tweet.public_metrics?.like_count || 0) + 
                     (tweet.public_metrics?.retweet_count || 0) + 
                     (tweet.public_metrics?.reply_count || 0);

    const factors = [];

    // Analyze what might have driven engagement
    if (features.hashtag_count > 0 && engagement > 5) {
      factors.push('hashtags_effective');
    }
    
    if (features.has_media && engagement > 3) {
      factors.push('media_boost');
    }
    
    if (features.text_length > 100 && features.text_length < 200 && engagement > 5) {
      factors.push('optimal_length');
    }
    
    if (tweet.text.includes('?') && (tweet.public_metrics?.reply_count || 0) > 2) {
      factors.push('question_engagement');
    }

    if (features.mention_count > 0 && engagement > 2) {
      factors.push('mention_network_effect');
    }

    return {
      identified_factors: factors,
      engagement_score: engagement,
      likely_drivers: factors.length > 0 ? factors : ['organic_content_quality'],
      optimization_suggestions: this.generateOptimizationSuggestions(features, engagement)
    };
  }

  /**
   * Generate optimization suggestions based on tweet analysis
   */
  private generateOptimizationSuggestions(features: any, engagement: number): string[] {
    const suggestions = [];

    if (features.hashtag_count === 0 && engagement < 3) {
      suggestions.push('Consider adding relevant hashtags for visibility');
    }

    if (features.text_length < 50) {
      suggestions.push('Try longer, more detailed content');
    }

    if (features.text_length > 250) {
      suggestions.push('Consider breaking long content into threads');
    }

    if (!features.has_media && engagement < 5) {
      suggestions.push('Adding images or media could boost engagement');
    }

    if (features.mention_count === 0) {
      suggestions.push('Engaging with other users through mentions could increase reach');
    }

    return suggestions.length > 0 ? suggestions : ['Content performed well - maintain this style'];
  }

  /**
   * Analyze tweet images using Anthropic with OpenAI fallback
   */
  private async analyzeCreatorTweetImages(imageUrls: string[], tweetText: string, userId: number): Promise<string | null> {
    try {
      if (!imageUrls || imageUrls.length === 0) {
        return null;
      }

      logger.info(`🎯 Analyzing ${imageUrls.length} images for creator/miner ${userId} with Anthropic/OpenAI`);

      // Call Python backend for image analysis
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

      try {
        const response = await fetch(`${process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000'}/api/analyze-creator-images`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_urls: imageUrls,
            tweet_text: tweetText,
            user_id: userId,
            analysis_type: 'creator_content_analysis'
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`❌ Python backend image analysis failed: ${response.status} - ${errorText}`);
          return `Analysis failed: ${response.status} - ${errorText}`;
        }

        const result = await response.json() as any;

        if (result.success && result.analysis) {
          logger.info(`✅ Successfully analyzed images for creator ${userId}`);
          return result.analysis;
        } else {
          logger.warn(`⚠️ Image analysis returned without success for creator ${userId}: ${result.error || 'Unknown error'}`);
          return `Analysis incomplete: ${result.error || 'Unknown error'}`;
        }
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }

    } catch (error) {
      logger.error(`❌ Error analyzing creator images for user ${userId}:`, error);
      return `Analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Extract actual image URLs from Twitter API response data
   */
  private extractImageUrlsFromTweet(tweet: TwitterTweet, mediaData?: any[]): string[] {
    const imageUrls: string[] = [];

    try {
      // If we have media expansion data, use it
      if (mediaData && tweet.attachments?.media_keys) {
        for (const mediaKey of tweet.attachments.media_keys) {
          const media = mediaData.find((m: any) => m.media_key === mediaKey);
          if (media && (media.type === 'photo' || media.type === 'video')) {
            if (media.url) {
              imageUrls.push(media.url);
            } else if (media.preview_image_url) {
              imageUrls.push(media.preview_image_url);
            }
          }
        }
      }

      // Fallback: Extract URLs from entities if available
      if (imageUrls.length === 0 && tweet.entities?.urls) {
        for (const urlEntity of tweet.entities.urls) {
          if (urlEntity.expanded_url && (
            urlEntity.expanded_url.includes('pic.twitter.com') ||
            urlEntity.expanded_url.includes('pbs.twimg.com') ||
            urlEntity.expanded_url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
          )) {
            imageUrls.push(urlEntity.expanded_url);
          }
        }
      }

    } catch (error) {
      logger.error(`❌ Error extracting image URLs from tweet ${tweet.id}:`, error);
    }

    return imageUrls;
  }

  /**
   * Trigger batch comprehensive LLM analysis for multiple tweets (async background process)
   */
  private async triggerBatchComprehensiveLLMAnalysis(
    userId: number,
    tweetsData: {
      learningDataId: number;
      tweetId: string;
      tweetText: string;
      imageUrls: string[];
    }[]
  ): Promise<void> {
    try {
      logger.info(`🧠 Triggering batch comprehensive LLM analysis for ${tweetsData.length} tweets`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout for batch

      try {
        const response = await fetch(`${process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000'}/api/comprehensive-creator-batch-analysis`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: userId,
            tweets_data: tweetsData.map(tweet => ({
              tweet_id: tweet.tweetId,
              tweet_text: tweet.tweetText,
              image_urls: tweet.imageUrls,
              learning_data_id: tweet.learningDataId
            })),
            analysis_type: 'creator'
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const result = await response.json() as any;
          if (result.success) {
            logger.info(`✅ Batch comprehensive LLM analysis triggered for ${tweetsData.length} tweets`);
          } else {
            logger.warn(`⚠️ Batch LLM analysis trigger failed: ${result.error}`);
          }
        } else {
          logger.error(`❌ Batch LLM analysis endpoint failed: ${response.status} - ${response.statusText}`);
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } catch (error) {
      logger.error(`❌ Error triggering batch LLM analysis:`, error);
      // Don't re-throw - this is a background process
    }
  }

  /**
   * Trigger comprehensive LLM analysis for a tweet (async background process)
   */
  private async triggerComprehensiveLLMAnalysis(
    userId: number, 
    tweetId: string, 
    tweetText: string, 
    imageUrls: string[], 
    learningDataId: number
  ): Promise<void> {
    try {
      logger.info(`🧠 Triggering comprehensive LLM analysis for tweet ${tweetId}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

      try {
        const response = await fetch(`${process.env.PYTHON_AI_BACKEND_URL || 'http://localhost:8000'}/api/comprehensive-creator-analysis`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: userId,
            tweet_id: tweetId,
            tweet_text: tweetText,
            image_urls: imageUrls,
            learning_data_id: learningDataId,
            analysis_type: 'creator'
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const result = await response.json() as any;
          if (result.success) {
            logger.info(`✅ Comprehensive LLM analysis triggered for tweet ${tweetId}`);
          } else {
            logger.warn(`⚠️ LLM analysis trigger failed for tweet ${tweetId}: ${result.error}`);
          }
        } else {
          logger.error(`❌ LLM analysis endpoint failed: ${response.status} - ${response.statusText}`);
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } catch (error) {
      logger.error(`❌ Error triggering LLM analysis for tweet ${tweetId}:`, error);
      // Don't re-throw - this is a background process
    }
  }
} 