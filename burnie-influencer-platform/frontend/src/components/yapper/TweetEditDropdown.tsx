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
    <div className="relative w-full mb-1">
      {/* Edit Tweet Button */}
      <button
        onClick={handleButtonClick}
        disabled={!canEdit}
        className={`w-full font-semibold py-3 lg:py-4 rounded-sm text-sm lg:text-lg transition-all duration-200 flex flex-col items-center justify-center gap-0.5 lg:gap-1 ${
          canEdit 
            ? 'bg-[#FFFFFF1A] hover:bg-[#FFFFFF2A] text-white' 
            : 'bg-gray-800 text-gray-500 cursor-not-allowed'
        }`}
      >
        <div className="flex items-center gap-1.5 lg:gap-2">
          {/* Pencil Icon */}
          <svg 
            className="w-4 h-4 lg:w-5 lg:h-5" 
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
          <span>
            {isLoading ? 'Loading...' : (
              !isPurchased && remainingCredits > 0 ? `Add Your Avatar - ${remainingCredits} credits left` :
              !isPurchased && remainingCredits === 0 ? 'Add Your Avatar (Purchase Required)' :
              isPurchased ? 'Add Your Avatar' :
              'Add Your Avatar - 5 credits left'
            )}
          </span>
          {canEdit && isPurchased && (
            <svg 
              className={`w-3 h-3 lg:w-4 lg:h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
        <span className="text-[9px] lg:text-sm text-white/70 font-normal text-center px-2">
          (Personalise Tweet in your style with your own Avatar)
        </span>
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
          <div className="absolute top-full left-0 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50">
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
