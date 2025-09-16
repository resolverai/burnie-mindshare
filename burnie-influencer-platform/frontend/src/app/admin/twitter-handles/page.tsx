'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, 
  Search, 
  Upload, 
  RefreshCw, 
  Trash2, 
  Plus,
  Filter,
  Calendar,
  Users,
  TrendingUp,
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react';

interface Handle {
  id: number;
  twitter_handle: string;
  display_name?: string;
  followers_count: number;
  following_count: number;
  tweet_count: number;
  verified: boolean;
  profile_image_url?: string;
  last_tweet_id?: string;
  last_fetch_at?: string;
  status: string;
  error_message?: string;
  fetch_count: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface ApiResponse {
  success: boolean;
  data: Handle[];
  pagination: Pagination;
}

export default function TwitterHandlesPage() {
  const router = useRouter();
  const [handles, setHandles] = useState<Handle[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [newHandle, setNewHandle] = useState({ 
    twitter_handle: '', 
    display_name: ''
  });
  const [selectedHandles, setSelectedHandles] = useState<number[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [refreshing, setRefreshing] = useState<number | null>(null);

  // Fetch handles
  const fetchHandles = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        ...(searchTerm && { search: searchTerm }),
        ...(statusFilter !== 'ALL' && { status: statusFilter })
      });

      const response = await fetch(`/api/admin/twitter-handles?${params}`);
      const data: ApiResponse = await response.json();

      if (data.success) {
        setHandles(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching handles:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHandles();
  }, [pagination.page, searchTerm, statusFilter]);

  // Add single handle
  const handleAddHandle = async () => {
    try {
      const response = await fetch('/api/admin/twitter-handles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHandle)
      });

      const data = await response.json();
      if (data.success) {
        setShowAddModal(false);
        setNewHandle({ twitter_handle: '', display_name: '' });
        fetchHandles();
        alert(`Successfully added @${data.data.twitter_handle}`);
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error adding handle:', error);
      alert('Failed to add handle');
    }
  };

  // Bulk upload
  const handleBulkUpload = async () => {
    if (!csvFile) return;

    try {
      const formData = new FormData();
      formData.append('csvFile', csvFile);

      const response = await fetch('/api/admin/twitter-handles/bulk-upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        setShowBulkUploadModal(false);
        setCsvFile(null);
        fetchHandles();
        alert(`Successfully uploaded ${data.data.uploaded.length} handles. ${data.data.errors.length} errors.`);
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error bulk uploading:', error);
      alert('Failed to upload CSV');
    }
  };

  // Toggle handle selection
  const toggleHandleSelection = (handleId: number) => {
    setSelectedHandles(prev => 
      prev.includes(handleId) 
        ? prev.filter(id => id !== handleId)
        : [...prev, handleId]
    );
  };

  // Select all handles
  const selectAllHandles = () => {
    setSelectedHandles(handles.map(h => h.id));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedHandles([]);
  };

  // Refresh selected handles
  const handleRefreshSelected = async () => {
    if (selectedHandles.length === 0) {
      alert('Please select handles to refresh');
      return;
    }

    try {
      const response = await fetch('/api/admin/twitter-handles/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          handle_ids: selectedHandles
        })
      });

      const data = await response.json();
      if (data.success) {
        fetchHandles();
        setSelectedHandles([]);
        alert(`Successfully refreshed ${selectedHandles.length} handles`);
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error refreshing handles:', error);
      alert('Failed to refresh handles');
    }
  };

