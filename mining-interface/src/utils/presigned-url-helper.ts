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

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001';
  }

  /**
   * Extract S3 key from various URL formats
   */
  private extractS3Key(url: string): string | null {
    try {
      // Handle pre-signed URLs (remove query parameters)
      const cleanUrl = url.split('?')[0];
      
      // Look for ai-generated path
      const match = cleanUrl.match(/ai-generated\/[^\/]+\/[^\/]+\/(images|videos)\/[^\/]+\/[^\/]+\/[^\/]+$/);
      if (match) {
        const urlParts = cleanUrl.split('/');
        const aiGeneratedIndex = urlParts.findIndex(part => part === 'ai-generated');
        if (aiGeneratedIndex !== -1) {
          return urlParts.slice(aiGeneratedIndex).join('/');
        }
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
   * Get pre-signed URL from Python AI backend
   */
  private async fetchPresignedUrl(s3Key: string): Promise<PresignedUrlResponse> {
    try {
      const pythonBackendUrl = process.env.NEXT_PUBLIC_PYTHON_AI_BACKEND_URL || 'http://localhost:8000';
      
      const response = await fetch(`${pythonBackendUrl}/api/s3/generate-presigned-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          s3_key: s3Key,
          expiration: 3600 // 1 hour
        }),
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
      console.error('Error fetching pre-signed URL:', error);
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
      if (!originalUrl.includes('ai-generated/') && !originalUrl.includes('.s3.')) {
        return originalUrl;
      }

      const s3Key = this.extractS3Key(originalUrl);
      if (!s3Key) {
        console.warn('Could not extract S3 key from URL:', originalUrl);
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
 */
export const usePresignedUrl = (originalUrl: string | null) => {
  const [presignedUrl, setPresignedUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!originalUrl) {
      setPresignedUrl(null);
      return;
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
  }, [originalUrl]);

  return { presignedUrl, loading, error };
};

export default presignedUrlManager; 