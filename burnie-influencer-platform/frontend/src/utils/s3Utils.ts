// Utility functions for S3 URLs and pre-signed URL generation

/**
 * Extract S3 key from a full S3 URL
 * @param s3Url - Full S3 URL (e.g., https://burnie-storage.s3.amazonaws.com/brand_logos/file.png)
 * @returns S3 key (e.g., brand_logos/file.png)
 */
export function extractS3Key(s3Url: string): string | null {
  if (!s3Url) return null;
  
  try {
    // Handle different S3 URL formats
    if (s3Url.includes('s3.amazonaws.com/')) {
      // Format: https://bucket.s3.amazonaws.com/key
      const parts = s3Url.split('s3.amazonaws.com/');
      return parts[1] || null;
    } else if (s3Url.includes('.s3.')) {
      // Format: https://bucket.s3.region.amazonaws.com/key
      const urlObj = new URL(s3Url);
      return urlObj.pathname.substring(1); // Remove leading slash
    } else if (s3Url.startsWith('brand_logos/')) {
      // Already an S3 key
      return s3Url;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting S3 key from URL:', error);
    return null;
  }
}

/**
 * Get pre-signed URL for displaying an S3 object
 * @param s3Key - S3 key of the object
 * @returns Promise<string> - Pre-signed URL
 */
export async function getPresignedUrlForDisplay(s3Key: string): Promise<string | null> {
  if (!s3Key) return null;
  
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/logo-presigned-url/${encodeURIComponent(s3Key)}`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get pre-signed URL: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.data.presignedUrl) {
      return data.data.presignedUrl;
    }
    
    throw new Error(data.error || 'Failed to get pre-signed URL');
  } catch (error) {
    console.error('Error getting pre-signed URL:', error);
    return null;
  }
}

/**
 * Get displayable URL for a project logo
 * If it's an S3 URL, convert to pre-signed URL, otherwise return as-is
 * @param logoUrl - Original logo URL (could be S3 URL or direct URL)
 * @returns Promise<string> - Displayable URL
 */
export async function getDisplayableLogoUrl(logoUrl: string): Promise<string | null> {
  if (!logoUrl) return null;
  
  // If it's not an S3 URL, return as-is
  if (!logoUrl.includes('s3.amazonaws.com') && !logoUrl.includes('.s3.')) {
    return logoUrl;
  }
  
  // Extract S3 key and get pre-signed URL
  const s3Key = extractS3Key(logoUrl);
  if (!s3Key) return logoUrl;
  
  const presignedUrl = await getPresignedUrlForDisplay(s3Key);
  return presignedUrl || logoUrl;
}

/**
 * React hook for managing project logo display with pre-signed URLs
 */
import { useState, useEffect } from 'react';

export function useProjectLogo(logoUrl: string | undefined | null) {
  const [displayUrl, setDisplayUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (!logoUrl) {
      setDisplayUrl('');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    getDisplayableLogoUrl(logoUrl)
      .then((url) => {
        setDisplayUrl(url || '');
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading logo:', err);
        setError('Failed to load logo');
        setDisplayUrl('');
        setLoading(false);
      });
  }, [logoUrl]);
  
  return { displayUrl, loading, error };
} 