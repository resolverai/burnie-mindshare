"use client";

import React, { useState, useEffect } from "react";
import RewardsPanel from "@/components/sections/RewardsPanel";

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

// 3D Podium with SVG and user images
function Podium() {
  const top3 = leaderboardData.slice(0, 3);

  // Sample user data for the top 3
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
      {/* 3D Podium SVG */}
      <div className="relative w-full max-w-[750px] px-3 md:px-0 flex justify-center">
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

        {/* User Images Overlay */}
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
                <div className="relative w-10 h-10 md:w-16 md:h-16 rounded-full overflow-hidden border-2 border-white shadow-inner z-10 translate-y-1 md:translate-y-2">
                  <img
                    src={podiumUsers[0].avatar}
                    alt={podiumUsers[0].name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-white text-xs md:text-base font-bold mb-1">{podiumUsers[0].name}</div>
              <div className="bg-white text-black text-[8px] md:text-sm font-semibold px-3 py-1 rounded-full inline-block shadow-lg">
                {podiumUsers[0].points.toLocaleString()} points
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
                <div className="relative w-10 h-10 md:w-14 md:h-14 rounded-full overflow-hidden border-2 border-white shadow-inner z-10 translate-y-1 md:translate-y-2">
                  <img
                    src={podiumUsers[1].avatar}
                    alt={podiumUsers[1].name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-white text-xs md:text-sm font-bold mb-1">{podiumUsers[1].name}</div>
              <div className="bg-white text-black text-[8px] md:text-xs font-semibold px-2 py-1 rounded-full inline-block shadow-lg">
                {podiumUsers[1].points.toLocaleString()} points
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
                <div className="relative w-10 h-10 md:w-14 md:h-14 rounded-full overflow-hidden border-2 border-white shadow-inner z-10 translate-y-1 md:translate-y-2">
                  <img
                    src={podiumUsers[2].avatar}
                    alt={podiumUsers[2].name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-white text-xs md:text-sm font-bold mb-1">{podiumUsers[2].name}</div>
              <div className="bg-white text-black text-[8px] md:text-xs font-semibold px-2 py-1 rounded-full inline-block shadow-lg">
                {podiumUsers[2].points.toLocaleString()} points
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

// Leaderboard table component
function LeaderboardTable() {
  const currentUser = currentUserData;
  const shouldShowPinned = !!currentUser; // always pin current user row

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
          <div className="text-left md:text-center text-white text-sm font-medium w-6">#</div>
          <div className="text-left text-white text-sm font-medium md:text-center md:w-48">TWITTER HANDLE</div>
          <div className="hidden md:block text-center text-white text-sm font-medium w-36">WALLET ADDRESS</div>
          <div className="hidden md:block text-center text-white text-sm font-medium w-20">TIER</div>
          <div className="hidden md:block text-center text-white text-sm font-medium w-24">MINDSHARE%</div>
          <div className="hidden md:block text-center text-white text-sm font-medium w-24">REFERRALS</div>
          <div className="text-right md:text-center text-white text-sm font-medium w-20">POINTS</div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto">
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
              <div className="flex items-center gap-3 w-40 md:w-48 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${currentUser?.avatar === "A" ? "bg-blue-500" :
                    currentUser?.avatar === "J" ? "bg-orange-500" :
                      currentUser?.avatar === "D" ? "bg-red-500" :
                        currentUser?.avatar === "K" ? "bg-blue-400" :
                          "bg-red-500"
                    }`}
                >
                  {currentUser?.avatar}
                </div>
                <span className="text-white text-sm truncate" title={currentUser?.twitterHandle}>{currentUser?.twitterHandle}</span>
              </div>
              <div className="hidden md:block text-white/70 text-center text-sm font-mono w-36">{currentUser?.walletAddress}</div>
              <div className="hidden md:block w-20 text-center">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${currentUser?.tier === "Emerald" ? "bg-emerald-500/20 text-emerald-400" :
                  currentUser?.tier === "Platinum" ? "bg-gray-500/20 text-gray-400" :
                    "bg-yellow-500/20 text-yellow-400"}`}>{currentUser?.tier}</span>
              </div>
              <div className="hidden md:block text-white text-center text-sm w-24">{currentUser?.mindshare}%</div>
              <div className="hidden md:block text-white text-center text-sm w-24">{currentUser?.referrals.toLocaleString()}</div>
              <div className="text-white text-right md:text-center text-sm font-medium w-20">{currentUser?.points.toLocaleString()}</div>
            </div>
          )}

          {leaderboardData.map((user, index) => (
            <div
              key={user.rank}
              className={`flex items-center justify-between w-full hover:bg-white/5 ${index === leaderboardData.length - 1 ? "" : ""}`}
              style={{
                height: "60px",
                paddingTop: "10px",
                paddingRight: "24px",
                paddingBottom: "10px",
                paddingLeft: "24px"
              }}
            >
              <div className="text-white md:text-center text-sm font-medium w-6">{user.rank}</div>
              <div className="flex items-center gap-3 w-40 md:w-48 min-w-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${user.avatar === "A" ? "bg-blue-500" :
                      user.avatar === "J" ? "bg-orange-500" :
                        user.avatar === "D" ? "bg-red-500" :
                          user.avatar === "K" ? "bg-blue-400" :
                            "bg-red-500"
                    }`}
                >
                  {user.avatar}
                </div>
                <span className="text-white text-sm truncate" title={user.twitterHandle}>{user.twitterHandle}</span>
              </div>
              <div className="hidden md:block text-white/70 text-center text-sm font-mono w-36">{user.walletAddress}</div>
              <div className="hidden md:block w-20 text-center">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.tier === "Emerald" ? "bg-emerald-500/20 text-emerald-400" :
                    user.tier === "Platinum" ? "bg-gray-500/20 text-gray-400" :
                      "bg-yellow-500/20 text-yellow-400"
                  }`}>
                  {user.tier}
                </span>
              </div>
              <div className="hidden md:block text-white text-center text-sm w-24">{user.mindshare}%</div>
              <div className="hidden md:block text白 text-center text-sm w-24">{user.referrals.toLocaleString()}</div>
              <div className="text-white text-right md:text-center text-sm font-medium w-20">{user.points.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Rewards() {
  const [activeTab, setActiveTab] = useState<"rewards" | "leaderboard">("rewards");
  const [activeTimePeriod, setActiveTimePeriod] = useState<"now" | "7d" | "1m">("now");

  return (
    <section className="space-y-6 md:space-y-8 overflow-x-hidden px-0 md:px-0 w-full max-w-[100vw]">
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
      <div
        className="flex gap-2 md:gap-3 justify-start items-center w-full max-w-[calc(100vw-1rem)] md:max-w-md mx-auto md:mx-0 px-4 lg:px-1"
        style={{
          borderRadius: "32px",
          padding: "4px",
          background: "rgba(255,255,255,0.1)",
          backdropFilter: "blur(10px)"
        }}
      >
        <button
          onClick={() => setActiveTab("rewards")}
          className={`px-3 md:px-6 py-2 rounded-3xl w-full text-xs md:text-sm font-medium transition-all duration-200 ${activeTab === "rewards"
              ? "bg-white text-black shadow-lg"
              : "text-white/70 hover:text-white"
            }`}
        >
          Rewards
        </button>
        <button
          onClick={() => setActiveTab("leaderboard")}
          className={`px-3 md:px-6 py-2 rounded-3xl w-full text-xs md:text-sm font-medium transition-all duration-200 ${activeTab === "leaderboard"
              ? "bg-white text-black shadow-lg"
              : "text-white/70 hover:text-white"
            }`}
        >
          Leaderboard
        </button>
      </div>

      {/* Time Period Selector - Only show on leaderboard tab */}
      {activeTab === "leaderboard" && (
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
              onClick={() => setActiveTimePeriod("now")}
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
              onClick={() => setActiveTimePeriod("7d")}
              className={`px-3 py-2 rounded-xs text-sm font-medium transition-all duration-200 ${
                activeTimePeriod === "7d"
                  ? "bg-[#220808] text-white shadow-lg"
                  : "text-white/70 hover:text-white"
              }`}
            >
              7D
            </button>
            <button
              onClick={() => setActiveTimePeriod("1m")}
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
      {activeTab === "leaderboard" && (
        <div className="space-y-20">
          {/* Top 3 Podium */}
          <div className="flex justify-center mt-20">
            <Podium />
          </div>

          {/* Leaderboard Table */}
          <div className="flex justify-center">
            <LeaderboardTable />
          </div>
        </div>
      )}

      {activeTab === "rewards" && (
        <div className="space-y-4">
          <div className="w-full md:max-w-none">
            <RewardsPanel />
          </div>
        </div>
      )}
    </section>
  );
}


