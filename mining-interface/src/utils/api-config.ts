/**
 * API Configuration Utility
 * Handles inconsistent API URL patterns across the mining interface
 */

/**
 * Get the base API URL without /api suffix
 * Handles both cases: env var with or without /api
 */
export function getBaseApiUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api';
  
  // Remove /api suffix if present to get base URL
  return envUrl.endsWith('/api') ? envUrl.slice(0, -4) : envUrl;
}

/**
 * Get the full API URL with /api suffix
 * Ensures consistent /api endpoint
 */
export function getApiUrl(): string {
  const baseUrl = getBaseApiUrl();
  return `${baseUrl}/api`;
}

/**
 * Build a complete API endpoint URL
 * @param endpoint - The endpoint path (without leading slash)
 * @returns Complete URL with proper /api prefix
 */
export function buildApiUrl(endpoint: string): string {
  const apiUrl = getApiUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  return `${apiUrl}/${cleanEndpoint}`;
}

/**
 * Legacy compatibility function
 * For components that expect the old pattern
 */
export function getApiUrlWithFallback(): string {
  const envUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL;
  
  // Validate and clean the URL
  if (envUrl && envUrl.trim()) {
    const cleaned = envUrl.trim();
    // Ensure it starts with http:// or https://
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      // Remove trailing slash
      return cleaned.endsWith('/') ? cleaned.slice(0, -1) : cleaned;
    }
    // If it doesn't start with http, it might be malformed
    console.warn('NEXT_PUBLIC_BURNIE_API_URL does not start with http:// or https://:', cleaned);
  }
  
  // Fallback to default
  const defaultUrl = 'http://localhost:3001/api';
  console.log('Using default API URL:', defaultUrl);
  return defaultUrl;
}

// Export default configuration
export const API_CONFIG = {
  baseUrl: getBaseApiUrl(),
  apiUrl: getApiUrl(),
  buildUrl: buildApiUrl,
  legacy: getApiUrlWithFallback()
};

export default API_CONFIG;
