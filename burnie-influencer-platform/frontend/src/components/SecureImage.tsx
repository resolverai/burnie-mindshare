/**
 * Secure Image Component for Yapper Dashboard
 * Automatically handles S3 pre-signed URLs with caching and refresh
 */

import React, { useState, useEffect } from 'react';
import { usePresignedUrl } from '../utils/presigned-url-helper';

interface SecureImageProps {
  src: string;
  alt: string;
  contentId?: string; // For marketplace content
  className?: string;
  style?: React.CSSProperties;
  onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onError?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  fallbackComponent?: React.ReactNode;
  showLoading?: boolean;
  loadingComponent?: React.ReactNode;
  // Copy protection props
  onDragStart?: (event: React.DragEvent<HTMLImageElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLImageElement>) => void;
  userSelect?: 'none' | 'auto';
}

export const SecureImage: React.FC<SecureImageProps> = ({
  src,
  alt,
  contentId,
  className = '',
  style,
  onLoad,
  onError,
  fallbackComponent,
  showLoading = true,
  loadingComponent,
  onDragStart,
  onContextMenu,
  userSelect = 'none'
}) => {
  const { presignedUrl, loading, error } = usePresignedUrl(src, contentId);
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

  // Default copy protection handlers
  const preventDrag = (event: React.DragEvent<HTMLImageElement>) => {
    event.preventDefault();
    onDragStart?.(event);
  };

  const preventContextMenu = (event: React.MouseEvent<HTMLImageElement>) => {
    event.preventDefault();
    onContextMenu?.(event);
  };

  // Show loading state while fetching pre-signed URL
  if (loading && showLoading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }
    
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`} style={style}>
        <div className="text-center p-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600 mx-auto mb-2"></div>
          <p className="text-gray-600 text-sm">Loading secure image...</p>
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
      <div className={`flex items-center justify-center bg-gray-100 border border-red-200 rounded-lg ${className}`} style={style}>
        <div className="text-center p-4">
          <div className="text-red-500 text-2xl mb-2">🚫</div>
          <p className="text-red-500 text-sm">Failed to load secure image</p>
          <p className="text-gray-400 text-xs mt-1">{error}</p>
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

  // Render the actual image with copy protection
  return (
    <>
      {presignedUrl && (
        <img
          src={presignedUrl}
          alt={alt}
          className={className}
          style={{
            ...style,
            userSelect: userSelect,
            WebkitUserSelect: userSelect
          }}
          onLoad={handleImageLoad}
          onError={handleImageError}
          onDragStart={preventDrag}
          onContextMenu={preventContextMenu}
        />
      )}
      
      {/* Show fallback while loading if no custom loading component */}
      {!imageLoaded && !imageError && presignedUrl && !showLoading && (
        <div className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`} style={style}>
          <div className="text-center p-4">
            <div className="text-4xl mb-2">🖼️</div>
            <p className="text-gray-600 text-sm">Loading image...</p>
          </div>
        </div>
      )}
    </>
  );
};

export default SecureImage; 