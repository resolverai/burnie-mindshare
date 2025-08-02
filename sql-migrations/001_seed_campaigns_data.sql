-- =========================================
-- CAMPAIGNS SEED DATA - PRODUCTION READY
-- =========================================
-- Realistic campaigns from various platforms like cookie.fun, yaps.kaito.ai, yap.market

-- Insert realistic campaigns with diverse platforms and characteristics
INSERT INTO campaigns (
  title, 
  description, 
  category,
  "platformSource",
  "externalCampaignId",
  "rewardToken",
  "targetAudience",
  "brandGuidelines",
  "predictedMindshare",
  "mindshareRequirements",
  "isActive",
  "campaignType",
  status,
  "rewardPool",
  "entryFee",
  "maxSubmissions",
  "currentSubmissions",
  "startDate",
  "endDate",
  requirements,
  metadata,
  "creatorId"
) VALUES 

-- Cookie.fun Campaigns
(
  'Cookie Gaming Revolution', 
  'Create viral gaming content that showcases the next generation of web3 gaming experiences. Focus on memes, gameplay highlights, and community moments.',
  'Gaming',
  'cookie.fun',
  'cookie_gaming_rev_001',
  'COOKIE',
  'Web3 gamers, crypto enthusiasts, meme lovers aged 18-35',
  'Use bright colors, gaming terminology, include $COOKIE mentions, maintain fun and energetic tone',
  85.5,
  '{"minEngagement": 1000, "platforms": ["twitter", "tiktok"], "contentTypes": ["video", "meme", "text"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  50000, -- 50,000 COOKIE tokens
  100, -- 100 COOKIE entry fee
  2000,
  156,
  NOW() - INTERVAL '5 days',
  NOW() + INTERVAL '25 days',
  '{"minFollowers": 500, "engagementRate": 2.0, "contentGuidelines": ["No NSFW", "Gaming focused", "Community friendly"]}',
  '{"campaignManager": "cookie_team", "priority": "high", "tags": ["gaming", "web3", "viral"]}',
  1
),

(
  'Cookie DeFi Summer Memes', 
  'Create hilarious DeFi-related content that explains complex financial concepts through humor and accessible language.',
  'DeFi',
  'cookie.fun',
  'cookie_defi_memes_002',
  'COOKIE',
  'DeFi users, crypto traders, finance meme enthusiasts',
  'Educational but funny, use Cookie branding, explain DeFi concepts simply',
  78.2,
  '{"minEngagement": 800, "platforms": ["twitter", "instagram"], "contentTypes": ["meme", "infographic", "text"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  75000, -- 75,000 COOKIE tokens
  150, -- 150 COOKIE entry fee
  1500,
  89,
  NOW() - INTERVAL '10 days',
  NOW() + INTERVAL '20 days',
  '{"minFollowers": 300, "engagementRate": 1.5, "contentGuidelines": ["Educational focus", "Humor mandatory", "DeFi accuracy"]}',
  '{"campaignManager": "cookie_defi", "priority": "medium", "tags": ["defi", "education", "memes"]}',
  1
),

-- Yaps.kaito.ai Campaigns
(
  'AI x Crypto Fusion Content', 
  'Generate content showcasing the intersection of artificial intelligence and cryptocurrency. Focus on future predictions and current innovations.',
  'AI/Crypto',
  'yaps.kaito.ai',
  'yaps_ai_crypto_fusion_001',
  'KAITO',
  'AI researchers, crypto developers, tech futurists aged 22-45',
  'Technical accuracy required, mention @KaitoAI, focus on innovation and future tech',
  92.1,
  '{"minEngagement": 1500, "platforms": ["twitter", "linkedin"], "contentTypes": ["thread", "analysis", "prediction"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  100000, -- 100,000 KAITO tokens
  200, -- 200 KAITO entry fee
  1000,
  234,
  NOW() - INTERVAL '7 days',
  NOW() + INTERVAL '23 days',
  '{"minFollowers": 1000, "engagementRate": 3.0, "contentGuidelines": ["Technical accuracy", "AI focus", "Future predictions"]}',
  '{"campaignManager": "kaito_ai_team", "priority": "high", "tags": ["ai", "crypto", "tech", "analysis"]}',
  1
),

