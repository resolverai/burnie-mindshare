'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  CurrencyDollarIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  EyeIcon,
  ChartBarIcon,
  BanknotesIcon,
  WalletIcon
} from '@heroicons/react/24/outline'

interface TokenHolding {
  symbol: string
  name: string
  balance: number
  usdValue: number
  change24h: number
  allocation: number
  icon: string
}

interface Transaction {
  id: number
  type: 'bid' | 'reward' | 'deposit' | 'withdrawal'
  token: string
  amount: number
  usdValue: number
  status: 'completed' | 'pending' | 'failed'
  timestamp: string
  description: string
}

export default function YapperPortfolio() {
  const [selectedTimeframe, setSelectedTimeframe] = useState<'24h' | '7d' | '30d' | '1y'>('7d')

  // Mock portfolio data - in real implementation, fetch from wallet/API
  const mockHoldings: TokenHolding[] = [
    {
      symbol: 'ROAST',
      name: 'Roast Token',
      balance: 1247.35,
      usdValue: 3119.87,
      change24h: 12.5,
      allocation: 78.5,
      icon: '🔥'
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      balance: 856.42,
      usdValue: 856.42,
      change24h: 0.02,
      allocation: 21.5,
      icon: '💵'
    }
  ]

  const mockTransactions: Transaction[] = [
    {
      id: 1,
      type: 'reward',
      token: 'ROAST',
      amount: 45.5,
      usdValue: 113.75,
      status: 'completed',
      timestamp: '2024-01-15T10:30:00Z',
      description: 'Successful bid reward - AIXBT Campaign'
    },
    {
      id: 2,
      type: 'bid',
      token: 'ROAST',
      amount: -32.0,
      usdValue: -80.00,
      status: 'completed',
      timestamp: '2024-01-14T15:45:00Z',
      description: 'Bid placed on DeFi Protocol content'
    },
    {
      id: 3,
      type: 'reward',
      token: 'USDC',
      amount: 28.5,
      usdValue: 28.5,
      status: 'completed',
      timestamp: '2024-01-13T09:20:00Z',
      description: 'Content amplification reward'
    },
    {
      id: 4,
      type: 'deposit',
      token: 'USDC',
      amount: 500.0,
      usdValue: 500.0,
      status: 'completed',
      timestamp: '2024-01-10T16:00:00Z',
      description: 'Wallet deposit'
    }
  ]

  const totalValue = mockHoldings.reduce((sum, holding) => sum + holding.usdValue, 0)
  const totalChange24h = mockHoldings.reduce((sum, holding) => sum + (holding.usdValue * holding.change24h / 100), 0)
  const totalChangePercent = (totalChange24h / (totalValue - totalChange24h)) * 100

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'reward':
        return <ArrowDownIcon className="h-4 w-4 text-green-500" />
      case 'bid':
        return <ArrowUpIcon className="h-4 w-4 text-red-500" />
      case 'deposit':
        return <ArrowDownIcon className="h-4 w-4 text-blue-500" />
      case 'withdrawal':
        return <ArrowUpIcon className="h-4 w-4 text-orange-500" />
      default:
        return <CurrencyDollarIcon className="h-4 w-4 text-gray-500" />
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="bg-gray-50 h-screen overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Portfolio</h1>
            <p className="text-gray-600">Track your token holdings and transactions</p>
          </div>
          <div className="flex space-x-2">
            {['24h', '7d', '30d', '1y'].map((timeframe) => (
              <button
                key={timeframe}
                onClick={() => setSelectedTimeframe(timeframe as any)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedTimeframe === timeframe
                    ? 'bg-orange-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {timeframe}
              </button>
            ))}
          </div>
        </div>

        {/* Portfolio Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Portfolio Value</p>
                <p className="text-2xl font-bold text-gray-900">
                  ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <div className="flex items-center mt-1">
                  {totalChangePercent >= 0 ? (
                    <ArrowTrendingUpIcon className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <ArrowTrendingDownIcon className="h-4 w-4 text-red-500 mr-1" />
                  )}
                  <span className={`text-sm ${totalChangePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {totalChangePercent >= 0 ? '+' : ''}{totalChangePercent.toFixed(2)}% (24h)
                  </span>
                </div>
              </div>
              <WalletIcon className="h-8 w-8 text-orange-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Earnings</p>
                <p className="text-2xl font-bold text-gray-900">2,847 ROAST</p>
                <div className="flex items-center mt-1">
                  <ArrowTrendingUpIcon className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+18.7% this month</span>
                </div>
              </div>
              <BanknotesIcon className="h-8 w-8 text-green-500" />
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Success Rate</p>
                <p className="text-2xl font-bold text-gray-900">70.1%</p>
                <div className="flex items-center mt-1">
                  <ArrowTrendingUpIcon className="h-4 w-4 text-green-500 mr-1" />
                  <span className="text-sm text-green-600">+3.2% vs last month</span>
                </div>
              </div>
              <ChartBarIcon className="h-8 w-8 text-blue-500" />
            </div>
          </div>
        </div>

        {/* Holdings and Allocation */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Token Holdings */}
          <div className="lg:col-span-2">
            <div className="card">
              <div className="card-header">
                <h3 className="text-lg font-semibold text-gray-900">Token Holdings</h3>
                <p className="text-sm text-gray-500">Your current token balances</p>
              </div>
              <div className="card-content space-y-4">
                {mockHoldings.map((holding) => (
                  <div key={holding.symbol} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div className="text-2xl">{holding.icon}</div>
                      <div>
                        <div className="font-medium text-gray-900">{holding.name}</div>
                        <div className="text-sm text-gray-500">{holding.symbol}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-900">
                        {holding.balance.toLocaleString('en-US', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })} {holding.symbol}
                      </div>
                      <div className="text-sm text-gray-500">
                        ${holding.usdValue.toLocaleString('en-US', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </div>
                      <div className={`text-sm flex items-center ${
                        holding.change24h >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {holding.change24h >= 0 ? (
                          <ArrowTrendingUpIcon className="h-3 w-3 mr-1" />
                        ) : (
                          <ArrowTrendingDownIcon className="h-3 w-3 mr-1" />
                        )}
                        {holding.change24h >= 0 ? '+' : ''}{holding.change24h.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Portfolio Allocation */}
          <div>
            <div className="card">
              <div className="card-header">
                <h3 className="text-lg font-semibold text-gray-900">Allocation</h3>
                <p className="text-sm text-gray-500">Portfolio distribution</p>
              </div>
              <div className="card-content space-y-6">
                {/* Pie Chart Representation */}
                <div className="relative w-32 h-32 mx-auto">
                  <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="20"
                      strokeDasharray={`${mockHoldings[0].allocation * 2.51327} ${(100 - mockHoldings[0].allocation) * 2.51327}`}
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="20"
                      strokeDasharray={`${mockHoldings[1].allocation * 2.51327} ${(100 - mockHoldings[1].allocation) * 2.51327}`}
                      strokeDashoffset={`${-mockHoldings[0].allocation * 2.51327}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-900">100%</div>
                    </div>
                  </div>
                </div>

                {/* Legend */}
                <div className="space-y-3">
                  {mockHoldings.map((holding, index) => (
                    <div key={holding.symbol} className="flex items-center space-x-3">
                      <div 
                        className={`w-3 h-3 rounded-full ${
                          index === 0 ? 'bg-orange-500' : 'bg-blue-500'
                        }`}
                      ></div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{holding.symbol}</div>
                        <div className="text-xs text-gray-500">{holding.allocation}%</div>
                      </div>
                      <div className="text-sm font-medium text-gray-900">
                        ${holding.usdValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transaction History */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-semibold text-gray-900">Recent Transactions</h3>
            <p className="text-sm text-gray-500">Your latest portfolio activity</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transaction</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Token</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">USD Value</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {mockTransactions.map((transaction) => (
                  <tr key={transaction.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        {getTransactionIcon(transaction.type)}
                        <div>
                          <div className="font-medium text-gray-900 capitalize">{transaction.type}</div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">{transaction.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="status-indicator status-active">{transaction.token}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-medium ${
                        transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {transaction.amount >= 0 ? '+' : ''}{transaction.amount.toLocaleString('en-US', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-medium ${
                        transaction.usdValue >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {transaction.usdValue >= 0 ? '+' : ''}${Math.abs(transaction.usdValue).toLocaleString('en-US', { 
                          minimumFractionDigits: 2, 
                          maximumFractionDigits: 2 
                        })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(transaction.timestamp)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`status-indicator ${
                        transaction.status === 'completed' ? 'status-completed' :
                        transaction.status === 'pending' ? 'status-pending' :
                        'status-indicator bg-red-100 text-red-800'
                      }`}>
                        {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
} 