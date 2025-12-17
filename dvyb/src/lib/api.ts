const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Get account ID from localStorage (fallback for Safari/browsers that block cookies)
// Only returns header if user has an active session (not logged out)
function getAccountIdHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  
  // Check if session is active - this is cleared on logout
  const sessionActive = localStorage.getItem('dvyb_session_active');
  if (sessionActive !== 'true') {
    // Session not active (user logged out or never logged in)
    return {};
  }
  
  const accountId = localStorage.getItem('dvyb_account_id');
  if (accountId) {
    return { 'X-DVYB-Account-ID': accountId };
  }
  
  return {};
}

// Generic API request helper
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  
  // Check if this is a FormData request (for file uploads)
  const isFormData = options.body instanceof FormData;
  
  // Build headers - always include account ID header for Safari/ITP compatibility
  const accountIdHeader = getAccountIdHeader();
  const baseHeaders: Record<string, string> = {
    ...accountIdHeader, // Always include account ID header
  };
  
  // Only add Content-Type for non-FormData requests
  // For FormData, let the browser set the Content-Type with boundary
  if (!isFormData) {
    baseHeaders['Content-Type'] = 'application/json';
  }
  
  // Merge with any custom headers (but ensure account ID is always present)
  const customHeaders = options.headers as Record<string, string> || {};
  const finalHeaders = {
    ...baseHeaders,
    ...customHeaders,
    ...accountIdHeader, // Re-add to ensure it's not overwritten
  };
  
  const defaultOptions: RequestInit = {
    credentials: 'include', // Include cookies for session management
    ...options,
    headers: finalHeaders,
  };

  try {
    console.log(`🌐 API Request: ${options.method || 'GET'} ${url}`);
    const response = await fetch(url, defaultOptions);
    
    console.log(`📥 API Response: ${response.status} ${response.statusText}`);
    
    // Check for network errors or CORS issues
    if (!response.ok && response.status === 0) {
      throw new Error('Network error - request may have been blocked by browser (CORS/cookies)');
    }
    
    const data = await response.json();

    if (!response.ok) {
      console.error('❌ API Error:', data);
      throw new Error(data.error || `API request failed with status ${response.status}`);
    }

    return data;
  } catch (error: any) {
    // Handle network-level errors (CORS, blocked requests, etc.)
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('❌ Network/CORS Error:', error);
      throw new Error('Network error - unable to reach server. This might be a CORS or cookie blocking issue.');
    }
    throw error;
  }
}

// Authentication API
export const authApi = {
  async getGoogleLoginUrl() {
    return apiRequest<{ success: boolean; data: { oauth_url: string; state: string } }>(
      '/dvyb/auth/google/login'
    );
  },

  async handleGoogleCallback(code: string, state: string) {
    return apiRequest<{ 
      success: boolean; 
      data: { 
        account_id: number; 
        account_name: string;
        email: string;
        is_new_account: boolean;
        onboarding_complete: boolean;
      } 
    }>(
      '/dvyb/auth/google/callback',
      {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }
    );
  },

  // Twitter connection (not for login, only for connecting to existing account)
  async getTwitterLoginUrl() {
    return apiRequest<{ success: boolean; data: { oauth_url: string; state: string } }>(
      '/dvyb/auth/twitter/connect'
    );
  },

  async handleTwitterCallback(code: string, state: string) {
    return apiRequest<{ 
      success: boolean; 
      data: { 
        message: string;
      } 
    }>(
      '/dvyb/auth/twitter/callback',
      {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }
    );
  },

  async getAuthStatus() {
    return apiRequest<{
      success: boolean;
      data: { 
        authenticated: boolean; 
        accountId?: number; 
        hasValidGoogleConnection?: boolean;
        hasValidTwitterConnection?: boolean;
        onboardingComplete?: boolean;
        // User info for Mixpanel tracking
        email?: string;
        name?: string;
        accountName?: string;
      };
    }>('/dvyb/auth/status');
  },

  async logout() {
    return apiRequest<{ success: boolean; message: string }>(
      '/dvyb/auth/logout',
      { method: 'POST' }
    );
  },
};

