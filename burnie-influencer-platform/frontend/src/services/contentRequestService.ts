import { ContentRequestStatus } from '../types/contentRequest';

export interface ContentRequestData {
  projectName: string;
  platform: string;
  campaignLinks: string;
  walletAddress?: string;
}

export interface ContentRequest {
  id: string;
  projectName: string;
  platform: string;
  campaignLinks: string;
  status: ContentRequestStatus;
  walletAddress?: string;
  adminNotes?: string;
  generatedContent?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRequestResponse {
  success: boolean;
  data: ContentRequest;
  message: string;
}

export interface ContentRequestListResponse {
  success: boolean;
  data: {
    contentRequests: ContentRequest[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export class ContentRequestService {
  // Create a new content request
  static async createContentRequest(data: ContentRequestData): Promise<ContentRequestResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/content-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create content request');
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating content request:', error);
      throw error;
    }
  }

  // Get content requests by wallet address
  static async getContentRequestsByWallet(
    walletAddress: string,
    page: number = 1,
    limit: number = 10
  ): Promise<ContentRequestListResponse> {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_BASE_URL}/api/content-requests/wallet/${walletAddress}?page=${page}&limit=${limit}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch content requests');
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching content requests:', error);
      throw error;
    }
  }

  // Get all content requests (admin only)
  static async getAllContentRequests(
    page: number = 1,
    limit: number = 10,
    search?: string,
    status?: ContentRequestStatus
  ): Promise<ContentRequestListResponse> {
    try {
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(search && { search }),
        ...(status && { status }),
      });

      const response = await fetch(
        `${API_BASE_URL}/api/admin/content-requests?${params}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch content requests');
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching content requests:', error);
      throw error;
    }
  }

  // Update content request status (admin only)
  static async updateContentRequestStatus(
    id: string,
    status: ContentRequestStatus,
    adminNotes?: string,
    generatedContent?: string
  ): Promise<ContentRequestResponse> {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`${API_BASE_URL}/api/admin/content-requests/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          status,
          adminNotes,
          generatedContent,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update content request status');
      }

      return await response.json();
    } catch (error) {
      console.error('Error updating content request status:', error);
      throw error;
    }
  }

  // Get content request by ID (admin only)
  static async getContentRequestById(id: string): Promise<ContentRequestResponse> {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`${API_BASE_URL}/api/admin/content-requests/${id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch content request');
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching content request:', error);
      throw error;
    }
  }

  // Delete content request (admin only)
  static async deleteContentRequest(id: string): Promise<{ success: boolean; message: string }> {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`${API_BASE_URL}/api/admin/content-requests/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete content request');
      }

      return await response.json();
    } catch (error) {
      console.error('Error deleting content request:', error);
      throw error;
    }
  }
}
