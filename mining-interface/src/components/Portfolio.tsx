import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { 
  CurrencyDollarIcon, 
  SparklesIcon,
  ClockIcon,
  ChartBarIcon,
  DocumentTextIcon,
  UserIcon,
  ArrowTrendingUpIcon,
  TagIcon,
  CalendarIcon
} from '@heroicons/react/24/outline'
import { 
  TrophyIcon as TrophyIconSolid
} from '@heroicons/react/24/solid'

interface TokenEarning {
  token: string;
  amount: number;
  totalSales: number;
  avgSalePrice: number;
  maxSalePrice: number;
  minSalePrice: number;
  usdValue: number;
  pricePerToken: number;
}

interface PortfolioData {
  portfolio: {
    totalUSDValue: number;
    totalSales: number;
    uniqueTokens: number;
    topToken: {
      token: string;
      usdValue: number;
      changePercent: number;
    } | null;
  };
  earnings: TokenEarning[];
  distribution: Array<{
    token: string;
    percentage: number;
    usdValue: number;
  }>;
  recentTransactions: Array<{
    token: string;
    amount: number;
    usdValue: number;
    date: string;
    contentPreview: string;
    contentText: string;
    agentName: string;
    buyerwallet: string;
  }>;
  contentByToken: Record<string, Array<{
    contentId: number;
    contentText: string;
    agentName: string;
    predictedMindshare: number;
    qualityScore: number;
    saleprice: number;
    saledate: string;
    totalbids: number;
    usdValue: number;
  }>>;
  tokenRates: Record<string, number>;
}

const TOKEN_LOGOS: Record<string, string> = {
  ROAST: '🔥',
  USDC: '💰',
  KAITO: '🤖',
  COOKIE: '🍪',
  AXR: '⚡',
  NYKO: '🎯',
};

const TOKEN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ROAST: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  USDC: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  KAITO: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  COOKIE: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  AXR: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  NYKO: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
};

