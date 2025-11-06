/**
 * Pre-signed URL Helper for Mining Interface
 * Handles S3 pre-signed URL generation, caching, and refresh logic
 */

import React from 'react';

interface PresignedUrlCache {
  url: string;
  expiresAt: string;
  s3Key: string;
  generatedAt: string;
}

interface PresignedUrlResponse {
  success: boolean;
  presigned_url?: string;
  expires_at?: string;
  expires_in_seconds?: number;
  s3_key?: string;
  error?: string;
}

class PresignedUrlManager {
  private cache = new Map<string, PresignedUrlCache>();
  private baseUrl: string;
  private projectId: string | null = null;

  constructor() {
    // Import here to avoid circular dependency
    const getBaseApiUrl = () => {
      const envUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api';
      return envUrl.endsWith('/api') ? envUrl.slice(0, -4) : envUrl;
    };
    this.baseUrl = getBaseApiUrl();
  }

  /**
   * Set the project ID for presigned URL requests
   * This should be called from the component that uses this manager
   */
  setProjectId(projectId: string | null) {
    this.projectId = projectId;
  }

  /**
   * Extract S3 key from various URL formats
   * Handles both S3 keys and presigned S3 URLs
   */
  private extractS3Key(url: string): string | null {
    try {
      // If it's already an S3 key (starts with s3:// or doesn't have http/https), return as-is
      if (url.startsWith('s3://')) {
        const parts = url.replace('s3://', '').split('/');
        return parts.slice(1).join('/'); // Remove bucket name
      }
      
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        // Already an S3 key
        return url.startsWith('/') ? url.slice(1) : url;
      }
      
      // Handle pre-signed URLs (remove query parameters)
      const cleanUrl = url.split('?')[0];
      
      // Pattern 1: S3 presigned URL - https://bucket.s3.amazonaws.com/key or https://s3.amazonaws.com/bucket/key
      // Extract the S3 key from the path
      if (cleanUrl.includes('.s3.amazonaws.com/') || cleanUrl.includes('s3.amazonaws.com/')) {
        // Pattern: https://bucket.s3.amazonaws.com/key
        const bucketMatch = cleanUrl.match(/https?:\/\/([^\.]+)\.s3\.amazonaws\.com\/(.+)$/);
        if (bucketMatch) {
          return bucketMatch[2]; // Return the key part
        }
        
        // Pattern: https://s3.amazonaws.com/bucket/key
        const s3Match = cleanUrl.match(/https?:\/\/s3\.amazonaws\.com\/([^\/]+)\/(.+)$/);
        if (s3Match) {
          return s3Match[2]; // Return the key part
        }
      }
      
      // Pattern 2: Look for ai-generated path (for older format)
      const aiGeneratedMatch = cleanUrl.match(/ai-generated\/[^\/]+\/[^\/]+\/(images|videos)\/[^\/]+\/[^\/]+\/[^\/]+$/);
      if (aiGeneratedMatch) {
        const urlParts = cleanUrl.split('/');
        const aiGeneratedIndex = urlParts.findIndex(part => part === 'ai-generated');
        if (aiGeneratedIndex !== -1) {
          return urlParts.slice(aiGeneratedIndex).join('/');
        }
      }
      
      // Pattern 3: Look for web3_projects path (new format)
      const web3Match = cleanUrl.match(/web3_projects\/\d+\/(.+)$/);
      if (web3Match) {
        return web3Match[1]; // Return everything after web3_projects/{id}/
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting S3 key:', error);
      return null;
    }
  }

  /**
   * Check if a pre-signed URL is expired or about to expire
   */
  private isUrlExpiredOrExpiring(cachedUrl: PresignedUrlCache): boolean {
    const now = new Date();
    const expiresAt = new Date(cachedUrl.expiresAt);
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    
    // Consider expired if less than 5 minutes remaining
    return timeUntilExpiry <= 5 * 60 * 1000;
  }

