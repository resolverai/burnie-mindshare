import { 
  CurrencyDollarIcon, SparklesIcon
} from '@heroicons/react/24/outline'
import { 
  TrophyIcon as TrophyIconSolid
} from '@heroicons/react/24/solid'

const mockPortfolioData = [
  { project: 'AIXBT', symbol: 'AIXBT', amount: 1250, value: 2847.50, change: 12.5, logo: '🤖' },
  { project: 'VADER', symbol: 'VADER', amount: 950, value: 1824.30, change: -3.2, logo: '⚡' },
  { project: 'BASE', symbol: 'BASE', amount: 780, value: 1456.80, change: 8.1, logo: '🔵' },
  { project: 'ROAST', symbol: 'ROAST', amount: 3250, value: 2180.25, change: 5.4, logo: '🔥' }
]

export default function Portfolio() {
  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8"
      style={{ height: '100vh', overflow: 'hidden' }}
    >
      <div 
        className="max-w-6xl mx-auto"
        style={{
          height: '100%',
          overflowY: 'auto',
          paddingRight: '16px',
          // Hide scrollbar for webkit browsers
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE and Edge
        }}
      >
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white">Token Portfolio</h2>
          <p className="text-gray-400 mt-2">Track your token earnings and performance</p>
        </div>
        
        {/* Portfolio Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-8">
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg text-gray-400 uppercase tracking-wide">Total Value</span>
              <CurrencyDollarIcon className="h-6 w-6 text-green-400" />
            </div>
            <div className="text-4xl font-bold text-white mb-2">
              ${mockPortfolioData.reduce((sum, item) => sum + item.value, 0).toFixed(2)}
            </div>
            <div className="text-lg text-green-400">+7.8% this week</div>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-8">
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg text-gray-400 uppercase tracking-wide">Total Tokens</span>
              <SparklesIcon className="h-6 w-6 text-blue-400" />
            </div>
            <div className="text-4xl font-bold text-white mb-2">
              {mockPortfolioData.reduce((sum, item) => sum + item.amount, 0).toLocaleString()}
            </div>
            <div className="text-lg text-blue-400">4 different projects</div>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-8">
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg text-gray-400 uppercase tracking-wide">Best Performer</span>
              <TrophyIconSolid className="h-6 w-6 text-yellow-400" />
            </div>
            <div className="text-4xl font-bold text-white mb-2">AIXBT</div>
            <div className="text-lg text-green-400">+12.5% this week</div>
          </div>
        </div>

        {/* Holdings */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-8">
          <h3 className="text-2xl font-semibold text-white mb-8">Token Holdings</h3>
          <div className="space-y-6">
            {mockPortfolioData.map((holding) => (
              <div key={holding.symbol} className="flex items-center justify-between p-6 bg-gray-700/30 rounded-xl">
                <div className="flex items-center space-x-6">
                  <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center text-3xl">
                    {holding.logo}
                  </div>
                  <div>
                    <div className="text-xl font-semibold text-white">{holding.project}</div>
                    <div className="text-lg text-gray-400">{holding.symbol}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold text-white">{holding.amount.toLocaleString()}</div>
                  <div className="text-lg text-gray-400">${holding.value.toFixed(2)}</div>
                </div>
                <div className="text-right">
                  <div className={`text-xl font-medium ${holding.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {holding.change >= 0 ? '+' : ''}{holding.change.toFixed(1)}%
                  </div>
                  <div className="text-lg text-gray-400">7d change</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
} 