// Account API
export const accountApi = {
  async getAccount() {
    return apiRequest<{ success: boolean; data: any }>('/dvyb/account');
  },

  async updateAccount(data: any) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/account',
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  },

  async getTwitterConnection() {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/account/twitter-connection'
    );
  },

  async getInstagramConnection() {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/account/instagram-connection'
    );
  },

  async getLinkedInConnection() {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/account/linkedin-connection'
    );
  },

  async getTikTokConnection() {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/account/tiktok-connection'
    );
  },
};

// Context API
export const contextApi = {
  async getContext() {
    return apiRequest<{ success: boolean; data: any }>('/dvyb/context');
  },

  async updateContext(data: any) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/context',
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  },

  /**
   * Analyze website without authentication (guest mode)
   * Returns analysis data to be stored in localStorage
   */
  async analyzeWebsiteGuest(url: string) {
    return apiRequest<{ 
      success: boolean; 
      data: any;
      message: string;
    }>(
      '/dvyb/context/analyze-website-guest',
      {
        method: 'POST',
        body: JSON.stringify({ url }),
      }
    );
  },

  /**
   * Save website analysis to authenticated account
   * Can pass pre-analyzed data from localStorage or trigger new analysis
   */
  async saveWebsiteAnalysis(url: string, analysisData: any) {
    return apiRequest<{ 
      success: boolean; 
      data: { 
        analysis: any; 
        context: any 
      } 
    }>(
      '/dvyb/context/analyze-website',
      {
        method: 'POST',
        body: JSON.stringify({ url, analysisData }),
      }
    );
  },

  async extractDocuments(documentUrls: string[]) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/context/extract-documents',
      {
        method: 'POST',
        body: JSON.stringify({ documentUrls }),
      }
    );
  },
};

// Inspirations API
export const inspirationsApi = {
  /**
   * Match industry to inspiration categories using AI
   * Returns matched categories and selected inspiration videos
   */
  async matchInspirations(industry: string, count: number = 6) {
    return apiRequest<{ 
      success: boolean; 
      data: {
        matched_categories: string[];
        inspiration_videos: Array<{
          id: number;
          platform: string;
          category: string;
          url: string;
          title: string | null;
        }>;
      };
    }>(
      '/dvyb/inspirations/match',
      {
        method: 'POST',
        body: JSON.stringify({ industry, count }),
      }
    );
  },

  /**
   * Get all available inspiration categories
   */
  async getCategories() {
    return apiRequest<{ success: boolean; data: string[] }>(
      '/dvyb/inspirations/categories'
    );
  },
};

// Topics API
export const topicsApi = {
  async generateTopics() {
    return apiRequest<{ success: boolean; data: { topics: string[] } }>(
      '/dvyb/topics/generate',
      {
        method: 'POST',
      }
    );
  },

  async getTopics() {
    return apiRequest<{ success: boolean; data: any }>('/dvyb/topics');
  },

  async getUnusedTopics() {
    return apiRequest<{ success: boolean; data: { topics: string[] } }>('/dvyb/topics/unused');
  },
};

