'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { ArrowLeft } from 'lucide-react';

interface ReferralCode {
  id: number;
  code: string;
  communityName: string;
  leaderName: string;
  leaderWalletAddress: string;
  tier: 'SILVER' | 'GOLD' | 'PLATINUM';
  maxUses: number;
  currentUses: number;
  isActive: boolean;
  expiresAt: string;
  totalVolumeGenerated: number | string;
  totalCommissionsEarned: number | string;
  createdAt: string;
}

interface CreateReferralForm {
  communityName: string;
  leaderName: string;
  leaderWalletAddress: string;
  tier: 'SILVER' | 'GOLD' | 'PLATINUM';
  maxUses: number;
}

const ReferralManagement: React.FC = () => {
  const router = useRouter();
  const [referralCodes, setReferralCodes] = useState<ReferralCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateReferralForm>({
    communityName: '',
    leaderName: '',
    leaderWalletAddress: '',
    tier: 'SILVER',
    maxUses: 500
  });

  useEffect(() => {
    fetchReferralCodes();
  }, []);

  const fetchReferralCodes = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/codes`);
      const result = await response.json();
      
      if (result.success) {
        setReferralCodes(result.data);
      }
    } catch (error) {
      console.error('Error fetching referral codes:', error);
    } finally {
      setLoading(false);
    }
  };

  const createReferralCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/codes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createForm)
      });

      const result = await response.json();
      
      if (result.success) {
        setShowCreateForm(false);
        setCreateForm({
          communityName: '',
          leaderName: '',
          leaderWalletAddress: '',
          tier: 'SILVER',
          maxUses: 500
        });
        await fetchReferralCodes();
      } else {
        alert(result.message || 'Failed to create referral code');
      }
    } catch (error) {
      console.error('Error creating referral code:', error);
      alert('Failed to create referral code');
    }
  };

  const updateTier = async (id: number, tier: 'SILVER' | 'GOLD' | 'PLATINUM') => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/codes/${id}/tier`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tier })
      });

      const result = await response.json();
      
      if (result.success) {
        await fetchReferralCodes();
      } else {
        alert(result.message || 'Failed to update tier');
      }
    } catch (error) {
      console.error('Error updating tier:', error);
      alert('Failed to update tier');
    }
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-lg text-gray-600">Loading referral codes...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Button 
              onClick={() => router.push('/admin/dashboard')}
              variant="outline"
              size="sm"
              className="flex items-center gap-2 text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Referral Management</h1>
              <p className="text-gray-600 mt-2">Manage community leader referral codes and tiers</p>
            </div>
            <Button
              onClick={() => setShowCreateForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Create Referral Code
            </Button>
          </div>
        </div>

        {/* Create Form Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-md bg-white">
              <CardHeader>
                <CardTitle>Create Referral Code</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={createReferralCode} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Community Name
                    </label>
                    <input
                      type="text"
                      value={createForm.communityName}
                      onChange={(e) => setCreateForm({ ...createForm, communityName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Leader Name
                    </label>
                    <input
                      type="text"
                      value={createForm.leaderName}
                      onChange={(e) => setCreateForm({ ...createForm, leaderName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Leader Wallet Address
                    </label>
                    <input
                      type="text"
                      value={createForm.leaderWalletAddress}
                      onChange={(e) => setCreateForm({ ...createForm, leaderWalletAddress: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0x..."
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tier
                    </label>
                    <select
                      value={createForm.tier}
                      onChange={(e) => setCreateForm({ ...createForm, tier: e.target.value as 'SILVER' | 'GOLD' | 'PLATINUM' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="SILVER">Silver (5%)</option>
                      <option value="GOLD">Gold (7.5%)</option>
                      <option value="PLATINUM">Platinum (10%)</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Uses
                    </label>
                    <input
                      type="number"
                      value={createForm.maxUses}
                      onChange={(e) => setCreateForm({ ...createForm, maxUses: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="1"
                      required
                    />
                  </div>
                  
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      variant="outline"
                      className="text-gray-700 border-gray-300 hover:bg-gray-50"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Create Code
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Referral Codes List */}
        <div className="grid gap-6">
          {referralCodes.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-gray-500">No referral codes found</div>
              </CardContent>
            </Card>
          ) : (
            referralCodes.map((code) => (
              <Card key={code.id} className="border-l-4 border-l-blue-500">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl font-bold text-blue-600">
                        {code.code}
                      </CardTitle>
                      <p className="text-gray-600 mt-1">
                        {code.communityName} • {code.leaderName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getTierColor(code.tier)}>
                        {code.tier} ({getCommissionRate(code.tier)})
                      </Badge>
                      {code.isActive ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          Active
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 border-red-200">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <div className="text-sm text-gray-500">Usage</div>
                      <div className="text-lg font-semibold">
                        {code.currentUses} / {code.maxUses}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Volume Generated</div>
                      <div className="text-lg font-semibold">
                        {Number(code.totalVolumeGenerated).toFixed(2)} ROAST
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Commissions Earned</div>
                      <div className="text-lg font-semibold">
                        {Number(code.totalCommissionsEarned).toFixed(2)} ROAST
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Expires</div>
                      <div className="text-lg font-semibold">
                        {new Date(code.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <div className="text-sm text-gray-500 mb-1">Leader Wallet</div>
                    <div className="font-mono text-sm bg-gray-100 p-2 rounded">
                      {code.leaderWalletAddress}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Update Tier:</span>
                    <select
                      value={code.tier}
                      onChange={(e) => updateTier(code.id, e.target.value as 'SILVER' | 'GOLD' | 'PLATINUM')}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="SILVER">Silver (5%)</option>
                      <option value="GOLD">Gold (7.5%)</option>
                      <option value="PLATINUM">Platinum (10%)</option>
                    </select>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ReferralManagement;
