"use client";

import React, { useState, useEffect } from 'react';
import { ContentRequestService } from '../../services/contentRequestService';
import { ContentRequest, ContentRequestStatus } from '../../types/contentRequest';
import { MagnifyingGlassIcon, EyeIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';

interface ContentRequestManagementProps {
  className?: string;
}

export default function ContentRequestManagement({ className = '' }: ContentRequestManagementProps) {
  const [contentRequests, setContentRequests] = useState<ContentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContentRequestStatus | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState<ContentRequest | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [updating, setUpdating] = useState(false);

  const itemsPerPage = 10;

  // Fetch content requests
  const fetchContentRequests = async () => {
    try {
      setLoading(true);
      const response = await ContentRequestService.getAllContentRequests(
        currentPage,
        itemsPerPage,
        searchTerm || undefined,
        statusFilter !== 'all' ? statusFilter : undefined
      );
      
      if (response.success) {
        setContentRequests(response.data.contentRequests);
        setTotalPages(response.data.pagination.totalPages);
      }
    } catch (error) {
      console.error('Error fetching content requests:', error);
      alert('Failed to fetch content requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContentRequests();
  }, [currentPage, searchTerm, statusFilter]);

  // Handle status update
  const handleStatusUpdate = async (requestId: string, newStatus: ContentRequestStatus) => {
    try {
      setUpdating(true);
      const response = await ContentRequestService.updateContentRequestStatus(
        requestId,
        newStatus,
        adminNotes,
        generatedContent
      );
      
      if (response.success) {
        await fetchContentRequests();
        setShowModal(false);
        setSelectedRequest(null);
        setAdminNotes('');
        setGeneratedContent('');
        alert('Content request updated successfully');
      }
    } catch (error) {
      console.error('Error updating content request:', error);
      alert('Failed to update content request');
    } finally {
      setUpdating(false);
    }
  };

  // Handle delete
  const handleDelete = async (requestId: string) => {
    if (!confirm('Are you sure you want to delete this content request?')) {
      return;
    }

    try {
      const response = await ContentRequestService.deleteContentRequest(requestId);
      if (response.success) {
        await fetchContentRequests();
        alert('Content request deleted successfully');
      }
    } catch (error) {
      console.error('Error deleting content request:', error);
      alert('Failed to delete content request');
    }
  };

  // Open modal for editing
  const openEditModal = (request: ContentRequest) => {
    setSelectedRequest(request);
    setAdminNotes(request.adminNotes || '');
    setGeneratedContent(request.generatedContent || '');
    setShowModal(true);
  };

  // Get status badge color
  const getStatusBadgeColor = (status: ContentRequestStatus) => {
    switch (status) {
      case ContentRequestStatus.REQUESTED:
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case ContentRequestStatus.INPROGRESS:
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case ContentRequestStatus.COMPLETED:
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className={`space-y-6 ${className}`}>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by project name, platform, or wallet address..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ContentRequestStatus | 'all')}
          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="all">All Status</option>
          <option value={ContentRequestStatus.REQUESTED}>Requested</option>
          <option value={ContentRequestStatus.INPROGRESS}>In Progress</option>
          <option value={ContentRequestStatus.COMPLETED}>Completed</option>
        </select>
      </div>

      {/* Content Requests Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p className="text-gray-600 mt-2">Loading content requests...</p>
          </div>
        ) : contentRequests.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-600">No content requests found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Wallet</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {contentRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-gray-900 font-medium">{request.projectName}</div>
                      {request.campaignLinks && (
                        <div className="text-gray-500 text-xs mt-1 truncate max-w-xs">
                          {request.campaignLinks.substring(0, 50)}...
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{request.platform}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${getStatusBadgeColor(request.status)}`}>
                        {request.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-sm">
                      {request.walletAddress ? `${request.walletAddress.slice(0, 6)}...${request.walletAddress.slice(-4)}` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-sm">{formatDate(request.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(request)}
                          className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                          title="Edit"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(request.id)}
                          className="p-1 text-red-500 hover:text-red-700 transition-colors"
                          title="Delete"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-gray-600 text-sm">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 bg-white border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 bg-white border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showModal && selectedRequest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-gray-900">Edit Content Request</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Project Name</label>
                <div className="text-gray-900">{selectedRequest.projectName}</div>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Platform</label>
                <div className="text-gray-900">{selectedRequest.platform}</div>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Campaign Links</label>
                <div className="text-gray-600 text-sm bg-gray-50 p-3 rounded border border-gray-200 max-h-32 overflow-y-auto">
                  {selectedRequest.campaignLinks}
                </div>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Current Status</label>
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${getStatusBadgeColor(selectedRequest.status)}`}>
                  {selectedRequest.status}
                </span>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Admin Notes</label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add admin notes..."
                />
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">Generated Content</label>
                <textarea
                  value={generatedContent}
                  onChange={(e) => setGeneratedContent(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Add generated content..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => handleStatusUpdate(selectedRequest.id, ContentRequestStatus.INPROGRESS)}
                  disabled={updating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {updating ? 'Updating...' : 'Mark In Progress'}
                </button>
                <button
                  onClick={() => handleStatusUpdate(selectedRequest.id, ContentRequestStatus.COMPLETED)}
                  disabled={updating}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {updating ? 'Updating...' : 'Mark Completed'}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
