import axios from 'axios'
import type {
  User,
  Project,
  Campaign,
  Submission,
  Miner,
  Analytics,
  ApiResponse,
  PaginatedResponse,
  CreateProjectRequest,
  CreateCampaignRequest,
} from '@/types'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor for auth
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Analytics API
export const analyticsApi = {
  getDashboard: async (): Promise<Analytics> => {
    const response = await api.get('/api/analytics/dashboard')
    return response.data
  },
}

// Projects API
export const projectsApi = {
  getAll: async (page = 1, size = 10): Promise<PaginatedResponse<Project>> => {
    const response = await api.get(`/api/projects/?page=${page}&size=${size}`)
    
    // Backend returns { success: true, data: [...], pagination: {...} }
    // Frontend expects { items: [...], total, page, size, pages }
    if (response.data.success && response.data.data) {
      // Transform backend fields to frontend format
      const transformedItems = response.data.data.map((project: any) => ({
        id: project.id.toString(),
        name: project.name,
        description: project.description,
        website_url: project.website,
        created_by: project.ownerId?.toString() || '1',
        status: project.isActive ? 'active' : 'inactive',
        created_at: project.createdAt,
        updated_at: project.updatedAt,
        campaigns: project.campaigns || []
      }));
      
      return {
        items: transformedItems,
        total: response.data.pagination?.total || response.data.data.length,
        page: response.data.pagination?.page || page,
        size: response.data.pagination?.limit || size,
        pages: response.data.pagination?.totalPages || Math.ceil((response.data.pagination?.total || response.data.data.length) / size)
      }
    }
    
    // Fallback for unexpected format
    return {
      items: [],
      total: 0,
      page: 1,
      size: 10,
      pages: 0
    }
  },

  getById: async (id: string): Promise<Project> => {
    const response = await api.get(`/api/projects/${id}`)
    return response.data
  },

  create: async (data: CreateProjectRequest): Promise<Project> => {
    const response = await api.post('/api/projects/', data)
    return response.data
  },

  update: async (id: string, data: Partial<CreateProjectRequest>): Promise<Project> => {
    const response = await api.put(`/api/projects/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/projects/${id}`)
  },
}

// Campaigns API
export const campaignsApi = {
  getAll: async (page = 1, size = 10): Promise<PaginatedResponse<Campaign>> => {
    const response = await api.get(`/api/campaigns/?page=${page}&size=${size}`)
    
    // Transform backend response to frontend format
    if (response.data.success && response.data.data) {
      const transformedItems = response.data.data.map((campaign: any) => ({
        id: campaign.id.toString(),
        project_id: campaign.projectId?.toString() || '',
        title: campaign.title,
        description: campaign.description,
        topic: campaign.category || 'General', // Map category to topic
        guidelines: campaign.requirements ? JSON.stringify(campaign.requirements) : '',
        budget: campaign.rewardPool || '0', // Keep as text since it's now a text field
        reward_per_roast: 0, // Can't calculate this anymore since rewardPool is text
        max_submissions: campaign.maxSubmissions,
        status: campaign.status.toLowerCase(), // Convert ACTIVE to active
        start_date: campaign.startDate,
        end_date: campaign.endDate,
        created_at: campaign.createdAt,
        updated_at: campaign.updatedAt,
        submissions_count: campaign.submissionCount || 0,
        current_submissions: campaign.currentSubmissions || 0,
        project: campaign.project
      }));
      
      return {
        items: transformedItems,
        total: response.data.pagination?.total || response.data.data.length,
        page: response.data.pagination?.page || page,
        size: response.data.pagination?.limit || size,
        pages: response.data.pagination?.totalPages || Math.ceil((response.data.pagination?.total || response.data.data.length) / size)
      }
    }
    
    // Fallback for unexpected format
    return {
      items: [],
      total: 0,
      page: 1,
      size: 10,
      pages: 0
    }
  },

  getById: async (id: string): Promise<Campaign> => {
    const response = await api.get(`/api/campaigns/${id}`)
    return response.data
  },

  getByProject: async (projectId: string): Promise<Campaign[]> => {
    const response = await api.get(`/api/projects/${projectId}/campaigns`)
    return response.data
  },

  create: async (data: CreateCampaignRequest): Promise<Campaign> => {
    const response = await api.post('/api/campaigns/', data)
    return response.data
  },

  update: async (id: string, data: Partial<CreateCampaignRequest>): Promise<Campaign> => {
    const response = await api.put(`/api/campaigns/${id}`, data)
    return response.data
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/campaigns/${id}`)
  },

  activate: async (id: string): Promise<Campaign> => {
    const response = await api.post(`/api/campaigns/${id}/activate`)
    return response.data
  },

  deactivate: async (id: string): Promise<Campaign> => {
    const response = await api.post(`/api/campaigns/${id}/deactivate`)
    return response.data
  },
}

// Submissions API
export const submissionsApi = {
  getByCampaign: async (campaignId: string, page = 1, size = 10): Promise<PaginatedResponse<Submission>> => {
    const response = await api.get(`/api/campaigns/${campaignId}/submissions?page=${page}&size=${size}`)
    return response.data
  },

  getById: async (id: string): Promise<Submission> => {
    const response = await api.get(`/api/submissions/${id}`)
    return response.data
  },

  approve: async (id: string): Promise<Submission> => {
    const response = await api.post(`/api/submissions/${id}/approve`)
    return response.data
  },

  reject: async (id: string): Promise<Submission> => {
    const response = await api.post(`/api/submissions/${id}/reject`)
    return response.data
  },
}

// Miners API
export const minersApi = {
  getAll: async (page = 1, size = 10): Promise<PaginatedResponse<Miner>> => {
    const response = await api.get(`/api/miners?page=${page}&size=${size}`)
    return response.data
  },

  getById: async (id: string): Promise<Miner> => {
    const response = await api.get(`/api/miners/${id}`)
    return response.data
  },
}

// Auth API
export const authApi = {
  login: async (email: string, password: string): Promise<{ token: string; user: User }> => {
    const response = await api.post('/api/auth/login', { email, password })
    return response.data
  },

  register: async (userData: { username: string; email: string; password: string }): Promise<{ token: string; user: User }> => {
    const response = await api.post('/api/auth/register', userData)
    return response.data
  },

  me: async (): Promise<User> => {
    const response = await api.get('/api/auth/me')
    return response.data
  },
}

export default api 