"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RewardsPanel from "@/components/sections/RewardsPanel";
import MiningRewardsPanel from "@/components/sections/MiningRewardsPanel";
import { rewardsApi, LeaderboardUser, TierLevel } from "@/services/rewardsApi";
import { useMixpanel } from "@/hooks/useMixpanel";
import { useTimeTracking } from "@/hooks/useTimeTracking";

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

// Helper function to normalize data from different sources
const normalizeUser = (user: any): LeaderboardUser => ({
  rank: user.rank,
  walletAddress: user.walletAddress,
  twitterHandle: user.twitterHandle,
  name: user.name,
  tier: user.tier as TierLevel,
  mindshare: user.mindshare || 0,
  totalReferrals: user.totalReferrals || user.referrals || 0,
  activeReferrals: user.activeReferrals || 0,
  totalPoints: user.totalPoints || user.points || 0,
  totalRoastEarned: user.totalRoastEarned || 0,
  totalDailyRewards: user.totalDailyRewards === 'TBD' ? 'TBD' : (user.totalDailyRewards || 0),
  profileImageUrl: user.profileImageUrl || user.avatar,
  isCurrentUser: user.isCurrentUser || false
});

// Avatar component that shows profile image or initials
function UserAvatar({ user, size = 'md' }: { user: LeaderboardUser, size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 md:w-16 md:h-16 text-xs md:text-base',
    lg: 'w-12 h-12 text-base'
  };

  const getInitials = (user: LeaderboardUser) => {
    if (user.name) {
      return user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (user.twitterHandle) {
      return user.twitterHandle.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  const getBackgroundColor = (user: LeaderboardUser) => {
    const firstChar = (user.twitterHandle || user.name || 'u').toLowerCase().charAt(0);
    const colors = {
      'a': 'bg-orange-500',
      't': 'bg-blue-500',
      'j': 'bg-red-500',
      'd': 'bg-blue-400',
      'u': 'bg-red-500'
    };
    return colors[firstChar as keyof typeof colors] || 'bg-gray-500';
  };

  if (user.profileImageUrl && user.profileImageUrl !== '/default-avatar.svg') {
    return (
      <div className={`${sizeClasses[size]} rounded-full overflow-hidden border-2 border-white shadow-inner`}>
        <img
          src={user.profileImageUrl}
          alt={user.name || user.twitterHandle || 'User'}
          className="w-full h-full object-cover"
          onError={(e) => {
            // If image fails to load, hide it and show initials
            (e.target as HTMLImageElement).style.display = 'none';
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.innerHTML = `<div class="w-full h-full ${getBackgroundColor(user)} flex items-center justify-center text-white font-bold">${getInitials(user)}</div>`;
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`${sizeClasses[size]} rounded-full ${getBackgroundColor(user)} flex items-center justify-center text-white font-bold border-2 border-white shadow-inner`}>
      {getInitials(user)}
    </div>
  );
}

// Mock data for leaderboard
const leaderboardData = [
  {
    rank: 1,
    name: "Aakash dheeman",
    twitterHandle: "@aakashdheeman",
    walletAddress: "0X829X.......9Ktv",
    tier: "Emerald",
    mindshare: 98,
    referrals: 8932,
    points: 42000,
    avatar: "A",
    isCurrentUser: false,
  },
  {
    rank: 2,
    name: "James roadies",
    twitterHandle: "@jamesroadies",
    walletAddress: "0XrpKV.......3214",
    tier: "Emerald",
    mindshare: 82,
    referrals: 8352,
    points: 32000,
    avatar: "J",
    isCurrentUser: false,
  },
  {
    rank: 3,
    name: "Dinisha shukla",
    twitterHandle: "@dinishashukla",
    walletAddress: "0xuaik.......2Drv",
    tier: "Platinum",
    mindshare: 79,
    referrals: 7334,
    points: 12000,
    avatar: "D",
    isCurrentUser: false,
  },
  {
    rank: 4,
    name: "Username",
    twitterHandle: "@username4",
    walletAddress: "0xrpKV.......3214",
    tier: "Platinum",
    mindshare: 70,
    referrals: 5500,
    points: 11700,
    avatar: "U",
    isCurrentUser: false,
  },
  {
    rank: 5,
    name: "Username",
    twitterHandle: "@username5",
    walletAddress: "0xrpKV.......3214",
    tier: "Gold",
    mindshare: 55,
    referrals: 5100,
    points: 10900,
    avatar: "U",
    isCurrentUser: false,
  },
  {
    rank: 6,
    name: "You",
    twitterHandle: "@yourhandle",
    walletAddress: "0xrpKV.......3214",
    tier: "Gold",
    mindshare: 55,
    referrals: 5100,
    points: 10900,
    avatar: "K",
    isCurrentUser: true,
  },
  {
    rank: 7,
    name: "Username",
    twitterHandle: "@username7",
    walletAddress: "0xrpKV.......3214",
    tier: "Gold",
    mindshare: 55,
    referrals: 5100,
    points: 10900,
    avatar: "U",
    isCurrentUser: false,
  },
  {
    rank: 8,
    name: "Username",
    twitterHandle: "@username8",
    walletAddress: "0xrpKV.......3214",
    tier: "Gold",
    mindshare: 55,
    referrals: 5100,
    points: 10900,
    avatar: "U",
    isCurrentUser: false,
  },
  {
    rank: 9,
    name: "Username",
    twitterHandle: "@username9",
    walletAddress: "0xrpKV.......3214",
    tier: "Gold",
    mindshare: 55,
    referrals: 5100,
    points: 10900,
    avatar: "U",
    isCurrentUser: false,
  },
  {
    rank: 10,
    name: "Username",
    twitterHandle: "@username10",
    walletAddress: "0xrpKV.......3214",
    tier: "Gold",
    mindshare: 55,
    referrals: 5100,
    points: 10900,
    avatar: "U",
    isCurrentUser: false,
  },
];

// Current user data (rank 96) - will be shown at top if not in top 10
const currentUserData = {
  rank: 96,
  name: "You",
  twitterHandle: "@yourhandle",
  walletAddress: "0xYOU0.......ABCD",
  tier: "Gold",
  mindshare: 52,
  referrals: 1500,
  points: 10900,
  avatar: "K",
  isCurrentUser: true,
};

// Mining Leaderboard table component
function MiningLeaderboardTable({ leaderboardUsers, loading }: { leaderboardUsers: any[], loading: boolean }) {
  // Use API data only - no dummy data (for now, empty array until API is ready)
  const users = leaderboardUsers;
  const currentUser = users.find(user => user.isCurrentUser);
  const shouldShowPinned = !!currentUser;

  return (
    <div className="w-full overflow-x-hidden justify-center items-center flex px-2 md:px-0">
      <div className="h-full flex flex-col w-full max-w-[1116px]" style={{ height: "745px" }}>
        {/* Table Header */}
        <div
          className="flex items-center justify-between text-white shadow-2xl w-full"
          style={{
            height: "61px",
            paddingTop: "20px",
            paddingRight: "24px",
            paddingBottom: "20px",
            paddingLeft: "24px",
            borderWidth: "1px",
            borderTopLeftRadius: "16px",
            borderTopRightRadius: "16px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            background: "linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 100%)"
          }}
        >
          <div className="text-left md:text-center text-white text-xs font-medium w-6">#</div>
          <div className="text-left text-white text-xs font-medium md:text-center md:w-40">TWITTER HANDLE</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-20">TIER</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-24">CONTENT CREATED</div>
          <div className="text-right md:text-center text-white text-xs font-medium w-28">TOTAL VALUE SOLD</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-24">REV SHARE</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-24">EARNINGS</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-20">BONUS</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-28">REWARDS</div>
        </div>

        {/* Table Body */}
        <div 
          className="flex-1 overflow-y-auto" 
          onWheel={(e) => {
            const element = e.currentTarget;
            const { scrollTop, scrollHeight, clientHeight } = element;
            const deltaY = e.deltaY;
            
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
            const atTop = scrollTop <= 1;
            
            if ((deltaY > 0 && atBottom) || (deltaY < 0 && atTop)) {
              return;
            }
            
            e.stopPropagation();
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-12 h-12 animate-spin border-4 border-orange-500 border-t-transparent rounded-full"></div>
              <div className="text-white ml-4">Loading mining leaderboard...</div>
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-white text-center">
                <div className="text-xl font-semibold mb-2">Mining Leaderboard Coming Soon</div>
                <div className="text-white/70">Node Runner leaderboard will be available here.</div>
              </div>
            </div>
          ) : (
            <>
              {shouldShowPinned && currentUser && (
                <div
                  className="flex items-center justify-between w-full text-white shadow-2xl"
                  style={{
                    height: "60px",
                    paddingTop: "10px",
                    paddingRight: "24px",
                    paddingBottom: "10px",
                    paddingLeft: "24px",
                    background: "linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 100%)"
                  }}
                >
                  <div className="text-white md:text-center text-sm font-medium w-6">{currentUser.rank}</div>
                  <div className="flex items-center gap-3 w-40 min-w-0">
                    <UserAvatar user={currentUser} size="sm" />
                    <span className="text-white text-sm truncate" title={currentUser.twitterHandle || currentUser.name}>@{currentUser.twitterHandle || currentUser.name}</span>
                  </div>
                  <div className="hidden md:block w-20 text-center">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">
                      {currentUser.tier}
                    </span>
                  </div>
                  <div className="hidden md:block w-24 text-center text-sm">{currentUser.contentCreated || 0}</div>
                  <div className="text-right md:text-center text-sm w-28">{formatRoastValue(currentUser.totalValueSold || 0)}</div>
                  <div className="hidden md:block w-24 text-center text-sm">{formatRoastValue(currentUser.revShare || 0)}</div>
                  <div className="hidden md:block w-24 text-center text-sm">{formatRoastValue(currentUser.earnings || 0)}</div>
                  <div className="hidden md:block w-20 text-center text-sm">{formatRoastValue(currentUser.bonus || 0)}</div>
                  <div className="hidden md:block w-28 text-center text-sm font-semibold">{formatRoastValue(currentUser.rewards || 0)}</div>
                </div>
              )}

              {users.map((user: any, index: number) => (
                <div
                  key={index}
                  className="flex items-center justify-between w-full text-white"
                  style={{
                    height: "60px",
                    paddingTop: "10px",
                    paddingRight: "24px",
                    paddingBottom: "10px",
                    paddingLeft: "24px",
                    borderBottom: "1px solid rgba(255,255,255,0.1)"
                  }}
                >
                  <div className="text-white md:text-center text-sm font-medium w-6">{user.rank}</div>
                  <div className="flex items-center gap-3 w-40 min-w-0">
                    <UserAvatar user={user} size="sm" />
                    <span className="text-white text-sm truncate" title={user.twitterHandle || user.name}>@{user.twitterHandle || user.name}</span>
                  </div>
                  <div className="hidden md:block w-20 text-center">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">
                      {user.tier}
                    </span>
                  </div>
                  <div className="hidden md:block w-24 text-center text-sm">{user.contentCreated || 0}</div>
                  <div className="text-right md:text-center text-sm w-28">{formatRoastValue(user.totalValueSold || 0)}</div>
                  <div className="hidden md:block w-24 text-center text-sm">{formatRoastValue(user.revShare || 0)}</div>
                  <div className="hidden md:block w-24 text-center text-sm">{formatRoastValue(user.earnings || 0)}</div>
                  <div className="hidden md:block w-20 text-center text-sm">{formatRoastValue(user.bonus || 0)}</div>
                  <div className="hidden md:block w-28 text-center text-sm font-semibold">{formatRoastValue(user.rewards || 0)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 3D Podium with SVG and user images
function Podium({ topThreeUsers, loading }: { topThreeUsers: LeaderboardUser[], loading: boolean }) {
  // Use API data only - no dummy data
  const top3 = topThreeUsers.slice(0, 3);

  // Sample user data for the top 3 (fallback for styling)
  const podiumUsers = [
    {
      id: 1,
      name: "Aakash dheeman",
      points: 32000,
      avatar: "https://images.unsplash.com/photo-1544006659-f0b21884ce1d?q=80&w=256&fit=facearea&facepad=2",
      rank: "1st",
      position: "center"
    },
    {
      id: 2,
      name: "Dinisha shukla",
      points: 7334,
      avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=256&auto=format&fit=facearea&facepad=3",
      rank: "2nd",
      position: "left"
    },
    {
      id: 3,
      name: "James roadies",
      points: 4784,
      avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=256&fit=facearea&facepad=2",
      rank: "3rd",
      position: "right"
    }
  ];

  return (
    <div className="relative w-full flex justify-center items-center py-8 mt-12 md:py-12 md:mt-20">
      {loading ? (
        <div className="text-white text-center py-12">
          <div className="w-16 h-16 animate-spin border-4 border-orange-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <div className="text-xl font-semibold">Loading podium...</div>
        </div>
      ) : (
        <div className="relative w-full">
          {/* No Data Message - Show when no users */}
          {top3.length === 0 && (
            <div className="text-white text-center mb-8">
              <div className="text-xl font-semibold mb-2">No Leaderboard Data</div>
              <div className="text-white/70">Check back later when users start earning points</div>
            </div>
          )}
          
          {/* 3D Podium SVG - Always show */}
          <div className="relative w-full max-w-[750px] px-3 md:px-0 flex justify-center mx-auto">
        <svg
          width="100%"
          height="176"
          viewBox="0 0 523 176"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-auto max-w-[750px]"
        >
          {/* 2nd Place (Left) */}
          <rect x="0" y="53" width="158" height="123" fill="url(#paint2_linear_5191_1092)" />
          <path d="M0 53H158L139 18H22L0 53Z" fill="url(#paint3_linear_5191_1092)" />

          {/* 1st Place (Center) */}
          <rect x="166" y="36" width="191" height="140" fill="url(#paint0_linear_5191_1092)" />
          <path d="M166 36H357L339 0H189L166 36Z" fill="url(#paint1_linear_5191_1092)" />

          {/* 3rd Place (Right) */}
          <rect x="365" y="53" width="158" height="123" fill="url(#paint4_linear_5191_1092)" />
          <path d="M365 53H523L504 18H387L365 53Z" fill="url(#paint5_linear_5191_1092)" />

          {/* Rank Text - 1st */}
          <text
            x="261.5"
            y="128"
            textAnchor="middle"
            fill="url(#rankTextGrad)"
            filter="url(#rankShadow)"
            style={{ fontWeight: 900, fontSize: 51 }}
          >1st</text>

          {/* Rank Text - 2nd */}
          <text
            x="79"
            y="141"
            textAnchor="middle"
            fill="url(#rankTextGrad)"
            filter="url(#rankShadow)"
            style={{ fontWeight: 900, fontSize: 38 }}
          >2nd</text>

          {/* Rank Text - 3rd */}
          <text
            x="444"
            y="141"
            textAnchor="middle"
            fill="url(#rankTextGrad)"
            filter="url(#rankShadow)"
            style={{ fontWeight: 900, fontSize: 38 }}
          >3rd</text>

          {/* Gradients */}
          <defs>
            {/* Rank text gradient + shadow */}
            <linearGradient id="rankTextGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFB56A" />
              <stop offset="55%" stopColor="#FF8F2F" />
              <stop offset="100%" stopColor="#FF7A00" />
            </linearGradient>
            <filter id="rankShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feOffset dy="6" in="SourceAlpha" result="off" />
              <feGaussianBlur in="off" stdDeviation="0" result="blur" />
              <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0   0 0 0 0.45 0" result="shadow" />
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
                <linearGradient id="paint0_linear_5191_1092" x1="261.5" y1="36" x2="261.5" y2="176" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#693B3B" />
                  <stop offset="1" stopColor="#220808" />
                </linearGradient>
                <linearGradient id="paint1_linear_5191_1092" x1="261.5" y1="36" x2="261.5" y2="0" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#C19595" />
                  <stop offset="0.245192" stopColor="#8C5757" />
                  <stop offset="1" stopColor="#220808" />
                </linearGradient>
                <linearGradient id="paint2_linear_5191_1092" x1="79" y1="53" x2="79" y2="176" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#552929" />
                  <stop offset="1" stopColor="#220808" />
                </linearGradient>
                <linearGradient id="paint3_linear_5191_1092" x1="79" y1="53" x2="79" y2="29" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#8C5A5A" />
                  <stop offset="0.350962" stopColor="#5E2F2F" />
                  <stop offset="1" stopColor="#220808" />
                </linearGradient>
                <linearGradient id="paint4_linear_5191_1092" x1="79" y1="58" x2="79" y2="176" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#552929" />
                  <stop offset="1" stopColor="#220808" />
                </linearGradient>
                <linearGradient id="paint5_linear_5191_1092" x1="79" y1="58" x2="79" y2="34" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#8C5A5A" />
                  <stop offset="0.350962" stopColor="#5E2F2F" />
                  <stop offset="1" stopColor="#220808" />
                </linearGradient>
          </defs>
        </svg>

        {/* User Images Overlay - Only show when we have data */}
        {top3.length > 0 && (
          <>
            {/* 1st Place - Center */}
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-32 md:-translate-y-52 flex flex-col items-center justify-center">
              <div className="relative">
                {/* Flame SVG Background */}
                <div className="relative w-20 h-24 md:w-32 md:h-36 flex items-center justify-center">
                  <img
                    src="/flame.svg"
                    alt="Flame background"
                    className="absolute w-full h-full object-contain"
                  />
                  <div className="relative z-10 translate-y-1 md:translate-y-2">
                    {top3[0] && <UserAvatar user={top3[0]} size="md" />}
                  </div>
                </div>
              </div>
              <div className="text-center">
                <div className="text-white text-xs md:text-base font-bold mb-1">{top3[0]?.name || top3[0]?.twitterHandle || 'User'}</div>
                <div className="bg-white text-black text-[8px] md:text-sm font-semibold px-3 py-1 rounded-full inline-block shadow-lg">
                  {top3[0]?.totalPoints?.toLocaleString() || '0'} points
                </div>
              </div>
            </div>

            {/* 2nd Place - Left */}
            <div className="absolute top-0 left-0 transform translate-x-4 md:translate-x-14 -translate-y-28 md:-translate-y-40 flex flex-col items-center justify-center">
              <div className="relative">
                {/* Flame SVG Background */}
                <div className="relative w-20 h-24 md:w-28 md:h-32 flex items-center justify-center">
                  <img
                    src="/flame.svg"
                    alt="Flame background"
                    className="absolute w-full h-full object-contain"
                  />
                  <div className="relative z-10 translate-y-1 md:translate-y-2">
                    {top3[1] && <UserAvatar user={top3[1]} size="md" />}
                  </div>
                </div>
              </div>
              <div className="text-center">
                <div className="text-white text-xs md:text-sm font-bold mb-1">{top3[1]?.name || top3[1]?.twitterHandle || 'User'}</div>
                <div className="bg-white text-black text-[8px] md:text-xs font-semibold px-2 py-1 rounded-full inline-block shadow-lg">
                  {top3[1]?.totalPoints?.toLocaleString() || '0'} points
                </div>
              </div>
            </div>

            {/* 3rd Place - Right */}
            <div className="absolute top-0 right-0 transform -translate-x-4 md:-translate-x-14 -translate-y-28 md:-translate-y-40 flex flex-col items-center justify-center">
              <div className="relative">
                {/* Flame SVG Background */}
                <div className="relative w-20 h-24 md:w-28 md:h-32 flex items-center justify-center">
                  <img
                    src="/flame.svg"
                    alt="Flame background"
                    className="absolute w-full h-full object-contain"
                  />
                  <div className="relative z-10 translate-y-1 md:translate-y-2">
                    {top3[2] && <UserAvatar user={top3[2]} size="md" />}
                  </div>
                </div>
              </div>
              <div className="text-center">
                <div className="text-white text-xs md:text-sm font-bold mb-1">{top3[2]?.name || top3[2]?.twitterHandle || 'User'}</div>
                <div className="bg-white text-black text-[8px] md:text-xs font-semibold px-2 py-1 rounded-full inline-block shadow-lg">
                  {top3[2]?.totalPoints?.toLocaleString() || '0'} points
                </div>
              </div>
            </div>
          </>
        )}
      </div>
        </div>
      )}
    </div>
  );
}

// Leaderboard table component
function LeaderboardTable({ leaderboardUsers, loading, activeTimePeriod }: { leaderboardUsers: LeaderboardUser[], loading: boolean, activeTimePeriod: "now" | "7d" | "1m" }) {
  // Use API data only - no dummy data
  const users = leaderboardUsers;
  const currentUser = users.find(user => user.isCurrentUser);
  const shouldShowPinned = !!currentUser; // only pin if current user exists in data

  return (
    <div className="w-full overflow-x-hidden justify-center items-center flex px-2 md:px-0">
      {/* Track: full width on mobile; fixed desktop width from md+ */}
          <div className="h-full flex flex-col w-full max-w-[1116px]" style={{ height: "745px" }}>
        {/* Table Header */}
        <div
          className="flex items-center justify-between text-white shadow-2xl w-full"
          style={{
            height: "61px",
            paddingTop: "20px",
            paddingRight: "24px",
            paddingBottom: "20px",
            paddingLeft: "24px",
            borderWidth: "1px",
            borderTopLeftRadius: "16px",
            borderTopRightRadius: "16px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            background: "linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 100%)"
          }}
        >
          <div className="text-left md:text-center text-white text-xs font-medium w-6">#</div>
          <div className="text-left text-white text-xs font-medium md:text-center md:w-40">TWITTER HANDLE</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-20">TIER</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-24">IMPRESSION</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-24">REFERRALS</div>
          <div className="text-right md:text-center text-white text-xs font-medium w-20">POINTS</div>
          <div className="hidden md:block text-center text-white text-xs font-medium w-28">REWARDS</div>
        </div>

        {/* Table Body */}
        <div 
          className="flex-1 overflow-y-auto" 
          onWheel={(e) => {
            const element = e.currentTarget;
            const { scrollTop, scrollHeight, clientHeight } = element;
            const deltaY = e.deltaY;
            
            // Check if trying to scroll down at bottom or up at top
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
            const atTop = scrollTop <= 1;
            
            if ((deltaY > 0 && atBottom) || (deltaY < 0 && atTop)) {
              // Don't prevent default, allow page scroll
              return;
            }
            
            // Prevent page scroll when scrolling within table
            e.stopPropagation();
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-12 h-12 animate-spin border-4 border-orange-500 border-t-transparent rounded-full"></div>
              <div className="text-white ml-4">Loading leaderboard...</div>
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-white text-center">
                <div className="text-xl font-semibold mb-2">No Leaderboard Data</div>
                <div className="text-white/70">Be the first to start earning points!</div>
              </div>
            </div>
          ) : (
            <>
              {shouldShowPinned && (
            <div
              className={`flex items-center justify-between w-full text-white shadow-2xl`}
              style={{
                height: "60px",
                paddingTop: "10px",
                paddingRight: "24px",
                paddingBottom: "10px",
                paddingLeft: "24px",
                background: "linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 100%)"
              }}
            >
              <div className="text-white md:text-center text-sm font-medium w-6">{currentUser?.rank}</div>
              <div className="flex items-center gap-3 w-40 min-w-0">
                {currentUser && <UserAvatar user={currentUser} size="sm" />}
                <span className="text-white text-sm truncate" title={currentUser?.twitterHandle || currentUser?.name}>@{currentUser?.twitterHandle || currentUser?.name}</span>
              </div>
              <div className="hidden md:block w-20 text-center">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${currentUser?.tier === "EMERALD" ? "bg-emerald-500/20 text-emerald-400" :
                  currentUser?.tier === "PLATINUM" ? "bg-gray-500/20 text-gray-400" :
                    "bg-yellow-500/20 text-yellow-400"}`}>{currentUser?.tier}</span>
              </div>
              <div className="hidden md:block text-white text-center text-sm w-24">{currentUser?.mindshare ? (currentUser.mindshare * 100).toFixed(1) : '0.0'}%</div>
              <div className="hidden md:block text-white text-center text-sm w-24">{currentUser?.activeReferrals?.toLocaleString() || '0'}</div>
              <div className="text-white text-right md:text-center text-sm font-medium w-20">{currentUser?.totalPoints?.toLocaleString() || '0'}</div>
              <div className="hidden md:block text-white text-center text-sm w-28">
                {currentUser?.totalDailyRewards === 'TBD' ? 'TBD' : 
                 currentUser?.totalDailyRewards ? formatRoastValue(Number(currentUser.totalDailyRewards)) : '0'}
              </div>
            </div>
          )}

          {users.map((user, index) => (
            <div
              key={user.rank}
              className={`flex items-center justify-between w-full hover:bg-white/5 ${index === users.length - 1 ? "" : ""}`}
              style={{
                height: "60px",
                paddingTop: "10px",
                paddingRight: "24px",
                paddingBottom: "10px",
                paddingLeft: "24px"
              }}
            >
              <div className="text-white md:text-center text-sm font-medium w-6">{user.rank}</div>
              <div className="flex items-center gap-3 w-40 min-w-0">
                <UserAvatar user={user} size="sm" />
                <span className="text-white text-sm truncate" title={user.twitterHandle || user.name}>@{user.twitterHandle || user.name}</span>
              </div>
              <div className="hidden md:block w-20 text-center">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.tier === "EMERALD" ? "bg-emerald-500/20 text-emerald-400" :
                    user.tier === "PLATINUM" ? "bg-gray-500/20 text-gray-400" :
                      "bg-yellow-500/20 text-yellow-400"
                  }`}>
                  {user.tier}
                </span>
              </div>
              <div className="hidden md:block text-white text-center text-sm w-24">{(user.mindshare * 100).toFixed(1)}%</div>
              <div className="hidden md:block text-white text-center text-sm w-24">{user.activeReferrals.toLocaleString()}</div>
              <div className="text-white text-right md:text-center text-sm font-medium w-20">{user.totalPoints.toLocaleString()}</div>
              <div className="hidden md:block text-white text-center text-sm w-28">
                {user.totalDailyRewards === 'TBD' ? 'TBD' : 
                 user.totalDailyRewards ? formatRoastValue(Number(user.totalDailyRewards)) : '0'}
              </div>
            </div>
          ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Rewards({ currentUserWallet }: { currentUserWallet?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Initialize activeTab based on URL parameter
  const getInitialTab = (): "yapping-rewards" | "mining-rewards" | "yapping-leaderboard" | "mining-leaderboard" => {
    const tabParam = searchParams?.get('tab');
    if (tabParam === 'mining-rewards') return 'mining-rewards';
    if (tabParam === 'yapping-leaderboard') return 'yapping-leaderboard';
    if (tabParam === 'mining-leaderboard') return 'mining-leaderboard';
    return 'yapping-rewards';
  };
  
  const [activeTab, setActiveTab] = useState<"yapping-rewards" | "mining-rewards" | "yapping-leaderboard" | "mining-leaderboard">(getInitialTab());
  const [activeTimePeriod, setActiveTimePeriod] = useState<"now" | "7d" | "1m">("now");
  const [leaderboardUsers, setLeaderboardUsers] = useState<LeaderboardUser[]>([]);
  const [topThreeUsers, setTopThreeUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [userStats, setUserStats] = useState<any>(null);
  
  // Mixpanel tracking
  const mixpanel = useMixpanel();
  const { getTimeSpentSeconds } = useTimeTracking();
  const tabStartTime = useRef<number>(Date.now());

  // Fetch leaderboard data function
  const fetchLeaderboardData = async () => {
    try {
      setLoading(true);
      const [leaderboard, topThree] = await Promise.all([
        rewardsApi.getLeaderboard(activeTimePeriod, 50, 1),
        rewardsApi.getTopThree(activeTimePeriod)
      ]);
      
      // Mark current user in leaderboard data
      const updatedLeaderboardUsers = leaderboard.users.map(user => ({
        ...user,
        isCurrentUser: Boolean(currentUserWallet && user.walletAddress.toLowerCase() === currentUserWallet.toLowerCase())
      }));
      
      const updatedTopThree = topThree.map(user => ({
        ...user,
        isCurrentUser: Boolean(currentUserWallet && user.walletAddress.toLowerCase() === currentUserWallet.toLowerCase())
      }));
      
      setLeaderboardUsers(updatedLeaderboardUsers);
      setTopThreeUsers(updatedTopThree);

      // Track leaderboard view
      const currentUser = updatedLeaderboardUsers.find(user => user.isCurrentUser);
      if (currentUser) {
        mixpanel.leaderboardViewed({
          timePeriod: activeTimePeriod,
          userRank: currentUser.rank,
          totalUsers: leaderboard.pagination.total,
          userInTopThree: currentUser.rank <= 3,
          screenName: 'Rewards',
          timeSpent: getTimeSpentSeconds()
        });
      }
    } catch (error) {
      console.error('Error fetching leaderboard data:', error);
      // Set empty arrays on error - no dummy data
      setLeaderboardUsers([]);
      setTopThreeUsers([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch user stats on mount
  useEffect(() => {
    const fetchUserStats = async () => {
      if (!currentUserWallet) return;
      
      try {
        const stats = await rewardsApi.getUserStats(currentUserWallet);
        setUserStats(stats);
      } catch (error) {
        console.error('Error fetching user stats:', error);
      }
    };
    
    fetchUserStats();
  }, [currentUserWallet]);

  // Handle URL parameter changes for tab switching
  useEffect(() => {
    const tabParam = searchParams?.get('tab');
    if (tabParam === 'mining-rewards' && activeTab !== 'mining-rewards') {
      setActiveTab('mining-rewards');
    } else if (tabParam === 'yapping-leaderboard' && activeTab !== 'yapping-leaderboard') {
      setActiveTab('yapping-leaderboard');
    } else if (tabParam === 'mining-leaderboard' && activeTab !== 'mining-leaderboard') {
      setActiveTab('mining-leaderboard');
    } else if (tabParam === 'yapping-rewards' && activeTab !== 'yapping-rewards') {
      setActiveTab('yapping-rewards');
    } else if (!tabParam && activeTab !== 'yapping-rewards') {
      // Default to yapping-rewards if no tab param
      setActiveTab('yapping-rewards');
    }
  }, [searchParams, activeTab]);

  // Track page view on mount and when user stats are loaded
  useEffect(() => {
    if (userStats) {
      mixpanel.rewardsPageViewed({
        screenName: 'Rewards',
        activeTab: activeTab,
        userTier: userStats.currentTier,
        totalPoints: userStats.totalPoints,
        totalRoastEarned: userStats.totalRoastEarned,
        totalReferrals: userStats.totalReferrals,
        timeSpent: getTimeSpentSeconds(),
        season: 'season2'
      });
    }
  }, [userStats, activeTab, mixpanel, getTimeSpentSeconds]);

  // Fetch leaderboard data when tab or time period changes
  useEffect(() => {
    if (activeTab === "yapping-leaderboard" || activeTab === "mining-leaderboard") {
      fetchLeaderboardData();
    }
  }, [activeTab, activeTimePeriod]); // Removed fetchLeaderboardData to prevent infinite loop

  // Handle tab change with tracking
  const handleTabChange = (newTab: "yapping-rewards" | "mining-rewards" | "yapping-leaderboard" | "mining-leaderboard") => {
    if (newTab === activeTab) return;
    
    // Track time spent on previous tab
    const timeSpentOnPrevious = Date.now() - tabStartTime.current;
    
    mixpanel.rewardsTabClicked({
      tabName: newTab,
      previousTab: activeTab,
      timeSpentOnPreviousTab: Math.floor(timeSpentOnPrevious / 1000),
      screenName: 'Rewards',
      season: 'season2'
    });
    
    // Update URL parameter to match the new tab
    const newUrl = `/rewards?tab=${newTab}`;
    router.push(newUrl, { scroll: false });
    
    setActiveTab(newTab);
    tabStartTime.current = Date.now();
  };

  // Handle time period change with tracking
  const handleTimePeriodChange = (newPeriod: "now" | "7d" | "1m") => {
    if (newPeriod === activeTimePeriod) return;
    
    const currentUser = leaderboardUsers.find(user => user.isCurrentUser);
    const previousRank = currentUser?.rank || 0;
    
    const previousPeriod = activeTimePeriod;
    setActiveTimePeriod(newPeriod);
    
    // Track after the data is fetched (this will happen in the useEffect)
    setTimeout(() => {
      const updatedUser = leaderboardUsers.find(user => user.isCurrentUser);
      const newRank = updatedUser?.rank || 0;
      
      mixpanel.leaderboardTimePeriodChanged({
        newTimePeriod: newPeriod,
        previousTimePeriod: previousPeriod,
        userRankChange: newRank - previousRank,
        screenName: 'Rewards'
      });
    }, 1000);
  };

  return (
    <section className="space-y-6 md:space-y-8 overflow-x-visible px-0 md:px-0 w-full max-w-[100vw]">
      {/* Header Section */}
      <div
        className="text-white w-full px-4 lg:px-0"
        style={{
          height: "52px",
          gap: "8px"
        }}
      >
        <h1 className="text-xl md:text-3xl font-bold text-white mb-2">BURNIE YAPPING REWARDS</h1>
        <p className="text-white/70 text-sm">Invite friends • Buy content • Yap</p>
      </div>

      {/* Tabs Section */}
      <div className="relative w-full px-4 lg:px-1">
        {/* Tabs Container - Expanded for 4 tabs */}
        <div
          className="flex gap-1 md:gap-2 justify-start items-center w-full max-w-[calc(100vw-1rem)] md:max-w-3xl mx-auto md:mx-0"
          style={{
            borderRadius: "32px",
            padding: "4px",
            background: "rgba(255,255,255,0.1)",
            backdropFilter: "blur(10px)"
          }}
        >
          <button
            onClick={() => handleTabChange("yapping-rewards")}
            className={`px-2 md:px-3 py-2 rounded-3xl w-full text-[9px] sm:text-xs md:text-sm font-medium transition-all duration-200 sm:whitespace-nowrap leading-tight ${activeTab === "yapping-rewards"
                ? "bg-white text-black shadow-lg"
                : "text-white/70 hover:text-white"
              }`}
          >
            Yapping Rewards
          </button>
          <button
            onClick={() => handleTabChange("mining-rewards")}
            className={`px-2 md:px-3 py-2 rounded-3xl w-full text-[9px] sm:text-xs md:text-sm font-medium transition-all duration-200 sm:whitespace-nowrap leading-tight ${activeTab === "mining-rewards"
                ? "bg-white text-black shadow-lg"
                : "text-white/70 hover:text-white"
              }`}
          >
            Mining Rewards
          </button>
          <button
            onClick={() => handleTabChange("yapping-leaderboard")}
            className={`px-2 md:px-3 py-2 rounded-3xl w-full text-[9px] sm:text-xs md:text-sm font-medium transition-all duration-200 sm:whitespace-nowrap leading-tight ${activeTab === "yapping-leaderboard"
                ? "bg-white text-black shadow-lg"
                : "text-white/70 hover:text-white"
              }`}
          >
            Yapping Leaderboard
          </button>
          <button
            onClick={() => handleTabChange("mining-leaderboard")}
            className={`px-2 md:px-3 py-2 rounded-3xl w-full text-[9px] sm:text-xs md:text-sm font-medium transition-all duration-200 sm:whitespace-nowrap leading-tight ${activeTab === "mining-leaderboard"
                ? "bg-white text-black shadow-lg"
                : "text-white/70 hover:text-white"
              }`}
          >
            Mining Leaderboard
          </button>
        </div>
      </div>

      {/* Time Period Selector - Only show on leaderboard tabs */}
      {(activeTab === "yapping-leaderboard" || activeTab === "mining-leaderboard") && (
        <div className="flex justify-center md:justify-end">
          <div
            className="flex gap-1 items-center"
            style={{
              borderRadius: "8px",
              padding: "4px",
              background: "#4a2323",
              backdropFilter: "blur(10px)"
            }}
          >
            <button
              onClick={() => handleTimePeriodChange("now")}
              className={`flex items-center gap-2 px-3 py-2 rounded-xs text-sm font-medium transition-all duration-200 ${
                activeTimePeriod === "now"
                  ? "bg-[#220808] text-white shadow-lg"
                  : "text-white/70 hover:text-white"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/>
              </svg>
              Now
            </button>
            <button
              onClick={() => handleTimePeriodChange("7d")}
              className={`px-3 py-2 rounded-xs text-sm font-medium transition-all duration-200 ${
                activeTimePeriod === "7d"
                  ? "bg-[#220808] text-white shadow-lg"
                  : "text-white/70 hover:text-white"
              }`}
            >
              7D
            </button>
            <button
              onClick={() => handleTimePeriodChange("1m")}
              className={`px-3 py-2 rounded-xs text-sm font-medium transition-all duration-200 ${
                activeTimePeriod === "1m"
                  ? "bg-[#220808] text-white shadow-lg"
                  : "text-white/70 hover:text-white"
              }`}
            >
              1M
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {activeTab === "yapping-leaderboard" && (
        <div className="space-y-20">

          {/* Top 3 Podium */}
          <div className="flex justify-center mt-20">
            <Podium topThreeUsers={topThreeUsers} loading={loading} />
          </div>

          {/* Leaderboard Table */}
          <div className="flex justify-center">
            <LeaderboardTable leaderboardUsers={leaderboardUsers} loading={loading} activeTimePeriod={activeTimePeriod} />
          </div>
        </div>
      )}

      {activeTab === "yapping-rewards" && (
        <div className="space-y-4">
          <div className="w-full md:max-w-none">
            <RewardsPanel currentUserWallet={currentUserWallet} />
          </div>
        </div>
      )}

      {activeTab === "mining-rewards" && (
        <div className="space-y-4">
          <div className="w-full md:max-w-none">
            <MiningRewardsPanel currentUserWallet={currentUserWallet} />
          </div>
        </div>
      )}

      {activeTab === "mining-leaderboard" && (
        <div className="space-y-20">

          {/* Top 3 Podium */}
          <div className="flex justify-center mt-20">
            <Podium topThreeUsers={[]} loading={loading} />
          </div>

          {/* Mining Leaderboard Table */}
          <div className="flex justify-center">
            <MiningLeaderboardTable leaderboardUsers={[]} loading={loading} />
          </div>
        </div>
      )}
    </section>
  );
}


