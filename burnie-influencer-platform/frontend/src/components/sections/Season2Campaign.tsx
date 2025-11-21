import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useState, useEffect, useRef } from "react";

interface CampaignComponentProps {
  mixpanel?: any;
  onWalletConnect?: () => void;
}

export default function Season2CampaignComponent({ mixpanel, onWalletConnect }: CampaignComponentProps) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<'yappers' | 'miners'>('yappers');
    const tabStartTime = useRef<number>(Date.now());
    
    // Determine if user is authenticated based on onWalletConnect presence
    // If onWalletConnect is provided, user is unauthenticated
    const isAuthenticated = !onWalletConnect;

    // Track page view on mount
    useEffect(() => {
        if (mixpanel) {
            mixpanel.yapperCampaignPageViewed({
                screenName: 'Season2Campaign',
                season: 'season2',
                activeTab: activeTab
            });
        }
    }, [mixpanel]);

    // Handle tab change with tracking
    const handleTabChange = (newTab: 'yappers' | 'miners') => {
        if (newTab === activeTab) return;

        const timeSpentOnPrevious = Date.now() - tabStartTime.current;

        if (mixpanel) {
            mixpanel.campaignTabClicked({
                tabName: newTab,
                previousTab: activeTab,
                timeSpentOnPreviousTab: Math.floor(timeSpentOnPrevious / 1000),
                screenName: 'Season2Campaign',
                season: 'season2'
            });
        }

        setActiveTab(newTab);
        tabStartTime.current = Date.now();
    };

    // Track tier view
    const handleTierView = (tier: any, index: number) => {
        if (mixpanel) {
            mixpanel.campaignTierViewed({
                tierName: tier.title,
                tierLevel: index + 1,
                tierRequirements: tier.requirements,
                revenueShare: tier.revenueShare,
                userCurrentTier: 'SILVER',
                isUnlocked: true,
                screenName: 'Season2Campaign',
                season: 'season2'
            });
        }
    };

    // Yapper-specific How to earn points
    const yapperHowToEarn = [
        { title: "Dreamathon Content", description: "Post about any of 20 Somnia Dreamathon projects", points: "100", maxDaily: "300 points per project" },
        { title: "Referrals", description: "New user + 3 purchases on Base Mainnet OR 10 on Somnia Testnet", points: "500", bonus: "5,000 $ROAST airdrop for both" },
        { title: "Transaction Milestones", description: "Every 20 referral purchases on Base mainnet", points: "10,000" },
        { title: "Champion Bonus", description: "Make it to top 5 of any project leaderboard", points: "10,000" },
    ]

    // Node Runner How to earn (matching yapper card layout)
    const nodeRunnerHowToEarn = [
        { title: "Reach Platinum Tier", description: "Earn 50,000 points through yapping to unlock node runner access", points: "Unlock" },
        { title: "Deploy Your Node", description: "Set up dedicated miner with 95%+ uptime to generate content", points: "95%+" },
        { title: "Generate & Sell Content", description: "Create content and earn 70% revenue share on all sales", points: "70%" },
        { title: "Stack Dual Rewards", description: "Earn from both yapper pool (6M) AND node runner pool (6M) simultaneously", points: "12M" },
    ]

    const tiers = [
        {
            title: "Tier I: Silver",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(229, 238, 242, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/silverbg.svg",
            badge: "/silver.svg",
            requirements: ["Signup and Connect Twitter account"],
            revenueShare: "5% from direct referrals",
            benefits: [
                "Earn from every content sale your referrals make",
                "Access to exclusive Silver tier content",
            ],
        },
        {
            title: "Tier II: Gold",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 181, 53, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/goldbg.svg",
            badge: "/gold.svg",
            requirements: ["20K points"],
            revenueShare: "7.5% referral revenue",
            benefits: [
                "Higher revenue percentage",
                "Priority customer support",
                "Early access to new features",
            ],
        },
        {
            title: "Tier III: Platinum",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(245, 116, 116, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/platinumbg.svg",
            badge: "/platinum.svg",
            requirements: ["50K points"],
            revenueShare: "10% revenue + Node Runner Access",
            benefits: [
                "Node Operator Eligibility: Run content generation nodes",
                "Node Revenue: 70% of content sales from your nodes",
                "Dual earning from both 6M pools",
            ],
        },
        {
            title: "Tier IV: Emerald",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(219, 116, 245, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/emeraldbg.svg",
            badge: "/emeraldbadge.png",
            requirements: ["100K points"],
            revenueShare: "10% revenue + Mentor Status",
            benefits: [
                "Advanced analytics dashboard",
                "Direct line to development team",
                "Help shape platform future",
            ],
        },
        {
            title: "Tier V: Diamond",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(218, 162, 97, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/diamondbg.svg",
            badge: "/diamond.svg",
            requirements: ["200K points"],
            revenueShare: "DAO Membership",
            benefits: [
                "Alpha group access for future launches",
                "Governance voting rights",
            ],
        },
        {
            title: "Tier VI: Unicorn",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(105, 210, 246, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/unicornbg.svg",
            badge: "/unicorn.svg",
            requirements: ["500K points"],
            revenueShare: "Exclusive NFT Drops",
            benefits: [
                "In-person event invitation (all expenses paid)",
                "Lifetime platform benefits",
            ],
        },
    ] as const

    const yapperLeaderboardCards = [
        {
            title: "Daily leaderboard",
            description: [
                "200K impressions points divided among top 100 daily",
                "Real-time updates throughout the day",
                "Engagement-based ranking",
            ]
        },
        {
            title: "Weekly leaderboard",
            description: [
                "Top 50 yappers split 600K $ROAST every Tuesday",
                "Proportional distribution based on weekly points",
                "Leaderboard resets every Tuesday",
            ]
        },
        {
            title: "Overall Campaign",
            description: [
                "Top 10 share 1.2M $ROAST grand prize",
                "Dreamathon Project Champions: 300K each for top yapper of winning projects",
                "Per-project leaderboards track champion standings",
            ]
        },
    ] as const

    const nodeRunnerLeaderboardCards = [
        {
            title: "Daily tracking",
            description: [
                "Real-time uptime monitoring",
                "Daily content generation metrics",
                "Daily sales revenue tracking",
            ]
        },
        {
            title: "Weekly leaderboard",
            description: [
                "Top 5 sellers split 1M $ROAST (seller bonus)",
                "450K uptime pool for all nodes with 95%+ uptime",
                "Weekly snapshots every Tuesday 10 AM ET",
            ]
        },
        {
            title: "Overall Campaign",
            description: [
                "Top 5 share 1.65M $ROAST grand prize",
                "Ranked by total sales revenue + uptime",
                "70% revenue share on all content sales",
            ]
        },
    ] as const

    const yapperCampaignStrategy = [
        {
            title: "Week 1: Scout & Build (Days 1-7)",
            description: [
                "Research all 20 Somnia Dreamathon projects",
                "Purchase content in $TOAST and build referral network",
                "Target: 20K+ points to reach Gold tier",
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(229, 238, 242, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/foundation.svg"
        },
        {
            title: "Week 2: Dominate & Graduate (Days 8-14)",
            description: [
                "Content blitz on chosen projects",
                "Push for Platinum tier (50K points)",
                "Deploy node and start dual earning",
                "Climb weekly leaderboard for Top 50",
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 181, 53, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/network.svg"
        },
        {
            title: "Week 3: The Finale (Days 15-21)",
            description: [
                "All-in on Top 10 project contenders",
                "Maximize impressions for daily pool",
                "Secure weekly Top 50 position",
                "Lock Project Champion Bonus (300K)",
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(218, 162, 97, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/leaderboard.svg"
        },
    ] as const

    const nodeRunnerCampaignStrategy = [
        {
            title: "Week 1: Deploy & Optimize (Days 1-7)",
            description: [
                "Set up dedicated miner infrastructure",
                "Achieve and maintain 95%+ uptime",
                "Generate initial content for Somnia projects",
                "Test content quality and sales performance",
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(229, 238, 242, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/foundation.svg"
        },
        {
            title: "Week 2: Scale Sales (Days 8-14)",
            description: [
                "Focus on high-demand Somnia projects",
                "Build content catalog for marketplace",
                "Target weekly Top 5 seller position",
                "Earn from both uptime (450K) and sales (600K) pools",
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 181, 53, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/network.svg"
        },
        {
            title: "Week 3: Maximize Revenue (Days 15-21)",
            description: [
                "Push for #1 weekly seller position (240K)",
                "Maintain perfect uptime for qualification",
                "Secure Top 5 overall for grand prize (1.65M)",
                "Stack 70% revenue share on all sales",
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(218, 162, 97, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/leaderboard.svg"
        },
    ] as const

    const fairplayCards = [
        {
            title: "Eligibility Requirements",
            description: [
                "Connected Twitter account",
                "Minimum 3 Dreamathon posts",
                "Authentic engagement only",
                "Node runners: 95%+ uptime required",
            ]
        },
        {
            title: "Anti-Gaming Measures",
            description: [
                "Bot activity = instant disqualification",
                "Fake engagement = forfeited rewards",
                "Low quality spam = platform ban",
                "Manual review of suspicious activity",
            ]
        },
        {
            title: "Reward Qualification",
            description: [
                "Must maintain connected Twitter account",
                "Authentic engagement required throughout campaign",
                "Violations result in immediate disqualification",
            ]
        },
    ] as const

    return (
        <main className="w-full flex flex-col items-center gap-14 overflow-x-hidden px-2">
            {/* Page header */}
            <div className="w-full flex justify-center px-4 mt-4 md:mt-12">
                <h1
                    className="uppercase text-center text-white font-normal tracking-normal w-full max-w-full text-base sm:text-lg md:text-3xl"
                    style={{
                        fontFamily: 'NT Brick Sans, sans-serif',
                    }}
                >
                    Somnia Dreamathon Yapping Campaign
                </h1>
            </div>

            {/* Hero Banner */}
            <section
                className="w-full max-w-4xl rounded-2xl text-white px-3 md:px-5 py-5 md:p-10 overflow-x-hidden"
                style={{
                    background: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(245, 116, 116, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
                }}
            >
                <div className="flex flex-col md:flex-row justify-between gap-6">
                    <div className="grid grid-cols-2 gap-4 md:gap-8">
                        <div>
                            <div className="text-white text-sm">Duration</div>
                            <div className="font-semibold text-lg">21 Days</div>
                        </div>
                        <div>
                            <div className="text-white text-sm">Weekly Snapshots</div>
                            <div className="font-semibold text-lg">Tuesday 10 AM ET</div>
                        </div>
                        <div>
                            <div className="text-white text-sm">Start Date</div>
                            <div className="font-semibold text-lg">18 Nov 2025</div>
                        </div>
                        <div>
                            <div className="text-white text-sm">End Date</div>
                            <div className="font-semibold text-lg">09 Dec 2025</div>
                        </div>
                    </div>
                    <div className="flex items-center justify-center mt-4 md:mt-0">
                        <div className="text-center">
                            <div className="text-white/80 text-sm mb-1">Total campaign pool</div>
                            <div
                                className="font-black leading-[130%] md:leading-[130%]"
                                style={{
                                    fontSize: "clamp(36px, 6vw, 64px)",
                                    background: "linear-gradient(150.21deg, #FFC89B 13.58%, #FD7A10 64.01%)",
                                    WebkitBackgroundClip: "text",
                                    WebkitTextFillColor: "transparent",
                                    backgroundClip: "text",
                                }}
                            >
                                12,000,000
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Start Earning Button */}
            <div className="w-full max-w-4xl flex justify-center px-3 md:px-5 -mt-8">
                        <button
                            type="button"
                            onClick={() => {
                                if (mixpanel) {
                                    mixpanel.campaignGetStartedClicked({
                                        buttonText: 'Start Earning',
                                        buttonPosition: 'below_banner',
                                        userAuthenticated: isAuthenticated,
                                        screenName: 'Season2Campaign',
                                        activeTab: activeTab,
                                        season: 'season2'
                                    });
                                }
                                // Route to homepage for unauthenticated, marketplace for authenticated
                                const route = isAuthenticated ? "/marketplace?search=Dreamathon" : "/?search=Dreamathon";
                                router.push(route);
                            }}
                            className="bg-[#FD7A10] hover:bg-[#e55a0d] text-white font-semibold text-sm transition-colors"
                            style={{
                                width: "281px",
                                height: "41px",
                                borderRadius: "8px",
                                padding: "12px 16px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            Start Earning
                        </button>
            </div>

            {/* Reward Pool Breakdown */}
            <section className="w-full max-w-7xl px-2 md:px-0 overflow-x-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mt-6 px-2 md:px-0 w-full">
                    {/* Yapper Rewards */}
                    <div
                        className="rounded-xl p-6 text-white"
                        style={{
                            background: "linear-gradient(180deg, #693B3B 0%, #4A1616 100%)",
                        }}
                    >
                        <h3 className="text-2xl font-bold mb-4">Yapper Rewards (6M)</h3>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center pb-2 border-b border-white/20">
                                <span className="text-white/80">Weekly (Top 50)</span>
                                <span className="font-semibold">1.8M $ROAST</span>
                            </div>
                            <div className="flex justify-between items-center pb-2 border-b border-white/20">
                                <span className="text-white/80">Dreamathon Project Champions</span>
                                <span className="font-semibold">3M $ROAST</span>
                            </div>
                            <div className="flex justify-between items-center pb-2">
                                <span className="text-white/80">Grand Prize (Top 10)</span>
                                <span className="font-semibold">1.2M $ROAST</span>
                            </div>
                        </div>
                    </div>

                    {/* Node Runner Rewards */}
                    <div
                        className="rounded-xl p-6 text-white"
                        style={{
                            background: "linear-gradient(180deg, #3B5669 0%, #16344A 100%)",
                        }}
                    >
                        <h3 className="text-2xl font-bold mb-4">Node Runner Rewards (6M)</h3>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center pb-2 border-b border-white/20">
                                <span className="text-white/80">Weekly Uptime Pool</span>
                                <span className="font-semibold">1.35M $ROAST</span>
                            </div>
                            <div className="flex justify-between items-center pb-2 border-b border-white/20">
                                <span className="text-white/80">Top Seller Bonus</span>
                                <span className="font-semibold">3M $ROAST</span>
                            </div>
                            <div className="flex justify-between items-center pb-2">
                                <span className="text-white/80">Grand Prize (Top 5)</span>
                                <span className="font-semibold">1.65M $ROAST</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Yappers / Node Runners Tabs */}
            <section className="w-full max-w-7xl px-2 md:px-0">
                {/* Tab Buttons - matching Rewards page style */}
                <div className="flex gap-2 sm:gap-4 mb-8">
                    <button
                        onClick={() => handleTabChange('yappers')}
                        className={`px-4 sm:px-6 py-2 sm:py-3 rounded-full text-xs sm:text-sm md:text-base font-semibold transition-all ${
                            activeTab === 'yappers'
                                ? 'bg-white text-[#220808]'
                                : 'bg-transparent text-white/70 hover:text-white border border-white/30'
                        }`}
                    >
                        Yappers
                    </button>
                    <button
                        onClick={() => handleTabChange('miners')}
                        className={`px-4 sm:px-6 py-2 sm:py-3 rounded-full text-xs sm:text-sm md:text-base font-semibold transition-all ${
                            activeTab === 'miners'
                                ? 'bg-white text-[#220808]'
                                : 'bg-transparent text-white/70 hover:text-white border border-white/30'
                        }`}
                    >
                        Node Runners
                    </button>
                </div>

                {/* Tab Content */}
                {activeTab === 'yappers' && (
                    <div className="space-y-8">
                        {/* How Yappers Earn Points */}
                        <div>
                            <h2 className="text-white/90 font-semibold mb-6 text-xl">How to earn points</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {yapperHowToEarn.map((item, i) => (
                                    <div
                                        key={i}
                                        className="rounded-lg p-6 text-white flex flex-col gap-3"
                                        style={{
                                            background: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 235, 104, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
                                        }}
                                    >
                                        <div
                                            className="flex items-center justify-center text-sm font-semibold px-4 py-2 self-start"
                                            style={{
                                                borderRadius: "6px",
                                                background: "linear-gradient(94.37deg, #FFE6B5 0%, #FCEC74 48.31%, #995C0B 103.6%)",
                                                color: "#220808",
                                            }}
                                        >
                                            {item.points} points
                                        </div>
                                        <div className="text-base font-semibold">{item.title}</div>
                                        <div className="text-sm text-white/80">{item.description}</div>
                                        {item.maxDaily && (
                                            <div className="text-xs text-white/60 italic">Max: {item.maxDaily}</div>
                                        )}
                                        {item.bonus && (
                                            <div className="text-xs text-orange-300 font-semibold">+ {item.bonus}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Yapper Weekly Breakdown */}
                        <div className="bg-white/10 rounded-xl p-6">
                            <h3 className="text-white font-semibold text-lg mb-4">Weekly Snapshot Details</h3>
                            <div className="text-white/80 space-y-2 text-sm">
                                <p>• <strong>Every Tuesday 10 AM ET:</strong> Top 50 yappers split 600K $ROAST</p>
                                <p>• <strong>Proportional Distribution:</strong> Higher rank = larger share</p>
                                <p>• <strong>Leaderboard Resets:</strong> Fresh start every Tuesday</p>
                                <p>• <strong>Daily Points:</strong> Accumulate throughout the week for Tuesday snapshot</p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'miners' && (
                    <div className="space-y-8">
                        {/* How Node Runners Earn */}
                        <div>
                            <h2 className="text-white/90 font-semibold mb-6 text-xl">How to earn as a Node Runner</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {nodeRunnerHowToEarn.map((item, i) => (
                                    <div
                                        key={i}
                                        className="rounded-lg p-6 text-white flex flex-col gap-3"
                                        style={{
                                            background: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(104, 210, 246, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
                                        }}
                                    >
                                        <div
                                            className="flex items-center justify-center text-sm font-semibold px-4 py-2 self-start"
                                            style={{
                                                borderRadius: "6px",
                                                background: "linear-gradient(135deg, #00B4D8 0%, #0077B6 100%)",
                                                color: "#FFFFFF",
                                            }}
                                        >
                                            {item.points}
                                        </div>
                                        <div className="text-base font-semibold">{item.title}</div>
                                        <div className="text-sm text-white/80">{item.description}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Node Runner Rewards Breakdown */}
                        <div className="bg-white/10 rounded-xl p-6">
                            <h3 className="text-white font-semibold text-lg mb-4">Weekly & Grand Prize Details</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <h4 className="text-white/90 font-semibold mb-3">Weekly Rewards</h4>
                                    <div className="text-white/80 space-y-2 text-sm">
                                        <p>• <strong>Uptime Pool (450K):</strong> Distributed equally among all nodes with 95%+ uptime</p>
                                        <p>• <strong>Top Seller Bonus (1M):</strong> Distributed Proprtionately based on sales revenue</p>
    
                                    </div>
                                </div>
                                <div>
                                    <h4 className="text-white/90 font-semibold mb-3">Revenue Share</h4>
                                    <div className="text-white/80 space-y-2 text-sm">
                                        <p>• <strong>70% of all content sales</strong> go directly to node operator</p>
                                        <p>• <strong>Instant payouts</strong> on every purchase</p>
                                        <p>• <strong>No minimum threshold</strong> for withdrawals</p>
                                        <p>• <strong>Track performance</strong> in real-time dashboard</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </section>

            {/* Tier Structure (Yappers Only) */}
            {activeTab === 'yappers' && (
                <section className="w-full max-w-7xl px-2 md:px-0 overflow-x-hidden">
                    <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Tier Structure & Benefits (Yappers)</h2>
                    <p className="text-white/60 text-sm mb-6 px-4 md:px-0">Progress through tiers based on points earned. Higher tiers unlock node runner access and increased revenue share.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 px-2 md:px-0 mt-6 w-full overflow-x-hidden">
                        {tiers.map((tier, index) => (
                            <div
                                key={tier.title}
                                className="rounded-2xl text-white p-5 flex flex-col justify-between w-full cursor-pointer hover:scale-105 transition-transform duration-200"
                                style={{
                                    borderRadius: "16px",
                                    backgroundImage: `${tier.bg}, url('${tier.bgImage}')`,
                                    backgroundRepeat: "no-repeat, no-repeat",
                                    backgroundPosition: "left top, right center",
                                    backgroundSize: "100% 100%, 120% 110%",
                                }}
                                onClick={() => handleTierView(tier, index)}
                            >
                                <div className="space-y-4">
                                    <div className="text-lg font-semibold">{tier.title}</div>
                                    <div className="flex flex-row items-start justify-between">
                                        <div className="flex flex-col items-start gap-2">
                                            <div className="text-white/70 text-sm">
                                                <div className="font-semibold text-white/60 mb-1">Requirements</div>
                                                {tier.requirements.map((r) => (
                                                    <div className="font-semibold text-white text-md" key={r}>{r}</div>
                                                ))}
                                            </div>
                                            <div className="text-white/70 text-sm">
                                                <div className="font-semibold text-white/60 mb-1">Revenue Share</div>
                                                <div className="font-semibold text-white text-md">{tier.revenueShare}</div>
                                            </div>
                                        </div>
                                        <Image className="w-36 h-full" src={tier.badge} alt="tier badge" width={100} height={100} />
                                    </div>
                                    <div className="text-white/70 text-sm">
                                        <div className="font-semibold text-white/60 mb-1">Benefits</div>
                                        <ul className="list-disc pl-5 space-y-1">
                                            {tier.benefits.map((b) => (
                                                <li className="font-semibold text-white text-sm" key={b}>{b}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Leaderboard System */}
            <section className="w-full max-w-7xl px-2 md:px-0 overflow-x-hidden">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Leaderboard system</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 px-3 md:px-0 mt-8 w-full overflow-x-hidden">
                    {(activeTab === 'yappers' ? yapperLeaderboardCards : nodeRunnerLeaderboardCards).map((card, idx) => (
                        <div
                            key={idx}
                            className="rounded-xl p-5 text-white flex flex-col items-start justify-center gap-4"
                            style={{
                                background: "#FFFFFF1A",
                                borderRadius: "12px",
                            }}
                        >
                            <div className="text-lg font-semibold">{card.title}</div>
                            <ul className="list-disc pl-5 space-y-1">
                                {card.description.map((b) => (
                                    <li className="font-normal text-white text-sm" key={b}>{b}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            {/* Campaign Strategy Guide (3 weeks) */}
            <section className="w-full max-w-7xl px-3 md:px-0 overflow-x-hidden">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Campaign strategy guide</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 px-2 md:px-0 mt-6 w-full overflow-x-hidden">
                    {(activeTab === 'yappers' ? yapperCampaignStrategy : nodeRunnerCampaignStrategy).map((card, idx) => (
                        <div
                            key={idx}
                            className="rounded-xl p-5 text-white flex flex-col items-start justify-center gap-4 w-full"
                            style={{
                                borderRadius: "16px",
                                backgroundImage: `${card.bg}, url('${card.bgImage}')`,
                                backgroundRepeat: "no-repeat, no-repeat",
                                backgroundPosition: "left top, right end",
                                backgroundSize: "100% 100%, 160% 110%",
                            }}
                        >
                            <div className="text-lg font-semibold">{card.title}</div>
                            <ul className="list-disc pl-5 space-y-1">
                                {card.description.map((b) => (
                                    <li className="font-normal text-white text-sm" key={b}>{b}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            {/* Rules and Fair Play */}
            <section className="w-full max-w-7xl px-1 md:px-0">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Rules and fair play</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 px-4 md:px-0 mt-8">
                    {fairplayCards.map((card, idx) => (
                        <div
                            key={idx}
                            className="rounded-xl p-5 text-white flex flex-col items-start justify-center gap-4"
                            style={{
                                background: "#FFFFFF1A",
                                borderRadius: "12px",
                            }}
                        >
                            <div className="text-lg font-semibold">{card.title}</div>
                            <ul className="list-disc pl-5 space-y-1">
                                {card.description.map((b) => (
                                    <li className="font-normal text-white text-sm" key={b}>{b}</li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </section>

            {/* Call to Action */}
            <section className="w-full max-w-7xl px-1 md:px-0 mb-12">
                <div className="w-full rounded-xl p-8 text-white text-center">
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                        Ready to Dominate Somnia Dreamathon?
                    </h2>
                    <p className="text-lg text-white/80 mb-8">
                        21 days. 12M $ROAST. Champion the projects you believe in.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            type="button"
                            onClick={() => {
                                if (mixpanel) {
                                    mixpanel.campaignGetStartedClicked({
                                        buttonText: 'View Somnia Projects',
                                        buttonPosition: 'cta_section',
                                        userAuthenticated: isAuthenticated,
                                        screenName: 'Season2Campaign',
                                        activeTab: activeTab,
                                        season: 'season2'
                                    });
                                }
                                // Route to homepage for unauthenticated, marketplace for authenticated
                                const route = isAuthenticated ? "/marketplace?search=Dreamathon" : "/?search=Dreamathon";
                                router.push(route);
                            }}
                            className="bg-[#FD7A10] hover:bg-[#e55a0d] text-white font-semibold text-sm transition-colors px-8 py-3 rounded-lg"
                        >
                            View Somnia Projects
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                // Route to appropriate leaderboard based on active tab
                                const leaderboardTab = activeTab === 'yappers' ? 'yapping-leaderboard' : 'mining-leaderboard';
                                
                                if (mixpanel) {
                                    mixpanel.campaignGetStartedClicked({
                                        buttonText: 'View Leaderboard',
                                        buttonPosition: 'cta_section',
                                        userAuthenticated: true,
                                        screenName: 'Season2Campaign',
                                        activeTab: activeTab,
                                        season: 'season2'
                                    });
                                }
                                
                                router.push(`/rewards?tab=${leaderboardTab}`);
                            }}
                            className="border border-[#FD7A10] text-[#FD7A10] hover:bg-[#FD7A10]/10 font-semibold text-sm transition-colors px-8 py-3 rounded-lg"
                        >
                            View Leaderboard
                        </button>
                    </div>
                </div>
            </section>
        </main>
    );
}

