'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, 
  Search, 
  Users,
  CheckCircle,
  XCircle,
  Globe,
  Mail,
  Calendar,
  DollarSign,
  Image as ImageIcon,
  Video,
  Trash2
} from 'lucide-react';
import Image from 'next/image';

interface CurrentPlan {
  planId: number;
  planName: string;
  selectedFrequency: 'monthly' | 'annual';
  imagePostsLimit: number;
  videoPostsLimit: number;
  planPrice: number;
  startDate: string;
}

interface DvybAccount {
  id: number;
  accountName: string;
  primaryEmail: string;
  accountType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  website: string | null;
  logoUrl: string | null;
  logoPresignedUrl: string | null;
  hasContext: boolean;
  usage: {
    imagesGenerated: number;
    videosGenerated: number;
  };
  currentPlan: CurrentPlan | null;
}

interface PricingPlan {
  id: number;
  planName: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  monthlyImageLimit: number;
  monthlyVideoLimit: number;
  annualImageLimit: number;
  annualVideoLimit: number;
  isActive: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface Stats {
  totalActive: number;
  totalInactive: number;
  totalAll: number;
}

interface ApiResponse {
  success: boolean;
  data: DvybAccount[];
  pagination: Pagination;
  stats: Stats;
}

export default function DvybAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<DvybAccount[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 0 });
  const [stats, setStats] = useState<Stats>({ totalActive: 0, totalInactive: 0, totalAll: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [toggling, setToggling] = useState<number | null>(null);
  const [showAssociatePlanModal, setShowAssociatePlanModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<DvybAccount | null>(null);
  const [availablePlans, setAvailablePlans] = useState<PricingPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<'monthly' | 'annual'>('monthly');
  const [associating, setAssociating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<DvybAccount | null>(null);

  // Fetch accounts
  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(searchTerm && { search: searchTerm }),
        ...(statusFilter !== 'ALL' && { status: statusFilter.toLowerCase() })
      });

      const response = await fetch(`/api/admin/dvyb-accounts?${params}`);
      const data: ApiResponse = await response.json();

      if (data.success) {
        setAccounts(data.data);
        setPagination(data.pagination);
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [pagination.page, searchTerm, statusFilter]);

  // Toggle account status
  const handleToggleStatus = async (accountId: number) => {
    try {
      setToggling(accountId);
      const response = await fetch(`/api/admin/dvyb-accounts/${accountId}/toggle-status`, {
        method: 'PATCH',
      });

      const data = await response.json();
      if (data.success) {
        fetchAccounts();
      } else {
        alert('Failed to update account status');
      }
    } catch (error) {
      console.error('Error toggling status:', error);
      alert('Failed to update account status');
    } finally {
      setToggling(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  // Fetch available plans
  const fetchAvailablePlans = async () => {
    try {
      const response = await fetch('/api/admin/dvyb-plans?status=active&limit=100');
      const data = await response.json();
      if (data.success) {
        setAvailablePlans(data.data);
      }
    } catch (error) {
      console.error('Error fetching plans:', error);
    }
  };

  // Open Associate Plan modal
  const openAssociatePlanModal = async (account: DvybAccount) => {
    setSelectedAccount(account);
    setSelectedPlanId(account.currentPlan?.planId || null);
    setSelectedFrequency(account.currentPlan?.selectedFrequency || 'monthly');
    await fetchAvailablePlans();
    setShowAssociatePlanModal(true);
  };

  // Handle plan association
  const handleAssociatePlan = async () => {
    if (!selectedAccount || !selectedPlanId || !selectedFrequency) return;

    try {
      setAssociating(true);
      const response = await fetch(`/api/admin/dvyb-accounts/${selectedAccount.id}/associate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          planId: selectedPlanId,
          selectedFrequency,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        setShowAssociatePlanModal(false);
        fetchAccounts();
        alert(data.message);
      } else {
        alert(data.error || 'Failed to associate plan');
      }
    } catch (error) {
      console.error('Error associating plan:', error);
      alert('Failed to associate plan');
    } finally {
      setAssociating(false);
    }
  };

  // Open Delete confirmation modal
  const openDeleteModal = (account: DvybAccount) => {
    setAccountToDelete(account);
    setDeleteConfirmText('');
    setShowDeleteModal(true);
  };

  // Handle account deletion
  const handleDeleteAccount = async () => {
    if (!accountToDelete || deleteConfirmText !== 'delete') return;

    try {
      setDeleting(true);
      const response = await fetch(`/api/admin/dvyb-accounts/${accountToDelete.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationText: deleteConfirmText }),
      });

      const data = await response.json();
      
      if (data.success) {
        setShowDeleteModal(false);
        setAccountToDelete(null);
        setDeleteConfirmText('');
        fetchAccounts();
        alert(data.message);
      } else {
        alert(data.error || 'Failed to delete account');
      }
    } catch (error) {
      console.error('Error deleting account:', error);
      alert('Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
                className="flex items-center gap-2 text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <h1 className="text-3xl font-bold text-gray-900">DVYB Accounts</h1>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Accounts</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.totalActive}
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Inactive Accounts</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.totalInactive}
                  </p>
                </div>
                <XCircle className="h-8 w-8 text-red-500" />
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Accounts</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalAll}</p>
                </div>
                <Users className="h-8 w-8 text-blue-500" />
              </div>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by account name or email..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPagination({ ...pagination, page: 1 });
                  }}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPagination({ ...pagination, page: 1 });
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white text-gray-900"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
        </div>

        {/* Accounts Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Users className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">No accounts found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Account
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Current Plan
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Usage
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {accounts.map((account) => (
                    <tr key={account.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-12 w-12">
                            {account.logoPresignedUrl ? (
                              <Image
                                src={account.logoPresignedUrl}
                                alt={account.accountName}
                                width={48}
                                height={48}
                                className="h-12 w-12 rounded-lg object-contain border border-gray-200"
                                unoptimized
                              />
                            ) : (
                              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white font-bold text-lg">
                                {account.accountName.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {account.accountName}
                            </div>
                            <div className="text-sm text-gray-500 flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {account.primaryEmail}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {account.currentPlan ? (
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {account.currentPlan.planName}
                            </div>
                            <div className="text-xs text-gray-500">
                              {account.currentPlan.selectedFrequency === 'monthly' ? 'Monthly' : 'Annual'}
                            </div>
                            <div className="text-xs text-gray-600 mt-1 flex items-center gap-2">
                              <span className="flex items-center gap-1">
                                <ImageIcon className="h-3 w-3 text-gray-500" />
                                {account.currentPlan.imagePostsLimit}
                              </span>
                              <span className="flex items-center gap-1">
                                <Video className="h-3 w-3 text-gray-500" />
                                {account.currentPlan.videoPostsLimit}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 italic">No plan</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1 text-xs text-gray-600">
                              <ImageIcon className="h-3 w-3 text-gray-500" />
                              {account.usage?.imagesGenerated || 0}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-gray-600">
                              <Video className="h-3 w-3 text-gray-500" />
                              {account.usage?.videosGenerated || 0}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            account.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {account.isActive ? (
                            <>
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Active
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3 w-3 mr-1" />
                              Inactive
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Calendar className="h-3 w-3" />
                          {formatDate(account.createdAt)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Button
                            onClick={() => openAssociatePlanModal(account)}
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1 text-purple-600 border-purple-300 hover:bg-purple-50 text-xs px-2 py-1 h-7"
                          >
                            <DollarSign className="h-3 w-3" />
                            {account.currentPlan ? 'Change Plan' : 'Add Plan'}
                          </Button>
                          <Button
                            onClick={() => handleToggleStatus(account.id)}
                            disabled={toggling === account.id}
                            size="sm"
                            variant={account.isActive ? 'destructive' : 'default'}
                            className={`text-xs px-2 py-1 h-7 ${
                              account.isActive
                                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                : 'bg-green-600 hover:bg-green-700 text-white'
                            }`}
                          >
                            {toggling === account.id ? (
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                            ) : account.isActive ? (
                              'Deactivate'
                            ) : (
                              'Activate'
                            )}
                          </Button>
                          <Button
                            onClick={() => openDeleteModal(account)}
                            size="sm"
                            variant="destructive"
                            className="text-xs px-2 py-1 h-7 bg-red-600 hover:bg-red-700 text-white"
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && pagination.pages > 1 && (
            <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
              <div className="flex-1 flex justify-between sm:hidden">
                <Button
                  onClick={() => setPagination({ ...pagination, page: Math.max(1, pagination.page - 1) })}
                  disabled={pagination.page === 1}
                  variant="outline"
                  size="sm"
                  className="text-gray-900"
                >
                  Previous
                </Button>
                <Button
                  onClick={() => setPagination({ ...pagination, page: Math.min(pagination.pages, pagination.page + 1) })}
                  disabled={pagination.page === pagination.pages}
                  variant="outline"
                  size="sm"
                  className="text-gray-900"
                >
                  Next
                </Button>
              </div>
              <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-700">
                    Showing{' '}
                    <span className="font-medium">
                      {(pagination.page - 1) * pagination.limit + 1}
                    </span>{' '}
                    to{' '}
                    <span className="font-medium">
                      {Math.min(pagination.page * pagination.limit, pagination.total)}
                    </span>{' '}
                    of{' '}
                    <span className="font-medium">{pagination.total}</span>{' '}
                    accounts
                  </p>
                </div>
                <div>
                  <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                    <Button
                      onClick={() => setPagination({ ...pagination, page: Math.max(1, pagination.page - 1) })}
                      disabled={pagination.page === 1}
                      variant="outline"
                      size="sm"
                      className="rounded-l-md text-gray-900"
                    >
                      Previous
                    </Button>
                    {[...Array(pagination.pages)].map((_, i) => {
                      const pageNum = i + 1;
                      if (
                        pageNum === 1 ||
                        pageNum === pagination.pages ||
                        (pageNum >= pagination.page - 1 && pageNum <= pagination.page + 1)
                      ) {
                        return (
                          <Button
                            key={pageNum}
                            onClick={() => setPagination({ ...pagination, page: pageNum })}
                            variant={pagination.page === pageNum ? 'default' : 'outline'}
                            size="sm"
                            className={
                              pagination.page === pageNum
                                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                : 'text-gray-900'
                            }
                          >
                            {pageNum}
                          </Button>
                        );
                      } else if (
                        pageNum === pagination.page - 2 ||
                        pageNum === pagination.page + 2
                      ) {
                        return <span key={pageNum} className="px-2 text-gray-900">...</span>;
                      }
                      return null;
                    })}
                    <Button
                      onClick={() => setPagination({ ...pagination, page: Math.min(pagination.pages, pagination.page + 1) })}
                      disabled={pagination.page === pagination.pages}
                      variant="outline"
                      size="sm"
                      className="rounded-r-md text-gray-900"
                    >
                      Next
                    </Button>
                  </nav>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Associate Plan Modal */}
      {showAssociatePlanModal && selectedAccount && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">
                {selectedAccount.currentPlan ? 'Change Plan' : 'Associate Plan'}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {selectedAccount.accountName}
              </p>
            </div>
            <div className="p-6 space-y-4">
              {selectedAccount.currentPlan && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-600 font-medium">Current Plan</p>
                  <p className="text-sm font-bold text-blue-900">{selectedAccount.currentPlan.planName}</p>
                  <p className="text-xs text-blue-700">
                    {selectedAccount.currentPlan.selectedFrequency === 'monthly' ? 'Monthly' : 'Annual'} • 
                    📸 {selectedAccount.currentPlan.imagePostsLimit} • 
                    🎥 {selectedAccount.currentPlan.videoPostsLimit}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Plan *
                </label>
                <select
                  value={selectedPlanId || ''}
                  onChange={(e) => setSelectedPlanId(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                  required
                >
                  <option value="">Choose a plan...</option>
                  {availablePlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.planName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Billing Frequency *
                </label>
                <select
                  value={selectedFrequency}
                  onChange={(e) => setSelectedFrequency(e.target.value as 'monthly' | 'annual')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                  required
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual (Save More!)</option>
                </select>
              </div>

              {selectedPlanId && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  {(() => {
                    const selectedPlan = availablePlans.find(p => p.id === selectedPlanId);
                    if (!selectedPlan) return null;
                    
                    const priceRaw = selectedFrequency === 'monthly' ? selectedPlan.monthlyPrice : selectedPlan.annualPrice;
                    const price = typeof priceRaw === 'number' ? priceRaw : parseFloat(priceRaw || '0');
                    const imageLimit = selectedFrequency === 'monthly' ? selectedPlan.monthlyImageLimit : selectedPlan.annualImageLimit;
                    const videoLimit = selectedFrequency === 'monthly' ? selectedPlan.monthlyVideoLimit : selectedPlan.annualVideoLimit;
                    
                    return (
                      <>
                        <p className="text-xs text-gray-600">Selected Plan Details</p>
                        <p className="text-sm font-bold text-gray-900">{selectedPlan.planName}</p>
                        <p className="text-xs text-gray-700">
                          ${price.toFixed(2)}/{selectedFrequency === 'monthly' ? 'month' : 'year'}
                        </p>
                        <div className="mt-2 flex gap-3 text-xs text-gray-600">
                          <span>📸 {imageLimit} images</span>
                          <span>🎥 {videoLimit} videos</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-gray-200 flex gap-3">
              <Button
                onClick={() => {
                  setShowAssociatePlanModal(false);
                  setSelectedAccount(null);
                  setSelectedPlanId(null);
                  setSelectedFrequency('monthly');
                }}
                variant="outline"
                className="flex-1 text-gray-900 border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAssociatePlan}
                disabled={!selectedPlanId || associating}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
              >
                {associating ? 'Associating...' : selectedAccount.currentPlan ? 'Change Plan' : 'Associate Plan'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && accountToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-red-600">⚠️ Delete Account</h2>
              <p className="text-sm text-gray-600 mt-1">
                This action is <span className="font-bold text-red-600">permanent</span> and cannot be undone.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-gray-800">
                  You are about to permanently delete the account:
                </p>
                <p className="font-bold text-gray-900 mt-2 text-lg">{accountToDelete.accountName}</p>
                <p className="text-sm text-gray-600">{accountToDelete.primaryEmail}</p>
              </div>
              
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-800 mb-2">
                  This will permanently delete:
                </p>
                <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                  <li>Account profile and settings</li>
                  <li>All generated content</li>
                  <li>All scheduled posts</li>
                  <li>All platform connections</li>
                  <li>All posted content records</li>
                  <li>Brand context and configurations</li>
                </ul>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Type <span className="font-bold text-red-600">delete</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value.toLowerCase())}
                  placeholder="Type 'delete' here"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 text-gray-900"
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex gap-3">
              <Button
                onClick={() => {
                  setShowDeleteModal(false);
                  setAccountToDelete(null);
                  setDeleteConfirmText('');
                }}
                variant="outline"
                className="flex-1 text-gray-700 border-gray-300 hover:bg-gray-100"
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'delete' || deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Deleting...
                  </div>
                ) : (
                  'Delete Account'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

