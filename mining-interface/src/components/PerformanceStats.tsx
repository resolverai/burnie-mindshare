interface PerformanceStatsProps {
  minerId?: number
}

export function PerformanceStats({ minerId }: PerformanceStatsProps) {
  // Mock performance data - would come from API in real implementation
  const stats = {
    rank: 42,
    weeklyChange: '+15%',
    totalSubmissions: 156,
    successRate: 87.5,
    avgReward: 245,
    streak: 7
  }

  return (
    <div className="gaming-card gaming-card-glow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="neon-text neon-purple text-lg font-bold">PERFORMANCE</h3>
        <div className="text-xs text-gray-400">
          {minerId ? `Miner #${minerId}` : 'Demo Mode'}
        </div>
      </div>
      
      <div className="space-y-4">
        {/* Rank */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Global Rank</span>
          <div className="flex items-center space-x-1">
            <span className="neon-text neon-orange text-lg font-bold">#{stats.rank}</span>
            <span className="text-xs">🏆</span>
          </div>
        </div>

        {/* Weekly Performance */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">This Week</span>
          <span className={`font-bold ${stats.weeklyChange.startsWith('+') ? 'neon-green' : 'neon-red'} neon-text`}>
            {stats.weeklyChange}
          </span>
        </div>

        {/* Success Rate */}
        <div className="flex justify-between items-center">
          <span className="text-gray-400 text-sm">Success Rate</span>
          <span className="neon-text neon-blue font-bold">{stats.successRate}%</span>
        </div>

        {/* Progress Bar */}
        <div className="mt-2">
          <div className="neon-progress h-2">
            <div 
              className="neon-progress-bar h-full" 
              style={{ width: `${stats.successRate}%` }}
            ></div>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-600">
          <div className="text-center">
            <div className="neon-text neon-blue text-lg font-bold">{stats.totalSubmissions}</div>
            <div className="text-xs text-gray-400">Submissions</div>
          </div>
          <div className="text-center">
            <div className="neon-text neon-green text-lg font-bold">{stats.streak}</div>
            <div className="text-xs text-gray-400">Day Streak</div>
          </div>
        </div>
      </div>
    </div>
  )
} 