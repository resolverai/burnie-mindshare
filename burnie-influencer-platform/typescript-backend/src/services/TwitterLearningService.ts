import { Repository, Not, IsNull } from 'typeorm';
import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import { TwitterLearningData } from '../models/TwitterLearningData';
import { TwitterUserConnection } from '../models/TwitterUserConnection';
import { AgentConfiguration, AgentType } from '../models/AgentConfiguration';
import { logger } from '../config/logger';

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
          await this.processUserTwitterData(user);
          
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
   * Process individual user's Twitter data
   */
  public async processUserTwitterData(user: User): Promise<void> {
    try {
      logger.info(`🧠 Starting comprehensive Twitter learning for user ${user.id}...`);

      // Fetch user tweets
      const tweets = await this.fetchUserTweets(user);
      
      if (tweets.length === 0) {
        logger.info(`📭 No tweets to process for user ${user.id}`);
        return;
      }

      logger.info(`📊 Processing ${tweets.length} tweets for comprehensive AI training...`);

      // Generate comprehensive insights for all 5 agent types
      const agentInsights = await this.generateAgentSpecificInsights(tweets, user);
      
      // Calculate overall learning metrics
      const overallMetrics = this.calculateOverallMetrics(tweets);

      // Save detailed learning data for each agent type
      const learningDataRepository = AppDataSource.getRepository(TwitterLearningData);
      
      // Create comprehensive learning records for each agent type
      for (const [agentType, insights] of Object.entries(agentInsights)) {
        const learningData = new TwitterLearningData();
        learningData.userId = user.id;
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

    } catch (error) {
      logger.error(`❌ Error processing Twitter data for user ${user.id}:`, error);
      throw error;
    }
  }

  /**
   * Fetch tweets from a user's timeline using Twitter API v2
   */
  private async fetchUserTweets(user: User): Promise<TwitterTweet[]> {
    try {
      logger.info(`📡 Fetching real tweets for user ${user.id} (@${user.twitterHandle})`);

      const twitterConnection = await AppDataSource.getRepository(TwitterUserConnection).findOne({
        where: { userId: user.id, isConnected: true }
      });

      if (!twitterConnection || !twitterConnection.accessToken) {
        logger.error(`❌ No valid Twitter access token for user ${user.id}`);
        return [];
      }

      const url = `https://api.twitter.com/2/users/${twitterConnection.twitterUserId}/tweets`;
      const params = new URLSearchParams({
        'max_results': '50',
        'tweet.fields': 'created_at,public_metrics,context_annotations,entities,attachments,author_id,conversation_id',
        'exclude': 'retweets,replies',
        'expansions': 'attachments.media_keys',
        'media.fields': 'type,url,preview_image_url'
      });

      logger.info(`🔗 Making Twitter API request: ${url}?${params.toString()}`);

      const response = await fetch(`${url}?${params}`, {
        headers: {
          'Authorization': `Bearer ${twitterConnection.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'BurnieAI/1.0'
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText };
        }
        
        logger.error(`❌ Twitter API error for user ${user.id} (${response.status}):`, errorData);
        
        if (response.status === 401) {
          logger.error(`🔑 Invalid or expired access token for user ${user.id}`);
        } else if (response.status === 429) {
          logger.error(`⏰ Rate limit exceeded for user ${user.id}`);
        } else if (response.status === 403) {
          logger.error(`🚫 Access forbidden for user ${user.id} - account may be private`);
        }
        
        return [];
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
      }
      return [];
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
} 