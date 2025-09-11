'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';

interface WaitlistForm {
  email: string;
  username: string;
  reason: string;
  twitterHandle: string;
  discordHandle: string;
}

interface WaitlistStatus {
  id: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  position: number;
  createdAt: string;
  approvedAt?: string;
}

const WaitlistSignup: React.FC = () => {
  const router = useRouter();
  const { address: walletAddress, isConnected } = useAccount();
  const [form, setForm] = useState<WaitlistForm>({
    email: '',
    username: '',
    reason: '',
    twitterHandle: '',
    discordHandle: ''
  });
  const [loading, setLoading] = useState(false);
  const [existingStatus, setExistingStatus] = useState<WaitlistStatus | null>(null);
  const [joinResult, setJoinResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);

  useEffect(() => {
    // Check if user already has access or is on waitlist
    if (walletAddress && isConnected) {
      checkExistingStatus();
    }
  }, [walletAddress, isConnected]);

  const checkExistingStatus = async () => {
    try {
      // First check if they have marketplace access
      const accessResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/check-access/${walletAddress}`
      );
      const accessResult = await accessResponse.json();
      
      if (accessResult.success && accessResult.data.hasAccess) {
        // User already has access, redirect to marketplace
        router.push('/marketplace');
        return;
      }

      // Check waitlist status
      const waitlistResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/waitlist/status/${walletAddress}`
      );
      
      if (waitlistResponse.ok) {
        const waitlistResult = await waitlistResponse.json();
        if (waitlistResult.success) {
          setExistingStatus(waitlistResult.data);
        }
      }
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!walletAddress || !isConnected) {
      alert('Please connect your wallet first');
      return;
    }

    setLoading(true);
    setJoinResult(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/waitlist/join`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            walletAddress,
            ...form
          })
        }
      );

      const result = await response.json();
      setJoinResult(result);
      
      if (result.success) {
        // Refresh status to show updated position
        await checkExistingStatus();
      }
    } catch (error) {
      console.error('Error joining waitlist:', error);
      setJoinResult({
        success: false,
        message: 'Network error. Please try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: keyof WaitlistForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED': return 'bg-green-100 text-green-800 border-green-200';
      case 'REJECTED': return 'bg-red-100 text-red-800 border-red-200';
      case 'PENDING': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-gray-900">
              Connect Your Wallet
            </CardTitle>
            <p className="text-gray-600 mt-2">
              Please connect your wallet to join the waitlist
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

  // Show existing status
  if (existingStatus) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">
              Waitlist Status
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="text-center">
              <Badge className={getStatusColor(existingStatus.status)}>
                {existingStatus.status}
              </Badge>
            </div>
            
            {existingStatus.status === 'PENDING' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-800">#{existingStatus.position}</div>
                  <div className="text-sm text-blue-600">Your position in queue</div>
                </div>
              </div>
            )}
            
            {existingStatus.status === 'APPROVED' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <div className="text-green-800 font-medium">Congratulations!</div>
                <div className="text-sm text-green-600 mt-1">
                  You've been approved for platform access
                </div>
                <Button
                  onClick={() => router.push('/marketplace')}
                  className="mt-3 bg-green-600 hover:bg-green-700 text-white"
                >
                  Go to Marketplace
                </Button>
              </div>
            )}
            
            {existingStatus.status === 'REJECTED' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                <div className="text-red-800 font-medium">Application Not Approved</div>
                <div className="text-sm text-red-600 mt-1">
                  Your waitlist application was not approved at this time
                </div>
              </div>
            )}
            
            <div className="text-center text-xs text-gray-500">
              <div>Applied: {new Date(existingStatus.createdAt).toLocaleDateString()}</div>
              {existingStatus.approvedAt && (
                <div>Processed: {new Date(existingStatus.approvedAt).toLocaleDateString()}</div>
              )}
            </div>
            
            <div className="text-center">
              <Button
                onClick={() => router.push('/referral')}
                className="bg-gray-300 hover:bg-gray-400 text-gray-700"
              >
                Try Referral Code Instead
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show success result
  if (joinResult?.success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">
              Welcome to the Waitlist!
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="text-center">
              <p className="text-gray-600">{joinResult.message}</p>
            </div>
            
            {joinResult.data && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-800">#{joinResult.data.position}</div>
                  <div className="text-sm text-blue-600">Your position in queue</div>
                </div>
              </div>
            )}
            
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-2">What's Next?</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Our team will review your application</li>
                <li>• You'll be notified via email when approved</li>
                <li>• Access will be granted based on platform capacity</li>
              </ul>
            </div>
            
            <div className="text-center">
              <Button
                onClick={() => router.push('/referral')}
                className="bg-gray-300 hover:bg-gray-400 text-gray-700"
              >
                Try Referral Code Instead
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">
            Join Waitlist
          </CardTitle>
          <p className="text-gray-600 mt-2">
            Get early access to the Burnie platform
          </p>
        </CardHeader>
        
        <CardContent>
          {joinResult && !joinResult.success && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="text-red-800 text-sm">{joinResult.message}</div>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address *
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => handleInputChange('username', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Your preferred username"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Why do you want to join Burnie?
              </label>
              <textarea
                value={form.reason}
                onChange={(e) => handleInputChange('reason', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={3}
                placeholder="Tell us about your interest in the platform..."
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Twitter Handle
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">@</span>
                <input
                  type="text"
                  value={form.twitterHandle}
                  onChange={(e) => handleInputChange('twitterHandle', e.target.value.replace(/@/g, ''))}
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="username"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discord Handle
              </label>
              <input
                type="text"
                value={form.discordHandle}
                onChange={(e) => handleInputChange('discordHandle', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="username#1234"
              />
            </div>
            
            <Button
              type="submit"
              disabled={loading || !form.email}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 text-lg font-semibold"
            >
              {loading ? 'Joining Waitlist...' : 'Join Waitlist'}
            </Button>
          </form>
          
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-3">Already have a referral code?</p>
              <Button
                onClick={() => router.push('/referral')}
                className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700"
              >
                Enter Referral Code
              </Button>
            </div>
          </div>
          
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

export default WaitlistSignup;