export default function Portfolio() {
  const { address, isConnected } = useAccount();
  const [showContentModal, setShowContentModal] = useState<any>(null);

  const { data: portfolioData, isLoading, error, refetch } = useQuery<PortfolioData>({
    queryKey: ['portfolio', address],
    queryFn: async () => {
      if (!address) throw new Error('No wallet connected');
      
      const baseUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api';
      const response = await fetch(`${baseUrl}/marketplace/analytics/purchase/miner/portfolio/${address}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch portfolio data');
      }
      
      return response.json();
    },
    enabled: !!address && isConnected,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const formatCurrency = (amount: number | undefined | null, currency?: string) => {
    const safeAmount = amount || 0;
    if (currency && currency !== 'USD') {
      return `${safeAmount.toLocaleString()} ${currency}`;
    }
    return `$${safeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const getTokenStyle = (token: string) => {
    return TOKEN_COLORS[token] || { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' };
  };

  // Content parsing functions similar to bidding interface
  const extractImageUrl = (contentText: string): string | null => {
    const prefixMatch = contentText.match(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i);
    if (prefixMatch) return prefixMatch[1];
    
    const urlMatch = contentText.match(/https?:\/\/[^\s\n<>"'`]+\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s\n<>"'`]*)?/i);
    if (urlMatch) return urlMatch[0];
    
    return null;
  };

  const formatTwitterContent = (contentText: string) => {
    let cleanText = contentText;
    
    // Remove image URL patterns from the text
    cleanText = cleanText.replace(/📸 Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '');
    cleanText = cleanText.replace(/Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '');
    cleanText = cleanText.replace(/https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+/gi, '');
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+/gi, '');
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+/gi, '');
    
    // Remove AWS parameters that might appear on separate lines
    const lines = cleanText.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmedLine = line.trim();
      return trimmedLine && 
             !trimmedLine.startsWith('http') && 
             !trimmedLine.includes('AWSAccessKeyId') &&
             !trimmedLine.includes('Signature=') &&
             !trimmedLine.includes('Expires=');
    });
    cleanText = filteredLines.join('\n');
    
    // Remove content stats and posting instructions
    cleanText = cleanText.replace(/📊 Content Stats:[\s\S]*$/i, '').trim();
    cleanText = cleanText.replace(/💡 To Post on Twitter:[\s\S]*$/i, '').trim();
    
    return { text: cleanText };
  };

  const extractHashtags = (text: string): string[] => {
    const hashtagMatch = text.match(/#[\w]+/g);
    return hashtagMatch || [];
  };

  if (!isConnected || !address) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8 flex items-center justify-center">
        <div className="text-center">
          <UserIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Connect Wallet</h2>
          <p className="text-gray-400">Please connect your wallet to view your portfolio</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading portfolio data...</p>
        </div>
      </div>
    );
  }

  if (error || !portfolioData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white p-8 flex items-center justify-center">
        <div className="text-center">
          <ChartBarIcon className="h-16 w-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Error Loading Portfolio</h2>
          <p className="text-gray-400 mb-4">Failed to load portfolio data</p>
          <button 
            onClick={() => refetch()} 
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-y-auto portfolio-scroll"
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#4B5563 #1F2937'
      }}
    >
      <style jsx global>{`
        .portfolio-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .portfolio-scroll::-webkit-scrollbar-track {
          background: #1F2937;
        }
        .portfolio-scroll::-webkit-scrollbar-thumb {
          background: #4B5563;
          border-radius: 4px;
        }
        .portfolio-scroll::-webkit-scrollbar-thumb:hover {
          background: #6B7280;
        }
      `}</style>
      <div 
        className="max-w-7xl mx-auto p-8 pb-16"
      >
 

        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white">Token Portfolio</h2>
          <p className="text-gray-400 mt-2">Track your token earnings from content purchases</p>
        </div>
        
        {/* Portfolio Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg text-gray-400 uppercase tracking-wide">Total Value</span>
              <CurrencyDollarIcon className="h-6 w-6 text-green-400" />
            </div>
            <div className="text-3xl font-bold text-white mb-2">
              {portfolioData?.earnings?.reduce((total, earning) => total + (earning?.amount || 0), 0).toLocaleString() || 0} Tokens
            </div>
            <div className="text-sm text-green-400">
              {portfolioData?.portfolio?.totalSales || 0} total purchases
            </div>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg text-gray-400 uppercase tracking-wide">Token Types</span>
              <SparklesIcon className="h-6 w-6 text-blue-400" />
            </div>
            <div className="text-3xl font-bold text-white mb-2">
              {portfolioData?.portfolio?.uniqueTokens || 0}
            </div>
            <div className="text-sm text-blue-400">Different currencies</div>
          </div>

          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-lg text-gray-400 uppercase tracking-wide">Top Performer</span>
              <TrophyIconSolid className="h-6 w-6 text-yellow-400" />
            </div>
            <div className="text-3xl font-bold text-white mb-2">
              {portfolioData?.portfolio?.topToken?.token || 'None'}
            </div>
            <div className="text-sm text-green-400">
              {portfolioData?.portfolio?.topToken ? 
                `${portfolioData.earnings.find(e => e.token === portfolioData.portfolio.topToken?.token)?.amount.toLocaleString() || 0} ${portfolioData.portfolio.topToken.token}` : 
                'No earnings yet'
              }
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Token Holdings */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Token Holdings</h3>
              <ChartBarIcon className="h-5 w-5 text-gray-400" />
            </div>
            
            {(portfolioData?.earnings?.length || 0) === 0 ? (
              <div className="text-center py-8">
                <CurrencyDollarIcon className="h-12 w-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">No token earnings yet</p>
                <p className="text-sm text-gray-500 mt-1">Start creating content to earn tokens!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {(portfolioData?.earnings || []).map((earning) => {
                  const style = getTokenStyle(earning.token);
                  return (
                    <div key={earning.token} className={`p-4 rounded-lg border ${style.bg} ${style.border}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center text-lg">
                            {TOKEN_LOGOS[earning?.token] || '🪙'}
                          </div>
                          <div>
                            <div className="font-semibold text-white">{earning?.token || 'Unknown'}</div>
                            <div className="text-sm text-gray-400">
                              {earning.totalSales} purchases
                            </div>
                          </div>
                        </div>
                                                  <div className="text-right">
                          <div className="font-semibold text-white">
                            {earning.amount.toLocaleString()} {earning.token}
                          </div>
                          <div className="text-sm text-gray-400">
                            {earning.totalSales} sales
                          </div>
                        </div>
                      </div>
                                              <div className="mt-3 grid grid-cols-2 gap-4 text-xs text-gray-400">
                         <div>Avg: {earning.avgSalePrice?.toLocaleString() || 0} {earning.token}</div>
                         <div>Max: {earning.maxSalePrice?.toLocaleString() || 0} {earning.token}</div>
                        </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Transactions */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Recent Purchases</h3>
              <ClockIcon className="h-5 w-5 text-gray-400" />
            </div>
            
            {(portfolioData?.recentTransactions?.length || 0) === 0 ? (
              <div className="text-center py-8">
                <DocumentTextIcon className="h-12 w-12 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">No recent transactions</p>
                <p className="text-sm text-gray-500 mt-1">Your purchases will appear here</p>
              </div>
            ) : (
                                <div className="space-y-3 max-h-96 overflow-y-auto">
                 {(portfolioData?.recentTransactions || []).map((tx, index) => {
                   const style = getTokenStyle(tx.token);
                   return (
                     <div 
                       key={index} 
                       className="p-3 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 cursor-pointer transition-colors"
                       onClick={() => setShowContentModal({
                         ...tx,
                         content_text: tx.contentText || tx.contentPreview,
                         quality_score: 85, // Mock for now
                         predicted_mindshare: 43 // Mock for now
                       })}
                     >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${style.bg} ${style.text}`}>
                            {tx?.token || 'Unknown'}
                          </span>
                          <span className="text-sm text-gray-400">by {tx?.agentName || 'Unknown'}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-white">
                            {tx?.amount?.toLocaleString() || 0} {tx?.token}
                          </div>
                          <div className="text-xs text-gray-400">
                            Purchase Date
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 mb-1">
                        {tx?.contentPreview || 'No preview available'}
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>Buyer: {tx?.buyerwallet?.slice(0, 6)}...{tx?.buyerwallet?.slice(-4)}</span>
                        <span>{formatDate(tx?.date)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Content Performance by Token */}
        {Object.keys(portfolioData?.contentByToken || {}).length > 0 && (
          <div className="mt-8 bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Content Performance by Token</h3>
              <ArrowTrendingUpIcon className="h-5 w-5 text-gray-400" />
            </div>
            
          <div className="space-y-6">
              {Object.entries(portfolioData?.contentByToken || {}).map(([token, contents]) => {
                const style = getTokenStyle(token);
                return (
                  <div key={token} className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <span className={`px-3 py-1 rounded-lg font-medium ${style.bg} ${style.text}`}>
                        {TOKEN_LOGOS[token]} {token}
                      </span>
                      <span className="text-sm text-gray-400">
                        {contents.length} content piece{contents.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {contents.slice(0, 4).map((content) => (
                        <div 
                          key={content.contentId} 
                          className="p-4 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 cursor-pointer transition-colors"
                                                     onClick={() => setShowContentModal({
                             ...content,
                             content_text: content.contentText,
                             quality_score: content.qualityScore,
                             predicted_mindshare: content.predictedMindshare,
                             token: token,
                             amount: content.saleprice,
                             agentName: content.agentName,
                             date: content.saledate
                           })}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="text-sm font-medium text-white mb-1">
                                {content?.agentName || 'Unknown Agent'}
                              </div>
                              <div className="text-xs text-gray-400 line-clamp-2">
                                {content?.contentText ? formatTwitterContent(content.contentText).text.substring(0, 100) + '...' : 'No content preview'}
                              </div>
                            </div>
                            <div className="text-right ml-3">
                              <div className="text-sm font-medium text-white">
                                {content?.saleprice?.toLocaleString() || 0} {token}
                              </div>
                              <div className="text-xs text-gray-400">
                                Purchase Price
                              </div>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                            <div>
                              <span className="text-gray-500">Quality:</span>
                              <div className="font-medium">{Number(content?.qualityScore || 0).toFixed(1)}</div>
                            </div>
                            <div>
                              <span className="text-gray-500">Bids:</span>
                              <div className="font-medium">{content?.totalbids || 0}</div>
                            </div>
                            <div>
                              <span className="text-gray-500">Mindshare:</span>
                              <div className="font-medium">{Number(content?.predictedMindshare || 0).toFixed(1)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {contents.length > 4 && (
                      <div className="text-center">
                        <button className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                          View {contents.length - 4} more {token} content pieces
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Portfolio Distribution */}
        {(portfolioData?.distribution?.length || 0) > 0 && (
          <div className="mt-8 bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Portfolio Distribution</h3>
              <ChartBarIcon className="h-5 w-5 text-gray-400" />
            </div>
            
            <div className="space-y-3">
              {(portfolioData?.distribution || []).map((item) => {
                const style = getTokenStyle(item.token);
                return (
                  <div key={item.token} className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2 w-20">
                      <span className="text-lg">{TOKEN_LOGOS[item.token]}</span>
                      <span className="text-sm font-medium text-white">{item.token}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-400">{Number(item?.percentage || 0).toFixed(1)}%</span>
                        <span className="text-sm text-gray-400">{portfolioData.earnings.find(e => e.token === item.token)?.amount.toLocaleString() || 0} {item.token}</span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${style.bg.replace('/20', '')}`}
                          style={{ width: `${item.percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Content Details Modal */}
        {showContentModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 max-w-4xl w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-white">Content Details</h3>
                <button
                  onClick={() => setShowContentModal(null)}
                  className="text-gray-400 hover:text-gray-300 transition-colors"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* Content Preview */}
                <div className="bg-gray-700/50 rounded-lg p-4">
                  <div className="mb-4">
                    <h4 className="text-sm font-semibold text-orange-400 mb-2">🐦 Twitter Content</h4>
                    <div className="bg-gray-800 rounded-lg p-4 border border-gray-600 max-h-96 overflow-y-auto">
                      <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">
                        {formatTwitterContent(showContentModal.content_text).text}
                      </p>
                      <div className="mt-3 pt-3 border-t border-gray-600 space-y-2">
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span>Characters: {formatTwitterContent(showContentModal.content_text).text.length}/280</span>
                          <span className="text-orange-400">Purchased Content ✓</span>
                        </div>
                        {extractHashtags(formatTwitterContent(showContentModal.content_text).text).length > 0 && (
                          <div className="flex items-start space-x-2 text-xs text-gray-400">
                            <span className="whitespace-nowrap">Hashtags:</span>
                            <div className="flex flex-wrap gap-1">
                              {extractHashtags(formatTwitterContent(showContentModal.content_text).text).map((tag, index) => (
                                <span key={index} className="bg-orange-900/30 text-orange-300 px-2 py-1 rounded text-xs whitespace-nowrap">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Visual Content */}
                    {extractImageUrl(showContentModal.content_text) && (
                      <div className="mt-4">
                        <h5 className="text-sm font-semibold text-orange-400 mb-3">🖼️ Generated Visual</h5>
                        <div className="bg-gray-800 rounded-lg p-4 border border-gray-600">
                          <div className="space-y-2">
                            <div className="relative max-w-md mx-auto">
                              <img 
                                src={extractImageUrl(showContentModal.content_text)!} 
                                alt="AI Generated content image"
                                className="w-full rounded-lg border border-gray-600 shadow-md"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none'
                                }}
                              />
                            </div>
                            <div className="text-xs text-gray-400 bg-gray-700 p-2 rounded font-mono break-all">
                              <strong>Image URL:</strong> {extractImageUrl(showContentModal.content_text)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Quality: {Number(showContentModal.quality_score || 0).toFixed(1)}</span>
                    <span>Mindshare: {Number(showContentModal.predicted_mindshare || 0).toFixed(1)}%</span>
                  </div>
                </div>

                {/* Sales Information */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="bg-orange-900/20 rounded-lg p-3 border border-orange-500/30">
                    <p className="text-orange-400 font-medium">Purchase Price</p>
                    <p className="font-bold text-orange-300 text-lg">
                      {showContentModal.amount?.toLocaleString() || 0} {showContentModal.token || 'Tokens'}
                    </p>
                  </div>
                  <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-500/30">
                    <p className="text-blue-400 font-medium">Created By</p>
                    <p className="font-bold text-blue-300 text-lg">{showContentModal.agentName || 'Unknown'}</p>
                </div>
                  <div className="bg-green-900/20 rounded-lg p-3 border border-green-500/30">
                    <p className="text-green-400 font-medium">Purchase Date</p>
                    <p className="font-bold text-green-300 text-lg">
                      {showContentModal.date ? formatDate(showContentModal.date) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Buyer Information (if available) */}
                {showContentModal.buyerwallet && (
                  <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                    <h5 className="text-sm font-semibold text-purple-400 mb-2">🏆 Buyer Information</h5>
                    <div className="text-sm text-gray-300">
                      <p><strong>Wallet:</strong> {showContentModal.buyerwallet}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 