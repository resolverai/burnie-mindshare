-- =========================================
-- CONTENT MARKETPLACE SEED DATA - MVP TESTING
-- =========================================
-- Sample AI-generated content with approved status for bidding screen testing

-- Insert sample content marketplace entries with realistic AI-generated content
INSERT INTO content_marketplace (
  "creatorId",
  "campaignId", 
  "contentText",
  "contentImages",
  "predictedMindshare",
  "qualityScore",
  "askingPrice",
  "isAvailable",
  "approvalStatus",
  "agentName",
  "walletAddress",
  "approvedAt",
  "generationMetadata"
) VALUES 

-- Cookie Gaming Revolution Campaign Content
(
  1, -- Default admin user as creator
  1, -- Cookie Gaming Revolution campaign
  '🎮 Just discovered @cookie_fun and I''m blown away! This isn''t just another web3 game - it''s a complete gaming revolution. Earning $COOKIE while having actual fun? Finally, a crypto project that gets it right! 

Who else is ready to game AND earn? 🚀

#Web3Gaming #COOKIE #GameFi #CryptoGaming',
  '[{"url": "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500", "description": "Gaming setup with RGB lighting", "type": "generated_visual"}]',
  88.5,
  92.3,
  25.0,
  true,
  'approved',
  'Gaming Content Specialist',
  '0x1234567890123456789012345678901234567890',
  NOW(),
  '{"generation_time": 45.2, "model_used": "gpt-4", "agent_constellation": ["Data Analyst", "Content Strategist", "Text Creator", "Visual Creator", "Orchestrator"], "twitter_optimization": true}'
),

(
  1,
  2, -- Cookie DeFi Summer Memes campaign
  '📊 DeFi explained in memes because that''s how we learn best in 2024 😂

🏦 Traditional Bank: "Fill out 47 forms to get 0.01% APY"
🌾 DeFi Yield Farming: "Here''s 420% APY, just connect your wallet"

Meanwhile $COOKIE holders watching their portfolio grow: 📈🍪

#DeFi #COOKIE #YieldFarming #CryptoMemes',
  '[{"url": "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=500", "description": "DeFi vs Traditional Banking comparison meme", "type": "generated_meme"}]',
  82.7,
  89.1,
  20.0,
  true,
  'approved',
  'Meme Strategy Agent',
  '0x2345678901234567890123456789012345678901',
  NOW(),
  '{"generation_time": 38.7, "humor_score": 94, "educational_value": 87, "meme_format": "comparison", "viral_potential": 91}'
),

-- Yaps.kaito.ai Campaign Content
(
  1,
  3, -- AI x Crypto Fusion Content campaign
  '🧠 The convergence of AI and crypto is happening faster than most realize.

Thread on why @KaitoAI represents the future: 🧵

1/ AI models need massive compute power
2/ Crypto enables decentralized compute networks
3/ $KAITO bridges this gap perfectly
4/ We''re looking at the birth of truly decentralized AI

The implications are staggering. Thoughts? 🤔

#AI #Crypto #KAITO #DecentralizedAI #FutureTech',
  '[{"url": "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=500", "description": "AI brain neural network visualization", "type": "generated_infographic"}]',
  93.2,
  95.8,
  35.0,
  true,
  'approved',
  'Technical Analysis AI',
  '0x3456789012345678901234567890123456789012',
  NOW(),
  '{"generation_time": 52.3, "technical_accuracy": 96, "thread_structure": "optimal", "engagement_prediction": 94, "ai_insights": true}'
),

(
  1,
  4, -- Kaito Market Analysis Threads campaign
  '📈 $KAITO Market Analysis - Week 47

Key metrics that caught my attention:
• Volume up 340% vs last week
• 89% of holders are long-term (>90 days)
• Dev activity increased 67%
• Social sentiment: EXTREMELY BULLISH 

The AI sector is heating up, and $KAITO is positioned to benefit from the next wave of AI adoption in crypto.

Chart analysis in replies 👇

#KAITO #MarketAnalysis #AI #CryptoTrading',
  '[{"url": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=500", "description": "KAITO price chart with technical indicators", "type": "generated_chart"}]',
  90.4,
  93.7,
  30.0,
  true,
  'approved',
  'Data Analyst Pro',
  '0x4567890123456789012345678901234567890123',
  NOW(),
  '{"generation_time": 47.1, "data_accuracy": 98, "chart_quality": 92, "analysis_depth": 95, "market_insights": true}'
),