// Upload API
export const uploadApi = {
  async uploadLogo(file: File) {
    const formData = new FormData();
    formData.append('logo', file);

    return apiRequest<{ success: boolean; data: { s3_key: string; presignedUrl: string } }>(
      '/dvyb/upload/logo',
      {
        method: 'POST',
        body: formData,
        // Note: apiRequest auto-detects FormData and handles Content-Type + account ID header
      }
    );
  },

  async uploadAdditionalLogos(files: File[]) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('logos', file);
    });

    return apiRequest<{
      success: boolean;
      data: {
        logos: Array<{ url: string; presignedUrl: string; timestamp: string }>;
      };
    }>(
      '/dvyb/upload/additional-logos',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  async uploadBrandImages(files: File[]) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('images', file);
    });

    return apiRequest<{ success: boolean; data: { urls: string[]; total_images: number } }>(
      '/dvyb/upload/brand-images',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  async uploadDocument(file: File) {
    const formData = new FormData();
    formData.append('document', file);

    return apiRequest<{ success: boolean; data: { s3_key: string; url: string; filename: string } }>(
      '/dvyb/upload/document',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  async uploadDocuments(files: File[]) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('documents', file);
    });

    return apiRequest<{ 
      success: boolean; 
      data: { 
        documents_text: Array<{
          name: string;
          url: string; // S3 key
          text: string;
          timestamp: string;
        }>;
        document_urls: string[];
      } 
    }>(
      '/dvyb/upload/documents',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  async uploadMedia(files: File[]) {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('media', file);
    });

    return apiRequest<{
      success: boolean;
      data: {
        images: Array<{ url: string; presignedUrl: string; timestamp: string }>;
        videos: Array<{ url: string; presignedUrl: string; timestamp: string }>;
      };
    }>(
      '/dvyb/upload/media',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  async getPresignedUrl(s3Key: string): Promise<string | null> {
    try {
      const response = await apiRequest<{ success: boolean; presigned_url: string }>(
        '/dvyb/upload/presigned-url-from-key',
        {
          method: 'POST',
          body: JSON.stringify({ s3_key: s3Key }),
        }
      );
      return response.success ? response.presigned_url : null;
    } catch (error) {
      console.error('Failed to get presigned URL:', error);
      return null;
    }
  },

  async getPresignedUrlFromKey(s3Key: string) {
    return apiRequest<{ success: boolean; presigned_url: string; timestamp: string }>(
      '/dvyb/upload/presigned-url-from-key',
      {
        method: 'POST',
        body: JSON.stringify({ s3_key: s3Key }),
      }
    );
  },

  async getPresignedUrlOld(filename: string, contentType: string, uploadType = 'general') {
    return apiRequest<{ success: boolean; data: { presigned_url: string; public_url: string; s3_key: string } }>(
      '/dvyb/upload/presigned-url',
      {
        method: 'POST',
        body: JSON.stringify({ filename, contentType, uploadType }),
      }
    );
  },
};

// Generation API
export const generationApi = {
  async startGeneration(params: {
    weekStart: string;
    weekEnd: string;
  }) {
    return apiRequest<{ 
      success: boolean; 
      data: { job_id: string; content_id: number; status: string } 
    }>(
      '/dvyb/generate',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  },

  async getProgress(jobId: string) {
    return apiRequest<{ success: boolean; data: any }>(
      `/dvyb/generate/progress/${jobId}`
    );
  },

  async getAllContent(filters?: {
    status?: string;
    contentType?: string;
    platform?: string;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.contentType) params.append('contentType', filters.contentType);
    if (filters?.platform) params.append('platform', filters.platform);
    if (filters?.limit) params.append('limit', filters.limit.toString());

    return apiRequest<{ success: boolean; data: any[] }>(
      `/dvyb/content?${params.toString()}`
    );
  },

  async getContentById(contentId: number) {
    return apiRequest<{ success: boolean; data: any }>(
      `/dvyb/content/${contentId}`
    );
  },

  async deleteContent(contentId: number) {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/content/${contentId}`,
      { method: 'DELETE' }
    );
  },

  async getGeneratedContent(filters?: {
    weekStart?: string;
    weekEnd?: string;
    status?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.weekStart) params.append('weekStart', filters.weekStart);
    if (filters?.weekEnd) params.append('weekEnd', filters.weekEnd);
    if (filters?.status) params.append('status', filters.status);

    return apiRequest<{ success: boolean; data: any[] }>(
      `/dvyb/generation/content?${params.toString()}`
    );
  },
};

// Dashboard API
export const dashboardApi = {
  async getDashboard() {
    return apiRequest<{ success: boolean; data: any }>('/dvyb/dashboard');
  },

  async getAnalytics(filters?: {
    startDate?: string;
    endDate?: string;
    groupBy?: 'day' | 'week' | 'month';
  }) {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.groupBy) params.append('groupBy', filters.groupBy);

    return apiRequest<{ success: boolean; data: any[] }>(
      `/dvyb/dashboard/analytics?${params.toString()}`
    );
  },
};

// Posting API
export const postingApi = {
  async postTweet(params: {
    tweetText: string;
    generatedContentId?: number;
    imageUrl?: string;
    videoUrl?: string;
    mediaIds?: string[];
  }) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/posts/tweet',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  },

  async postThread(params: {
    tweets: string[];
    generatedContentId?: number;
    mediaUrls?: string[];
  }) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/posts/thread',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
  },

  async postNow(data: {
    platforms: string[];
    content: {
      caption: string;
      platformTexts?: any;
      mediaUrl: string;
      mediaType: 'image' | 'video';
      generatedContentId?: number;
      postIndex?: number;
    };
  }) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/posts/now',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  },

  async validateTokens(data: {
    platforms: string[];
    requireOAuth1ForTwitterVideo?: boolean;
  }) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/posts/validate-tokens',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  },

  async schedulePost(data: {
    scheduledFor: string;
    platforms: string[];
    content: {
      caption: string;
      platformTexts?: any;
      mediaUrl: string;
      mediaType: 'image' | 'video';
      generatedContentId?: number;
      postIndex?: number;
    };
    timezone?: string;
  }) {
    return apiRequest<{ success: boolean; data: any }>(
      '/dvyb/posts/schedule',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  },

  async getSchedules(generatedContentId?: number) {
    const params = generatedContentId 
      ? `?generatedContentId=${generatedContentId}` 
      : '';
    return apiRequest<{ success: boolean; data: any[] }>(
      `/dvyb/posts/schedules${params}`
    );
  },

  async getAllPosts(limit?: number) {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());

    return apiRequest<{ success: boolean; data: any[] }>(
      `/dvyb/posts?${params.toString()}`
    );
  },

  async getScheduledPosts() {
    return apiRequest<{ success: boolean; data: any[] }>('/dvyb/posts/scheduled');
  },

  async cancelScheduledPost(scheduleId: number) {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/posts/scheduled/${scheduleId}`,
      { method: 'DELETE' }
    );
  },

  async refreshMetrics(postId: number) {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/posts/${postId}/refresh-metrics`,
      { method: 'POST' }
    );
  },
};

// OAuth1 API for Twitter video uploads
export const oauth1Api = {
  async initiateOAuth1() {
    return apiRequest<{ 
      success: boolean; 
      data: { 
        authUrl: string; 
        state: string;
        oauthToken: string;
        oauthTokenSecret: string;
      } 
    }>(
      '/dvyb/auth/oauth1/initiate'
    );
  },

  async handleOAuth1Callback(params: {
    oauthToken: string;
    oauthVerifier: string;
    state: string;
    oauthTokenSecret: string;
  }) {
    return apiRequest<{
      success: boolean;
      data: {
        message: string;
        screenName: string;
      };
    }>(
      '/dvyb/auth/oauth1/callback',
      {
        method: 'POST',
        body: JSON.stringify({
          oauth_token: params.oauthToken,
          oauth_verifier: params.oauthVerifier,
          state: params.state,
          oauth_token_secret: params.oauthTokenSecret,
        }),
      }
    );
  },

  async getOAuth1Status() {
    return apiRequest<{
      success: boolean;
      data: {
        hasOAuth1: boolean;
        oauth1Valid: boolean;
        oauth2Valid: boolean;
        twitterHandle?: string;
        message: string;
      };
    }>(
      '/dvyb/auth/oauth1/status'
    );
  },
};

// Combined API export for convenience
// Analytics API
export const analyticsApi = {
  async getInstagramAnalytics(days = 30) {
    return apiRequest<{ success: boolean; data: { metrics: any; topPosts: any[] } }>(
      `/dvyb/analytics/instagram?days=${days}`
    );
  },

  async getTwitterAnalytics(days = 30) {
    return apiRequest<{ success: boolean; data: { metrics: any; topPosts: any[] } }>(
      `/dvyb/analytics/twitter?days=${days}`
    );
  },

  async getTikTokAnalytics(days = 30) {
    return apiRequest<{ success: boolean; data: { metrics: any; topPosts: any[] } }>(
      `/dvyb/analytics/tiktok?days=${days}`
    );
  },

  async getLinkedInAnalytics(days = 30) {
    return apiRequest<{ success: boolean; data: { metrics: any; topPosts: any[] } }>(
      `/dvyb/analytics/linkedin?days=${days}`
    );
  },

  async getGrowthMetrics(days = 30) {
    return apiRequest<{ success: boolean; data: any }>(
      `/dvyb/analytics/growth?days=${days}`
    );
  },
};

// Content Library API
export const contentLibraryApi = {
  async getContentLibrary(params?: {
    page?: number;
    limit?: number;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    showPosted?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
    if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
    if (params?.showPosted !== undefined) queryParams.append('showPosted', params.showPosted.toString());
    
    const url = queryParams.toString() 
      ? `/dvyb/content-library?${queryParams.toString()}`
      : '/dvyb/content-library';
    
    return apiRequest<{ success: boolean; data: any; pagination: any }>(url);
  },

  // Accept content (mark as selected)
  async acceptContent(generatedContentId: number, postIndex: number) {
    return apiRequest<{ success: boolean; message: string }>(
      '/dvyb/content-library/accept',
      {
        method: 'POST',
        body: JSON.stringify({ generatedContentId, postIndex }),
      }
    );
  },

  // Reject content (mark as not selected)
  async rejectContent(generatedContentId: number, postIndex: number) {
    return apiRequest<{ success: boolean; message: string }>(
      '/dvyb/content-library/reject',
      {
        method: 'POST',
        body: JSON.stringify({ generatedContentId, postIndex }),
      }
    );
  },

  // Bulk accept content
  async bulkAcceptContent(items: Array<{ generatedContentId: number; postIndex: number }>) {
    return apiRequest<{ success: boolean; message: string; acceptedCount: number }>(
      '/dvyb/content-library/bulk-accept',
      {
        method: 'POST',
        body: JSON.stringify({ items }),
      }
    );
  },

  // Bulk reject content
  async bulkRejectContent(items: Array<{ generatedContentId: number; postIndex: number }>) {
    return apiRequest<{ success: boolean; message: string; rejectedCount: number }>(
      '/dvyb/content-library/bulk-reject',
      {
        method: 'POST',
        body: JSON.stringify({ items }),
      }
    );
  },
};

// Social Media Connections API
export const socialConnectionsApi = {
  // Check all connection statuses
  async getAllConnectionStatuses() {
    return apiRequest<{ 
      success: boolean; 
      data: { 
        google: 'connected' | 'expired' | 'not_connected';
        twitter: 'connected' | 'expired' | 'not_connected';
        instagram: 'connected' | 'expired' | 'not_connected';
        linkedin: 'connected' | 'expired' | 'not_connected';
        tiktok: 'connected' | 'expired' | 'not_connected';
      } 
    }>(
      `/dvyb/auth/connections/status`
    );
  },

  // Instagram
  async getInstagramAuthUrl() {
    return apiRequest<{ success: boolean; data: { authUrl: string } }>(
      `/dvyb/auth/instagram/auth-url`
    );
  },

  async handleInstagramConnectCallback(code: string, state: string) {
    return apiRequest<{
      success: boolean;
      data: {
        accountId: number;
        username: string;
        isConnected: boolean;
      };
    }>(
      `/dvyb/auth/instagram/connect`,
      {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }
    );
  },

  async getInstagramStatus() {
    return apiRequest<{ success: boolean; data: { isConnected: boolean } }>(
      `/dvyb/auth/instagram/status`
    );
  },

  async disconnectInstagram() {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/auth/instagram/disconnect`,
      { method: 'DELETE' }
    );
  },

  // LinkedIn
  async getLinkedInAuthUrl() {
    return apiRequest<{ success: boolean; data: { authUrl: string } }>(
      `/dvyb/auth/linkedin/auth-url`
    );
  },

  async handleLinkedInConnectCallback(code: string, state: string) {
    return apiRequest<{
      success: boolean;
      data: {
        accountId: number;
        username: string;
        isConnected: boolean;
      };
    }>(
      `/dvyb/auth/linkedin/connect`,
      {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }
    );
  },

  async getLinkedInStatus() {
    return apiRequest<{ success: boolean; data: { isConnected: boolean } }>(
      `/dvyb/auth/linkedin/status`
    );
  },

  async disconnectLinkedIn() {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/auth/linkedin/disconnect`,
      { method: 'DELETE' }
    );
  },

  // TikTok
  async getTikTokAuthUrl() {
    return apiRequest<{ success: boolean; data: { authUrl: string } }>(
      `/dvyb/auth/tiktok/auth-url`
    );
  },

  async handleTikTokConnectCallback(code: string, state: string) {
    return apiRequest<{
      success: boolean;
      data: {
        accountId: number;
        username: string;
        isConnected: boolean;
      };
    }>(
      `/dvyb/auth/tiktok/connect`,
      {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }
    );
  },

  async getTikTokStatus() {
    return apiRequest<{ success: boolean; data: { isConnected: boolean } }>(
      `/dvyb/auth/tiktok/status`
    );
  },

  async disconnectTikTok() {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/auth/tiktok/disconnect`,
      { method: 'DELETE' }
    );
  },

  // Google
  async disconnectGoogle() {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/auth/google/disconnect`,
      { method: 'DELETE' }
    );
  },

  // Twitter
  async disconnectTwitter() {
    return apiRequest<{ success: boolean; message: string }>(
      `/dvyb/auth/twitter/disconnect`,
      { method: 'DELETE' }
    );
  },
};

// Ad-hoc Generation API (proxied through TypeScript backend for security)
export const adhocGenerationApi = {
  async generateContent(data: {
    topic: string;
    platforms: string[];
    number_of_posts: number;
    number_of_images?: number;
    number_of_videos?: number;
    user_prompt?: string;
    user_images?: string[];
    inspiration_links?: string[];
    is_onboarding_product_image?: boolean;  // If true, user_images[0] is explicitly a product image
    force_product_marketing?: boolean;  // If true, force product_marketing video type
  }) {
    return apiRequest<{
      success: boolean;
      job_id?: string;
      uuid?: string;
      message?: string;
      error?: string;
    }>(
      '/dvyb/adhoc/generate', // apiRequest prepends API_URL
      {
        method: 'POST',
        body: JSON.stringify(data), // TypeScript backend handles accountId from session
      }
    );
  },

  async getStatus() {
    return apiRequest<{
      success: boolean;
      status: string;
      progress_percent: number;
      progress_message: string;
      data?: any;
    }>('/dvyb/adhoc/status'); // apiRequest prepends API_URL
  },

  async uploadImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_URL}/dvyb/adhoc/upload`, {
      method: 'POST',
      credentials: 'include', // Send session cookie for authentication
      headers: {
        ...getAccountIdHeader(), // Add account ID header for Safari/ITP compatibility
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Upload failed');
    }

    // Return presigned URL for preview (FileDropZone uses this to display images)
    return data.s3_url;
  },

  // Get S3 keys from presigned URLs for API submission
  extractS3Key(presignedUrl: string): string {
    try {
      const url = new URL(presignedUrl);
      // Extract path and remove leading slash
      return url.pathname.substring(1).split('?')[0];
    } catch {
      // If it's already an S3 key (no protocol), return as is
      return presignedUrl;
    }
  },
};

