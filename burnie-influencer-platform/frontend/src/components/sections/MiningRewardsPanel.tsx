"use client";

import { InfoIcon, CheckIcon, GiftIcon } from "lucide-react";
import Image from "next/image";
import React, { useState, useRef, useEffect } from "react";
import { rewardsApi, UserStats, TierLevel } from "@/services/rewardsApi";

// Helper function to format ROAST values with K/M suffixes
const formatRoastValue = (value: number): string => {
    if (value >= 1000000) {
        const millions = value / 1000000;
        return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(2)}M`;
    } else if (value >= 100000) {
        const thousands = value / 1000;
        return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
    } else {
        return Math.round(value).toLocaleString();
    }
};

// Helper function to get tier image based on current tier
const getTierImage = (tier: TierLevel): string => {
    const tierImages = {
        'SILVER': '/silver.jpeg',
        'GOLD': '/gold.jpeg', 
        'PLATINUM': '/platinum.jpeg',
        'EMERALD': '/emerald.jpeg',
        'DIAMOND': '/diamond.jpeg',
        'UNICORN': '/unicorn.jpeg'
    };
    return tierImages[tier] || '/silver.jpeg';
};

export default function MiningRewardsPanel({ currentUserWallet }: { currentUserWallet?: string }) {
    const [showInfo, setShowInfo] = useState(false);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [copySuccess, setCopySuccess] = useState(false);
    const [loading, setLoading] = useState(false);
    const [userStats, setUserStats] = useState<UserStats | null>(null);
    
    // Sliders state (for potential earnings calculator)
    const [contentMined, setContentMined] = useState(0);
    const [contentSold, setContentSold] = useState(0);
    const [potentialEarnings, setPotentialEarnings] = useState<any>(null);

    // Refs for mobile tier growth carousel centering
    const mobileTierContainerRef = useRef<HTMLDivElement | null>(null);
    const mobileTierItemRefs = useRef<Array<HTMLDivElement | null>>([]);

    // Fetch user stats when wallet address is available
    useEffect(() => {
        fetchUserData();
    }, [currentUserWallet]);

    const fetchUserData = async () => {
        if (!currentUserWallet) {
            console.log('No wallet address available, using static data');
            return;
        }

        try {
            setLoading(true);
            const stats = await rewardsApi.getUserStats(currentUserWallet);
            setUserStats(stats);
        } catch (error) {
            console.error('Error fetching user stats:', error);
            // Component will use fallback static data
        } finally {
            setLoading(false);
        }
    };

    // Default tier is SILVER
    const currentTier = userStats?.currentTier || 'SILVER';

    const mobileTiers = [
        { name: "Tier 1: Silver", req: "0 Referrals or 0 points", selected: currentTier === 'SILVER', image: "/silver.svg" },
        { name: "Tier 2: Gold", req: "10 Referrals or 10,000 points", selected: currentTier === 'GOLD', image: "/gold.svg" },
        { name: "Tier 3: Platinum", req: "20 Referrals or 20,000 points", selected: currentTier === 'PLATINUM', image: "/platinum.svg" },
        { name: "Tier 4: Emerald", req: "50 Referrals or 50,000 points", selected: currentTier === 'EMERALD', image: "/emeraldbadge.png" },
        { name: "Tier 5: Diamond", req: "100 Referrals or 100,000 points", selected: currentTier === 'DIAMOND', image: "/diamond.svg" },
        { name: "Tier 6: Unicorn", req: "500 Referrals or 500,000 points", selected: currentTier === 'UNICORN', image: "/unicorn.svg" },
    ];

    return (
        <div className="w-full max-w-[100vw] overflow-x-hidden flex flex-col lg:flex-row gap-4 lg:gap-8">
            <div className="w-full max-w-[100vw] flex flex-col gap-4 lg:gap-8 justify-center lg:justify-start px-0 lg:px-2 overflow-x-hidden">
                {/* Mining Stats Banner */}
                <div className="relative text-white w-full max-w-[calc(100vw-1rem)] h-auto md:h-[300px] rounded-2xl overflow-hidden mx-2 lg:mx-0 bg-[#382121]">
                    {/* Background tier image with fade effect */}
                    <div className="absolute inset-0 hidden md:block rounded-2xl overflow-hidden">
                        {/* Tier image positioned on the right */}
                        <div 
                            className="absolute right-0 top-0 w-full h-full"
                            style={{
                                backgroundImage: `url('${getTierImage(currentTier)}')`,
                                backgroundRepeat: "no-repeat",
                                backgroundPosition: "right center",
                                backgroundSize: "auto 100%",
                            }}
                        />
                        {/* Fade overlay from left to right */}
                        <div 
                            className="absolute inset-0 pointer-events-none"
                            style={{
                                background: 'linear-gradient(to right, #382121 0%, #382121 50%, rgba(56, 33, 33, 0.95) 55%, rgba(56, 33, 33, 0.85) 60%, rgba(56, 33, 33, 0.7) 65%, rgba(56, 33, 33, 0.5) 70%, rgba(56, 33, 33, 0.3) 75%, rgba(56, 33, 33, 0.15) 80%, rgba(56, 33, 33, 0.05) 85%, transparent 90%)'
                            }}
                        />
                    </div>

                    {/* Content */}
                    <div className="relative z-10 p-4 md:p-6">
                        {/* Title + subtitle block */}
                        <div className="flex flex-col gap-3 md:gap-6">
                            <div className="flex flex-col items-start gap-2">
                                <h3 className="font-bold text-lg md:text-3xl text-white">Mining stats</h3>
                            </div>
                            
                            {/* Stats Cards */}
                            <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 md:gap-3 w-full max-w-2xl">
                                {/* Content Created Card */}
                                <div
                                    className="flex-1 w-full md:w-1/3 md:max-w-[200px] h-24 md:h-40 px-3 py-2 md:px-3 md:py-3 flex flex-row sm:flex-col items-center md:items-start justify-between md:justify-center gap-1 md:gap-2 rounded-xl md:rounded-2xl"
                                    style={{
                                        background: "#48821C80",
                                        borderImageSlice: 1,
                                        borderImageSource:
                                            "linear-gradient(107.36deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.5) 107.18%)",
                                        backdropFilter: "blur(6.8px)",
                                    }}
                                >
                                    <div className="text-xs md:text-sm text-white font-semibold">Content created</div>
                                    <div className="text-base md:text-2xl font-bold text-white">
                                        No data
                                    </div>
                                </div>

                                {/* Content Sold Card */}
                                <div
                                    className="flex-1 w-full md:w-1/3 md:max-w-[200px] h-24 md:h-40 px-3 py-2 md:px-3 md:py-3 flex flex-row sm:flex-col items-center md:items-start justify-between md:justify-center gap-1 md:gap-2 rounded-xl md:rounded-2xl"
                                    style={{
                                        background: "#8B5A2B80",
                                        borderImageSlice: 1,
                                        borderImageSource:
                                            "linear-gradient(107.36deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.5) 107.18%)",
                                        backdropFilter: "blur(6.8px)",
                                    }}
                                >
                                    <div className="text-xs md:text-sm text-white font-semibold">Content sold</div>
                                    <div className="text-base md:text-2xl font-bold text-white">
                                        No data
                                    </div>
                                </div>

                                {/* ROAST Earned Card */}
                                <div
                                    className="flex-1 w-full md:w-1/3 md:max-w-[200px] h-24 md:h-40 px-3 py-2 md:px-3 md:py-3 flex flex-row sm:flex-col items-center md:items-start justify-between md:justify-center gap-1 md:gap-2 rounded-xl md:rounded-2xl"
                                    style={{
                                        background: "#6B612080",
                                        borderImageSlice: 1,
                                        borderImageSource:
                                            "linear-gradient(107.36deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.5) 107.18%)",
                                        backdropFilter: "blur(6.8px)",
                                    }}
                                >
                                    <div className="text-xs md:text-sm text-white font-semibold">$ROAST earned</div>
                                    <div className="text-base md:text-2xl font-bold text-white">
                                        No data
                                    </div>
                                    <div className="text-xs text-white/60 md:hidden sm:block">
                                        ≈ USD 0.00
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Potential Monthly Earnings Banner */}
                <div className="relative text-white w-full max-w-[calc(100vw-1rem)] h-auto md:h-[300px] rounded-2xl bg-[#382121] mx-2 lg:mx-0">
                    <div className="w-full flex flex-col-reverse md:flex-row h-full">
                        {/* Left side - Controls */}
                        <div className="w-full md:w-[60%] flex flex-col gap-4 px-4 lg:px-6 py-4 md:py-6">
                            <h3 className="text-white text-md md:text-xl font-semibold">Potential monthly earnings</h3>

                            {/* Content Mined & Sold Slider */}
                            <div className="flex flex-col gap-4">
                                {/* Referrals Slider */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white text-sm">Referrals</span>
                                        <div className="px-3 py-2 bg-[#220808] rounded-xs w-24 text-center">
                                            <span className="text-white text-sm font-medium">45</span>
                                        </div>
                                    </div>
                                    <div
                                        className="w-full max-w-[calc(100vw-8rem)] lg:max-w-[400px] h-1.5 rounded-full relative"
                                        style={{ background: "#FFFFFF1A" }}
                                    >
                                        <div
                                            className="absolute left-0 top-0 h-full rounded-full"
                                            style={{
                                                width: "45%",
                                                background: "linear-gradient(270deg, #FFFFFF 0%, rgba(255, 255, 255, 0.4) 100%)"
                                            }}
                                        />
                                        <div
                                            className="absolute top-1/2 w-3 h-3 bg-white rounded-full transform -translate-y-1/2 shadow-lg"
                                            style={{ left: "calc(45% - 6px)" }}
                                        />
                                    </div>
                                </div>

                                {/* Content Mined & Sold Monthly Slider */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white text-sm">Estimated Content Mined & Sold Monthly</span>
                                        <div className="px-3 py-2 bg-[#220808] rounded-xs w-24 text-center">
                                            <span className="text-white text-sm font-medium">{contentSold}</span>
                                        </div>
                                    </div>
                                    <div
                                        className="w-full max-w-[calc(100vw-8rem)] lg:max-w-[400px] h-1.5 rounded-full relative cursor-pointer"
                                        style={{ background: "#FFFFFF1A" }}
                                        onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = e.clientX - rect.left;
                                            const percentage = x / rect.width;
                                            const value = Math.round(percentage * 1000);
                                            setContentSold(Math.max(0, Math.min(1000, value)));
                                        }}
                                    >
                                        <div
                                            className="absolute left-0 top-0 h-full rounded-full transition-all duration-75"
                                            style={{
                                                width: `${(contentSold / 1000) * 100}%`,
                                                background: "linear-gradient(270deg, #FFFFFF 0%, rgba(255, 255, 255, 0.4) 100%)"
                                            }}
                                        />
                                        <div
                                            className="absolute top-1/2 w-3 h-3 bg-white rounded-full transform -translate-y-1/2 shadow-lg cursor-grab active:cursor-grabbing"
                                            style={{ left: `calc(${(contentSold / 1000) * 100}% - 6px)` }}
                                        />
                                    </div>
                                    <p className="text-[#ffffff]/50 text-xs">
                                        Average price of $0.50 per piece of content based on 7 b average rate for 30 days
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Right side - Estimated earnings card */}
                        <div className="w-full md:w-[40%] px-4 lg:px-6 py-4 md:py-6 flex items-center justify-center">
                            <div
                                className="w-full max-w-full lg:w-[343px] min-h-[150px] lg:h-[200px] p-4 lg:p-5 flex flex-col items-center justify-center gap-3 rounded-2xl relative"
                                style={{
                                    background: "linear-gradient(106.05deg, #8B35E0 0%, #4B1D7A 100%)"
                                }}
                            >
                                {/* Header with info icon */}
                                <div className="flex items-center justify-center gap-2 relative">
                                    <span className="text-white text-sm font-medium">Estimated monthly earnings</span>
                                    <button
                                        type="button"
                                        aria-label="More info"
                                        onMouseEnter={(e) => {
                                            setShowInfo(true);
                                            setTooltipPosition({ x: e.clientX, y: e.clientY });
                                        }}
                                        onMouseMove={(e) => {
                                            setTooltipPosition({ x: e.clientX, y: e.clientY });
                                        }}
                                        onMouseLeave={() => setShowInfo(false)}
                                        className="w-4 h-4 rounded-full flex items-center justify-center cursor-pointer"
                                    >
                                        <InfoIcon className="w-4 h-4" />
                                    </button>

                                    {showInfo && (
                                        <div 
                                            className="fixed bg-black text-white text-sm px-4 py-4 rounded-2xl shadow-xl w-[260px] text-left leading-5 z-50 pointer-events-none"
                                            style={{
                                                left: `${tooltipPosition.x - 130}px`,
                                                top: `${tooltipPosition.y - 80}px`,
                                            }}
                                        >
                                            Average price of $0.50 per piece of content based on 7 b average rate for 30 days
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[10px] border-transparent border-t-black"></div>
                                        </div>
                                    )}
                                </div>

                                {/* Amount */}
                                <div
                                    className="text-center text-4xl font-black leading-[130%]"
                                    style={{
                                        background: "linear-gradient(150.21deg, #FFC89B 13.58%, #FD7A10 64.01%)",
                                        WebkitBackgroundClip: "text",
                                        WebkitTextFillColor: "transparent",
                                        backgroundClip: "text"
                                    }}
                                >
                                    {loading ? '...' : potentialEarnings?.totalEarnings ? `$${potentialEarnings.totalEarnings}` : 'No data'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Grow and Earn with Friends Section */}
                <div
                    className="w-full max-w-[calc(100vw-1rem)] h-auto lg:h-[273.89px] p-4 lg:p-6 rounded-2xl flex flex-col lg:flex-row items-center gap-4 lg:gap-8 mx-2 lg:mx-0"
                    style={{
                        background: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(148, 251, 72, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)"
                    }}
                >
                    {/* Left side - Character graphic */}
                    <div className="items-center justify-center md:flex hidden">
                        <Image src="/graphics.svg" alt="Character" width={220} height={220} />
                    </div>

                    {/* Right side - Content */}
                    <div className="w-full flex flex-col gap-4">
                        <h3 className="text-white text-base lg:text-3xl font-bold">Grow and earn with friends</h3>

                        {/* Content container */}
                        <div className="flex flex-col gap-4 lg:gap-8">
                            {/* 10% content button */}
                            <button
                                className="w-full max-w-full lg:w-11/12 px-2 lg:px-5 py-1.5 lg:py-2 flex items-center justify-start gap-2 lg:gap-3 text-black font-semibold rounded-sm lg:rounded-full"
                                style={{
                                    background: "#94FB48"
                                }}
                            >
                                <span> <GiftIcon className="w-3 lg:w-4 h-3 lg:h-4" /></span>
                                <span className="text-xs lg:text-base w-full text-start">Get upto 10% of all content sales from your referrals</span>
                            </button>

                            {/* Referral link container */}
                            <div
                                className="w-full max-w-full h-[44px] lg:h-[50px] flex items-center justify-between px-2 py-2 rounded-md bg-[#00000066]"
                            >
                                <input
                                    type="text"
                                    value={loading ? "Loading..." : userStats?.referralLink || "No referral link available"}
                                    readOnly
                                    className="flex-1 bg-transparent text-white text-xs lg:text-md outline-none px-1 lg:px-2"
                                />
                                <button
                                    onClick={() => {
                                        const linkToCopy = userStats?.referralLink || null;
                                        if (!linkToCopy) {
                                            console.log('No referral link available to copy');
                                            return;
                                        }
                                        navigator.clipboard.writeText(linkToCopy).then(() => {
                                            console.log('Referral link copied to clipboard');
                                            setCopySuccess(true);
                                            setTimeout(() => setCopySuccess(false), 2000);
                                        }).catch(err => {
                                            console.error('Failed to copy referral link: ', err);
                                        });
                                    }}
                                    className="px-2 lg:px-4 py-1.5 lg:py-2 text-white text-xs lg:text-sm font-medium rounded-sm flex-shrink-0"
                                    style={{
                                        background: copySuccess ? "#22C55E" : "#FD7A10",
                                        boxShadow: copySuccess ? "0px 8px 20px 0px #22C55E80" : "0px 8px 20px 0px #FF9E4F80"
                                    }}
                                >
                                    {copySuccess ? "Copied!" : "Copy"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Mobile and Tablet: Your Tier growth between earnings and friends */}
                <div className="block lg:hidden w-screen max-w-[100vw] -mx-2 overflow-hidden">
                    <div className="bg-[#382121] rounded-2xl py-4 px-4 mx-2">
                        <h4 className="text-center text-lg font-semibold text-white mb-4">Your Tier growth</h4>
                        <div className="w-full overflow-x-auto overflow-y-hidden">
                            <aside ref={mobileTierContainerRef} className="flex flex-row gap-3 text-white" style={{ width: 'max-content' }}>
                                {mobileTiers.map((tier, idx) => (
                                    <div
                                        key={idx}
                                        ref={(el) => { mobileTierItemRefs.current[idx] = el; }}
                                        className="flex-none w-[180px] flex flex-col items-center justify-center py-2"
                                    >
                                        <div className={tier.selected ? "w-[170px] h-[140px] rounded-[12px] py-3 px-3 bg-white text-black shadow relative flex flex-col items-center justify-center gap-1" : "w-[170px] h-[120px] rounded-[12px] py-3 px-3 text-white/90 flex flex-col items-center justify-center gap-1 bg-[#442929] shadow-lg"}>
                                            <Image src={tier.image || "/silver.svg"} alt="Tier" width={45} height={45} />
                                            <div className={tier.selected ? "text-center text-sm font-semibold" : "text-center text-sm font-medium"}>{tier.name}</div>
                                            <div className={tier.selected ? "text-center text-xs text-black/60" : "text-center text-xs text-white/70"}>{tier.req}</div>
                                            {tier.selected && (
                                                <CheckIcon className="absolute top-2 right-2 w-4 h-4 rounded-full text-[#2FCC71]" />
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </aside>
                        </div>
                    </div>
                </div>

                {/* Mining Rewards Structure */}
                <div className="w-full max-w-[calc(100vw-1rem)] p-4 lg:p-6 rounded-2xl bg-[#382121] mx-2 lg:mx-0">
                    <h3 className="text-white text-lg lg:text-xl font-semibold mb-6">Mining rewards structure</h3>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                        <div className="space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#FD7A10]/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[#FD7A10] font-bold">1</span>
                                </div>
                                <div>
                                    <div className="text-white font-medium">Content Revenue Share</div>
                                    <div className="text-white/70 text-sm">Earn 70% of all sales from your mined content</div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#FD7A10]/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[#FD7A10] font-bold">2</span>
                                </div>
                                <div>
                                    <div className="text-white font-medium">Weekly Uptime Rewards</div>
                                    <div className="text-white/70 text-sm">450K $ROAST distributed equally (95%+ uptime required)</div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#FD7A10]/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[#FD7A10] font-bold">3</span>
                                </div>
                                <div>
                                    <div className="text-white font-medium">Weekly Top Seller Bonus</div>
                                    <div className="text-white/70 text-sm">1M $ROAST for Top 5 sellers each week</div>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#FD7A10]/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[#FD7A10] font-bold">4</span>
                                </div>
                                <div>
                                    <div className="text-white font-medium">Grand Prize Pool</div>
                                    <div className="text-white/70 text-sm">1.65M $ROAST for Top 5 overall at campaign end</div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#FD7A10]/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[#FD7A10] font-bold">5</span>
                                </div>
                                <div>
                                    <div className="text-white font-medium">Referral Bonus</div>
                                    <div className="text-white/70 text-sm">Earn from both mining AND yapper referral pools</div>
                                </div>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-[#FD7A10]/20 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[#FD7A10] font-bold">6</span>
                                </div>
                                <div>
                                    <div className="text-white font-medium">Requirements</div>
                                    <div className="text-white/70 text-sm">Platinum tier (20K points) + 95% uptime minimum</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Desktop: Your Tier growth sidebar */}
            <div className="hidden lg:flex w-full max-w-[380px] gap-8">
                <aside className="w-full h-auto p-6 rounded-2xl flex flex-col gap-4 bg-[#382121] text-white">
                    <h4 className="text-center text-2xl font-bold">Your Tier growth</h4>

                    {[
                        { name: "Tier 1: Silver", req: "0 Referrals or 0 points", selected: userStats?.currentTier === 'SILVER', image: "/silver.svg" },
                        { name: "Tier 2: Gold", req: "10 Referrals or 10,000 points", selected: userStats?.currentTier === 'GOLD', image: "/gold.svg" },
                        { name: "Tier 3: Platinum", req: "20 Referrals or 20,000 points", selected: userStats?.currentTier === 'PLATINUM', image: "/platinum.svg" },
                        { name: "Tier 4: Emerald", req: "50 Referrals or 50,000 points", selected: userStats?.currentTier === 'EMERALD', image: "/emeraldbadge.png" },
                        { name: "Tier 5: Diamond", req: "100 Referrals or 100,000 points", selected: userStats?.currentTier === 'DIAMOND', image: "/diamond.svg" },
                        { name: "Tier 6: Unicorn", req: "500 Referrals or 500,000 points", selected: userStats?.currentTier === 'UNICORN', image: "/unicorn.svg" },
                    ].map((tier, idx) => (
                        <div key={idx} className="flex flex-col items-center justify-center py-4">
                            <div
                                className={tier.selected ? "w-full max-w-[276px] h-[150px] rounded-[12px] py-4 px-4 bg-white text-black shadow relative flex flex-col items-center justify-center gap-1" : "w-full max-w-[276px] h-[131px] rounded-[12px] py-4 px-4 text-white flex flex-col items-center justify-center gap-1"}
                            >
                                <Image src={tier.image || "/silver.svg"} alt="Character" className="" width={100} height={100} />
                                <div className={tier.selected ? "text-center text-base font-semibold" : "text-center text-lg font-medium"}>{tier.name}</div>
                                <div className={tier.selected ? "text-center text-xs text-black/60" : "text-center text-sm text-white"}>{tier.req}</div>

                                {tier.selected && (
                                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center">
                                        <span className="text-[#2FCC71] text-xs"><CheckIcon className="w-6 h-6" /></span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </aside>
            </div>
        </div>
    );
}

