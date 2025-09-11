'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { ArrowLeft } from 'lucide-react';

interface WaitlistEntry {
  id: number;
  walletAddress: string;
  email?: string;
  username?: string;
  reason?: string;
  twitterHandle?: string;
  discordHandle?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: {
    id: number;
    username: string;
    walletAddress: string;
  };
  approvedAt?: string;
  adminNotes?: string;
  priority: number;
  position: number;
  createdAt: string;
}

interface ApprovalForm {
  adminNotes: string;
}

const WaitlistManagement: React.FC = () => {
  const router = useRouter();
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<WaitlistEntry | null>(null);
  const [approvalForm, setApprovalForm] = useState<ApprovalForm>({ adminNotes: '' });
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');

  useEffect(() => {
    fetchWaitlistEntries();
  }, [statusFilter, currentPage]);

  const fetchWaitlistEntries = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20'
      });
      
      if (statusFilter !== 'ALL') {
        params.append('status', statusFilter);
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/waitlist/admin/list?${params}`
      );
      const result = await response.json();
      
      if (result.success) {
        setWaitlistEntries(result.data.entries);
        setTotalPages(result.data.pagination.totalPages);
      }
    } catch (error) {
      console.error('Error fetching waitlist entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprovalAction = (entry: WaitlistEntry, action: 'approve' | 'reject') => {
    setSelectedEntry(entry);
    setActionType(action);
    setApprovalForm({ adminNotes: '' });
    setShowApprovalModal(true);
  };

  const submitApprovalAction = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedEntry) return;

    try {
      const endpoint = actionType === 'approve' ? 'approve' : 'reject';
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/waitlist/admin/${endpoint}/${selectedEntry.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            adminUserId: 1, // TODO: Get actual admin user ID from auth context
            adminNotes: approvalForm.adminNotes
          })
        }
      );

      const result = await response.json();
      
      if (result.success) {
        setShowApprovalModal(false);
        setSelectedEntry(null);
        await fetchWaitlistEntries();
      } else {
        // Show detailed error message for Twitter handle conflicts
        if (result.data && result.data.conflictingUser) {
          const errorMsg = `${result.message}\n\nConflicting User:\n- ID: ${result.data.conflictingUser.id}\n- Wallet: ${result.data.conflictingUser.walletAddress}\n- Username: ${result.data.conflictingUser.username || 'N/A'}\n- Current Twitter Handle: ${result.data.conflictingUser.currentTwitterHandle || 'N/A'}\n\nWaitlist Entry:\n- ID: ${result.data.waitlistEntry.id}\n- Wallet: ${result.data.waitlistEntry.walletAddress}\n- Twitter: @${result.data.waitlistEntry.twitterHandle}`;
          alert(errorMsg);
        } else {
          alert(result.message || `Failed to ${actionType} entry`);
        }
      }
    } catch (error) {
      console.error(`Error ${actionType}ing entry:`, error);
      alert(`Failed to ${actionType} entry`);
    }
  };

  const updatePriority = async (entryId: number, priority: number) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/waitlist/admin/priority/${entryId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ priority })
        }
      );

      const result = await response.json();
      
      if (result.success) {
        await fetchWaitlistEntries();
      } else {
        alert(result.message || 'Failed to update priority');
      }
    } catch (error) {
      console.error('Error updating priority:', error);
      alert('Failed to update priority');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED': return 'bg-green-100 text-green-800 border-green-200';
      case 'REJECTED': return 'bg-red-100 text-red-800 border-red-200';
      case 'PENDING': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 100) return 'bg-red-100 text-red-800 border-red-200';
    if (priority >= 50) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (priority >= 10) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-lg text-gray-600">Loading waitlist entries...</div>
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
              <h1 className="text-3xl font-bold text-gray-900">Waitlist Management</h1>
              <p className="text-gray-600 mt-2">Manage user waitlist applications and approvals</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED');
                    setCurrentPage(1);
                  }}
                  className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Approval Modal */}
        {showApprovalModal && selectedEntry && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-md bg-white">
              <CardHeader>
                <CardTitle className="capitalize">
                  {actionType} Waitlist Entry
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="text-sm text-gray-500">Wallet Address</div>
                  <div className="font-mono text-sm bg-gray-100 p-2 rounded break-all">
                    {selectedEntry.walletAddress}
                  </div>
                </div>
                
                {selectedEntry.username && (
                  <div className="mb-4">
                    <div className="text-sm text-gray-500">Username</div>
                    <div className="text-sm">{selectedEntry.username}</div>
                  </div>
                )}
                
                {selectedEntry.reason && (
                  <div className="mb-4">
                    <div className="text-sm text-gray-500">Reason</div>
                    <div className="text-sm bg-gray-50 p-2 rounded">{selectedEntry.reason}</div>
                  </div>
                )}
                
                <form onSubmit={submitApprovalAction} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Admin Notes
                    </label>
                    <textarea
                      value={approvalForm.adminNotes}
                      onChange={(e) => setApprovalForm({ ...approvalForm, adminNotes: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      placeholder="Optional notes about this decision..."
                    />
                  </div>
                  
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      onClick={() => setShowApprovalModal(false)}
                      variant="outline"
                      className="text-gray-700 border-gray-300 hover:bg-gray-50"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className={actionType === 'approve' 
                        ? "bg-green-600 hover:bg-green-700 text-white" 
                        : "bg-red-600 hover:bg-red-700 text-white"
                      }
                    >
                      {actionType === 'approve' ? 'Approve' : 'Reject'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Waitlist Entries */}
        <div className="grid gap-4">
          {waitlistEntries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-gray-500">No waitlist entries found</div>
              </CardContent>
            </Card>
          ) : (
            waitlistEntries.map((entry) => (
              <Card key={entry.id} className="border-l-4 border-l-blue-500">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        Position #{entry.position}
                      </CardTitle>
                      <div className="text-sm text-gray-600 mt-1">
                        {entry.username || 'No username'} • Applied {new Date(entry.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getPriorityColor(entry.priority)}>
                        Priority: {entry.priority}
                      </Badge>
                      <Badge className={getStatusColor(entry.status)}>
                        {entry.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-sm text-gray-500">Wallet Address</div>
                      <div className="font-mono text-sm bg-gray-100 p-2 rounded break-all">
                        {entry.walletAddress}
                      </div>
                    </div>
                    
                    {entry.email && (
                      <div>
                        <div className="text-sm text-gray-500">Email</div>
                        <div className="text-sm">{entry.email}</div>
                      </div>
                    )}
                    
                    <div>
                      <div className="text-sm text-gray-500">Twitter</div>
                      <div className="text-sm">
                        {entry.twitterHandle ? `@${entry.twitterHandle}` : 'Not provided'}
                      </div>
                    </div>
                    
                    {entry.discordHandle && (
                      <div>
                        <div className="text-sm text-gray-500">Discord</div>
                        <div className="text-sm">{entry.discordHandle}</div>
                      </div>
                    )}
                  </div>
                  
                  {entry.reason && (
                    <div className="mb-4">
                      <div className="text-sm text-gray-500 mb-1">Reason for Joining</div>
                      <div className="text-sm bg-gray-50 p-3 rounded">{entry.reason}</div>
                    </div>
                  )}
                  
                  {entry.adminNotes && (
                    <div className="mb-4">
                      <div className="text-sm text-gray-500 mb-1">Admin Notes</div>
                      <div className="text-sm bg-blue-50 p-3 rounded border-l-4 border-blue-200">
                        {entry.adminNotes}
                      </div>
                    </div>
                  )}
                  
                  {entry.approvedBy && (
                    <div className="mb-4">
                      <div className="text-sm text-gray-500 mb-1">
                        {entry.status === 'APPROVED' ? 'Approved' : 'Rejected'} by
                      </div>
                      <div className="text-sm">
                        {entry.approvedBy.username} on {new Date(entry.approvedAt!).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between pt-4 border-t">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">Priority:</span>
                      <input
                        type="number"
                        value={entry.priority}
                        onChange={(e) => updatePriority(entry.id, parseInt(e.target.value) || 0)}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        min="0"
                        max="999"
                      />
                    </div>
                    
                    {entry.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleApprovalAction(entry, 'approve')}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          Approve
                        </Button>
                        <Button
                          onClick={() => handleApprovalAction(entry, 'reject')}
                          size="sm"
                          className="bg-red-600 hover:bg-red-700 text-white"
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-8">
            <Button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              variant="outline"
              className="text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </Button>
            
            <span className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            
            <Button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              variant="outline"
              className="text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default WaitlistManagement;