// Captions API (user-edited captions)
export const captionsApi = {
  async getCaptions(generatedContentId: number, postIndex: number) {
    return apiRequest<{
      success: boolean;
      data: {
        captions: Record<string, string>; // { platform: caption }
        raw: any[];
      };
    }>(`/dvyb/captions?generatedContentId=${generatedContentId}&postIndex=${postIndex}`);
  },

  async saveCaption(data: {
    generatedContentId: number;
    postIndex: number;
    platform: string;
    caption: string;
  }) {
    return apiRequest<{
      success: boolean;
      data: any;
    }>('/dvyb/captions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteCaption(captionId: number) {
    return apiRequest<{
      success: boolean;
      message: string;
    }>(`/dvyb/captions/${captionId}`, {
      method: 'DELETE',
    });
  },
};

// Image Edits API (text overlays, emojis, stickers)
export const imageEditsApi = {
  async saveImageEdit(data: {
    generatedContentId: number;
    postIndex: number;
    originalImageUrl: string;
    regeneratedImageUrl?: string | null;
    overlays: Array<{
      id: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      fontSize: number;
      fontFamily: string;
      color: string;
      isBold: boolean;
      isItalic: boolean;
      isUnderline: boolean;
      isEmoji?: boolean;
      isSticker?: boolean;
    }>;
    referenceWidth?: number;
  }) {
    return apiRequest<{
      success: boolean;
      data: {
        id: number;
        status: string;
        message: string;
      };
      error?: string;
    }>('/dvyb/image-edits', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getImageEdit(generatedContentId: number, postIndex: number) {
    return apiRequest<{
      success: boolean;
      data: {
        id: number;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        editedImageUrl: string | null;
        originalImageUrl: string | null;
        regeneratedImageUrl: string | null;
        overlays: any[];
        errorMessage: string | null;
      } | null;
    }>(`/dvyb/image-edits/${generatedContentId}/${postIndex}`);
  },

  async refreshUrl(s3Key: string) {
    return apiRequest<{
      success: boolean;
      data: {
        presignedUrl: string;
      };
      error?: string;
    }>('/dvyb/image-edits/refresh-url', {
      method: 'POST',
      body: JSON.stringify({ s3Key }),
    });
  },
};

// Image Regeneration API (AI-based image changes using nano-banana edit)
export const imageRegenerationApi = {
  async regenerate(data: {
    generatedContentId: number;
    postIndex: number;
    prompt: string;
    sourceImageS3Key: string;
  }) {
    return apiRequest<{
      success: boolean;
      data: {
        id: number;
        status: string;
        message: string;
      };
      error?: string;
    }>('/dvyb/image-regeneration/regenerate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getRegenerations(generatedContentId: number, postIndex: number) {
    return apiRequest<{
      success: boolean;
      data: Array<{
        id: number;
        prompt: string;
        sourceImageS3Key: string;
        sourceImageUrl: string | null;
        regeneratedImageS3Key: string | null;
        regeneratedImageUrl: string | null;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        errorMessage: string | null;
        metadata: any;
        createdAt: string;
      }>;
    }>(`/dvyb/image-regeneration/${generatedContentId}/${postIndex}`);
  },

  async getStatus(regenerationId: number) {
    return apiRequest<{
      success: boolean;
      data: {
        id: number;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        regeneratedImageS3Key: string | null;
        regeneratedImageUrl: string | null;
        errorMessage: string | null;
        metadata: any;
      };
    }>(`/dvyb/image-regeneration/status/${regenerationId}`);
  },
};

// Subscription API
export const subscriptionApi = {
  async createCheckout(planId: number, frequency: 'monthly' | 'annual', promoCode?: string) {
    return apiRequest<{
      success: boolean;
      checkoutUrl?: string;
      hasActiveSubscription?: boolean;
      error?: string;
    }>('/dvyb/subscription/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, frequency, promoCode }),
    });
  },

  async getCurrentSubscription() {
    return apiRequest<{
      success: boolean;
      data?: {
        isSubscribed: boolean;
        currentPlan?: any;
        isFree?: boolean;
        subscription?: {
          id: number;
          planId: number;
          plan: any;
          frequency: 'monthly' | 'annual';
          status: string;
          currentPeriodStart: string;
          currentPeriodEnd: string;
          cancelAtPeriodEnd: boolean;
          pendingPlanId: number | null;
          pendingFrequency: 'monthly' | 'annual' | null;
        };
      };
      error?: string;
    }>('/dvyb/subscription/current');
  },

  async upgrade(planId: number, frequency: 'monthly' | 'annual') {
    return apiRequest<{
      success: boolean;
      message?: string;
      requiresAction?: boolean; // True if 3DS/SCA authentication is required
      checkoutUrl?: string; // URL to redirect user for payment authentication
      error?: string;
    }>('/dvyb/subscription/upgrade', {
      method: 'POST',
      body: JSON.stringify({ planId, frequency }),
    });
  },

  async downgrade(planId: number, frequency: 'monthly' | 'annual') {
    return apiRequest<{
      success: boolean;
      message?: string;
      effectiveDate?: string;
      error?: string;
    }>('/dvyb/subscription/downgrade', {
      method: 'POST',
      body: JSON.stringify({ planId, frequency }),
    });
  },

  async switchBillingCycle(newFrequency: 'monthly' | 'annual') {
    return apiRequest<{
      success: boolean;
      message?: string;
      effectiveDate?: string;
      requiresAction?: boolean; // True if 3DS/SCA authentication is required
      checkoutUrl?: string; // URL to redirect user for payment authentication
      error?: string;
    }>('/dvyb/subscription/switch-billing-cycle', {
      method: 'POST',
      body: JSON.stringify({ newFrequency }),
    });
  },

  async cancel() {
    return apiRequest<{
      success: boolean;
      message?: string;
      error?: string;
    }>('/dvyb/subscription/cancel', {
      method: 'POST',
    });
  },

  async resume() {
    return apiRequest<{
      success: boolean;
      message?: string;
      error?: string;
    }>('/dvyb/subscription/resume', {
      method: 'POST',
    });
  },

  async getBillingPortalUrl() {
    return apiRequest<{
      success: boolean;
      portalUrl?: string;
      error?: string;
    }>('/dvyb/subscription/billing-portal');
  },

  async getPaymentHistory(limit = 10) {
    return apiRequest<{
      success: boolean;
      data?: any[];
      error?: string;
    }>(`/dvyb/subscription/payments?limit=${limit}`);
  },
};

// Content Strategy API
export interface PlatformFollowers {
  instagram?: number;
  tiktok?: number;
  twitter?: number;
  linkedin?: number;
}

export interface StrategyPreferences {
  goal?: string;
  platforms?: string[];
  platformFollowers?: PlatformFollowers;
  idealCustomer?: string;
  postingFrequency?: string;
  businessAge?: string;
  revenueRange?: string;
  contentTypes?: string[];
  biggestChallenge?: string;
}

export interface ContentStrategyItem {
  id: number;
  date: string;
  platform: string;
  contentType: string;
  topic: string;
  weekTheme: string;
  weekNumber: number;
  metadata: {
    captionHint?: string;
    hashtags?: string[];
    callToAction?: string;
    visualStyle?: string;
    toneOfVoice?: string;
  };
  status: string;
  generatedContentId?: number;
}

export const contentStrategyApi = {
  /**
   * Generate content strategy based on preferences
   */
  async generateStrategy(strategyPreferences: StrategyPreferences) {
    return apiRequest<{
      success: boolean;
      message: string;
      data?: {
        itemCount: number;
        strategyMonth: string;
      };
    }>(
      '/dvyb/content-strategy/generate',
      {
        method: 'POST',
        body: JSON.stringify({ strategyPreferences }),
      }
    );
  },

  /**
   * Get strategy items for calendar display
   */
  async getCalendar(month?: string) {
    const params = month ? `?month=${month}` : '';
    return apiRequest<{
      success: boolean;
      data: {
        weekThemes: Record<number, string>;
        items: ContentStrategyItem[];
      };
    }>(`/dvyb/content-strategy/calendar${params}`);
  },

  /**
   * Get single strategy item details
   */
  async getItem(id: number) {
    return apiRequest<{
      success: boolean;
      data: ContentStrategyItem;
    }>(`/dvyb/content-strategy/${id}`);
  },

  /**
   * Delete strategy item
   */
  async deleteItem(id: number) {
    return apiRequest<{
      success: boolean;
      message: string;
    }>(
      `/dvyb/content-strategy/${id}`,
      { method: 'DELETE' }
    );
  },

  /**
   * Check if strategy exists for account
   */
  async checkStatus() {
    return apiRequest<{
      success: boolean;
      data: {
        hasStrategy: boolean;
        itemCount: number;
      };
    }>('/dvyb/content-strategy/check/status');
  },

  /**
   * Get available months with strategy items
   */
  async getAvailableMonths() {
    return apiRequest<{
      success: boolean;
      data: {
        months: string[];
      };
    }>('/dvyb/content-strategy/available-months');
  },
};

export const dvybApi = {
  auth: authApi,
  account: accountApi,
  context: contextApi,
  topics: topicsApi,
  upload: uploadApi,
  generation: generationApi,
  dashboard: dashboardApi,
  posting: postingApi,
  analytics: analyticsApi,
  socialConnections: socialConnectionsApi,
  adhocGeneration: adhocGenerationApi,
  captions: captionsApi,
  imageEdits: imageEditsApi,
  imageRegeneration: imageRegenerationApi,
  subscription: subscriptionApi,
  inspirations: inspirationsApi,
  contentStrategy: contentStrategyApi,
};