(
  'Kaito Market Analysis Threads', 
  'Create detailed analysis threads about crypto market trends using AI insights and data visualization.',
  'Market Analysis',
  'yaps.kaito.ai',
  'yaps_market_analysis_002',
  'KAITO',
  'Crypto traders, market analysts, data scientists',
  'Data-driven content, include charts/graphs, cite sources, maintain analytical tone',
  88.7,
  '{"minEngagement": 1200, "platforms": ["twitter"], "contentTypes": ["thread", "analysis", "chart"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  80000, -- 80,000 KAITO tokens
  180, -- 180 KAITO entry fee
  800,
  67,
  NOW() - INTERVAL '3 days',
  NOW() + INTERVAL '27 days',
  '{"minFollowers": 800, "engagementRate": 2.5, "contentGuidelines": ["Data accuracy", "Source citation", "Market focus"]}',
  '{"campaignManager": "kaito_analysis", "priority": "high", "tags": ["analysis", "market", "data", "trading"]}',
  1
),

-- Yap.market Campaigns
(
  'Viral Social Trading Content', 
  'Create engaging content about social trading, copy trading, and community-driven investment strategies.',
  'Social Trading',
  'yap.market',
  'yap_social_trading_001',
  'YAP',
  'Social traders, crypto investors, trading community members aged 20-40',
  'Community-focused, highlight success stories, use YAP branding, encourage interaction',
  82.3,
  '{"minEngagement": 900, "platforms": ["twitter", "discord"], "contentTypes": ["story", "tutorial", "community"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  60000, -- 60,000 YAP tokens
  120, -- 120 YAP entry fee
  1200,
  178,
  NOW() - INTERVAL '8 days',
  NOW() + INTERVAL '22 days',
  '{"minFollowers": 400, "engagementRate": 2.0, "contentGuidelines": ["Community focus", "Trading education", "Success stories"]}',
  '{"campaignManager": "yap_community", "priority": "medium", "tags": ["trading", "community", "social", "education"]}',
  1
),

(
  'YAP Trading Signal Memes', 
  'Transform trading signals and market movements into entertaining and shareable meme content.',
  'Trading Memes',
  'yap.market',
  'yap_trading_memes_002',
  'YAP',
  'Meme traders, crypto Twitter users, trading communities',
  'Humorous but informative, reference current market events, maintain trading accuracy',
  75.8,
  '{"minEngagement": 700, "platforms": ["twitter", "telegram"], "contentTypes": ["meme", "signal", "humor"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  45000, -- 45,000 YAP tokens
  90, -- 90 YAP entry fee
  1800,
  92,
  NOW() - INTERVAL '6 days',
  NOW() + INTERVAL '24 days',
  '{"minFollowers": 250, "engagementRate": 1.8, "contentGuidelines": ["Trading accuracy", "Market relevance", "Humor focus"]}',
  '{"campaignManager": "yap_memes", "priority": "medium", "tags": ["memes", "trading", "signals", "humor"]}',
  1
),

-- Pump.fun Campaigns
(
  'Pump.fun Memecoin Mania', 
  'Create viral content around the hottest new memecoins launching on Pump.fun. Focus on community building and hype.',
  'Memecoin',
  'pump.fun',
  'pump_memecoin_mania_001',
  'PUMP',
  'Memecoin enthusiasts, pump.fun users, degen traders aged 18-35',
  'High energy, memecoin focused, pump.fun branding, community hype',
  79.4,
  '{"minEngagement": 1100, "platforms": ["twitter", "tiktok"], "contentTypes": ["video", "meme", "hype"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  25000, -- 25,000 PUMP tokens
  50, -- 50 PUMP entry fee
  2500,
  312,
  NOW() - INTERVAL '4 days',
  NOW() + INTERVAL '26 days',
  '{"minFollowers": 200, "engagementRate": 3.5, "contentGuidelines": ["Memecoin focus", "High energy", "Community hype"]}',
  '{"campaignManager": "pump_team", "priority": "high", "tags": ["memecoin", "pump", "hype", "community"]}',
  1
),