-- Yap.market Campaign Content
(
  1,
  5, -- Viral Social Trading Content campaign
  '🎯 Copy trading success story that will blow your mind!

Meet Sarah: Started with $500 on @yap_market 6 months ago
Today: $12,847 portfolio value

Her secret? She found the top 3 performers and allocated:
• 40% to the swing trader (averaging 23% monthly)
• 35% to the DeFi yield hunter (consistent 15%)
• 25% to the meme coin specialist (high risk, high reward)

Social trading isn''t just copying - it''s building a portfolio of expertise 📊

$YAP making this accessible to everyone 🚀

#SocialTrading #YAP #CopyTrading #CryptoSuccess',
  '[{"url": "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=500", "description": "Portfolio growth chart showing 2500% returns", "type": "success_story_visual"}]',
  85.9,
  91.2,
  22.0,
  true,
  'approved',
  'Community Success Agent',
  '0x5678901234567890123456789012345678901234',
  NOW(),
  '{"generation_time": 41.8, "story_authenticity": 94, "community_appeal": 97, "success_metrics": true, "viral_potential": 89}'
),

(
  1,
  6, -- YAP Trading Signal Memes campaign (assuming campaign 6 exists)
  '🚨 When your $YAP trading signals hit different 📈

Me: "Just a small position in this alt"
YAP Signal: "MAXIMUM CONVICTION BUY" 
My portfolio 24 hours later: 🚀🌙

The accuracy of these signals is actually scary good. 
Who else is using YAP for trading signals? Drop your wins below 👇

#YAP #TradingSignals #CryptoTrading #Gains #WAGMI',
  '[{"url": "https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=500", "description": "Rocket ship emoji with YAP logo heading to moon", "type": "trading_meme"}]',
  79.3,
  87.6,
  18.0,
  true,
  'approved',
  'Viral Meme Creator',
  '0x6789012345678901234567890123456789012345',
  NOW(),
  '{"generation_time": 35.4, "meme_quality": 91, "trading_relevance": 94, "humor_score": 88, "engagement_prediction": 92}'
),

-- Additional diverse content for better testing
(
  1,
  1, -- Another Cookie Gaming content
  '🔥 THREAD: Why Cookie.fun is the future of GameFi 🧵

1/ Traditional gaming: You spend money, get entertainment
2/ Current crypto games: You spend money, maybe earn back some
3/ Cookie.fun: You have fun AND earn real $COOKIE tokens

This is the model every game should follow. Gaming should be rewarding in every sense!

Built different 💪

#COOKIE #GameFi #Web3Gaming #PlayToEarn',
  '[{"url": "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=500", "description": "Futuristic gaming controller with crypto symbols", "type": "conceptual_art"}]',
  87.1,
  90.5,
  28.0,
  true,
  'approved',
  'GameFi Strategist',
  '0x7890123456789012345678901234567890123456',
  NOW(),
  '{"generation_time": 43.6, "thread_structure": "engaging", "gamefi_expertise": 96, "community_building": 93}'
),

(
  1,
  3, -- Another AI x Crypto content
  '🤖 Hot take: AI agents managing crypto portfolios will be the norm by 2025

Current reality:
- Humans make emotional trades
- Miss opportunities while sleeping 
- Can''t process 1000s of signals simultaneously

@KaitoAI is building the infrastructure for autonomous trading agents that never sleep, never panic, and never FOMO.

The future is algorithmic. $KAITO is the bridge.

Thoughts on AI-managed portfolios? 🤔

#AI #KAITO #AlgoTrading #CryptoFuture #AutomatedTrading',
  '[{"url": "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=500", "description": "AI robot analyzing cryptocurrency charts", "type": "futuristic_concept"}]',
  91.8,
  94.3,
  32.0,
  true,
  'approved',
  'Future Tech Analyst',
  '0x8901234567890123456789012345678901234567',
  NOW(),
  '{"generation_time": 49.7, "future_prediction": 97, "technical_depth": 94, "ai_expertise": 99, "discussion_catalyst": 91}'
); 