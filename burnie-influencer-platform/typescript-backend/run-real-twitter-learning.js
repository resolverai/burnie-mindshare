#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Since we can't easily import TypeORM entities in plain JS, let's use the backend server directly
async function runRealTwitterLearning() {
  try {
    console.log('🧠 Starting REAL Twitter Learning Process...\n');
    
    // First, let's check what user we have with Twitter connection
    const checkUserQuery = `
      SELECT u.id, u."walletAddress", t."twitterUsername", t."twitterDisplayName", 
             t."twitterUserId", t."accessToken" IS NOT NULL as has_token
      FROM users u 
      JOIN twitter_user_connections t ON u.id = t."userId" 
      WHERE t."isConnected" = true AND t."accessToken" IS NOT NULL;
    `;
    
    console.log('📊 Checking for users with Twitter connections...');
    
    // Use psql to check the database
    const checkCommand = `psql postgres://postgres@localhost:5434/roastpower -c "${checkUserQuery}"`;
    
    const { stdout: userResult, stderr: userError } = await execPromise(checkCommand);
    
    if (userError) {
      console.error('❌ Database error:', userError);
      return;
    }
    
    console.log('Database result:');
    console.log(userResult);
    
    // Parse the result to extract user info
    const lines = userResult.split('\n').filter(line => line.trim());
    const dataLines = lines.filter(line => line.includes('|') && !line.includes('---') && !line.includes('('));
    
    if (dataLines.length === 0) {
      console.log('❌ No users with connected Twitter accounts and valid access tokens found');
      return;
    }
    
    // Now let's try to fetch real tweets using the Twitter API
    console.log('\n🐦 Attempting to fetch real tweets...');
    
    // Let's try to make a direct API call to test
    await testTwitterAPI();
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function testTwitterAPI() {
  try {
    // Get the access token from database
    const getTokenQuery = `
      SELECT t."accessToken", t."twitterUserId", t."twitterUsername"
      FROM twitter_user_connections t 
      WHERE t."isConnected" = true AND t."accessToken" IS NOT NULL
      LIMIT 1;
    `;
    
    const tokenCommand = `psql postgres://postgres@localhost:5434/roastpower -t -c "${getTokenQuery}"`;
    const { stdout: tokenResult } = await execPromise(tokenCommand);
    
    if (!tokenResult.trim()) {
      console.log('❌ No access token found');
      return;
    }
    
    // Parse the token result
    const tokenParts = tokenResult.trim().split('|').map(part => part.trim());
    const accessToken = tokenParts[0];
    const twitterUserId = tokenParts[1];
    const twitterUsername = tokenParts[2];
    
    console.log(`🔑 Found access token for @${twitterUsername} (ID: ${twitterUserId})`);
    console.log(`📱 Making Twitter API call...`);
    
    // Make the actual Twitter API call
    const twitterUrl = `https://api.twitter.com/2/users/${twitterUserId}/tweets`;
    const params = new URLSearchParams({
      'max_results': '50',
      'tweet.fields': 'created_at,public_metrics,context_annotations,entities,attachments',
      'exclude': 'retweets,replies'
    });
    
    const fetch = require('node-fetch');
    
    const response = await fetch(`${twitterUrl}?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BurnieAI/1.0'
      }
    });
    
    console.log(`📊 Twitter API Response Status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Twitter API Error:', errorText);
      
      if (response.status === 401) {
        console.log('🔑 This likely means the access token is invalid or expired');
        console.log('   User may need to reconnect their Twitter account');
      } else if (response.status === 403) {
        console.log('🚫 Access forbidden - account may be private or app lacks permissions');
      } else if (response.status === 429) {
        console.log('⏰ Rate limit exceeded - try again later');
      }
      
      return;
    }
    
    const data = await response.json();
    const tweets = data.data || [];
    
    console.log(`\n✅ Successfully fetched ${tweets.length} tweets!`);
    
    if (tweets.length === 0) {
      console.log('📭 No tweets found on user\'s timeline');
      console.log('   This could mean:');
      console.log('   • User has no original tweets (only retweets/replies)');
      console.log('   • Account is private and token lacks permission');
      console.log('   • User has deleted all their tweets');
    } else {
      console.log('\n📝 Sample tweets found:');
      tweets.slice(0, 3).forEach((tweet, index) => {
        console.log(`\n${index + 1}. Tweet ID: ${tweet.id}`);
        console.log(`   Text: ${tweet.text.substring(0, 100)}${tweet.text.length > 100 ? '...' : ''}`);
        console.log(`   Created: ${tweet.created_at}`);
        console.log(`   Likes: ${tweet.public_metrics?.like_count || 0}`);
        console.log(`   Retweets: ${tweet.public_metrics?.retweet_count || 0}`);
      });
      
      // Now let's analyze the real tweets
      const analysis = analyzeRealTweets(tweets, twitterUsername);
      
      // Save results
      const outputPath = path.join(__dirname, 'real-twitter-learning-results.json');
      const fullResults = {
        timestamp: new Date().toISOString(),
        user: {
          twitterUsername: twitterUsername,
          twitterUserId: twitterUserId
        },
        tweetsAnalyzed: tweets.length,
        tweets: tweets,
        analysis: analysis
      };
      
      fs.writeFileSync(outputPath, JSON.stringify(fullResults, null, 2));
      
      console.log(`\n📁 Full results saved to: ${outputPath}`);
      console.log('\n🎯 REAL TWITTER ANALYSIS SUMMARY:');
      console.log('===================================');
      console.log(analysis.summary);
    }
    
  } catch (error) {
    console.error('❌ Twitter API Error:', error.message);
  }
}

function analyzeRealTweets(tweets, username) {
  console.log(`\n🧠 Analyzing ${tweets.length} real tweets from @${username}...`);
  
  // Analyze writing style
  const textLengths = tweets.map(t => t.text.length);
  const avgLength = textLengths.reduce((a, b) => a + b, 0) / textLengths.length;
  
  // Analyze hashtag usage
  const hashtagUsage = tweets.filter(t => t.entities?.hashtags?.length > 0).length;
  const hashtagRate = hashtagUsage / tweets.length;
  
  // Analyze emoji usage
  const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/gu;
  const emojiUsage = tweets.filter(t => emojiRegex.test(t.text)).length;
  const emojiRate = emojiUsage / tweets.length;
  
  // Analyze engagement
  const totalLikes = tweets.reduce((sum, t) => sum + (t.public_metrics?.like_count || 0), 0);
  const totalRetweets = tweets.reduce((sum, t) => sum + (t.public_metrics?.retweet_count || 0), 0);
  const totalReplies = tweets.reduce((sum, t) => sum + (t.public_metrics?.reply_count || 0), 0);
  
  const avgLikes = totalLikes / tweets.length;
  const avgRetweets = totalRetweets / tweets.length;
  const avgReplies = totalReplies / tweets.length;
  
  // Extract topics/keywords
  const allText = tweets.map(t => t.text.toLowerCase()).join(' ');
  const cryptoKeywords = ['bitcoin', 'eth', 'crypto', 'defi', 'blockchain', 'nft', 'web3', 'token', 'dex', 'yield', 'staking', 'protocol'];
  const foundKeywords = cryptoKeywords.filter(keyword => allText.includes(keyword));
  
  // Analyze posting times
  const postingHours = tweets.map(t => new Date(t.created_at).getHours());
  const hourCounts = {};
  postingHours.forEach(hour => {
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });
  
  const mostActiveHour = Object.entries(hourCounts)
    .sort(([,a], [,b]) => b - a)[0];
  
  return {
    writingStyle: {
      averageLength: Math.round(avgLength),
      hashtagUsageRate: Math.round(hashtagRate * 100),
      emojiUsageRate: Math.round(emojiRate * 100),
      totalTweets: tweets.length
    },
    engagement: {
      averageLikes: Math.round(avgLikes * 10) / 10,
      averageRetweets: Math.round(avgRetweets * 10) / 10,
      averageReplies: Math.round(avgReplies * 10) / 10,
      totalEngagement: totalLikes + totalRetweets + totalReplies
    },
    contentThemes: {
      cryptoKeywordsFound: foundKeywords,
      keywordCount: foundKeywords.length
    },
    postingPatterns: {
      mostActiveHour: mostActiveHour ? `${mostActiveHour[0]}:00 (${mostActiveHour[1]} tweets)` : 'N/A',
      hourlyDistribution: hourCounts
    },
    summary: `
🎯 REAL DATA ANALYSIS for @${username}:

📝 Writing Style:
   • Average tweet length: ${Math.round(avgLength)} characters
   • Uses hashtags in ${Math.round(hashtagRate * 100)}% of tweets
   • Uses emojis in ${Math.round(emojiRate * 100)}% of tweets

📊 Engagement:
   • Average likes: ${Math.round(avgLikes * 10) / 10}
   • Average retweets: ${Math.round(avgRetweets * 10) / 10}
   • Average replies: ${Math.round(avgReplies * 10) / 10}

🎯 Content Focus:
   • Crypto keywords found: ${foundKeywords.join(', ') || 'None detected'}
   • Most active posting hour: ${mostActiveHour ? mostActiveHour[0] + ':00' : 'Varies'}

🤖 AI Agent Training Insights:
   This real data will train your agents to:
   • Write tweets averaging ${Math.round(avgLength)} characters
   • Use ${Math.round(hashtagRate * 100)}% hashtag frequency
   • Focus on topics: ${foundKeywords.length > 0 ? foundKeywords.join(', ') : 'General content'}
   • Post during optimal hours: ${mostActiveHour ? mostActiveHour[0] + ':00' : 'Flexible timing'}
    `
  };
}

function execPromise(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Install node-fetch if not available and run
const checkFetch = async () => {
  try {
    require('node-fetch');
  } catch (error) {
    console.log('📦 Installing node-fetch...');
    await execPromise('npm install node-fetch@2');
  }
};

checkFetch().then(() => {
  runRealTwitterLearning();
}).catch(console.error); 