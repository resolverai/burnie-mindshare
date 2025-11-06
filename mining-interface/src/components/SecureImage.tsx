/**
 * Secure Image Component for Mining Interface
 * Automatically handles S3 pre-signed URLs with caching and refresh
 */

import React, { useState, useEffect } from 'react';
import { usePresignedUrl } from '../utils/presigned-url-helper';

interface SecureImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onError?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  fallbackComponent?: React.ReactNode;
  showLoading?: boolean;
  loadingComponent?: React.ReactNode;
  projectId?: string | null; // Optional project ID for TypeScript backend endpoint
}

export const SecureImage: React.FC<SecureImageProps> = ({
  src,
  alt,
  className = '',
  style,
  onLoad,
  onError,
  fallbackComponent,
  showLoading = true,
  loadingComponent,
  projectId
}) => {
  const { presignedUrl, loading, error } = usePresignedUrl(src, projectId);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Reset states when src changes
  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [src]);

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setImageLoaded(true);
    setImageError(false);
    onLoad?.(event);
  };

  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setImageError(true);
    onError?.(event);
  };

  // Show loading state while fetching pre-signed URL
  if (loading && showLoading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }
    
    return (
      <div className={`flex items-center justify-center bg-gray-800 rounded-lg ${className}`} style={style}>
        <div className="text-center p-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400 mx-auto mb-2"></div>
          <p className="text-gray-400 text-sm">Loading secure image...</p>
        </div>
      </div>
    );
  }

  // Show error state if pre-signed URL generation failed
  if (error && !presignedUrl) {
    if (fallbackComponent) {
      return <>{fallbackComponent}</>;
    }
    
    return (
      <div className={`flex items-center justify-center bg-gray-800 border border-red-500/20 rounded-lg ${className}`} style={style}>
        <div className="text-center p-4">
          <div className="text-red-400 text-2xl mb-2">🚫</div>
          <p className="text-red-400 text-sm">Failed to load secure image</p>
          <p className="text-gray-500 text-xs mt-1">{error}</p>
        </div>
      </div>
    );
  }

  // Show fallback while image is loading or if image error
  if (!imageLoaded || imageError) {
    const showFallback = imageError || (!imageLoaded && presignedUrl);
    
    if (showFallback && fallbackComponent) {
      return (
        <>
          {fallbackComponent}
          {presignedUrl && !imageError && (
            <img
              src={presignedUrl}
              alt={alt}
              className="hidden"
              onLoad={handleImageLoad}
              onError={handleImageError}
            />
          )}
        </>
      );
    }
  }

  // Render the actual image
  return (
    <>
      {presignedUrl && (
        <img
          src={presignedUrl}
          alt={alt}
          className={className}
          style={style}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      )}
      
      {/* Show fallback while loading if no custom loading component */}
      {!imageLoaded && !imageError && presignedUrl && !showLoading && (
        <div className={`flex items-center justify-center bg-gray-800 rounded-lg ${className}`} style={style}>
          <div className="text-center p-4">
            <div className="text-4xl mb-2">🖼️</div>
            <p className="text-gray-400 text-sm">Loading image...</p>
          </div>
        </div>
      )}
    </>
  );
};

export default SecureImage; 