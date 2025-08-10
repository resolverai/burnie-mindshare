import React, { useState, useEffect } from 'react';
import { 
  MagnifyingGlassIcon, 
  FunnelIcon, 
  CurrencyDollarIcon,
  TrophyIcon,
  ClockIcon,
  CheckCircleIcon,
  StarIcon,
  EyeIcon,
  HeartIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { useROASTPrice, formatUSDCPrice } from '../utils/priceUtils';

interface ContentItem {
  id: number;
  content_text: string;
  predicted_mindshare: number;
  quality_score: number;
  asking_price: number;
  creator: {
    username: string;
    reputation_score: number;
  };
  campaign: {
    title: string;
    platform_source: string;
    reward_token: string;
  };
  bids: Array<{
    amount: number;
    currency: string;
    bidder: string;
    is_winning: boolean;
  }>;
  highest_bid?: {
    amount: number;
    currency: string;
    bidder: string;
  };
  total_bids: number;
  created_at: string;
}

interface User {
  id: number;
  username: string;
  roast_balance: number;
  usdc_balance: number;
}

// Content parsing function to remove URLs from tweet text
const formatTwitterContent = (contentText: string): { text: string; imageUrl: string | null } => {
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
  
  return { text: cleanText, imageUrl: null };
};

const ContentMarketplace: React.FC = () => {
  const [content, setContent] = useState<ContentItem[]>([]);
  const { price: roastPrice } = useROASTPrice();
  const [loading, setLoading] = useState(true);
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidCurrency, setBidCurrency] = useState<'ROAST' | 'USDC'>('ROAST');
  const [filters, setFilters] = useState({
    campaign_id: '',
    min_quality_score: '',
    max_price: '',
    sort_by: 'predicted_mindshare',
    order: 'DESC'
  });
  // TODO: Get user from authentication context
  const [user] = useState<User>({
    id: 1,
    username: 'current_user',
    roast_balance: 0, // Will be fetched from backend
    usdc_balance: 0 // Will be fetched from backend
  });

  // Fetch marketplace content
  const fetchContent = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      
      Object.entries(filters).forEach(([key, value]) => {
        if (value) queryParams.append(key, value);
      });

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/content?${queryParams}`);
      if (response.ok) {
        const data = await response.json();
        setContent(data.data || []);
      } else {
        // No fallback - show empty state
        setContent([]);
      }
    } catch (error) {
      console.error('Error fetching content:', error);
      setContent([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContent();
  }, [filters]);

  // Place bid on content
  const placeBid = async () => {
    if (!selectedContent || !bidAmount) return;

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_id: selectedContent.id,
          bid_amount: parseFloat(bidAmount),
          bid_currency: bidCurrency,
          user_id: user.id
        })
      });

      if (response.ok) {
        alert('Bid placed successfully!');
        setBidAmount('');
        setSelectedContent(null);
        fetchContent(); // Refresh content
      } else {
        const error = await response.json();
        alert(`Failed to place bid: ${error.message}`);
      }
    } catch (error) {
      console.error('Error placing bid:', error);
      alert('Failed to place bid');
    }
  };

  // Purchase content directly
  const purchaseContent = async (contentItem: ContentItem) => {
    try {
              const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/content/${contentItem.id}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          payment_currency: 'ROAST'
        })
      });

      if (response.ok) {
        alert('Content purchased successfully!');
        fetchContent(); // Refresh content
      } else {
        const error = await response.json();
        alert(`Failed to purchase: ${error.message}`);
      }
    } catch (error) {
      console.error('Error purchasing content:', error);
      alert('Failed to purchase content');
    }
  };

// All content fetched dynamically from marketplace API - no mock data

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Content Marketplace</h1>
              <p className="text-gray-600">AI-generated content optimized for maximum mindshare</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">Your Balance</div>
              <div className="text-lg font-semibold">
                {user.roast_balance} ROAST • {user.usdc_balance} USDC
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center space-x-2">
              <FunnelIcon className="h-5 w-5 text-gray-400" />
              <select
                value={filters.sort_by}
                onChange={(e) => setFilters({...filters, sort_by: e.target.value})}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="predicted_mindshare">Mindshare Score</option>
                <option value="quality_score">Quality Score</option>
                <option value="asking_price">Price</option>
                <option value="created_at">Newest</option>
              </select>
            </div>

            <input
              type="number"
              placeholder="Max Price"
              value={filters.max_price}
              onChange={(e) => setFilters({...filters, max_price: e.target.value})}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm w-32"
            />

            <button
              onClick={fetchContent}
              className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
            >
              <ArrowPathIcon className="h-4 w-4" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Content Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading marketplace content...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.map((item) => {
              const { text } = formatTwitterContent(item.content_text);
              
              return (
                <div key={item.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  {/* Campaign Badge */}
                  <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">{item.campaign.title}</span>
                      <span className="text-xs bg-white/20 px-2 py-1 rounded">
                        {item.campaign.platform_source}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-4">
                    <p className="text-gray-800 text-sm mb-4 line-clamp-4">
                      {text}
                    </p>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="text-center">
                      <TrophyIcon className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
                      <div className="text-lg font-bold text-gray-900">{item.predicted_mindshare.toFixed(1)}</div>
                      <div className="text-xs text-gray-500">Mindshare Score</div>
                    </div>
                    <div className="text-center">
                      <StarIcon className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                      <div className="text-lg font-bold text-gray-900">{item.quality_score.toFixed(1)}</div>
                      <div className="text-xs text-gray-500">Quality Score</div>
                    </div>
                  </div>

                  {/* Creator & Price */}
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        @{item.creator.username}
                      </div>
                      <div className="text-xs text-gray-500">
                        Rep: {item.creator.reputation_score}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-green-600">
                        {item.asking_price} {item.campaign.reward_token}
                      </div>
                      {item.highest_bid && (
                        <div className="text-xs text-gray-500">
                          High bid: {item.highest_bid.amount} {item.highest_bid.currency}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setSelectedContent(item)}
                      className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700"
                    >
                      <CurrencyDollarIcon className="h-4 w-4 inline mr-1" />
                      Bid
                    </button>
                    <button
                      onClick={() => purchaseContent(item)}
                      className="flex-1 bg-green-600 text-white px-3 py-2 rounded-md text-sm hover:bg-green-700"
                    >
                      <CheckCircleIcon className="h-4 w-4 inline mr-1" />
                      Buy Now
                    </button>
                    <button className="bg-gray-100 text-gray-600 px-3 py-2 rounded-md text-sm hover:bg-gray-200">
                      <EyeIcon className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Bidding Stats */}
                  {item.total_bids > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="flex items-center justify-between text-sm text-gray-600">
                        <span>{item.total_bids} bid{item.total_bids !== 1 ? 's' : ''}</span>
                        <span className="flex items-center">
                          <ClockIcon className="h-4 w-4 mr-1" />
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* Bidding Modal */}
        {selectedContent && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold mb-4">Place Bid</h2>
              
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-800 mb-2">
                  {selectedContent.content_text.substring(0, 100)}...
                </p>
                <div className="text-sm text-gray-600">
                  Asking Price: {selectedContent.asking_price} {selectedContent.campaign.reward_token} {roastPrice > 0 && `(${formatUSDCPrice(selectedContent.asking_price * roastPrice)} USDC)`}
                </div>
                {selectedContent.highest_bid && (
                  <div className="text-sm text-green-600">
                    Current High Bid: {selectedContent.highest_bid.amount} {selectedContent.highest_bid.currency}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bid Amount
                </label>
                <div className="flex space-x-2">
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder="Enter bid amount"
                    className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  />
                  <select
                    value={bidCurrency}
                    onChange={(e) => setBidCurrency(e.target.value as 'ROAST' | 'USDC')}
                    className="border border-gray-300 rounded-md px-3 py-2"
                  >
                    <option value="ROAST">ROAST</option>
                    <option value="USDC">USDC</option>
                  </select>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Your Balance: {bidCurrency === 'ROAST' ? user.roast_balance : user.usdc_balance} {bidCurrency}
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setSelectedContent(null)}
                  className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={placeBid}
                  disabled={!bidAmount || parseFloat(bidAmount) <= 0}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  Place Bid
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentMarketplace; 