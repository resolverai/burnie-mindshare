#!/usr/bin/env node

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

async function fetchRealTweets() {
  try {
    console.log('🧠 Fetching REAL tweets from @taran210487...\n');
    
    // Your actual data from the database
    const accessToken = 'N3pNbThPczJUR1B2ZXFHZWV3V0JzbEo0Tldzb1NCY2REdUwzOWU4akxTYWZoOjE3NTM5NjIzNDIxNzk6MToxOmF0OjE';
    const twitterUserId = '1882102529556701184';
    const twitterUsername = 'taran210487';
    
    console.log(`🔑 Using access token for @${twitterUsername} (ID: ${twitterUserId})`);
    
    // Twitter API v2 endpoint
    const url = `https://api.twitter.com/2/users/${twitterUserId}/tweets`;
    const params = new URLSearchParams({
      'max_results': '50', // Last 50 tweets
      'tweet.fields': 'created_at,public_metrics,context_annotations,entities,attachments',
      'exclude': 'retweets,replies' // Only original content
    });
    
    console.log(`📡 Making Twitter API request to: ${url}`);
    console.log(`📋 Parameters: ${params.toString()}\n`);
    
    const response = await fetch(`${url}?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BurnieAI/1.0'
      }
    });
    
    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('\n❌ Twitter API Error Response:');
      console.error(errorText);
      
      if (response.status === 401) {
        console.log('\n💡 This means:');
        console.log('   🔑 Access token is invalid or expired');
        console.log('   🔄 User needs to reconnect their Twitter account');
        console.log('   📱 OAuth flow needs to be completed again');
      } else if (response.status === 403) {
        console.log('\n💡 This means:');
        console.log('   🚫 Access forbidden');
        console.log('   🔒 Account may be private');
        console.log('   📜 App may lack required permissions');
      } else if (response.status === 429) {
        console.log('\n💡 This means:');
        console.log('   ⏰ Rate limit exceeded');
        console.log('   ⏳ Need to wait before making more requests');
      }
      
      return;
    }
    
    const data = await response.json();
    const tweets = data.data || [];
    
    console.log(`\n✅ SUCCESS! Fetched ${tweets.length} real tweets from @${twitterUsername}\n`);
    
    if (tweets.length === 0) {
      console.log('📭 No tweets found on timeline');
      console.log('   Possible reasons:');
      console.log('   • User has no original tweets (only retweets/replies)');
      console.log('   • Account is new or tweets were deleted');
      console.log('   • API permissions are limited');
    } else {
      console.log('📝 REAL TWEETS PREVIEW:');
      console.log('======================\n');
      
      tweets.slice(0, 5).forEach((tweet, index) => {
        console.log(`${index + 1}. ${tweet.id} (${tweet.created_at})`);
        console.log(`   "${tweet.text}"`);
        console.log(`   👍 ${tweet.public_metrics?.like_count || 0} likes | 🔄 ${tweet.public_metrics?.retweet_count || 0} retweets | 💬 ${tweet.public_metrics?.reply_count || 0} replies`);
        
        if (tweet.entities?.hashtags?.length > 0) {
          console.log(`   #️⃣ Hashtags: ${tweet.entities.hashtags.map(h => '#' + h.tag).join(', ')}`);
        }
        console.log('');
      });
      
      // Analyze the real data
      const analysis = analyzeRealTweets(tweets, twitterUsername);
      
      // Save full results
      const outputPath = path.join(__dirname, 'real-twitter-analysis.json');
      const fullResults = {
        timestamp: new Date().toISOString(),
        user: {
          username: twitterUsername,
          userId: twitterUserId,
          totalTweetsFetched: tweets.length
        },
        tweets: tweets,
        analysis: analysis
      };
      
      fs.writeFileSync(outputPath, JSON.stringify(fullResults, null, 2));
      
      console.log(`📁 Full analysis saved to: ${outputPath}\n`);
      console.log('🎯 REAL TWITTER LEARNING ANALYSIS:');
      console.log('===================================');
      console.log(analysis.summary);
      
      console.log('\n🤖 AI AGENT TRAINING INSIGHTS:');
      console.log('==============================');
      console.log(analysis.aiAgentTraining);
    }
    
  } catch (error) {
    console.error('❌ Error fetching tweets:', error.message);
    if (error.code === 'ENOTFOUND') {
      console.log('🌐 Network error - check internet connection');
    }
  }
}