  // Refresh individual handle
  const handleRefreshHandle = async (handleId: number, twitterHandle: string) => {
    try {
      setRefreshing(handleId);
      const response = await fetch(`/api/admin/twitter-handles/refresh/${handleId}`, {
        method: 'POST'
      });

      const data = await response.json();
      if (data.success) {
        fetchHandles();
        alert(`Successfully refreshed @${twitterHandle}`);
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error refreshing handle:', error);
      alert('Failed to refresh handle');
    } finally {
      setRefreshing(null);
    }
  };

  // Delete handle
  const handleDeleteHandle = async (handleId: number, twitterHandle: string) => {
    if (!confirm(`Are you sure you want to delete @${twitterHandle}?`)) return;

    try {
      const response = await fetch(`/api/admin/twitter-handles/${handleId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        fetchHandles();
        alert(`Successfully deleted @${twitterHandle}`);
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error deleting handle:', error);
      alert('Failed to delete handle');
    }
  };

  // Trigger processing
  const handleTriggerProcessing = async () => {
    try {
      const response = await fetch('/api/admin/twitter-handles/trigger-processing', {
        method: 'POST'
      });

      const data = await response.json();
      if (data.success) {
        alert('Processing triggered successfully');
        fetchHandles();
      } else {
        alert(data.message);
      }
    } catch (error) {
      console.error('Error triggering processing:', error);
      alert('Failed to trigger processing');
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full flex items-center gap-1"><CheckCircle className="h-3 w-3" />Active</span>;
      case 'pending':
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full flex items-center gap-1"><Clock className="h-3 w-3" />Pending</span>;
      case 'processing':
        return <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" />Processing</span>;
      case 'error':
        return <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full flex items-center gap-1"><AlertCircle className="h-3 w-3" />Error</span>;
      default:
        return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded-full">{status}</span>;
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  // Format number
  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
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
              <h1 className="text-3xl font-bold text-gray-900">Twitter Handles</h1>
            </div>
            <div className="flex items-center gap-3">
              <Button 
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add Handle
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowBulkUploadModal(true)}
                className="flex items-center gap-2 text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                <Upload className="h-4 w-4" />
                Bulk Upload
              </Button>
              <Button 
                variant="outline" 
                onClick={handleTriggerProcessing}
                className="flex items-center gap-2 text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                <RefreshCw className="h-4 w-4" />
                Trigger Processing
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-2xl font-bold text-gray-900">{pagination.total}</div>
              <div className="text-sm text-gray-600">Total Handles</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-2xl font-bold text-gray-900">
                {handles.filter(h => h.status === 'active').length}
              </div>
              <div className="text-sm text-gray-600">Active Handles</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-2xl font-bold text-gray-900">
                {handles.filter(h => h.status === 'pending').length}
              </div>
              <div className="text-sm text-gray-600">Pending Handles</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-2xl font-bold text-gray-900">
                {handles.reduce((sum, h) => sum + h.fetch_count, 0)}
              </div>
              <div className="text-sm text-gray-600">Total Fetches</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search handles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
            >
              <option value="ALL">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="suspended">Suspended</option>
              <option value="error">Error</option>
            </select>
            <div className="flex items-center gap-2">
              <Button
                onClick={selectAllHandles}
                variant="outline"
                size="sm"
                className="text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                Select All
              </Button>
              <Button
                onClick={clearSelection}
                variant="outline"
                size="sm"
                className="text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                Clear
              </Button>
              <Button
                onClick={handleRefreshSelected}
                disabled={selectedHandles.length === 0}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh Selected ({selectedHandles.length})
              </Button>
            </div>
          </div>
        </div>

        {/* Handles List */}
        <div className="bg-white rounded-lg shadow">
          {loading ? (
            <div className="p-8 text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">Loading handles...</p>
            </div>
          ) : handles.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">No handles found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={selectedHandles.length === handles.length && handles.length > 0}
                        onChange={selectedHandles.length === handles.length ? clearSelection : selectAllHandles}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Handle</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Followers</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tweets</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Fetch</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fetch Count</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {handles.map((handle) => (
                    <tr key={handle.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedHandles.includes(handle.id)}
                          onChange={() => toggleHandleSelection(handle.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {handle.profile_image_url && (
                            <img 
                              src={handle.profile_image_url} 
                              alt={handle.twitter_handle}
                              className="h-10 w-10 rounded-full mr-3"
                            />
                          )}
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              @{handle.twitter_handle}
                              {handle.verified && <span className="ml-1 text-blue-500">✓</span>}
                            </div>
                            {handle.display_name && (
                              <div className="text-sm text-gray-500">{handle.display_name}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatNumber(handle.followers_count)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatNumber(handle.tweet_count)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(handle.status)}
                        {handle.error_message && (
                          <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={handle.error_message}>
                            {handle.error_message}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {handle.last_fetch_at ? formatDate(handle.last_fetch_at) : 'Never'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {handle.fetch_count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRefreshHandle(handle.id, handle.twitter_handle)}
                            disabled={refreshing === handle.id}
                            className="text-blue-600 border-blue-300 hover:bg-blue-50"
                            title={`Refresh data for @${handle.twitter_handle}`}
                          >
                            <RefreshCw className={`h-4 w-4 ${refreshing === handle.id ? 'animate-spin' : ''}`} />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteHandle(handle.id, handle.twitter_handle)}
                            title={`Delete @${handle.twitter_handle}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <div className="text-sm text-gray-700">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} handles
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                disabled={pagination.page === 1}
                className="text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                Previous
              </Button>
              <span className="px-3 py-2 text-sm text-gray-700">
                Page {pagination.page} of {pagination.pages}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPagination(prev => ({ ...prev, page: Math.min(pagination.pages, prev.page + 1) }))}
                disabled={pagination.page === pagination.pages}
                className="text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Add Handle Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Add Twitter Handle</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Twitter Handle
                  </label>
                  <input
                    type="text"
                    placeholder="@username or username"
                    value={newHandle.twitter_handle}
                    onChange={(e) => setNewHandle({ ...newHandle, twitter_handle: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Display Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="Display name"
                    value={newHandle.display_name}
                    onChange={(e) => setNewHandle({ ...newHandle, display_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowAddModal(false)}
                    className="text-gray-700 border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddHandle}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Add Handle
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Upload Modal */}
        {showBulkUploadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">Bulk Upload Handles</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    CSV File
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    CSV should have a column named 'twitter_handle', 'handle', or 'Twitter Handle'
                  </p>
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowBulkUploadModal(false)}
                    className="text-gray-700 border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleBulkUpload}
                    disabled={!csvFile}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    Upload CSV
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}