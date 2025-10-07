/**
 * Utility functions for device detection
 */

/**
 * Detects if the current device is mobile based on user agent and screen width
 * @returns boolean indicating if device is mobile
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         window.innerWidth < 768
}

/**
 * Detects if the current device is desktop
 * @returns boolean indicating if device is desktop
 */
export function isDesktopDevice(): boolean {
  return !isMobileDevice()
}

/**
 * Gets device type as string
 * @returns 'mobile' | 'desktop'
 */
export function getDeviceType(): 'mobile' | 'desktop' {
  return isMobileDevice() ? 'mobile' : 'desktop'
}
