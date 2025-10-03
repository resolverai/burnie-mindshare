"use client";

import { CheckIcon, ChevronDown, ChevronUp, GiftIcon, InfoIcon } from "lucide-react";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
import { rewardsApi, UserStats, TierProgress, UserContext, PotentialEarnings, TierLevel } from "@/services/rewardsApi";

// Helper function to format ROAST values with K/M suffixes
const formatRoastValue = (value: number): string => {
    if (value >= 1000000) {
        const millions = value / 1000000;
        return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
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

// Helper function to get tier number based on tier level
const getTierNumber = (tier: TierLevel): number => {
    const tierNumbers = {
        'SILVER': 1,
        'GOLD': 2,
        'PLATINUM': 3,
        'EMERALD': 4,
        'DIAMOND': 5,
        'UNICORN': 6
    };
    return tierNumbers[tier] || 1;
};

// Rewards banner (Tier 2: Gold) — first step of Rewards tab UI
export default function RewardsPanel({ currentUserWallet }: { currentUserWallet?: string }) {
    const [isRunningNode, setIsRunningNode] = useState(true);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [userStats, setUserStats] = useState<UserStats | null>(null);
    const [tierProgress, setTierProgress] = useState<TierProgress | null>(null);
    const [loading, setLoading] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [userContext, setUserContext] = useState<UserContext | null>(null);
    const [potentialEarnings, setPotentialEarnings] = useState<PotentialEarnings | null>(null);
    const [selectedTier, setSelectedTier] = useState<string>('SILVER');
    const [selectedReferrals, setSelectedReferrals] = useState<number>(0);

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
            const [stats, progress, context] = await Promise.all([
                rewardsApi.getUserStats(currentUserWallet),
                rewardsApi.getTierProgress(currentUserWallet),
                rewardsApi.getUserContext(currentUserWallet)
            ]);
            
            
            setUserStats(stats);
            setTierProgress(progress);
            setUserContext(context);
            
            // Set default slider values to user's current values
            setSelectedTier(context.currentTier);
            setSelectedReferrals(context.totalReferrals);
            setIsRunningNode(context.isRunningNode);
            
            // Calculate initial potential earnings
            calculateEarnings(context.currentTier, context.totalReferrals, context.isRunningNode);
        } catch (error) {
            console.error('Error fetching user data:', error);
            // Component will use fallback static data
        } finally {
            setLoading(false);
        }
    };

    const calculateEarnings = async (tier: string, referrals: number, runningNode: boolean) => {
        if (!currentUserWallet) return;

        try {
            const earnings = await rewardsApi.calculatePotentialEarnings(
                currentUserWallet,
                tier,
                referrals,
                runningNode
            );
            setPotentialEarnings(earnings);
        } catch (error) {
            console.error('Error calculating earnings:', error);
        }
    };

    // Helper functions for tier management
    const getTierIndex = (tier: string) => {
        const tiers = ['SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'UNICORN'];
        return tiers.indexOf(tier);
    };

    const getTierByIndex = (index: number) => {
        const tiers = ['SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'UNICORN'];
        return tiers[index] || 'SILVER';
    };

    const handleTierChange = (tierIndex: number) => {
        const newTier = getTierByIndex(tierIndex);
        const currentUserTierIndex = userContext ? getTierIndex(userContext.currentTier) : 0;
        
        // Don't allow going below current tier
        if (tierIndex >= currentUserTierIndex) {
            setSelectedTier(newTier);
            calculateEarnings(newTier, selectedReferrals, isRunningNode);
        }
    };

    const handleReferralsChange = (referrals: number) => {
        const currentUserReferrals = userContext?.totalReferrals || 0;
        
        // Don't allow going below current referrals
        if (referrals >= currentUserReferrals) {
            setSelectedReferrals(referrals);
            calculateEarnings(selectedTier, referrals, isRunningNode);
        }
    };

    // Banner tier config (swap this object to change tier/name/image quickly)
    const bannerTier = [
        { name: "Tier 1: Silver", subtitle: "0 Referrals or 0 points", image: "/silver.jpeg" },
        { name: "Tier 2: Gold", subtitle: "10 Referrals or 10,000 points", image: "/gold.jpeg" },
        { name: "Tier 3: Platinum", subtitle: "20 Referrals or 20,000 points", image: "/platinum.jpeg" },
        { name: "Tier 4: Emerald", subtitle: "50 Referrals or 50,000 points", image: "/emerald.jpeg" },
        { name: "Tier 5: Diamond", subtitle: "100 Referrals or 100,000 points", image: "/diamond.jpeg" },
        { name: "Tier 6: Unicorn", subtitle: "500 Referrals or 500,000 points", image: "/unicorn.jpeg" },
    ] as const;
    // Refs for mobile tier growth carousel centering
    const mobileTierContainerRef = useRef<HTMLDivElement | null>(null);
    const mobileTierItemRefs = useRef<Array<HTMLDivElement | null>>([]);

    const mobileTiers = [
        { name: "Tier 1: Silver", req: "0 Referrals or 0 points", selected: userStats?.currentTier === 'SILVER', image: "/silver.svg" },
        { name: "Tier 2: Gold", req: "10 Referrals or 10,000 points", selected: userStats?.currentTier === 'GOLD', image: "/gold.svg" },
        { name: "Tier 3: Platinum", req: "20 Referrals or 20,000 points", selected: userStats?.currentTier === 'PLATINUM', image: "/platinum.svg" },
        { name: "Tier 4: Emerald", req: "50 Referrals or 50,000 points", selected: userStats?.currentTier === 'EMERALD', image: "/emeraldbadge.png" },
        { name: "Tier 5: Diamond", req: "100 Referrals or 100,000 points", selected: userStats?.currentTier === 'DIAMOND', image: "/diamond.svg" },
        { name: "Tier 6: Unicorn", req: "500 Referrals or 500,000 points", selected: userStats?.currentTier === 'UNICORN', image: "/unicorn.svg" },
    ];

    // Pick active banner tier based on API data or currently-selected mobile tier (defaults to Silver)
    const userTierName = userStats?.currentTier ? `Tier ${getTierNumber(userStats.currentTier)}: ${userStats.currentTier.charAt(0) + userStats.currentTier.slice(1).toLowerCase()}` : null;
    const selectedMobileTier = (mobileTiers.find(t => (t as any).selected) ?? mobileTiers[0]);
    const activeBanner = userTierName 
        ? bannerTier.find(t => t.name === userTierName) ?? bannerTier[0]
        : (bannerTier.find(t => t.name === selectedMobileTier.name) ?? bannerTier[0]);
    

    // Helper function to get tier number
    function getTierNumber(tier: string): number {
        const tierMap: { [key: string]: number } = {
            'SILVER': 1, 'GOLD': 2, 'PLATINUM': 3, 'EMERALD': 4, 'DIAMOND': 5, 'UNICORN': 6
        };
        return tierMap[tier] || 1;
    }

    // Disabled auto-scroll to prevent unwanted scrolling when switching tabs
    // useEffect(() => {
    //     // Center the selected tier on initial render (mobile only)
    //     const container = mobileTierContainerRef.current;
    //     if (!container) return;
    //     const selectedIndex = mobileTiers.findIndex(t => (t as any).selected);
    //     if (selectedIndex === -1) return;
    //     const item = mobileTierItemRefs.current[selectedIndex];
    //     if (item && container) {
    //         item.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
    //     }
    // }, []);
    return (
        <div className="w-full max-w-[100vw] overflow-x-hidden flex flex-col lg:flex-row gap-4 lg:gap-8">
            <div className="w-full max-w-[100vw] flex flex-col gap-4 lg:gap-8 justify-center lg:justify-start px-0 lg:px-2 overflow-x-hidden">
                {/* Banner container */}
                <div
                    className="relative text-white w-full max-w-[calc(100vw-1rem)] h-[250px] rounded-2xl bg-[#382121] overflow-hidden mx-2 lg:mx-0"
                >
                    {/* Background tier image with fade effect */}
                    <div className="absolute inset-0 hidden md:block rounded-2xl overflow-hidden">
                        {/* Tier image positioned on the right */}
                        <div 
                            className="absolute right-0 top-0 w-full h-full"
                            style={{
                                backgroundImage: `url('${activeBanner.image}')`,
                                backgroundRepeat: "no-repeat",
                                backgroundPosition: "right center",
                                backgroundSize: "auto 120%",
                            }}
                        />
                        {/* Fade overlay from left to right */}
                        <div 
                            className="absolute inset-0 pointer-events-none"
                            style={{
                                background: 'linear-gradient(to right, #382121 0%, #382121 35%, rgba(56, 33, 33, 0.95) 40%, rgba(56, 33, 33, 0.85) 45%, rgba(56, 33, 33, 0.7) 50%, rgba(56, 33, 33, 0.5) 55%, rgba(56, 33, 33, 0.3) 60%, rgba(56, 33, 33, 0.15) 65%, rgba(56, 33, 33, 0.05) 70%, transparent 75%)'
                            }}
                        />
                    </div>
                    {/* Left content block */}
                    <div
                        className="absolute w-full max-w-[calc(100vw-2rem)] md:max-w-[552px] h-auto md:h-[196px] top-4 md:top-8 left-1/2 md:left-[34px] right-auto md:right-auto transform -translate-x-1/2 md:transform-none flex flex-col gap-2 md:gap-8 overflow-x-hidden"
                    >
                        {/* Title + subtitle block */}
                        <div className="flex flex-col gap-3 md:gap-8">
                            <div className="flex flex-col items-start gap-2">
                                <h3 className="font-bold text-lg md:text-3xl text-white">
                                    {activeBanner.name}
                                </h3>
                                <span className="text-white font-semibold text-xs md:text-sm">{activeBanner.subtitle}</span>
                            </div>
                            {/* Three stat cards */}
                            <div className="flex flex-col sm:flex-row items-center sm:items-center gap-2 md:gap-4 w-full">
                                {/* Card 1 */}
                                <div
                                    className="flex-1 w-full md:min-w-0 h-24 px-4 py-2 md:p-4 flex flex-row sm:flex-col items-center md:items-start justify-between md:justify-center gap-0 md:gap-2 rounded-xl md:rounded-2xl"
                                    style={{
                                        background: "#6B612080",
                                        borderImageSlice: 1,
                                        borderImageSource:
                                            "linear-gradient(107.36deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.5) 107.18%)",
                                        backdropFilter: "blur(6.8px)",
                                    }}
                                >
                                    <div className="text-xs text-white font-semibold">Total points</div>
                                    <div className="text-lg md:text-3xl font-bold text-white">
                                        {loading ? '...' : userStats?.totalPoints ? Math.floor(Number(userStats.totalPoints)).toLocaleString() : 'No data'}
                                    </div>
                                </div>
                                {/* Card 2 */}
                                <div
                                    className="flex-1 w-full md:min-w-0 h-24 px-4 py-2 md:p-4 flex flex-row sm:flex-col items-center md:items-start justify-between md:justify-center gap-0 md:gap-2 rounded-xl md:rounded-2xl"
                                    style={{
                                        background: "#48821C80",
                                        borderImageSlice: 1,
                                        borderImageSource:
                                            "linear-gradient(107.36deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.5) 107.18%)",
                                        backdropFilter: "blur(6.8px)",
                                    }}
                                >
                                    <div className="text-xs text-white font-semibold">$ROAST earned</div>
                                    <div className="text-lg md:text-3xl font-bold text-white">
                                        {loading ? '...' : userStats?.totalRoastEarned ? formatRoastValue(Number(userStats.totalRoastEarned)) : 'No data'}
                                    </div>
                                </div>
                                {/* Card 3 */}
                                <div
                                    className="flex-1 w-full md:min-w-0 h-24 px-4 py-2 md:p-4 flex flex-row sm:flex-col items-center md:items-start justify-between md:justify-center gap-0 md:gap-2 rounded-xl md:rounded-2xl relative group cursor-help"
                                    style={{
                                        background: "#284E8380",
                                        borderImageSlice: 1,
                                        borderImageSource:
                                            "linear-gradient(107.36deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.5) 107.18%)",
                                        backdropFilter: "blur(6.8px)",
                                    }}
                                >
                                    <div className="text-xs text-white font-semibold">Total referrals</div>
                                    <div className="text-lg md:text-3xl font-bold text-white">
                                        {loading ? '...' : userStats?.totalReferrals ? 
                                            `${userStats.activeReferrals || 0} (Q) / ${userStats.totalReferrals.toLocaleString()}` : 
                                            'No data'
                                        }
                                    </div>
                                    
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 w-48 text-center">
                                        Only referrals with 2+ transactions count as qualified (Q)
                                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-black/90"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Potential Monthly Earnings Banner */}
                <div className="relative text-white w-full max-w-[calc(100vw-1rem)] h-auto md:h-[288px] rounded-2xl bg-[#382121] mx-2 lg:mx-0">
                    {/* Main content container */}
                    <div className="w-full flex flex-col-reverse md:flex-row">
                        {/* Left side - Controls */}
                        <div className="w-full md:w-[60%] flex flex-col gap-3 md:gap-2 px-2 lg:px-6 py-4 md:py-6">
                            {/* Title */}
                            <h3 className="text-white text-md md:text-xl font-semibold relative">Potential monthly earnings</h3>

                            {/* Controls container */}
                                <div className="flex flex-col gap-4 md:gap-4">
                                {/* Tier slider */}
                                <div className="flex flex-col gap-4 md:gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white text-sm">Tier</span>
                                        <div className="px-3 py-2 bg-[#220808] rounded-xs w-36 text-center">
                                            <span className="text-white text-sm font-medium">Tier {getTierIndex(selectedTier) + 1}: {selectedTier}</span>
                                        </div>
                                    </div>
                                    <div
                                        className="w-full max-w-[calc(100vw-8rem)] lg:max-w-[367px] h-1.5 rounded-full relative cursor-pointer"
                                        style={{
                                            background: "#FFFFFF1A"
                                        }}
                                        onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = e.clientX - rect.left;
                                            const percentage = x / rect.width;
                                            const tierIndex = Math.round(percentage * 5); // 0-5 for 6 tiers
                                            const clampedIndex = Math.max(userContext ? getTierIndex(userContext.currentTier) : 0, Math.min(5, tierIndex));
                                            handleTierChange(clampedIndex);
                                        }}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            const sliderRect = e.currentTarget.getBoundingClientRect();
                                            
                                            const handleMouseMove = (moveEvent: MouseEvent) => {
                                                moveEvent.preventDefault();
                                                const x = moveEvent.clientX - sliderRect.left;
                                                const percentage = Math.max(0, Math.min(1, x / sliderRect.width));
                                                const tierIndex = Math.round(percentage * 5);
                                                const clampedIndex = Math.max(userContext ? getTierIndex(userContext.currentTier) : 0, Math.min(5, tierIndex));
                                                handleTierChange(clampedIndex);
                                            };
                                            
                                            const handleMouseUp = () => {
                                                document.removeEventListener('mousemove', handleMouseMove);
                                                document.removeEventListener('mouseup', handleMouseUp);
                                                document.body.style.userSelect = '';
                                            };
                                            
                                            document.body.style.userSelect = 'none';
                                            document.addEventListener('mousemove', handleMouseMove);
                                            document.addEventListener('mouseup', handleMouseUp);
                                        }}
                                        onTouchStart={(e) => {
                                            e.preventDefault();
                                            const sliderRect = e.currentTarget.getBoundingClientRect();
                                            
                                            const handleTouchMove = (moveEvent: TouchEvent) => {
                                                moveEvent.preventDefault();
                                                const x = moveEvent.touches[0].clientX - sliderRect.left;
                                                const percentage = Math.max(0, Math.min(1, x / sliderRect.width));
                                                const tierIndex = Math.round(percentage * 5);
                                                const clampedIndex = Math.max(userContext ? getTierIndex(userContext.currentTier) : 0, Math.min(5, tierIndex));
                                                handleTierChange(clampedIndex);
                                            };
                                            
                                            const handleTouchEnd = () => {
                                                document.removeEventListener('touchmove', handleTouchMove);
                                                document.removeEventListener('touchend', handleTouchEnd);
                                            };
                                            
                                            document.addEventListener('touchmove', handleTouchMove, { passive: false });
                                            document.addEventListener('touchend', handleTouchEnd);
                                        }}
                                    >
                                        <div
                                            className="absolute left-0 top-0 h-full rounded-full transition-all duration-75 ease-out"
                                            style={{
                                                width: `${((getTierIndex(selectedTier) + 1) / 6) * 100}%`,
                                                background: "linear-gradient(270deg, #FFFFFF 0%, rgba(255, 255, 255, 0.4) 100%)"
                                            }}
                                        ></div>
                                        {/* Slider handle */}
                                        <div
                                            className="absolute top-1/2 w-3 h-3 bg-white rounded-full transform -translate-y-1/2 shadow-lg cursor-grab active:cursor-grabbing select-none transition-all duration-75 ease-out"
                                            style={{
                                                left: `calc(${((getTierIndex(selectedTier) + 1) / 6) * 100}% - 6px)`
                                            }}
                                        ></div>
                                    </div>
                                </div>

                                {/* Referrals slider */}
                                <div className="flex flex-col gap-3 md:gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white text-sm">No. Of Referrals</span>
                                        <div className="px-3 py-2 bg-[#220808] rounded-xs w-36 text-center">
                                            <span className="text-white text-sm font-medium">{selectedReferrals}</span>
                                        </div>
                                    </div>
                                    <div
                                        className="w-full max-w-[calc(100vw-8rem)] lg:max-w-[367px] h-1.5 rounded-full relative cursor-pointer"
                                        style={{
                                            background: "#FFFFFF1A"
                                        }}
                                        onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const x = e.clientX - rect.left;
                                            const percentage = x / rect.width;
                                            const referrals = Math.round(percentage * 1000); // 0-1000 referrals
                                            const minReferrals = userContext?.totalReferrals || 0;
                                            const clampedReferrals = Math.max(minReferrals, Math.min(1000, referrals));
                                            handleReferralsChange(clampedReferrals);
                                        }}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            const sliderRect = e.currentTarget.getBoundingClientRect();
                                            
                                            const handleMouseMove = (moveEvent: MouseEvent) => {
                                                moveEvent.preventDefault();
                                                const x = moveEvent.clientX - sliderRect.left;
                                                const percentage = Math.max(0, Math.min(1, x / sliderRect.width));
                                                const referrals = Math.round(percentage * 1000);
                                                const minReferrals = userContext?.totalReferrals || 0;
                                                const clampedReferrals = Math.max(minReferrals, Math.min(1000, referrals));
                                                handleReferralsChange(clampedReferrals);
                                            };
                                            
                                            const handleMouseUp = () => {
                                                document.removeEventListener('mousemove', handleMouseMove);
                                                document.removeEventListener('mouseup', handleMouseUp);
                                                document.body.style.userSelect = '';
                                            };
                                            
                                            document.body.style.userSelect = 'none';
                                            document.addEventListener('mousemove', handleMouseMove);
                                            document.addEventListener('mouseup', handleMouseUp);
                                        }}
                                        onTouchStart={(e) => {
                                            e.preventDefault();
                                            const sliderRect = e.currentTarget.getBoundingClientRect();
                                            
                                            const handleTouchMove = (moveEvent: TouchEvent) => {
                                                moveEvent.preventDefault();
                                                const x = moveEvent.touches[0].clientX - sliderRect.left;
                                                const percentage = Math.max(0, Math.min(1, x / sliderRect.width));
                                                const referrals = Math.round(percentage * 1000);
                                                const minReferrals = userContext?.totalReferrals || 0;
                                                const clampedReferrals = Math.max(minReferrals, Math.min(1000, referrals));
                                                handleReferralsChange(clampedReferrals);
                                            };
                                            
                                            const handleTouchEnd = () => {
                                                document.removeEventListener('touchmove', handleTouchMove);
                                                document.removeEventListener('touchend', handleTouchEnd);
                                            };
                                            
                                            document.addEventListener('touchmove', handleTouchMove, { passive: false });
                                            document.addEventListener('touchend', handleTouchEnd);
                                        }}
                                    >
                                        <div
                                            className="absolute left-0 top-0 h-full rounded-full transition-all duration-75 ease-out"
                                            style={{
                                                width: `${(selectedReferrals / 1000) * 100}%`,
                                                background: "linear-gradient(270deg, #FFFFFF 0%, rgba(255, 255, 255, 0.4) 100%)"
                                            }}
                                        ></div>
                                        {/* Slider handle */}
                                        <div
                                            className="absolute top-1/2 w-3 h-3 bg-white rounded-full transform -translate-y-1/2 shadow-lg cursor-grab active:cursor-grabbing select-none transition-all duration-75 ease-out"
                                            style={{
                                                left: `calc(${(selectedReferrals / 1000) * 100}% - 6px)`
                                            }}
                                        ></div>
                                    </div>
                                </div>

                                {/* Running Node dropdown/status */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white text-sm">Running Node?</span>
                                        {userContext?.isRunningNode ? (
                                            // Static display if already running node
                                            <div className="px-3 py-2 bg-[#220808] rounded-xs w-36 text-center">
                                                <span className="text-white text-sm font-medium">Yes</span>
                                            </div>
                                        ) : (
                                            // Dropdown if not running node (allow upgrade to Yes)
                                            <div className="relative">
                                                <button
                                                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                                    className="px-3 py-2 bg-[#220808] rounded-xs w-36 text-center transition-colors cursor-pointer flex items-center justify-between"
                                                >
                                                    <span className="text-white text-sm font-medium">
                                                        {isRunningNode ? "Yes" : "No"}
                                                    </span>
                                                    <span className="text-white text-xs ml-2">
                                                        {isDropdownOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    </span>
                                                </button>

                                                {/* Dropdown menu */}
                                                {isDropdownOpen && (
                                                    <div className="absolute top-full left-0 right-0 bg-[#220808] rounded-xs z-10">
                                                        <button
                                                            onClick={() => {
                                                                setIsRunningNode(false);
                                                                setIsDropdownOpen(false);
                                                                calculateEarnings(selectedTier, selectedReferrals, false);
                                                            }}
                                                            className="w-full px-3 py-2 text-left text-white text-sm hover:bg-[#2a0a0a] transition-colors rounded-xs"
                                                        >
                                                            No
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setIsRunningNode(true);
                                                                setIsDropdownOpen(false);
                                                                calculateEarnings(selectedTier, selectedReferrals, true);
                                                            }}
                                                            className="w-full px-3 py-2 text-left text-white text-sm hover:bg-[#2a0a0a] transition-colors rounded-xs"
                                                        >
                                                            Yes
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[#ffffff]/50 text-xs">Applicable on Tier 4 and above</p>
                                </div>
                            </div>
                        </div>

                         {/* Right side - Estimated earnings card */}
                         <div className="w-full md:w-[40%] px-2 lg:px-6 py-3 md:py-6 flex items-center justify-center mt-3 md:mt-0">
                             <div
                                 className="w-full max-w-full lg:w-[343px] min-h-[150px] lg:h-[184px] p-3 lg:p-5 flex flex-col items-center justify-center gap-3 lg:gap-[15px] rounded-2xl relative"
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
                                        onClick={() => setShowInfo((v) => !v)}
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
                                        <span className="text-white font-bold text-md"><InfoIcon className="w-4 h-4" /></span>
                                    </button>

                                    {showInfo && (
                                        <div 
                                            className="fixed bg-black text-white text-sm px-4 py-4 rounded-2xl shadow-xl w-[260px] text-left leading-5 z-50 pointer-events-none"
                                            style={{
                                                left: `${tooltipPosition.x - 130}px`, // Center the tooltip on cursor
                                                top: `${tooltipPosition.y - 60}px`,   // Position above cursor
                                            }}
                                        >
                                            On assumption that each referral will make a purchase of $5 per month
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[10px] border-transparent" style={{ borderTopColor: "#000000" }}></div>
                                        </div>
                                    )}
                                </div>

                                {/* Amount with gradient text */}
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

                                {/* Tooltip moved to icon trigger */}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Grow and Earn with Friends Section */}
                <div
                    className="w-full max-w-[calc(100vw-1rem)] h-auto lg:h-[273.89px] p-3 lg:p-5 rounded-2xl flex flex-col lg:flex-row items-center gap-4 lg:gap-8 mx-2 lg:mx-0"
                    style={{
                        background: "radial-gradient(65.2% 93.53% at 49.94% 6.47%, rgba(148, 251, 72, 0.3) 0%, rgba(255, 255, 255, 0.1) 100%)"
                    }}
                >
                    {/* Left side - Character graphic */}
                    <div
                        className="items-center justify-center md:flex hidden"
                    >
                        <Image src="/graphics.svg" alt="Character" className="w-full h-full" width={800} height={280} />
                    </div>

                    {/* Right side - Textual content */}
                    <div
                        className="w-full max-w-full h-auto lg:h-[186px] flex flex-col gap-3 lg:gap-4"
                    >
                        {/* Title */}
                        <h3 className="text-white text-base lg:text-3xl font-bold">Grow and earn with friends</h3>

                        {/* Content container */}
                        <div className="flex flex-col gap-4 lg:gap-8">
                            {/* 7.5% content button */}
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

                {/* Mobile and Tablet: Your Tier growth between earnings and friends (viewport width constrained) */}
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

                {/* Tier Based Rewards Section */}
                <div className="w-full max-w-[calc(100vw-1rem)] p-3 lg:p-6 rounded-2xl bg-[#382121] mx-2 lg:mx-0">
                    <h3 className="text-white text-lg lg:text-xl font-semibold mb-4 lg:mb-6">Tier based rewards</h3>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-6">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="text-white font-medium">
                                        {userStats?.currentTier ? `Tier ${getTierNumber(userStats.currentTier)}: ${userStats.currentTier}` : 'Tier 1: Silver'}
                                    </div>
                                    <div className="text-white/50 text-sm">5% revenue share</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="text-white font-medium">Tier 2: Gold</div>
                                    <div className="text-white/50 text-sm">7.5% revenue share</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="text-white font-medium">Tier 3: Platinum</div>
                                    <div className="text-white/50 text-sm">10% revenue share + Node waitlist</div>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="text-white font-medium">Tier 4: Emerald</div>
                                    <div className="text-white/50 text-sm">All in Platinum + Node priority + Alpha group access</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="text-white font-medium">Tier 5: Diamond</div>
                                    <div className="text-white/50 text-sm">All in Emerald + DAO membership</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="text-white font-medium">Tier 6: Unicorn</div>
                                    <div className="text-gray-400 text-sm">All in Diamond + NFT access + in-person exclusive events</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
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
        </div >
    );
}


