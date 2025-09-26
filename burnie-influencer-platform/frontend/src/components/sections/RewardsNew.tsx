"use client";

import React, { useState, useEffect } from "react";
import RewardsPanel from "@/components/sections/RewardsPanel";

// Types for API data
interface LeaderboardUser {
  rank: number;
  walletAddress: string;
  twitterHandle?: string;
  name?: string;
  tier: string;
  mindshare: number;
  totalReferrals: number;
  totalPoints: number;
  profileImageUrl?: string;
  isCurrentUser?: boolean;
}

interface LeaderboardResponse {
  users: LeaderboardUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

// Helper function to get avatar from name or Twitter handle
const getAvatarLetter = (name?: string, twitterHandle?: string): string => {
  if (name && name !== 'null') {
    return name.charAt(0).toUpperCase();
  }
  if (twitterHandle && twitterHandle !== 'null') {
    return twitterHandle.charAt(1).toUpperCase(); // Skip @ symbol
  }
  return 'U';
};

// Helper function to format wallet address
const formatWalletAddress = (address: string): string => {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// Podium component
function Podium({ topThree }: { topThree: LeaderboardUser[] }) {
  return (
    <div className="flex items-end justify-center space-x-8 py-8 mt-20 md:py-12 md:mt-20">
      {/* Second Place */}
      {topThree[1] && (
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-lg md:text-xl -translate-y-28 md:-translate-y-40">
            {getAvatarLetter(topThree[1].name, topThree[1].twitterHandle)}
          </div>
          <div className="bg-gradient-to-b from-orange-400 to-orange-600 w-16 h-20 md:w-20 md:h-32 rounded-t-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg md:text-xl">2</span>
          </div>
        </div>
      )}

      {/* First Place */}
      {topThree[0] && (
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-yellow-500 flex items-center justify-center text-white font-bold text-xl md:text-2xl -translate-y-32 md:-translate-y-52">
            {getAvatarLetter(topThree[0].name, topThree[0].twitterHandle)}
          </div>
          <div className="bg-gradient-to-b from-yellow-400 to-yellow-600 w-20 h-28 md:w-24 md:h-40 rounded-t-lg flex items-center justify-center">
            <span className="text-white font-bold text-xl md:text-2xl">1</span>
          </div>
        </div>
      )}

      {/* Third Place */}
      {topThree[2] && (
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-lg md:text-xl -translate-y-28 md:-translate-y-40">
            {getAvatarLetter(topThree[2].name, topThree[2].twitterHandle)}
          </div>
          <div className="bg-gradient-to-b from-orange-400 to-orange-600 w-16 h-16 md:w-20 md:h-24 rounded-t-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg md:text-xl">3</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Rewards() {
  const [activeTab, setActiveTab] = useState<"rewards" | "leaderboard">("rewards");
  const [activeTimePeriod, setActiveTimePeriod] = useState<"now" | "7d" | "1m">("now");
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardUser[]>([]);
  const [topThreeData, setTopThreeData] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch leaderboard data
  const fetchLeaderboardData = async (period: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const [leaderboardResponse, topThreeResponse] = await Promise.all([
        fetch(`http://localhost:3001/api/rewards/leaderboard?period=${period}`),
        fetch(`http://localhost:3001/api/rewards/leaderboard/top-three?period=${period}`)
      ]);

      if (!leaderboardResponse.ok || !topThreeResponse.ok) {
        throw new Error('Failed to fetch leaderboard data');
      }

      const leaderboardResult: LeaderboardResponse = await leaderboardResponse.json();
      const topThreeResult: LeaderboardUser[] = await topThreeResponse.json();

      setLeaderboardData(leaderboardResult.users);
      setTopThreeData(topThreeResult);
    } catch (error) {
      console.error('Error fetching leaderboard data:', error);
      setError('Failed to load leaderboard data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch data when tab or time period changes
  useEffect(() => {
    if (activeTab === "leaderboard") {
      fetchLeaderboardData(activeTimePeriod);
    }
  }, [activeTab, activeTimePeriod]);

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
      {activeTab === "rewards" && (
        <RewardsPanel />
      )}

      {activeTab === "leaderboard" && (
        <div className="space-y-16">
          {loading && (
            <div className="flex justify-center items-center py-8">
              <div className="text-white">Loading leaderboard...</div>
            </div>
          )}

          {error && (
            <div className="flex justify-center items-center py-8">
              <div className="text-red-400">{error}</div>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Top 3 Podium */}
              <div className="flex justify-center mt-20">
                <Podium topThree={topThreeData} />
              </div>

              {/* Leaderboard Table */}
              <div className="flex justify-center">
                <div className="w-full max-w-4xl mx-auto px-4 overflow-x-hidden max-w-[calc(100vw-1rem)] lg:max-w-none lg:px-1">
                  <div className="bg-[#1a0808]/80 backdrop-blur-sm rounded-2xl overflow-hidden">
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
                      <div className="text-white text-center text-sm font-medium w-6">Rank</div>
                      <div className="text-white text-center text-sm font-medium w-40 md:w-48">Name</div>
                      <div className="hidden md:block text-white text-center text-sm font-medium w-36">Wallet</div>
                      <div className="hidden md:block text-white text-center text-sm font-medium w-20">Tier</div>
                      <div className="hidden md:block text-white text-center text-sm font-medium w-24">Mindshare</div>
                      <div className="hidden md:block text-white text-center text-sm font-medium w-24">Referrals</div>
                      <div className="text-white text-center text-sm font-medium w-20">Points</div>
                    </div>

                    {/* Leaderboard Data */}
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
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                              user.tier === "Emerald" ? "bg-emerald-500" :
                              user.tier === "Platinum" ? "bg-gray-500" :
                              user.tier === "Gold" ? "bg-yellow-500" :
                              user.tier === "Silver" ? "bg-gray-400" :
                              user.tier === "Diamond" ? "bg-blue-500" :
                              "bg-purple-500"
                            }`}
                          >
                            {getAvatarLetter(user.name, user.twitterHandle)}
                          </div>
                          <span className="text-white text-sm truncate" title={user.twitterHandle || user.name}>
                            {user.twitterHandle ? `@${user.twitterHandle}` : (user.name || 'Anonymous')}
                          </span>
                        </div>
                        <div className="hidden md:block text-white/70 text-center text-sm font-mono w-36">
                          {formatWalletAddress(user.walletAddress)}
                        </div>
                        <div className="hidden md:block w-20 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            user.tier === "Emerald" ? "bg-emerald-500/20 text-emerald-400" :
                            user.tier === "Platinum" ? "bg-gray-500/20 text-gray-400" :
                            user.tier === "Gold" ? "bg-yellow-500/20 text-yellow-400" :
                            user.tier === "Silver" ? "bg-gray-400/20 text-gray-300" :
                            user.tier === "Diamond" ? "bg-blue-500/20 text-blue-400" :
                            "bg-purple-500/20 text-purple-400"
                          }`}>
                            {user.tier}
                          </span>
                        </div>
                        <div className="hidden md:block text-white text-center text-sm w-24">
                          {(user.mindshare * 100).toFixed(1)}%
                        </div>
                        <div className="hidden md:block text-white text-center text-sm w-24">
                          {user.totalReferrals.toLocaleString()}
                        </div>
                        <div className="text-white text-right md:text-center text-sm font-medium w-20">
                          {user.totalPoints.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