  /**
   * Get pre-signed URL from TypeScript backend (which uses Redis caching)
   * The TypeScript backend will check Redis cache first, then call Python backend if needed
   */
  private async fetchPresignedUrl(s3Key: string): Promise<PresignedUrlResponse> {
    try {
      // If no project ID is set, try to extract it from the S3 key
      let projectId = this.projectId;
      if (!projectId && s3Key.includes('web3_projects/')) {
        const match = s3Key.match(/web3_projects\/(\d+)/);
        if (match) {
          projectId = match[1];
        }
      }

      if (!projectId) {
        console.warn('No project ID available for presigned URL request, falling back to direct Python backend call');
        // Fallback to direct Python backend call if no project ID
        return this.fetchPresignedUrlFromPython(s3Key);
      }

      // Call TypeScript backend endpoint which has Redis caching
      const apiUrl = `${this.baseUrl}/api`;
      const response = await fetch(`${apiUrl}/projects/${projectId}/presigned-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include cookies for session
        body: JSON.stringify({
          s3_key: s3Key
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.success && result.presigned_url) {
        return {
          success: true,
          presigned_url: result.presigned_url,
          expires_at: result.expires_at,
          expires_in_seconds: result.expires_in_seconds,
          s3_key: s3Key
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to generate pre-signed URL'
        };
      }
    } catch (error) {
      console.error('Error fetching pre-signed URL:', error);
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Fallback: Get pre-signed URL directly from Python AI backend
   * This should only be used if TypeScript backend is unavailable
   */
  private async fetchPresignedUrlFromPython(s3Key: string): Promise<PresignedUrlResponse> {
    try {
      const pythonBackendUrl = process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      
      // Python backend expects s3_key and expiration as query parameters, not in POST body
      const queryParams = new URLSearchParams({
        s3_key: s3Key,
        expiration: '3600' // 1 hour
      });
      
      const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url?${queryParams}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.status === 'success') {
        return {
          success: true,
          presigned_url: result.presigned_url,
          expires_at: result.details?.expires_at,
          expires_in_seconds: result.details?.expires_in_seconds,
          s3_key: s3Key
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to generate pre-signed URL'
        };
      }
    } catch (error) {
      console.error('Error fetching pre-signed URL from Python backend:', error);
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get a valid pre-signed URL (from cache or generate new)
   */
  async getPresignedUrl(originalUrl: string): Promise<string> {
    try {
      // If it's not an S3 URL, return as-is
      if (!originalUrl.includes('ai-generated/') && 
          !originalUrl.includes('.s3.') && 
          !originalUrl.includes('s3.amazonaws.com') &&
          !originalUrl.includes('web3_projects/')) {
        return originalUrl;
      }

      // Check if URL is already a presigned URL (has query parameters with Signature)
      // If it's a valid presigned URL that's not expired, we can use it as-is
      if (originalUrl.includes('?') && originalUrl.includes('Signature=')) {
        // It's already a presigned URL - check if it's expired
        // For now, we'll regenerate it to be safe, but we could parse the expiration
        // For simplicity, let's extract the key and regenerate
      }

      const s3Key = this.extractS3Key(originalUrl);
      if (!s3Key) {
        console.warn('Could not extract S3 key from URL:', originalUrl);
        // If we can't extract the key but it looks like a valid URL, return as-is
        if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
          return originalUrl;
        }
        return originalUrl; // Fallback to original URL
      }

      // Check cache first
      const cachedUrl = this.cache.get(s3Key);
      if (cachedUrl && !this.isUrlExpiredOrExpiring(cachedUrl)) {
        return cachedUrl.url;
      }

      // Generate new pre-signed URL
      const result = await this.fetchPresignedUrl(s3Key);
      
      if (result.success && result.presigned_url) {
        // Cache the new URL
        this.cache.set(s3Key, {
          url: result.presigned_url,
          expiresAt: result.expires_at || new Date(Date.now() + 3600000).toISOString(),
          s3Key: s3Key,
          generatedAt: new Date().toISOString()
        });
        
        return result.presigned_url;
      } else {
        console.error('Failed to generate pre-signed URL:', result.error);
        return originalUrl; // Fallback to original URL
      }
    } catch (error) {
      console.error('Error in getPresignedUrl:', error);
      return originalUrl; // Fallback to original URL
    }
  }

  /**
   * Pre-load pre-signed URLs for multiple images
   */
  async preloadUrls(urls: string[]): Promise<Map<string, string>> {
    const urlMap = new Map<string, string>();
    
    const promises = urls.map(async (url) => {
      const presignedUrl = await this.getPresignedUrl(url);
      urlMap.set(url, presignedUrl);
      return { original: url, presigned: presignedUrl };
    });

    await Promise.all(promises);
    return urlMap;
  }

  /**
   * Clear expired URLs from cache
   */
  clearExpiredCache(): void {
    const now = new Date();
    const keysToDelete: string[] = [];
    
    this.cache.forEach((cachedUrl, key) => {
      if (this.isUrlExpiredOrExpiring(cachedUrl)) {
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear all cached URLs
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Global instance
export const presignedUrlManager = new PresignedUrlManager();

/**
 * React hook for managing pre-signed URLs
 * @param originalUrl - The original S3 URL or key
 * @param projectId - Optional project ID to use for TypeScript backend endpoint (if not provided, will try to extract from URL)
 */
export const usePresignedUrl = (originalUrl: string | null, projectId?: string | null) => {
  const [presignedUrl, setPresignedUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!originalUrl) {
      setPresignedUrl(null);
      return;
    }

    // Set project ID if provided
    if (projectId) {
      presignedUrlManager.setProjectId(projectId);
    }

    setLoading(true);
    setError(null);

    presignedUrlManager.getPresignedUrl(originalUrl)
      .then((url) => {
        setPresignedUrl(url);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error getting pre-signed URL:', err);
        setError(err.message || 'Failed to load image');
        setPresignedUrl(originalUrl); // Fallback
        setLoading(false);
      });
  }, [originalUrl, projectId]);

  return { presignedUrl, loading, error };
};

export default presignedUrlManager; 