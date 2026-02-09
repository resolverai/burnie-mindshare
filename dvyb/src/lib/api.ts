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
  options: RequestInit & { timeout?: number } = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const { timeout, ...fetchOptions } = options;
  
  // Check if this is a FormData request (for file uploads)
  const isFormData = fetchOptions.body instanceof FormData;
  
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
  const customHeaders = fetchOptions.headers as Record<string, string> || {};
  const finalHeaders = {
    ...baseHeaders,
    ...customHeaders,
    ...accountIdHeader, // Re-add to ensure it's not overwritten
  };
  
  const defaultOptions: RequestInit = {
    credentials: 'include', // Include cookies for session management
    ...fetchOptions,
    headers: finalHeaders,
  };
  
  // Add timeout support using AbortController
  let abortController: AbortController | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  
  if (timeout && timeout > 0) {
    abortController = new AbortController();
    timeoutId = setTimeout(() => {
      abortController?.abort();
    }, timeout);
    defaultOptions.signal = abortController.signal;
  }
  
  try {
    console.log(`🌐 API Request: ${fetchOptions.method || 'GET'} ${url}${timeout ? ` (timeout: ${timeout}ms)` : ''}`);
    const response = await fetch(url, defaultOptions);
    
    // Clear timeout on successful response
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    console.log(`📥 API Response: ${response.status} ${response.statusText}`);
    
    // Check for network errors or CORS issues
    if (!response.ok && response.status === 0) {
      throw new Error('Network error - request may have been blocked by browser (CORS/cookies)');
    }
    
    const data = await response.json();

    if (!response.ok) {
      console.error('❌ API Error:', data);
      const err = new Error(data.error || `API request failed with status ${response.status}`);
      if (data.error_code) (err as any).code = data.error_code;
      throw err;
    }

    return data;
  } catch (error: any) {
    // Clear timeout on error
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    // Handle abort (timeout)
    if (error.name === 'AbortError') {
      console.error('❌ Request timeout:', error);
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    
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
  async getGoogleLoginUrl(options?: { signInOnly?: boolean }) {
    const params = new URLSearchParams();
    if (options?.signInOnly) params.set('sign_in_only', 'true');
    const query = params.toString();
    return apiRequest<{ success: boolean; data: { oauth_url: string; state: string } }>(
      `/dvyb/auth/google/login${query ? `?${query}` : ''}`
    );
  },

  async handleGoogleCallback(
    code: string,
    state: string,
    initialAcquisitionFlow?: 'website_analysis' | 'product_photoshot',
    signInOnly?: boolean
  ) {
    return apiRequest<{ 
      success: boolean; 
      data?: { 
        account_id: number; 
        account_name: string;
        email: string;
        is_new_account: boolean;
        onboarding_complete: boolean;
      };
      error?: string;
      error_code?: string;
    }>(
      '/dvyb/auth/google/callback',
      {
        method: 'POST',
        body: JSON.stringify({ 
          code, 
          state,
          initial_acquisition_flow: initialAcquisitionFlow,
          sign_in_only: signInOnly,
        }),
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

  /** Mark that user has visited the discover page (free trial edit limit) */
  async recordDiscoverVisit() {
    return apiRequest<{ success: boolean }>('/dvyb/account/discover-visit', { method: 'POST' });
  },

  /** Record that user saved a design edit (free trial: one edit allowed after discover visit) */
  async recordEditSaved() {
    return apiRequest<{ success: boolean }>('/dvyb/account/edit-saved', { method: 'POST' });
  },

  /**
   * End trial period early and charge the customer immediately
   * Used when user wants to continue generating beyond trial limits
   */
  async endTrialEarly() {
    return apiRequest<{ 
      success: boolean; 
      message: string;
      invoiceId?: string;
      error?: string;
    }>(
      '/dvyb/account/end-trial-early',
      {
        method: 'POST',
      }
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

  /**
   * Get cached product images for a domain (from website analysis).
   * Used during onboarding product step - returns images when available.
   */
  async getDomainProductImages(domainOrUrl: string) {
    return apiRequest<{
      success: boolean;
      data: { images: Array<{ id: number; s3Key: string; image: string }> };
    }>(
      `/dvyb/context/domain-product-images?domain=${encodeURIComponent(domainOrUrl)}`,
      { method: 'GET' }
    );
  },

  /**
   * Upload product image during onboarding when no images were fetched from website/Instagram.
   * Uses X-DVYB-API-Key for unauthenticated onboarding.
   * Saves to S3 and dvyb_domain_product_images for use in content generation.
   */
  async uploadDomainProductImage(file: File, domainOrUrl: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('domain', domainOrUrl || 'onboarding');

    const apiKey = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_DVYB_ONBOARDING_API_KEY || '' : '';
    const response = await fetch(
      `${API_URL}/dvyb/context/upload-domain-product-image`,
      {
        method: 'POST',
        headers: { 'X-DVYB-API-Key': apiKey },
        body: formData,
      }
    );

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Upload failed');
    }
    return data.data as { id: number; s3Key: string; image: string };
  },
};

// Inspiration Item type
export interface InspirationItem {
  id: number;
  platform: string;
  category: string;
  url: string;
  title: string | null;
  mediaType: string;
  mediaUrl?: string | null;
}

// Brand context from localStorage (business overview, popular products, etc.)
export interface BrandContextForMatch {
  business_overview?: string | null;
  popular_products?: string[] | null;
  customer_demographics?: string | null;
  brand_story?: string | null;
}

// Inspirations API
export const inspirationsApi = {
  /**
   * Match industry + brand context to inspiration categories using AI (GPT-4o)
   * Returns matched categories and selected inspiration videos
   * Brand context improves matching when available from website analysis
   */
  async matchInspirations(
    industry: string,
    count: number = 6,
    brandContext?: BrandContextForMatch | null
  ) {
    return apiRequest<{
      success: boolean;
      data: {
        matched_categories: string[];
        inspiration_videos: Array<InspirationItem>;
      };
    }>(
      '/dvyb/inspirations/match',
      {
        method: 'POST',
        body: JSON.stringify({
          industry,
          count,
          brand_context: brandContext || undefined,
        }),
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

  /**
   * Get all inspirations grouped by category
   * Used in GenerateContentDialog for inspiration selection
   */
  async getByCategory(category?: string) {
    const params = category ? `?category=${encodeURIComponent(category)}` : '';
    return apiRequest<{ 
      success: boolean; 
      data: {
        categories: string[];
        inspirations: InspirationItem[];
        groupedByCategory: Record<string, InspirationItem[]>;
      };
    }>(
      `/dvyb/inspirations/by-category${params}`
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

  /**
   * Upload a file for guest (unauthenticated) users
   * Returns presigned URL for preview and S3 key for later use
   */
  async uploadGuestImage(file: File, guestSessionId?: string): Promise<{ 
    success: boolean; 
    data: { s3_key: string; presigned_url: string; guest_session_id: string } 
  }> {
    const formData = new FormData();
    formData.append('file', file);
    if (guestSessionId) {
      formData.append('guestSessionId', guestSessionId);
    }

    const response = await fetch(`${API_URL}/dvyb/upload/guest`, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Upload failed');
    }

    return data;
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
    showAll?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
    if (params?.dateTo) queryParams.append('dateTo', params.dateTo);
    if (params?.showPosted !== undefined) queryParams.append('showPosted', params.showPosted.toString());
    if (params?.showAll !== undefined) queryParams.append('showAll', params.showAll.toString());
    
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

  /**
   * Download content media (image/video) via backend proxy to avoid CORS.
   * Triggers file download in the browser.
   */
  async downloadContentMedia(contentId: number, postIndex: number, filename: string): Promise<void> {
    const base = API_URL.replace(/\/api\/?$/, '') || API_URL;
    const url = `${base}/api/dvyb/content-library/download?contentId=${contentId}&postIndex=${postIndex}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const ext = res.headers.get('content-type')?.includes('video') ? '.mp4' : '.png';
    const name = (filename || `content_${contentId}_${postIndex}`).replace(/[^a-z0-9]/gi, '_').slice(0, 40) + ext;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
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
    is_product_shot_flow?: boolean;  // If true, use product photography specialist persona (Flow 2)
    video_length_mode?: 'quick' | 'standard' | 'story';  // Video length: 8s | 16s | 30-45s
    video_style?: 'brand_marketing' | 'product_marketing' | 'ugc_influencer';  // User's choice of video style
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

// Video Edits API (timeline, clips, audio, effects)
export const videoEditsApi = {
  async loadVideoContent(generatedContentId: number, postIndex: number) {
    return apiRequest<{
      success: boolean;
      videoData?: {
        generatedContentId: number;
        postIndex: number;
        videoUrl: string;
        duration: number;
        clips: Array<{
          url: string;
          duration: number;
          startTime: number;
          prompt?: string; // AI prompt that generated this clip
        }>;
        voiceover?: {
          url: string;
          duration: number;
          prompt?: string;
        };
        backgroundMusic?: {
          url: string;
          duration: number;
        };
        aspectRatio?: string;
      };
      error?: string;
    }>(`/dvyb/video-edits/load-content/${generatedContentId}/${postIndex}`);
  },

  async saveVideoEdit(data: {
    generatedContentId: number;
    postIndex: number;
    originalVideoUrl: string;
    tracks: Array<{
      id: string;
      name: string;
      type: string;
      clips: Array<{
        id: string;
        trackId: string;
        name: string;
        startTime: number;
        duration: number;
        sourceStart: number;
        sourceDuration: number;
        src: string;
        type: string;
        thumbnail?: string;
        transform?: any;
        volume?: number;
        fadeIn?: number;
        fadeOut?: number;
        muted?: boolean;
        filters?: any;
        filterPreset?: string;
        transitionIn?: string;
        transitionOut?: string;
        transitionInDuration?: number;
        transitionOutDuration?: number;
        text?: any;
        blendMode?: string;
        flipHorizontal?: boolean;
        flipVertical?: boolean;
        cornerRadius?: number;
        borderWidth?: number;
        borderColor?: string;
        shadowEnabled?: boolean;
        shadowColor?: string;
        shadowBlur?: number;
        shadowOffsetX?: number;
        shadowOffsetY?: number;
      }>;
      muted: boolean;
      locked: boolean;
      visible: boolean;
    }>;
    duration: number;
    aspectRatio?: string;
  }) {
    return apiRequest<{
      success: boolean;
      data: {
        editId: number;
        status: string;
        message: string;
      };
      error?: string;
    }>('/dvyb/video-edits', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getVideoEdit(generatedContentId: number, postIndex: number) {
    return apiRequest<{
      success: boolean;
      edit?: {
        id: number;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        editedVideoUrl: string | null;
        originalVideoUrl: string | null;
        tracks: any[];
        duration: number;
        aspectRatio: string;
        errorMessage: string | null;
      } | null;
      error?: string;
    }>(`/dvyb/video-edits/${generatedContentId}/${postIndex}`);
  },

  // Export video - sends edit data to Python backend for actual video processing
  async exportVideo(editData: {
    generatedContentId?: number;
    postIndex?: number;
    originalVideoUrl?: string;
    projectName: string;
    aspectRatio: string;
    duration: number;
    exportSettings: {
      resolution: string;
      format: string;
      quality: string;
      fps: number;
    };
    tracks: Array<{
      id: string;
      name: string;
      type: string;
      muted: boolean;
      visible: boolean;
      clips: Array<any>;
    }>;
  }): Promise<{
    success: boolean;
    status?: 'completed' | 'processing' | 'pending' | 'failed';
    jobId?: string;
    editId?: number;
    videoUrl?: string;
    message?: string;
    error?: string;
    blob?: Blob;
    filename?: string;
  }> {
    const url = `${API_URL}/dvyb/video-edits/export`;
    const accountIdHeader = getAccountIdHeader();
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...accountIdHeader,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(editData),
    });
    
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentDisposition = response.headers.get('content-disposition') || '';
    const blob = await response.blob();
    let filename = 'exported-video.mp4';
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    if (filenameMatch) filename = filenameMatch[1];

    // Treat as video file if Content-Type says so, or if response is OK and body looks binary (no JSON)
    const looksLikeVideo =
      contentType.includes('video/') ||
      contentType.includes('application/octet-stream') ||
      (response.ok && blob.size > 1024 && !contentType.includes('application/json'));
    if (looksLikeVideo && blob.size > 0) {
      return { success: true, status: 'completed' as const, blob, filename };
    }

    // Treat as JSON (body already read as blob; parse from text)
    const text = await blob.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Export failed: invalid response from server');
    }
    if (!response.ok) {
      throw new Error((data as { error?: string }).error || `API request failed with status ${response.status}`);
    }
    return data as Awaited<ReturnType<typeof videoEditsApi.exportVideo>>;
  },

  // Get export job status (uses /job/:id/status to avoid route collision with /:generatedContentId/:postIndex)
  async getExportStatus(jobId: string) {
    return apiRequest<{
      success: boolean;
      status: 'pending' | 'processing' | 'completed' | 'failed';
      progress?: number;
      message?: string;
      videoUrl?: string;
      error?: string;
    }>(`/dvyb/video-edits/job/${jobId}/status`);
  },

  // Download exported video file (uses /job/:id/download to avoid route collision)
  async downloadVideo(jobId: string): Promise<{ blob: Blob; filename: string }> {
    const url = `${API_URL}/dvyb/video-edits/job/${jobId}/download`;
    const accountIdHeader = getAccountIdHeader();
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...accountIdHeader,
      },
      credentials: 'include',
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to download video' }));
      throw new Error(error.error || `Download failed with status ${response.status}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    const contentDisposition = response.headers.get('content-disposition') || '';
    
    const blob = await response.blob();
    let filename = 'exported-video.mp4';
    
    // Extract filename from Content-Disposition header
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    if (filenameMatch) {
      filename = filenameMatch[1];
    }
    
    return { blob, filename };
  },
};

// Assets API (videos, images, audio, effects)
export const assetsApi = {
  async getAssets(params?: {
    type?: string;
    category?: string;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.category) queryParams.append('category', params.category);
    if (params?.search) queryParams.append('search', params.search);
    
    const url = queryParams.toString()
      ? `/dvyb/assets?${queryParams.toString()}`
      : '/dvyb/assets';
    
    return apiRequest<{
      success: boolean;
      assets: Array<{
        id: string;
        name: string;
        type: string;
        thumbnail: string;
        duration?: number;
        src: string;
        tags: string[];
        category?: string;
        aiGenerated: boolean;
        createdAt: string;
        isAdminAsset: boolean;
      }>;
      error?: string;
    }>(url);
  },

  async uploadAsset(data: {
    name: string;
    type: string;
    category?: string;
    tags?: string[];
    metadata?: any;
  }) {
    return apiRequest<{
      success: boolean;
      asset?: {
        id: string;
        name: string;
        type: string;
        uploadUrl: string;
        s3Key: string;
      };
      error?: string;
    }>('/dvyb/assets/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateAsset(assetId: string, data: {
    duration?: number;
    thumbnailS3Key?: string;
    metadata?: any;
  }) {
    return apiRequest<{
      success: boolean;
      asset?: any;
      error?: string;
    }>(`/dvyb/assets/${assetId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteAsset(assetId: string) {
    return apiRequest<{
      success: boolean;
      message?: string;
      error?: string;
    }>(`/dvyb/assets/${assetId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Upload file to asset via backend proxy (avoids S3 CORS). Uses XHR for progress.
   */
  uploadAssetFile(
    assetId: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ success: boolean; error?: string; code?: string }> {
    return new Promise((resolve) => {
      const url = `${API_URL}/dvyb/assets/upload-file/${assetId}`;
      const formData = new FormData();
      formData.append('file', file);
      const xhr = new XMLHttpRequest();
      const accountHeader = getAccountIdHeader();
      xhr.open('POST', url);
      xhr.withCredentials = true;
      if (accountHeader['X-DVYB-Account-ID']) {
        xhr.setRequestHeader('X-DVYB-Account-ID', accountHeader['X-DVYB-Account-ID']);
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((100 * e.loaded) / e.total));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            resolve(data.success ? { success: true } : { success: false, error: data.error || 'Upload failed', code: data.code });
          } catch {
            resolve({ success: true });
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            const message = data.code === 'ASSET_NOT_FOUND'
              ? 'Upload link expired. Please close this dialog and try adding the file again.'
              : (data.error || `Upload failed (${xhr.status})`);
            resolve({ success: false, error: message, code: data.code });
          } catch {
            resolve({ success: false, error: `Upload failed (${xhr.status})` });
          }
        }
      };
      xhr.onerror = () => resolve({ success: false, error: 'Network error. Check that the app and API share the same origin or CORS allows this request.' });
      xhr.send(formData);
    });
  },
};

// Subscription API
export const subscriptionApi = {
  async createCheckout(
    planId: number,
    frequency: 'monthly' | 'annual',
    promoCode?: string,
    options?: { successUrl?: string; cancelUrl?: string }
  ) {
    return apiRequest<{
      success: boolean;
      checkoutUrl?: string;
      hasActiveSubscription?: boolean;
      error?: string;
    }>('/dvyb/subscription/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, frequency, promoCode, ...options }),
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

// Country selection for brand request
export interface CountrySelection {
  code: string;
  name: string;
}

// Brands API (Discover ads - request brand, list brands, poll for ads)
export const brandsApi = {
  /**
   * Request a brand. Creates dvyb_brands entry with pending_approval. Fetch runs only after admin approves.
   */
  async requestBrand(
    brandDomain: string,
    options?: { countries?: CountrySelection[]; brandName?: string; media?: 'image' | 'video' | 'both' }
  ) {
    return apiRequest<{
      success: boolean;
      data: {
        brand: {
          id: number;
          brandName: string;
          brandDomain: string;
          approvalStatus: string;
          fetchStatus: string;
          lastAdsFetchedAt: string | null;
        };
        message: string;
      };
      error?: string;
    }>('/dvyb/brands/request', {
      method: 'POST',
      body: JSON.stringify({
        brandDomain,
        countries: options?.countries || null,
        brandName: options?.brandName || null,
        media: options?.media || 'image',
      }),
    });
  },

  /**
   * Get following count from dvyb_brands_follow table.
   */
  async getFollowingCount() {
    return apiRequest<{ success: boolean; followingCount: number; error?: string }>(
      '/dvyb/brands/following-count'
    );
  },

  /**
   * List all brands with completed ads (for Brands page).
   * Pass { following: true } to get only brands the user follows.
   */
  async getBrands(options?: { following?: boolean }) {
    const params = options?.following ? '?following=true' : '';
    return apiRequest<{
      success: boolean;
      data: {
        brands: Array<{
          id: number;
          brandName: string;
          brandDomain: string;
          source: string;
          fetchStatus: string;
          lastAdsFetchedAt: string | null;
          createdAt?: string | null;
          approvedAdCount?: number;
          adCount?: number;
          category?: string | null;
          isFollowing?: boolean;
        }>;
        followingCount: number;
      };
      error?: string;
    }>(`/dvyb/brands${params}`);
  },

  /**
   * Follow a brand
   */
  async followBrand(brandId: number) {
    return apiRequest<{ success: boolean; data: { followed: boolean }; error?: string }>(
      `/dvyb/brands/${brandId}/follow`,
      { method: 'POST' }
    );
  },

  /**
   * Unfollow a brand
   */
  async unfollowBrand(brandId: number) {
    return apiRequest<{ success: boolean; data: { followed: boolean; unfollowed: boolean }; error?: string }>(
      `/dvyb/brands/${brandId}/follow`,
      { method: 'DELETE' }
    );
  },

  /**
   * Get ads for a brand (for polling when fetch is in progress)
   */
  async getBrandAds(brandId: number) {
    return apiRequest<{
      success: boolean;
      data: {
        brand: {
          id: number;
          brandName: string;
          brandDomain: string;
          fetchStatus: string;
          lastAdsFetchedAt: string | null;
        };
        ads: any[];
      };
      error?: string;
    }>(`/dvyb/brands/${brandId}/ads`);
  },

  /**
   * Get fresh presigned URLs for an ad's creatives (for modal when original URLs may have expired).
   * Also returns isSaved for the current account.
   */
  async getAdCreativeUrls(adId: number) {
    return apiRequest<{
      success: boolean;
      data: {
        creativeImageUrl: string | null;
        creativeVideoUrl: string | null;
        mediaType: 'image' | 'video';
        isSaved?: boolean;
      };
      error?: string;
    }>(`/dvyb/brands/discover/ads/${adId}/creative-urls`);
  },

  /**
   * Save an ad
   */
  async saveAd(adId: number) {
    return apiRequest<{ success: boolean; data: { saved: boolean }; error?: string }>(
      `/dvyb/brands/discover/ads/${adId}/save`,
      { method: 'POST' }
    );
  },

  /**
   * Unsave an ad
   */
  async unsaveAd(adId: number) {
    return apiRequest<{ success: boolean; data: { saved: boolean; unsaved: boolean }; error?: string }>(
      `/dvyb/brands/discover/ads/${adId}/save`,
      { method: 'DELETE' }
    );
  },

  /**
   * Get saved ads (for Saved Ads screen)
   */
  async getSavedAds(params?: { page?: number; limit?: number }) {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return apiRequest<{
      success: boolean;
      data: Array<{
        id: number;
        metaAdId: string;
        creativeImageUrl: string | null;
        creativeVideoUrl: string | null;
        mediaType: 'image' | 'video';
        brandName: string;
        brandLetter: string;
        category: string | null;
        status: string;
        runtime: string | null;
        firstSeen: string | null;
        image: string | null;
        videoSrc: string | null;
        isVideo: boolean;
        timeAgo: string;
        aspectRatio: '1:1';
      }>;
      pagination: { page: number; limit: number; total: number; pages: number };
      error?: string;
    }>(`/dvyb/brands/discover/ads/saved${qs ? `?${qs}` : ''}`);
  },

  /**
   * Get discover ads for onboarding modal (unauthenticated).
   * Uses X-DVYB-API-Key instead of user auth.
   */
  async getDiscoverAdsOnboarding(params?: {
    page?: number;
    limit?: number;
    search?: string;
    media?: string;
    status?: string;
    category?: string;
    websiteCategory?: string;
    productImageS3Key?: string;
    brandContext?: BrandContextForMatch | null;
    runtime?: string;
    adCount?: string;
    country?: string;
    language?: string;
    sort?: string;
  }) {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.search) sp.set('search', params.search || '');
    if (params?.media && params.media !== 'All') sp.set('media', params.media);
    if (params?.status && params.status !== 'All') sp.set('status', params.status);
    if (params?.category && params.category !== 'All') sp.set('category', params.category);
    if (params?.websiteCategory) sp.set('websiteCategory', params.websiteCategory);
    if (params?.productImageS3Key) sp.set('productImageS3Key', params.productImageS3Key);
    if (params?.brandContext && Object.keys(params.brandContext).length > 0) {
      sp.set('brandContext', encodeURIComponent(JSON.stringify(params.brandContext)));
    }
    if (params?.runtime && params.runtime !== 'All') sp.set('runtime', params.runtime);
    if (params?.adCount && params.adCount !== 'All') sp.set('adCount', params.adCount);
    if (params?.country && params.country !== 'All') sp.set('country', params.country);
    if (params?.language && params.language !== 'All') sp.set('language', params.language);
    if (params?.sort) sp.set('sort', params.sort || 'latest');
    const qs = sp.toString();
    const apiKey = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_DVYB_ONBOARDING_API_KEY || '' : '';
    return apiRequest<{
      success: boolean;
      data: Array<{
        id: number;
        metaAdId: string;
        creativeImageUrl: string | null;
        creativeVideoUrl: string | null;
        mediaType: 'image' | 'video';
        brandName: string;
        brandLetter: string;
        category: string | null;
        status: string;
        runtime: string | null;
        firstSeen: string | null;
        image: string | null;
        videoSrc: string | null;
        isVideo: boolean;
        timeAgo: string;
        aspectRatio: '1:1';
      }>;
      pagination: { page: number; limit: number; total: number; pages: number };
      error?: string;
    }>(`/dvyb/brands/discover/ads/onboarding${qs ? `?${qs}` : ''}`, {
      headers: { 'X-DVYB-API-Key': apiKey },
    });
  },

  /**
   * Get discover ads (paginated, with filters and sort).
   * Requires user authentication - use for Discover screen.
   * Pass websiteCategory (industry from dvyb_context) to show relevant ads via GPT-4o matching.
   */
  async getDiscoverAds(params?: {
    page?: number;
    limit?: number;
    search?: string;
    media?: string;
    status?: string;
    category?: string;
    websiteCategory?: string;
    productImageS3Key?: string;
    brandContext?: BrandContextForMatch | null;
    runtime?: string;
    adCount?: string;
    country?: string;
    language?: string;
    sort?: string;
  }) {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.search) sp.set('search', params.search);
    if (params?.media && params.media !== 'All') sp.set('media', params.media);
    if (params?.status && params.status !== 'All') sp.set('status', params.status);
    if (params?.category && params.category !== 'All') sp.set('category', params.category);
    if (params?.websiteCategory) sp.set('websiteCategory', params.websiteCategory);
    if (params?.productImageS3Key) sp.set('productImageS3Key', params.productImageS3Key);
    if (params?.brandContext && Object.keys(params.brandContext).length > 0) {
      sp.set('brandContext', encodeURIComponent(JSON.stringify(params.brandContext)));
    }
    if (params?.runtime && params.runtime !== 'All') sp.set('runtime', params.runtime);
    if (params?.adCount && params.adCount !== 'All') sp.set('adCount', params.adCount);
    if (params?.country && params.country !== 'All') sp.set('country', params.country);
    if (params?.language && params.language !== 'All') sp.set('language', params.language);
    if (params?.sort) sp.set('sort', params.sort);
    const qs = sp.toString();
    return apiRequest<{
      success: boolean;
      data: Array<{
        id: number;
        metaAdId: string;
        creativeImageUrl: string | null;
        creativeVideoUrl: string | null;
        mediaType: 'image' | 'video';
        brandName: string;
        brandLetter: string;
        category: string | null;
        status: string;
        runtime: string | null;
        firstSeen: string | null;
        image: string | null;
        videoSrc: string | null;
        isVideo: boolean;
        timeAgo: string;
        aspectRatio: '1:1';
      }>;
      pagination: { page: number; limit: number; total: number; pages: number };
      error?: string;
    }>(`/dvyb/brands/discover/ads${qs ? `?${qs}` : ''}`);
  },
};

// Products API (My Products screen)
export const productsApi = {
  async list() {
    return apiRequest<{
      success: boolean;
      data: Array<{
        id: number;
        name: string;
        imageS3Key: string;
        imageUrl: string;
        createdAt: string;
        source?: "account" | "domain";
      }>;
      error?: string;
    }>('/dvyb/products');
  },

  async uploadImage(
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ success: boolean; data?: { s3_key: string }; error?: string }> {
    const url = `${API_URL}/dvyb/products/upload`;
    const formData = new FormData();
    formData.append('image', file);

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = true;

      const accountId = typeof window !== 'undefined' ? localStorage.getItem('dvyb_account_id') : null;
      if (accountId) {
        xhr.setRequestHeader('X-DVYB-Account-ID', accountId);
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText || '{}');
          resolve(json);
        } catch {
          resolve({ success: false, error: 'Invalid response' });
        }
      };

      xhr.onerror = () => resolve({ success: false, error: 'Network error' });
      xhr.send(formData);
    });
  },

  async create(name: string, imageS3Key: string) {
    return apiRequest<{
      success: boolean;
      data: {
        id: number;
        name: string;
        imageS3Key: string;
        imageUrl: string;
        createdAt: string;
      };
      error?: string;
    }>('/dvyb/products', {
      method: 'POST',
      body: JSON.stringify({ name, image_s3_key: imageS3Key }),
    });
  },

  async update(id: number, name: string) {
    return apiRequest<{
      success: boolean;
      data: {
        id: number;
        name: string;
        imageS3Key: string;
        imageUrl: string;
        createdAt: string;
      };
      error?: string;
    }>(`/dvyb/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },

  async delete(id: number) {
    return apiRequest<{ success: boolean; message?: string; error?: string }>(
      `/dvyb/products/${id}`,
      { method: 'DELETE' }
    );
  },

  /** Hide a domain product from My Products list (domain products use negative id in list response) */
  async hideDomainProduct(domainProductImageId: number) {
    return apiRequest<{ success: boolean; message?: string; error?: string }>(
      `/dvyb/products/domain/${domainProductImageId}/hide`,
      { method: 'POST' }
    );
  },

  /** Rename a domain product: creates account product with new name and hides the domain product */
  async createFromDomain(domainProductImageId: number, name: string) {
    return apiRequest<{
      success: boolean;
      data?: {
        id: number;
        name: string;
        imageS3Key: string;
        imageUrl: string;
        createdAt: string;
      };
      error?: string;
    }>('/dvyb/products/from-domain', {
      method: 'POST',
      body: JSON.stringify({ domainProductImageId, name }),
    });
  },
};

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
  videoEdits: videoEditsApi,
  assets: assetsApi,
  subscription: subscriptionApi,
  inspirations: inspirationsApi,
  contentStrategy: contentStrategyApi,
  brands: brandsApi,
};
