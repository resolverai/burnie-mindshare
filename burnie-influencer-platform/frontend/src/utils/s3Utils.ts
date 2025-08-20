// Utility functions for S3 URLs and pre-signed URL generation

/**
 * Extract S3 key from a full S3 URL
 * @param s3Url - Full S3 URL (e.g., https://burnie-storage.s3.amazonaws.com/brand_logos/file.png)
 * @returns S3 key (e.g., brand_logos/file.png)
 */
export function extractS3Key(s3Url: string): string | null {
  if (!s3Url) return null;
  
  console.log('🔍 Extracting S3 key from URL:', s3Url);
  
  try {
    // Handle different S3 URL formats
    if (s3Url.includes('s3.amazonaws.com/')) {
      // Format: https://bucket.s3.amazonaws.com/key
      const parts = s3Url.split('s3.amazonaws.com/');
      const extractedKey = parts[1] || null;
      console.log('🔍 Extracted S3 key (format 1):', extractedKey);
      return extractedKey;
    } else if (s3Url.includes('.s3.')) {
      // Format: https://bucket.s3.region.amazonaws.com/key
      const urlObj = new URL(s3Url);
      const extractedKey = urlObj.pathname.substring(1); // Remove leading slash
      console.log('🔍 Extracted S3 key (format 2):', extractedKey);
      return extractedKey;
    } else if (s3Url.startsWith('brand_logos/') || s3Url.startsWith('campaign_banners/')) {
      // Already an S3 key
      console.log('🔍 Already an S3 key:', s3Url);
      return s3Url;
    }
    
    console.log('🔍 URL format not recognized, returning null');
    return null;
  } catch (error) {
    console.error('🔍 Error extracting S3 key from URL:', error);
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
  
  console.log('🔗 Requesting presigned URL for S3 key:', s3Key);
  
  try {
    const url = `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/logo-presigned-url/${encodeURIComponent(s3Key)}`;
    console.log('🔗 Full request URL:', url);
    
    const response = await fetch(url);
    
    console.log('🔗 Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('🔗 Response error:', errorText);
      throw new Error(`Failed to get pre-signed URL: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log('🔗 Response data:', data);
    
    if (data.success && data.data.presignedUrl) {
      console.log('🔗 Successfully generated presigned URL');
      return data.data.presignedUrl;
    }
    
    throw new Error(data.error || 'Failed to get pre-signed URL');
  } catch (error) {
    console.error('🔗 Error getting pre-signed URL:', error);
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
  
  console.log('🖼️ Processing URL for display:', logoUrl);
  
  // If it's not an S3 URL, return as-is
  if (!logoUrl.includes('s3.amazonaws.com') && !logoUrl.includes('.s3.')) {
    console.log('🖼️ Not an S3 URL, returning as-is');
    return logoUrl;
  }
  
  // Extract S3 key and get pre-signed URL
  const s3Key = extractS3Key(logoUrl);
  console.log('🖼️ Extracted S3 key:', s3Key);
  
  if (!s3Key) return logoUrl;
  
  const presignedUrl = await getPresignedUrlForDisplay(s3Key);
  console.log('🖼️ Generated presigned URL:', presignedUrl ? 'Success' : 'Failed');
  
  return presignedUrl || logoUrl;
}

/**
 * Get displayable URL for a campaign banner
 * Alias for getDisplayableLogoUrl since they use the same S3 infrastructure
 * @param bannerUrl - Original banner URL (could be S3 URL or direct URL)
 * @returns Promise<string> - Displayable URL
 */
export async function getDisplayableBannerUrl(bannerUrl: string): Promise<string | null> {
  console.log('🎨 Processing banner URL for display:', bannerUrl);
  return getDisplayableLogoUrl(bannerUrl);
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