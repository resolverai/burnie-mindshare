import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useRef } from "react";

interface CampaignComponentProps {
  mixpanel?: any;
  onWalletConnect?: () => void;
}

export default function CampaignComponent({ mixpanel, onWalletConnect }: CampaignComponentProps) {

    const router = useRouter();

    // Track tier view
    const handleTierView = (tier: any, index: number) => {
        if (mixpanel) {
            mixpanel.campaignTierViewed({
                tierName: tier.title,
                tierLevel: index + 1,
                tierRequirements: tier.requirements,
                revenueShare: tier.revenueShare,
                userCurrentTier: 'SILVER', // This could be passed as a prop from parent
                isUnlocked: true, // This could be determined based on user progress
                screenName: 'YapperCampaign'
            });
        }
    };

    const rewardDistribution = [
        { title: "Daily Rewards", desc: "Shared based on leaderboard position at 10 PM ET ", amount: "6,000,000", winners: "Top 25 Daily", image: "/twocoin.svg" },
        { title: "Weekly Rewards", desc: "Shared based on weekly leaderboard performance ", amount: "2,000,000", winners: "Top 10 weekly", image: "/threecoin.svg" },
        { title: "Grand Prize", desc: "Share based on overall campaign performance", amount: "2,000,000", winners: "Top 5", image: "/multiplecoin.svg" },
    ]

    const howToEarnPoints = [
        { title: "Content Purchase", description: "Purchase any content from marketplace", points: "100" },
        { title: "Referral System", description: "New user connects Twitter account and purchases minimum 2 tweets", points: "1,000" },
        { title: "Transaction Milestone", description: "Referrals total transactions cross multiples of 20 (20,40,60,80, etc)", points: "10,000" },
        { title: "Mindshare Rewards", description: "Based on your mindshare % on Crypto Twitter among top 100 yappers", points: "100,000" },
    ]

    const tiers = [
        {
            title: "Tier I: Silver",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(229, 238, 242, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/silverbg.svg",
            badge: "/silver.svg",
            requirements: ["5+ content purchases"],
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
            requirements: ["20 referrals or 20,000 points"],
            revenueShare: "7.5% from direct referrals + 2.5% from indirect",
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
            requirements: ["50 referrals or 50,000 points"],
            revenueShare: "10% from direct referrals + 2.5% from indirect",
            benefits: [
                "Node Operator Eligibility: Run content generation nodes",
                "Node Revenue: 50% of content sales from your nodes",
                "Exclusive Platinum community access",
            ],
        },
        {
            title: "Tier IV: Emerald",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(219, 116, 245, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/emeraldbg.svg",
            badge: "/emeraldbadge.png",
            requirements: ["100 referrals or 100,000 points"],
            revenueShare: "Priority node allocation",
            benefits: [
                "Advanced analytics dashboard",
                "Direct line to development team",
            ],
        },
        {
            title: "Tier V: Diamond",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(218, 162, 97, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/diamondbg.svg",
            badge: "/diamond.svg",
            requirements: ["200 referrals OR 200,000 points"],
            revenueShare: "DAO Membership",
            benefits: [
                "Alpha group access for future launches",
            ],
        },
        {
            title: "Tier VI: Unicorn",
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(105, 210, 246, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/unicornbg.svg",
            badge: "/unicorn.svg",
            requirements: ["500 referrals or 500,000 points"],
            revenueShare: "Exclusive NFT Drops",
            benefits: [
                "In-person event invitation (all expenses paid)",
            ],
        },
    ] as const

    // Next section: simple cards (title + description)
    const leaderboardCards = [
        {
            title: "Daily leaderboard",
            description: [
                "Updates in real-time throughout the day.",
                "Snapshot at 10 PM ET determines daily rewards.",
                "Top 25 positions earn rewards.",
            ]
        },
        {
            title: "Weekly leaderboard",
            description: [
                "Tracks cumulative performance over 7-day periods.",
                "Top 10 positions earn weekly rewards.",
                "Resets every Wednesday.",
            ]
        },
        {
            title: "Monthly leaderboard",
            description: [
                "Overall campaign performance ranking",
                "Determines the grand prize distribution.",
                "Top 5 positions share 2M tokens.",
            ]
        },
    ] as const

    const campaignStrategyGuide = [
        {
            title: "Week 1: Foundation Building",
            description: [
                "Purchase initial content to start earning points",
                "Focus on high-quality referrals",
                "Build consistent daily activity",
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(229, 238, 242, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/foundation.svg"
        },
        {
            title: "Week 2: Network Expansion",
            description: [
                "Leverage referral bonuses for compound growth",
                "Hit transaction milestones for bonus points",
                "Climb tier system for revenue sharing"
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 181, 53, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/network.svg"
        },
        {
            title: "Week 3: Leaderboard Push",
            description: [
                "Maximise daily snapshot positions",
                "Focus on weekly leaderboard competition",
                "Build mindshare for additional points"
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(218, 162, 97, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/leaderboard.svg"
        },
        {
            title: "Week 4: Grand Prize Sprint",
            description: [
                "All-out effort for monthly leaderboard",
                "Leverage accumulated tier benefits",
                "Position for grand prize distribution"
            ],
            bg: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(105, 210, 246, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
            bgImage: "/grandprize.svg"
        },
    ] as const

    const fairplayCards = [
        {
            title: "Eligibility Requirements",
            description: [
                "Connected and verified Twitter account",
                "Agreement to platform terms",
                "Compliance with community guidelines",
            ]
        },
        {
            title: "Anti-Gaming Measures",
            description: [
                "Manual review of suspicious activity",
                "Pattern analysis for coordinated behaviour",
                "Quality-based referral validation",
                "Penalty system for violations",
            ]
        },
        {
            title: "Reward Qualification",
            description: [
                "Must maintain connected Twitter account",
                "Authentic engagement required",
                "Violations result in disqualification"
            ]
        },
    ] as const

    const gettingStartedStepBar = [
        {
            title: "Connect & verify",
            description: [
                "Connect your wallet",
                "Access the marketplace",
                "Purchase and connect X"
            ]
        },
        {
            title: "Start earning points",
            description: [
                "Purchase your first content (100 points)",
                "Share your referral code",
                "Build authentic network",
                "Track leaderboard position"
            ]
        },
        {
            title: "Optimize strategy",
            description: [
                " Monitor daily snapshots",
                "Hit transaction milestones",
                "Build mindshare presence",
                "Advance through tier system"
            ]
        },
        {
            title: "Maximize Rewards",
            description: [
                "Maintain top leaderboard positions",
                "Leverage revenue sharing benefits",
                "Participate in all reward distributions",
                "Build long-term platform relationships"
            ]
        },
    ] as const

    return (
        <main className="w-full flex flex-col items-center gap-14 overflow-x-hidden px-2">
            {/* Page header to match Rewards/Leaderboard */}
            <div className="w-full flex justify-center px-4 mt-4 md:mt-12">
                <h1
                    className="uppercase text-center text-white font-normal tracking-normal w-full max-w-full text-base sm:text-lg md:text-3xl"
                    style={{
                        fontFamily: 'NT Brick Sans, sans-serif',
                    }}
                >
                    Roast Protocol Yapping Campaign
                </h1>
            </div>

            {/* First banner (spec: 1082x232, radius 16, p:40) */}
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
                            <div className="font-semibold text-lg">30 Days</div>
                        </div>
                        <div>
                            <div className="text-white text-sm">Daily Snapshots</div>
                            <div className="font-semibold text-lg">10 PM ET</div>
                        </div>
                        <div>
                            <div className="text-white text-sm">Start Date</div>
                            <div className="font-semibold text-lg">01 Oct 2025</div>
                        </div>
                        <div>
                            <div className="text-white text-sm">End Date</div>
                            <div className="font-semibold text-lg">30 Oct 2025</div>
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
                                10,000,000
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Start Yapping Button - Below Banner */}
            <div className="w-full max-w-4xl flex justify-center px-3 md:px-5 -mt-8">
                <button
                    type="button"
                    onClick={() => {
                        if (onWalletConnect) {
                            onWalletConnect();
                        } else {
                            if (mixpanel) {
                                mixpanel.campaignGetStartedClicked({
                                    buttonText: 'Start Yapping',
                                    buttonPosition: 'below_banner',
                                    userAuthenticated: true,
                                    screenName: 'YapperCampaign'
                                });
                            }
                            router.push("/marketplace?search=burnie yapping");
                        }
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
                    Start Yapping
                </button>
            </div>

                {/* Reward distribution cards */}
                <section className="w-full max-w-7xl px-2 md:px-0 overflow-x-hidden">
                    <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Reward distribution</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-8 mt-6 px-2 md:px-0 w-full overflow-x-hidden">
                        {rewardDistribution.map((reward, i) => (
                            <div
                                key={i}
                                className="rounded-xl p-4 md:p-5 text-white flex flex-col w-full items-start justify-center gap-2"
                                style={{
                                    background: "linear-gradient(180deg, #693B3B 0%, #4A1616 100%)",
                                    borderRadius: "12px",
                                }}
                            >
                                <div className="text-lg md:text-xl font-bold">{reward.title}</div>
                                <div className="text-white/70 text-xs mb-3">{reward.desc}</div>
                                <div
                                    className="flex flex-row justify-between items-center rounded-lg w-full gap-2 md:gap-4 px-4"
                                    style={{
                                        borderRadius: "8px",
                                        background: "linear-gradient(95.92deg, #FFFFFF 0%, #EFF1F5 99.92%)"
                                    }}
                                >
                                <Image
                                    className="w-10 sm:w-12 md:w-16 h-full"
                                        src={reward.image}
                                        alt="Roast"
                                        width={50}
                                        height={50}
                                    />
                                    <div className="py-2 md:py-4 px-2 md:px-4">
                                        <div className="flex flex-row items-center gap-1 md:gap-2">
                                            <span className="text-xl md:text-3xl font-extrabold text-[#220808]">{reward.amount}</span>
                                            <span className="text-xs font-normal text-[#220808]">$ROAST</span>
                                        </div>
                                        <div className="text-xs font-semibold mt-1 text-[#220808]">Winners: {reward.winners}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

            {/* How to earn points cards */}
            <section className="w-full max-w-7xl px-2 md:px-0 overflow-x-hidden">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">How to earn points</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 px-2 md:px-0 mt-6 w-full overflow-x-hidden">
                    {howToEarnPoints.map((earningPoint, i) => (
                        <div
                            key={i}
                            className="rounded-md text-white flex flex-col gap-3 md:gap-4 p-6 md:p-8"
                            style={{
                                background:
                                    "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(255, 235, 104, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)",
                            }}
                        >
                            <div className="w-full flex items-center justify-center">
                                <div
                                    className="flex items-center justify-center text-xs md:text-sm font-semibold px-3 md:px-4 py-1 gap-1"
                                    style={{
                                        borderRadius: "6px",
                                        background:
                                            "linear-gradient(94.37deg, #FFE6B5 0%, #FCEC74 48.31%, #995C0B 103.6%)",
                                        color: "#220808",
                                    }}
                                >
                                    <span>•</span>
                                    <span>{earningPoint.points} points</span>
                                    <span>•</span>
                                </div>
                            </div>
                            <div className="text-sm md:text-sm font-medium px-2 md:px-4 text-center">{earningPoint.title}</div>
                            <div className="text-xs text-white/80 px-2 md:px-4 text-center">
                                {earningPoint.description}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="w-full max-w-7xl px-2 md:px-0 overflow-x-hidden">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Tier Structure & Rewards</h2>
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
                                <div className=" flex flex-row items-start justify-between">
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
                                            <li className="font-semibold text-white text-md" key={b}>{b}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Leaderboard system (cards) */}
            <section className="w-full max-w-7xl px-2 md:px-0 overflow-x-hidden">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Leaderboard system</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 px-3 md:px-0 mt-8 w-full overflow-x-hidden">
                    {leaderboardCards.map((card, idx) => (
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

            <section className="w-full max-w-7xl px-3 md:px-0 overflow-x-hidden">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Campaign strategy guide</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 px-2 md:px-0 mt-6 w-full overflow-x-hidden">
                    {campaignStrategyGuide.map((card, idx) => (
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

            {/* Getting started section - step banner */}
            <section className="w-full max-w-7xl px-2 md:px-0">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">Getting started</h2>
                <div
                    className="w-full rounded-xl p-4 md:p-5 text-white mt-8"
                    style={{
                        background: "#FFFFFF1A",
                        borderRadius: "12px",
                    }}
                >
                    <div className="flex flex-col md:flex-row items-start justify-between h-full gap-6 md:gap-8 relative">
                        {/* Desktop connecting lines container */}
                        <div className="hidden md:block absolute top-0 left-0 w-full h-full pointer-events-none">
                            {gettingStartedStepBar.map((_, idx) => (
                                idx < gettingStartedStepBar.length - 1 && (
                                    <div
                                        key={`line-${idx}`}
                                        className="absolute w-1/4"
                                        style={{
                                            height: "1px",
                                            background: "#FFFFFF4D",
                                            border: "1px solid #FFFFFF4D",
                                            top: "16.5px",
                                            left: `${(100 / gettingStartedStepBar.length) * idx + (100 / gettingStartedStepBar.length / 7)}%`,
                                            transform: "translateX(33px)",
                                            zIndex: "1"
                                        }}
                                    />
                                )
                            ))}
                        </div>

                        {/* Mobile connecting lines container */}
                        <div className="block md:hidden absolute left-6 top-0 right-2 h-full pointer-events-none">
                            {gettingStartedStepBar.map((_, idx) => (
                                idx < gettingStartedStepBar.length - 1 && (
                                    <div
                                        key={`mobile-line-${idx}`}
                                        className="absolute h-[70%]"
                                        style={{
                                            width: "2px",
                                            background: "#FFFFFF4D",
                                            border: "1px solid #FFFFFF4D",
                                            top: "30px",
                                            left: "6px",
                                            zIndex: "1"
                                        }}
                                    />
                                )
                            ))}
                        </div>

                        {gettingStartedStepBar.map((step, idx) => (
                            <div key={idx} className="flex flex-row md:flex-col items-start justify-start text-center flex-1 relative z-10 gap-3 md:gap-4">
                                {/* Step button */}
                                <div
                                    className="text-black font-semibold text-xs md:text-sm w-18 md:w-20 p-2 flex items-center justify-center flex-shrink-0"
                                    style={{
                                        borderRadius: "24px",
                                        background: "#F5A030",
                                    }}
                                >
                                    Step {idx + 1}
                                </div>

                                {/* Content container */}
                                <div className="flex flex-col gap-4 flex-1 justify-center">
                                    {/* Step title */}
                                    <h3 className="text-base md:text-lg font-semibold text-white text-left">{step.title}</h3>

                                    {/* Numbered list */}
                                    <ul className="space-y-2 text-left pr-2">
                                        {step.description.map((item, itemIdx) => (
                                            <li key={itemIdx} className="text-sm md:text-base text-white/80 flex items-start gap-2">
                                                <span className="text-white font-semibold min-w-[20px]">{itemIdx + 1}.</span>
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQs Section */}
            <section className="w-full max-w-7xl px-2 md:px-0">
                <h2 className="text-white/90 font-semibold mb-3 px-4 md:px-0">FAQs</h2>
                <div
                    className="w-full rounded-xl p-4 md:p-5 text-white mt-8"
                    style={{
                        background: "#382121",
                        borderRadius: "12px",
                        padding: "16px",
                        gap: "20px"
                    }}
                >
                    <div className="space-y-4">
                        {/* FAQ 1 */}
                        <div className="space-y-2 border-b-[1px] border-white/20 pb-4">
                            <h3 className="text-lg font-semibold text-white">How do daily snapshots work?</h3>
                            <p className="text-sm text-white/80 leading-relaxed">
                                Every day at 10 PM ET, we take a snapshot of the leaderboard. The top 25 positions share 100,000 $ROAST tokens based on their ranking.
                            </p>
                        </div>

                        {/* FAQ 2 */}
                        <div className="space-y-2 border-b-[1px] border-white/20 pb-4">
                            <h3 className="text-lg font-semibold text-white">What qualifies as a valid referral?</h3>
                            <p className="text-sm text-white/80 leading-relaxed">
                                New users must connect Twitter, purchase minimum 2 tweets. Both referrer and referee get 1,000 $ROAST when qualified.
                            </p>
                        </div>

                        {/* FAQ 3 */}
                        <div className="space-y-2 border-b-[1px] border-white/20 pb-4">
                            <h3 className="text-lg font-semibold text-white">How is mindshare calculated?</h3>
                            <p className="text-sm text-white/80 leading-relaxed">
                                Mindshare percentage is calculated based on authentic engagement across platforms. Higher mindshare earns more points from the 100,000 monthly allocation.
                            </p>
                        </div>

                        {/* FAQ 4 */}
                        <div className="space-y-2 border-b-[1px] border-white/20 pb-4">
                            <h3 className="text-lg font-semibold text-white">Can I participate in all reward categories?</h3>
                            <p className="text-sm text-white/80 leading-relaxed">
                                Yes, you can earn daily, weekly, and monthly rewards simultaneously. There's no limit to total earnings across categories.
                            </p>
                        </div>

                        {/* FAQ 5 */}
                        <div className="space-y-2">
                            <h3 className="text-lg font-semibold text-white">What happens after the campaign ends?</h3>
                            <p className="text-sm text-white/80 leading-relaxed">
                                Tier benefits continue permanently, including revenue sharing and node access. The campaign rewards are a bonus on top of ongoing platform benefits.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Call to Action Section */}
            <section className="w-full max-w-7xl px-1 md:px-0">
                <div
                    className="w-full rounded-xl p-8 text-white mt-8 text-center"
                >
                    {/* Main heading */}
                    <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                        Ready to Dominate the Leaderboard?
                    </h2>

                    {/* Subtitle */}
                    <p className="text-lg text-white/80 mb-8">
                        30 days. 10 million $ROAST. Daily rewards starting at 10 PM ET
                    </p>

                    {/* Action buttons */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <button
                            type="button"
                            onClick={() => {
                                if (onWalletConnect) {
                                    onWalletConnect();
                                } else {
                                    if (mixpanel) {
                                        mixpanel.campaignGetStartedClicked({
                                            buttonText: 'Start Yapping',
                                            buttonPosition: 'main_hero',
                                            userAuthenticated: true,
                                            screenName: 'YapperCampaign'
                                        });
                                    }
                                    router.push("/marketplace?search=burnie yapping");
                                }
                            }}
                            className="font-semibold text-sm transition-all duration-200 text-[#FD7A10] cursor-pointer"
                            style={{
                                width: "281px",
                                height: "41px",
                                borderRadius: "8px",
                                padding: "12px 16px",
                                border: "1px solid #FD7A10",
                                background: "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            Start Yapping
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                if (onWalletConnect) {
                                    onWalletConnect();
                                } else {
                                    if (mixpanel) {
                                        mixpanel.campaignGetStartedClicked({
                                            buttonText: 'View Leaderboard',
                                            buttonPosition: 'main_hero',
                                            userAuthenticated: true,
                                            screenName: 'YapperCampaign'
                                        });
                                    }
                                    router.push("/rewards?tab=leaderboard");
                                }
                            }}
                            className="font-semibold text-sm transition-all duration-200 text-[#FD7A10] cursor-pointer"
                            style={{
                                width: "281px",
                                height: "41px",
                                borderRadius: "8px",
                                padding: "12px 16px",
                                border: "1px solid #FD7A10",
                                background: "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            View Leaderboard
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                if (onWalletConnect) {
                                    onWalletConnect();
                                } else {
                                    if (mixpanel) {
                                        mixpanel.campaignGetStartedClicked({
                                            buttonText: 'Dashboard',
                                            buttonPosition: 'main_hero',
                                            userAuthenticated: true,
                                            screenName: 'YapperCampaign'
                                        });
                                    }
                                    router.push("/rewards?tab=rewards");
                                }
                            }}
                            className="font-semibold text-sm transition-all duration-200 text-[#FD7A10] cursor-pointer"
                            style={{
                                width: "281px",
                                height: "41px",
                                borderRadius: "8px",
                                padding: "12px 16px",
                                border: "1px solid #FD7A10",
                                background: "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                            }}
                        >
                            Dashboard
                        </button>
                    </div>
                </div>
            </section>

        </main>
    )
}