function analyzeRealTweets(tweets, username) {
  // Writing style analysis
  const textLengths = tweets.map(t => t.text.length);
  const avgLength = textLengths.reduce((a, b) => a + b, 0) / textLengths.length;
  const shortTweets = tweets.filter(t => t.text.length < 100).length;
  const longTweets = tweets.filter(t => t.text.length > 200).length;
  
  // Content analysis
  const hashtagUsage = tweets.filter(t => t.entities?.hashtags?.length > 0).length;
  const urlUsage = tweets.filter(t => t.entities?.urls?.length > 0).length;
  const mentionUsage = tweets.filter(t => t.entities?.mentions?.length > 0).length;
  
  // Emoji analysis
  const emojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}]/gu;
  const emojiUsage = tweets.filter(t => emojiRegex.test(t.text)).length;
  
  // Engagement analysis
  const totalLikes = tweets.reduce((sum, t) => sum + (t.public_metrics?.like_count || 0), 0);
  const totalRetweets = tweets.reduce((sum, t) => sum + (t.public_metrics?.retweet_count || 0), 0);
  const totalReplies = tweets.reduce((sum, t) => sum + (t.public_metrics?.reply_count || 0), 0);
  
  const avgLikes = totalLikes / tweets.length;
  const avgRetweets = totalRetweets / tweets.length;
  const avgReplies = totalReplies / tweets.length;
  
  // Find best performing tweet
  const bestTweet = tweets.reduce((best, current) => {
    const currentScore = (current.public_metrics?.like_count || 0) + 
                        (current.public_metrics?.retweet_count || 0) + 
                        (current.public_metrics?.reply_count || 0);
    const bestScore = (best.public_metrics?.like_count || 0) + 
                     (best.public_metrics?.retweet_count || 0) + 
                     (best.public_metrics?.reply_count || 0);
    return currentScore > bestScore ? current : best;
  }, tweets[0]);
  
  // Topic analysis
  const allText = tweets.map(t => t.text.toLowerCase()).join(' ');
  const techKeywords = ['ai', 'ml', 'tech', 'development', 'coding', 'programming', 'software', 'data', 'algorithm'];
  const cryptoKeywords = ['bitcoin', 'eth', 'crypto', 'defi', 'blockchain', 'nft', 'web3', 'token', 'dex', 'yield'];
  const businessKeywords = ['startup', 'business', 'entrepreneur', 'innovation', 'growth', 'strategy', 'market'];
  
  const foundTech = techKeywords.filter(keyword => allText.includes(keyword));
  const foundCrypto = cryptoKeywords.filter(keyword => allText.includes(keyword));
  const foundBusiness = businessKeywords.filter(keyword => allText.includes(keyword));
  
  // Posting time analysis
  const postingHours = tweets.map(t => new Date(t.created_at).getHours());
  const hourCounts = {};
  postingHours.forEach(hour => {
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });
  
  const mostActiveHour = Object.entries(hourCounts)
    .sort(([,a], [,b]) => b - a)[0];
  
  // All hashtags used
  const allHashtags = tweets.flatMap(t => t.entities?.hashtags || []).map(h => h.tag);
  const hashtagCounts = {};
  allHashtags.forEach(tag => {
    hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
  });
  const topHashtags = Object.entries(hashtagCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([tag]) => tag);
  
  return {
    writingStyle: {
      averageLength: Math.round(avgLength),
      lengthDistribution: {
        short: `${Math.round(shortTweets/tweets.length*100)}% under 100 chars`,
        long: `${Math.round(longTweets/tweets.length*100)}% over 200 chars`
      },
      hashtagUsageRate: Math.round(hashtagUsage / tweets.length * 100),
      emojiUsageRate: Math.round(emojiUsage / tweets.length * 100),
      urlUsageRate: Math.round(urlUsage / tweets.length * 100),
      mentionUsageRate: Math.round(mentionUsage / tweets.length * 100)
    },
    engagement: {
      averageLikes: Math.round(avgLikes * 10) / 10,
      averageRetweets: Math.round(avgRetweets * 10) / 10,
      averageReplies: Math.round(avgReplies * 10) / 10,
      totalEngagement: totalLikes + totalRetweets + totalReplies,
      bestPerformingTweet: {
        text: bestTweet.text.substring(0, 100) + (bestTweet.text.length > 100 ? '...' : ''),
        likes: bestTweet.public_metrics?.like_count || 0,
        retweets: bestTweet.public_metrics?.retweet_count || 0,
        replies: bestTweet.public_metrics?.reply_count || 0
      }
    },
    contentThemes: {
      tech: foundTech,
      crypto: foundCrypto,
      business: foundBusiness,
      topHashtags: topHashtags
    },
    postingPatterns: {
      mostActiveHour: mostActiveHour ? `${mostActiveHour[0]}:00` : 'Varies',
      tweetsAnalyzed: tweets.length,
      hourlyDistribution: hourCounts
    },
    summary: `
📊 REAL DATA for @${username} (${tweets.length} tweets analyzed):

📝 Writing Style:
   • Average length: ${Math.round(avgLength)} characters
   • Uses hashtags: ${Math.round(hashtagUsage / tweets.length * 100)}% of tweets
   • Uses emojis: ${Math.round(emojiUsage / tweets.length * 100)}% of tweets
   • Includes URLs: ${Math.round(urlUsage / tweets.length * 100)}% of tweets

📈 Engagement Performance:
   • Average likes: ${Math.round(avgLikes * 10) / 10}
   • Average retweets: ${Math.round(avgRetweets * 10) / 10}
   • Average replies: ${Math.round(avgReplies * 10) / 10}
   • Total engagement: ${totalLikes + totalRetweets + totalReplies}

🎯 Content Focus:
   • Tech keywords: ${foundTech.join(', ') || 'None detected'}
   • Crypto keywords: ${foundCrypto.join(', ') || 'None detected'}
   • Business keywords: ${foundBusiness.join(', ') || 'None detected'}
   • Top hashtags: ${topHashtags.join(', ') || 'None used'}

⏰ Posting Habits:
   • Most active hour: ${mostActiveHour ? mostActiveHour[0] + ':00' : 'Varies'}
   • Posting frequency: ${tweets.length} tweets in recent history
`,
    aiAgentTraining: `
🤖 How this data will train your AI agents:

📊 Data Analyst Agent:
   → Learned your avg ${Math.round(avgLength)} char tweets get ${Math.round(avgLikes * 10) / 10} likes
   → Optimal posting time: ${mostActiveHour ? mostActiveHour[0] + ':00' : 'flexible'}
   → Hashtag strategy: ${Math.round(hashtagUsage / tweets.length * 100)}% usage rate

🎯 Content Strategist Agent:
   → Focus areas: ${[...foundTech, ...foundCrypto, ...foundBusiness].slice(0, 5).join(', ') || 'General content'}
   → Top performing style: "${bestTweet.text.substring(0, 80)}..."
   → Engagement sweet spot: ${Math.round(avgLength)} characters

✍️ Text Content Agent:
   → Writing style: ${Math.round(avgLength)} char average, ${Math.round(hashtagUsage / tweets.length * 100)}% hashtags
   → Tone: ${emojiUsage > tweets.length * 0.3 ? 'Casual/friendly' : 'Professional'}
   → Format: ${urlUsage > tweets.length * 0.3 ? 'Link-heavy' : 'Text-focused'}

🎨 Visual Content Agent:
   → Media usage: ${tweets.filter(t => t.attachments?.media_keys?.length > 0).length}/${tweets.length} tweets with media
   → Visual style needed: Support for ${foundTech.length > 0 ? 'tech' : foundCrypto.length > 0 ? 'crypto' : 'general'} content

🎭 Orchestrator Agent:
   → Brand voice: ${foundTech.length > 0 ? 'Tech-focused' : foundCrypto.length > 0 ? 'Crypto-savvy' : 'General professional'}
   → Posting schedule: Peak at ${mostActiveHour ? mostActiveHour[0] + ':00' : 'flexible timing'}
   → Content mix: ${Math.round(hashtagUsage / tweets.length * 100)}% with hashtags, ${Math.round(emojiUsage / tweets.length * 100)}% with emojis
`
  };
}

// Run the script
fetchRealTweets(); 