-- Dexscreener Campaigns
(
  'DEX Analytics & Chart Reading', 
  'Educational content about reading DEX charts, understanding token metrics, and spotting early opportunities.',
  'DEX Education',
  'dexscreener.com',
  'dex_analytics_education_001',
  'DEX',
  'DEX traders, chart analysts, crypto researchers',
  'Educational focus, accurate data, dexscreener integration, chart examples',
  86.9,
  '{"minEngagement": 1000, "platforms": ["twitter", "youtube"], "contentTypes": ["tutorial", "analysis", "education"]}',
  true,
  'AGGREGATED',
  'ACTIVE',
  40000, -- 40,000 DEX tokens
  80, -- 80 DEX entry fee
  1000,
  145,
  NOW() - INTERVAL '9 days',
  NOW() + INTERVAL '21 days',
  '{"minFollowers": 600, "engagementRate": 2.2, "contentGuidelines": ["Educational accuracy", "Chart analysis", "DEX focus"]}',
  '{"campaignManager": "dex_education", "priority": "medium", "tags": ["education", "dex", "charts", "analysis"]}',
  1
),

-- Burnie Native Campaigns
(
  'Burnie AI Agent Showcase', 
  'Demonstrate the power of personalized AI agents in content creation and community engagement.',
  'AI Agents',
  'burnie.io',
  'burnie_ai_agents_001',
  'ROAST',
  'AI enthusiasts, content creators, crypto communities',
  'Showcase AI capabilities, Burnie branding, technical demonstrations',
  94.2,
  '{"minEngagement": 1800, "platforms": ["twitter", "linkedin"], "contentTypes": ["demo", "tutorial", "showcase"]}',
  true,
  'ROAST',
  'ACTIVE',
  150000, -- 150,000 ROAST tokens
  300, -- 300 ROAST entry fee
  500,
  89,
  NOW() - INTERVAL '2 days',
  NOW() + INTERVAL '28 days',
  '{"minFollowers": 1200, "engagementRate": 3.0, "contentGuidelines": ["AI focus", "Technical accuracy", "Burnie branding"]}',
  '{"campaignManager": "burnie_core", "priority": "highest", "tags": ["ai", "agents", "demo", "tech"]}',
  1
),

(
  'ROAST Token Community Growth', 
  'Build awareness and adoption of ROAST token through community-driven content and engagement.',
  'Token Adoption',
  'burnie.io',
  'roast_community_growth_001',
  'ROAST',
  'Crypto communities, token holders, DeFi users',
  'Community-focused, ROAST utility explanation, adoption stories',
  87.6,
  '{"minEngagement": 1200, "platforms": ["twitter", "discord"], "contentTypes": ["community", "utility", "adoption"]}',
  true,
  'ROAST',
  'ACTIVE',
  200000, -- 200,000 ROAST tokens
  250, -- 250 ROAST entry fee
  750,
  156,
  NOW() - INTERVAL '12 days',
  NOW() + INTERVAL '18 days',
  '{"minFollowers": 500, "engagementRate": 2.5, "contentGuidelines": ["Community focus", "ROAST utility", "Adoption stories"]}',
  '{"campaignManager": "roast_community", "priority": "high", "tags": ["roast", "community", "adoption", "defi"]}',
  1
);

-- Update sequence for campaigns table if using PostgreSQL
SELECT setval('campaigns_id_seq', (SELECT MAX(id) FROM campaigns));

-- Add indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaigns_platform_active 
ON campaigns("platformSource", "isActive") 
WHERE "isActive" = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaigns_predicted_mindshare 
ON campaigns("predictedMindshare" DESC) 
WHERE "isActive" = true;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Successfully seeded % campaigns from various platforms including cookie.fun, yaps.kaito.ai, yap.market, pump.fun, dexscreener.com, and burnie.io', 
    (SELECT COUNT(*) FROM campaigns WHERE "platformSource" IN ('cookie.fun', 'yaps.kaito.ai', 'yap.market', 'pump.fun', 'dexscreener.com', 'burnie.io'));
END $$; 