'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';

interface ReferralValidationResult {
  success: boolean;
  data?: {
    user: {
      id: number;
      walletAddress: string;
      username?: string;
    };
    referralCode: {
      id: number;
      code: string;
      communityName: string;
      leaderName: string;
      tier: string;
    };
    referrer?: {
      walletAddress: string;
      username?: string;
    };
  };
  message: string;
}

const ReferralCodeEntry: React.FC = () => {
  const router = useRouter();
  const { address: walletAddress, isConnected } = useAccount();
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<ReferralValidationResult | null>(null);
  const [showWaitlistOption, setShowWaitlistOption] = useState(false);

  useEffect(() => {
    // Check if user already has access
    if (walletAddress && isConnected) {
      checkExistingAccess();
    }
  }, [walletAddress, isConnected]);

  const checkExistingAccess = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/check-access/${walletAddress}`
      );
      const result = await response.json();
      
      if (result.success && result.data.hasAccess) {
        // User already has access, redirect to marketplace
        router.push('/marketplace');
      }
    } catch (error) {
      console.error('Error checking access:', error);
    }
  };

  const validateReferralCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!walletAddress || !isConnected) {
      alert('Please connect your wallet first');
      return;
    }

    if (!referralCode.trim()) {
      alert('Please enter a referral code');
      return;
    }

    setLoading(true);
    setValidationResult(null);
    setShowWaitlistOption(false);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/validate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: referralCode.trim().toUpperCase(),
            walletAddress
          })
        }
      );

      const result = await response.json();
      setValidationResult(result);
      
      if (result.success) {
        // Successful referral, redirect to marketplace
        setTimeout(() => {
          router.push('/marketplace');
        }, 2000);
      } else {
        // Show waitlist option for invalid codes
        setShowWaitlistOption(true);
      }
    } catch (error) {
      console.error('Error validating referral code:', error);
      setValidationResult({
        success: false,
        message: 'Network error. Please try again.'
      });
      setShowWaitlistOption(true);
    } finally {
      setLoading(false);
    }
  };

  const joinWaitlist = () => {
    router.push('/waitlist');
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'PLATINUM': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'GOLD': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'SILVER': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getCommissionRate = (tier: string) => {
    switch (tier) {
      case 'PLATINUM': return '10%';
      case 'GOLD': return '7.5%';
      case 'SILVER': return '5%';
      default: return '5%';
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-gray-900">
              Connect Your Wallet
            </CardTitle>
            <p className="text-gray-600 mt-2">
              Please connect your wallet to continue
            </p>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-gray-500">
              Use the wallet connection button to get started
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">
            Enter Referral Code
          </CardTitle>
          <p className="text-gray-600 mt-2">
            Join the Burnie platform with a community leader's referral code
          </p>
        </CardHeader>
        
        <CardContent>
          {!validationResult && (
            <form onSubmit={validateReferralCode} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Referral Code
                </label>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="LEADER-COMMUNITY"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-center font-mono text-lg"
                  disabled={loading}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Format: LEADER-COMMUNITYNAME
                </p>
              </div>
              
              <Button
                type="submit"
                disabled={loading || !referralCode.trim()}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 text-lg font-semibold"
              >
                {loading ? 'Validating...' : 'Join with Referral Code'}
              </Button>
            </form>
          )}

          {/* Success Result */}
          {validationResult?.success && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-green-800">Welcome to Burnie!</h3>
                <p className="text-green-600 mt-1">{validationResult.message}</p>
              </div>
              
              {validationResult.data && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-left">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Community:</span>
                      <span className="font-medium">{validationResult.data.referralCode.communityName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Leader:</span>
                      <span className="font-medium">{validationResult.data.referralCode.leaderName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Tier:</span>
                      <Badge className={getTierColor(validationResult.data.referralCode.tier)}>
                        {validationResult.data.referralCode.tier} ({getCommissionRate(validationResult.data.referralCode.tier)})
                      </Badge>
                    </div>
                  </div>
                </div>
              )}
              
              <p className="text-sm text-gray-600">
                Redirecting to marketplace in 2 seconds...
              </p>
            </div>
          )}

          {/* Error Result */}
          {validationResult && !validationResult.success && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-red-800">Invalid Referral Code</h3>
                <p className="text-red-600 mt-1">{validationResult.message}</p>
              </div>
              
              <div className="space-y-3">
                <Button
                  onClick={() => {
                    setValidationResult(null);
                    setReferralCode('');
                    setShowWaitlistOption(false);
                  }}
                  className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700"
                >
                  Try Another Code
                </Button>
              </div>
            </div>
          )}

          {/* Waitlist Option */}
          {showWaitlistOption && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="text-center space-y-3">
                <h4 className="font-medium text-gray-900">Don't have a referral code?</h4>
                <p className="text-sm text-gray-600">
                  Join our waitlist and we'll notify you when access becomes available
                </p>
                <Button
                  onClick={joinWaitlist}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white"
                >
                  Join Waitlist
                </Button>
              </div>
            </div>
          )}

          {/* Connected Wallet Info */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Connected Wallet</p>
              <p className="font-mono text-sm text-gray-700 mt-1">
                {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ReferralCodeEntry;
