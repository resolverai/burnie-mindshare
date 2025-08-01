#!/usr/bin/env ts-node

import { AppDataSource } from './src/config/database';
import { TwitterLearningService } from './src/services/TwitterLearningService';
import { User } from './src/models/User';
import { TwitterLearningData } from './src/models/TwitterLearningData';
import { TwitterUserConnection } from './src/models/TwitterUserConnection';
import { logger } from './src/config/logger';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface UserResult {
  userId: number;
  walletAddress: string;
  twitterUsername?: string;
  twitterDisplayName?: string;
  processingStarted: string;
  processingCompleted?: string;
  tweets: {
    fetched: number;
    analyzed: number;
    newlyStored: number;
  };
  insights: any;
  errors: string[];
}

interface LearningResults {
  timestamp: string;
  totalUsers: number;
  users: UserResult[];
}

async function runTwitterLearning() {
  try {
    console.log('🧠 Starting REAL Twitter Learning Process...\n');

    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database connected');
    }

    // Get repositories
    const userRepository = AppDataSource.getRepository(User);
    const twitterRepository = AppDataSource.getRepository(TwitterUserConnection);
    const learningRepository = AppDataSource.getRepository(TwitterLearningData);

    // Find users with connected Twitter accounts - using proper query
    const usersWithTwitter = await userRepository
      .createQueryBuilder('user')
      .innerJoin(TwitterUserConnection, 'twitter', 'twitter.userId = user.id')
      .where('twitter.isConnected = :connected', { connected: true })
      .andWhere('twitter.accessToken IS NOT NULL')
      .getMany();

    if (usersWithTwitter.length === 0) {
      console.log('❌ No users with connected Twitter accounts and valid access tokens found');
      console.log('   Make sure users have:');
      console.log('   • Connected their Twitter account');
      console.log('   • Valid access tokens in the database');
      return;
    }

    console.log(`📊 Found ${usersWithTwitter.length} users with Twitter connections:`);
    for (const user of usersWithTwitter) {
      const twitterConn = await twitterRepository.findOne({
        where: { userId: user.id, isConnected: true }
      });
      console.log(`   - ${user.walletAddress} (@${twitterConn?.twitterUsername})`);
    }

    // Initialize the learning service
    const learningService = new TwitterLearningService();

    // Results storage
    const learningResults: LearningResults = {
      timestamp: new Date().toISOString(),
      totalUsers: usersWithTwitter.length,
      users: []
    };

    // Process each user individually to get real Twitter data
    for (const user of usersWithTwitter) {
      console.log(`\n🔄 Processing REAL Twitter data for user ${user.id}...`);
      
      const twitterConn = await twitterRepository.findOne({
        where: { userId: user.id, isConnected: true }
      });

      const userResult: UserResult = {
        userId: user.id,
        walletAddress: user.walletAddress,
        twitterUsername: twitterConn?.twitterUsername,
        twitterDisplayName: twitterConn?.twitterDisplayName,
        processingStarted: new Date().toISOString(),
        tweets: {
          fetched: 0,
          analyzed: 0,
          newlyStored: 0
        },
        insights: {},
        errors: []
      };

      try {
        // Call the real learning service method for this specific user
        await learningService.processUserTwitterData(user);
        
        // Get the learning data that was just processed
        const learningData = await learningRepository.find({
          where: { userId: user.id },
          order: { processedAt: 'DESC' },
          take: 50 // Get all recent analyzed tweets
        });

        userResult.tweets.analyzed = learningData.length;
        
        // Extract insights summary if we have data
        if (learningData.length > 0) {
          const recentInsights = learningData.slice(0, 10).map(data => ({
            tweetId: data.tweetId,
            tweetText: data.tweetText?.substring(0, 100) + (data.tweetText && data.tweetText.length > 100 ? '...' : ''),
            postingTime: data.postingTime,
            engagementMetrics: data.engagementMetrics,
            analyzedFeatures: data.analyzedFeatures,
            learningInsights: data.learningInsights,
            processedAt: data.processedAt
          }));

          userResult.insights = {
            totalTweetsAnalyzed: learningData.length,
            recentAnalysis: recentInsights,
            summary: generateInsightsSummary(learningData)
          };

          console.log(`   ✅ Successfully processed ${userResult.tweets.analyzed} real tweets`);
        } else {
          console.log(`   📭 No tweets found or all tweets were filtered out`);
          userResult.insights = {
            totalTweetsAnalyzed: 0,
            recentAnalysis: [],
            summary: {
              message: "No substantial tweets found on user's timeline",
              details: "User may have no original tweets, account may be private, or all tweets were too short/spam-like"
            }
          };
        }

      } catch (error: any) {
        console.error(`   ❌ Error processing user ${user.id}:`, error.message);
        userResult.errors.push(error.message);
        userResult.insights = {
          error: error.message,
          totalTweetsAnalyzed: 0
        };
      }

      userResult.processingCompleted = new Date().toISOString();
      learningResults.users.push(userResult);
    }

    // Save results to file
    const outputPath = join(__dirname, 'twitter-learning-results.json');
    writeFileSync(outputPath, JSON.stringify(learningResults, null, 2));
    
    console.log(`\n📁 Results saved to: ${outputPath}`);
    console.log('\n🎯 Summary:');
    console.log(`   Users processed: ${learningResults.users.length}`);
    
    for (const userResult of learningResults.users) {
      if (userResult.insights.totalTweetsAnalyzed > 0) {
        console.log(`   @${userResult.twitterUsername}: ${userResult.insights.totalTweetsAnalyzed} real tweets analyzed`);
      } else {
        console.log(`   @${userResult.twitterUsername}: No substantial tweets found`);
      }
      
      if (userResult.errors.length > 0) {
        console.log(`     Errors: ${userResult.errors.join(', ')}`);
      }
    }

    console.log('\n✅ REAL Twitter learning process completed!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

function generateInsightsSummary(learningData: TwitterLearningData[]): any {
  if (learningData.length === 0) return {};

  const features = learningData.map(d => d.analyzedFeatures).filter(Boolean);
  const insights = learningData.map(d => d.learningInsights).filter(Boolean);
  
  if (features.length === 0) {
    return {
      message: "No feature data available for analysis",
      totalTweets: learningData.length
    };
  }

  // Extract real insights from actual tweet data
  const textLengths = features.map(f => f.textLength || 0).filter(l => l > 0);
  const wordCounts = features.map(f => f.wordCount || 0).filter(w => w > 0);
  const hashtagUsage = features.filter(f => (f.hashtagCount || 0) > 0).length;
  const emojiUsage = features.filter(f => f.hasEmojis).length;
  const mediaUsage = features.filter(f => f.hasMedia).length;
  
  // Extract crypto keywords
  const allKeywords = features.flatMap(f => f.cryptoKeywords || []);
  const keywordCounts = allKeywords.reduce((acc: Record<string, number>, keyword) => {
    acc[keyword] = (acc[keyword] || 0) + 1;
    return acc;
  }, {});
  
  const topKeywords = Object.entries(keywordCounts)
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .slice(0, 10)
    .map(([keyword]) => keyword);

  // Analyze posting times
  const postingHours = features.map(f => f.postingHour).filter(h => h !== undefined);
  const postingDays = features.map(f => f.dayOfWeek).filter(d => d !== undefined);
  
  // Calculate engagement patterns
  const engagementMetrics = learningData.map(d => d.engagementMetrics).filter(Boolean);
  const avgLikes = engagementMetrics.length > 0 ? 
    engagementMetrics.reduce((sum, m) => sum + (m.like_count || 0), 0) / engagementMetrics.length : 0;
  const avgRetweets = engagementMetrics.length > 0 ? 
    engagementMetrics.reduce((sum, m) => sum + (m.retweet_count || 0), 0) / engagementMetrics.length : 0;
  const avgReplies = engagementMetrics.length > 0 ? 
    engagementMetrics.reduce((sum, m) => sum + (m.reply_count || 0), 0) / engagementMetrics.length : 0;

  return {
    // Writing Style Analysis
    averageTextLength: textLengths.length > 0 ? textLengths.reduce((a, b) => a + b, 0) / textLengths.length : 0,
    averageWordCount: wordCounts.length > 0 ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length : 0,
    hashtagUsageRate: features.length > 0 ? hashtagUsage / features.length : 0,
    emojiUsageRate: features.length > 0 ? emojiUsage / features.length : 0,
    mediaUsageRate: features.length > 0 ? mediaUsage / features.length : 0,
    
    // Content Themes
    commonCryptoKeywords: topKeywords,
    
    // Posting Patterns
    postingTimePatterns: {
      mostActiveHours: getMostFrequent(postingHours),
      mostActiveDays: getMostFrequent(postingDays),
      totalPosts: features.length
    },
    
    // Engagement Patterns
    engagementPatterns: {
      averageLikes: Math.round(avgLikes * 100) / 100,
      averageRetweets: Math.round(avgRetweets * 100) / 100,
      averageReplies: Math.round(avgReplies * 100) / 100,
      totalTweetsWithMetrics: engagementMetrics.length
    },
    
    // Content Types
    contentTypes: insights.length > 0 ? getMostFrequent(insights.map(i => i.contentType).filter(Boolean)) : {},
    
    // Tone Analysis
    toneAnalysis: insights.length > 0 ? getMostFrequent(insights.map(i => i.toneAnalysis).filter(Boolean)) : {},
    
    // Meta information
    dataQuality: {
      totalTweets: learningData.length,
      tweetsWithFeatures: features.length,
      tweetsWithInsights: insights.length,
      tweetsWithEngagement: engagementMetrics.length
    }
  };
}

function getMostFrequent(arr: any[]): Record<string, number> {
  if (arr.length === 0) return {};
  
  const counts = arr.reduce((acc: Record<string, number>, item) => {
    if (item !== undefined && item !== null) {
      acc[item] = (acc[item] || 0) + 1;
    }
    return acc;
  }, {});
  
  return Object.entries(counts)
    .sort(([,a], [,b]) => (b as number) - (a as number))
    .reduce((acc: Record<string, number>, [key, value]) => {
      acc[key] = value as number;
      return acc;
    }, {});
}

// Run the script
if (require.main === module) {
  runTwitterLearning();
} 