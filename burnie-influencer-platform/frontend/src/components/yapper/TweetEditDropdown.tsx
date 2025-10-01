"use client";

import React, { useState, useEffect } from 'react';

interface TweetEditDropdownProps {
  contentId: number;
  isPurchased: boolean;
  walletAddress: string;
  onEditSelect: (type: 'text' | 'fusion') => void;
  refreshCredits?: React.MutableRefObject<(() => void) | null>; // Optional ref to refresh function
}

const TweetEditDropdown: React.FC<TweetEditDropdownProps> = ({
  contentId,
  isPurchased,
  walletAddress,
  onEditSelect,
  refreshCredits
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [remainingCredits, setRemainingCredits] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCredits = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/edit-tweet/credits/${walletAddress}`);
      if (response.ok) {
        const data = await response.json();
        setRemainingCredits(data.remainingCredits);
        console.log('🔄 TweetEditDropdown credits refreshed:', data.remainingCredits);
      }
    } catch (error) {
      console.error('Failed to fetch edit credits:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (walletAddress) {
      fetchCredits();
    }
  }, [walletAddress]);

  // Expose refresh function to parent via callback
  useEffect(() => {
    if (refreshCredits) {
      // Override the refresh function to call our internal fetchCredits
      refreshCredits.current = fetchCredits;
    }
  }, [refreshCredits, walletAddress]);

  const canEdit = isPurchased || remainingCredits > 0;

  const getDisplayText = () => {
    if (isLoading) return '(Loading...)';
    
    if (!isPurchased && remainingCredits > 0) {
      return `(Edit Tweet - ${remainingCredits} credits left)`;
    }
    
    if (!isPurchased && remainingCredits === 0) {
      return '(You can edit this tweet after purchase)';
    }
    
    if (isPurchased) {
      return '(Edit Tweet)';
    }
    
    return '(Edit Tweet - 5 credits left)';
  };

  const handleOptionSelect = (type: 'text' | 'fusion') => {
    onEditSelect(type);
    setIsOpen(false);
  };

  const handleButtonClick = () => {
    if (!canEdit) return;
    
    // Before purchase: directly open AI Regenerate (fusion)
    if (!isPurchased) {
      onEditSelect('fusion');
      return;
    }
    
    // After purchase: show dropdown with both options
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative inline-block ml-2">
      {/* Trigger Button */}
      <button
        onClick={handleButtonClick}
        disabled={!canEdit}
        className={`text-xs flex items-center ${
          canEdit 
            ? 'text-orange-400 hover:text-orange-300 cursor-pointer' 
            : 'text-gray-500 cursor-not-allowed'
        } transition-colors`}
      >
        {/* Pencil Icon */}
        <svg 
          className="w-3 h-3 mr-1" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" 
          />
        </svg>
        {getDisplayText()}
        {canEdit && isPurchased && (
          <svg 
            className={`inline w-3 h-3 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Dropdown Menu - Only show after purchase */}
      {isOpen && canEdit && isPurchased && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown Content */}
          <div className="absolute top-full left-0 mt-1 w-64 bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50">
            {/* Text Edit Option */}
            <button
              onClick={() => handleOptionSelect('text')}
              className="w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors border-b border-gray-600 last:border-b-0"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">Edit Text Only</span>
                    <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded">Free</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">Quick manual editing of tweet text</p>
                </div>
              </div>
            </button>

            {/* AI Regenerate Option */}
            <button
              onClick={() => handleOptionSelect('fusion')}
              className="w-full px-4 py-3 text-left hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">AI Regenerate</span>
                    {isPurchased ? (
                      <span className="text-xs bg-orange-600 text-white px-2 py-0.5 rounded">50 ROAST</span>
                    ) : (
                      <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded">Free</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-xs mt-1">Avatar fusion & regeneration</p>
                </div>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default TweetEditDropdown;
