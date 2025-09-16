'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  PlusIcon,
  TrashIcon,
  UserIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  XCircleIcon
} from '@heroicons/react/24/outline';

interface ApprovedMiner {
  id: string;
  walletAddress: string;
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
}

const ApprovedMinersManagement: React.FC = () => {
  const router = useRouter();
  const [approvedMiners, setApprovedMiners] = useState<ApprovedMiner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMinerAddress, setNewMinerAddress] = useState('');
  const [addingMiner, setAddingMiner] = useState(false);
  const [removingMiner, setRemovingMiner] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchApprovedMiners();
  }, []);

  const fetchApprovedMiners = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/approved-miners`
      );
      const result = await response.json();
      
      if (result.success) {
        setApprovedMiners(result.data);
      } else {
        setError('Failed to fetch approved miners');
      }
    } catch (error) {
      console.error('Error fetching approved miners:', error);
      setError('Failed to fetch approved miners');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMiner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMinerAddress.trim()) return;

    try {
      setAddingMiner(true);
      setError('');
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/approved-miners`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            walletAddress: newMinerAddress.trim()
          }),
        }
      );

      const result = await response.json();

      if (result.success) {
        setNewMinerAddress('');
        setShowAddModal(false);
        fetchApprovedMiners(); // Refresh the list
      } else {
        setError(result.message || 'Failed to add miner');
      }
    } catch (error) {
      console.error('Error adding miner:', error);
      setError('Failed to add miner');
    } finally {
      setAddingMiner(false);
    }
  };

  const handleRemoveMiner = async (minerId: string) => {
    try {
      setRemovingMiner(minerId);
      setError('');
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/approved-miners/${minerId}`,
        {
          method: 'DELETE',
        }
      );

      const result = await response.json();

      if (result.success) {
        fetchApprovedMiners(); // Refresh the list
      } else {
        setError(result.message || 'Failed to remove miner');
      }
    } catch (error) {
      console.error('Error removing miner:', error);
      setError('Failed to remove miner');
    } finally {
      setRemovingMiner(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isValidWalletAddress = (address: string) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/admin/dashboard')}
                className="flex items-center space-x-2 text-gray-700 hover:text-gray-900 transition-colors bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-lg"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Back to Dashboard</span>
              </button>
              <div className="h-6 w-px bg-gray-300" />
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl">
                  <UserIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Approved Miners</h1>
                  <p className="text-xs text-gray-500">Manage automated mining permissions</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Overview Stats */}
        <div className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Approved Miners</p>
                  <p className="text-2xl font-bold text-gray-900">{approvedMiners.length}</p>
                </div>
                <CheckCircleIcon className="h-8 w-8 text-green-500" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Active Miners</p>
                  <p className="text-2xl font-bold text-gray-900">{approvedMiners.length}</p>
                </div>
                <UserIcon className="h-8 w-8 text-blue-500" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Recently Approved</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {approvedMiners.filter(miner => {
                      const approvedDate = new Date(miner.approvedAt);
                      const sevenDaysAgo = new Date();
                      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                      return approvedDate > sevenDaysAgo;
                    }).length}
                  </p>
                </div>
                <CalendarDaysIcon className="h-8 w-8 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        {/* Management Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Miner Management</h2>
              <p className="text-gray-600 mt-1">Approve miners for automated content generation</p>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
            >
              <PlusIcon className="h-4 w-4" />
              <span>Add Miner</span>
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <XCircleIcon className="h-5 w-5 text-red-400 mr-2" />
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Approved Miners List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Approved Miners</h3>
            <p className="text-sm text-gray-500">Miners authorized for automated mining</p>
          </div>

          {loading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading approved miners...</p>
            </div>
          ) : approvedMiners.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Wallet Address
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Approved Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {approvedMiners.map((miner) => (
                    <tr key={miner.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-green-100 rounded-full">
                            <UserIcon className="h-4 w-4 text-green-600" />
                          </div>
                          <div>
                            <div className="font-mono text-sm text-gray-900">
                              {miner.walletAddress}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {formatDate(miner.approvedAt)}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircleIcon className="h-3 w-3 mr-1" />
                          Approved
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => handleRemoveMiner(miner.id)}
                          disabled={removingMiner === miner.id}
                          className="text-red-600 hover:text-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                        >
                          <TrashIcon className="h-4 w-4" />
                          <span>Remove</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <UserIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-500 text-lg">No approved miners yet</p>
              <p className="text-gray-400 text-sm">Add miners to enable automated mining</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Miner Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 max-w-md w-full shadow-xl">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Add Approved Miner</h3>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setNewMinerAddress('');
                    setError('');
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={handleAddMiner} className="p-6 space-y-4">
              <div>
                <label htmlFor="walletAddress" className="block text-sm font-medium text-gray-700 mb-2">
                  Wallet Address *
                </label>
                <input
                  type="text"
                  id="walletAddress"
                  required
                  value={newMinerAddress}
                  onChange={(e) => setNewMinerAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 font-mono text-sm text-gray-900 placeholder-gray-500"
                  placeholder="0x..."
                  maxLength={42}
                />
                {newMinerAddress && !isValidWalletAddress(newMinerAddress) && (
                  <p className="text-red-500 text-xs mt-1">Invalid wallet address format</p>
                )}
                <p className="text-gray-500 text-xs mt-1">
                  Enter the Ethereum wallet address of the miner to approve
                </p>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewMinerAddress('');
                    setError('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingMiner || !isValidWalletAddress(newMinerAddress)}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {addingMiner ? 'Adding...' : 'Add Miner'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApprovedMinersManagement;
