import { useEffect, useRef, useState } from 'react';

interface TimeTrackingOptions {
  trackVisibility?: boolean; // Track only when page is visible
  trackFocus?: boolean; // Track only when page has focus
  minTimeThreshold?: number; // Minimum time in ms to track
}

interface TimeTrackingResult {
  timeSpent: number; // Total time spent in milliseconds
  isTracking: boolean; // Whether currently tracking
  startTracking: () => void; // Manually start tracking
  stopTracking: () => void; // Manually stop tracking
  resetTime: () => void; // Reset accumulated time
  getTimeSpentSeconds: () => number; // Get time in seconds
}

export const useTimeTracking = (options: TimeTrackingOptions = {}): TimeTrackingResult => {
  const {
    trackVisibility = true,
    trackFocus = true,
    minTimeThreshold = 1000 // 1 second minimum
  } = options;

  const [timeSpent, setTimeSpent] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startTracking = () => {
    if (isTracking) return;
    
    startTimeRef.current = Date.now();
    setIsTracking(true);
  };

  const stopTracking = () => {
    if (!isTracking || !startTimeRef.current) return;
    
    const sessionTime = Date.now() - startTimeRef.current;
    
    // Only add time if it meets the minimum threshold
    if (sessionTime >= minTimeThreshold) {
      setTimeSpent(prev => prev + sessionTime);
    }
    
    startTimeRef.current = null;
    setIsTracking(false);
  };

  const resetTime = () => {
    setTimeSpent(0);
    if (isTracking) {
      startTimeRef.current = Date.now();
    }
  };

  const getTimeSpentSeconds = () => {
    let currentTime = timeSpent;
    
    // Add current session time if tracking
    if (isTracking && startTimeRef.current) {
      currentTime += Date.now() - startTimeRef.current;
    }
    
    return Math.floor(currentTime / 1000);
  };

  // Track visibility changes
  useEffect(() => {
    if (!trackVisibility) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTracking();
      } else {
        startTracking();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Start tracking if page is visible on mount
    if (!document.hidden) {
      startTracking();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [trackVisibility]);

  // Track focus changes
  useEffect(() => {
    if (!trackFocus) return;

    const handleFocus = () => startTracking();
    const handleBlur = () => stopTracking();

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    // Start tracking if window has focus on mount
    if (document.hasFocus()) {
      startTracking();
    }

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [trackFocus]);

  // Auto-start tracking if neither visibility nor focus tracking is enabled
  useEffect(() => {
    if (!trackVisibility && !trackFocus) {
      startTracking();
    }
  }, [trackVisibility, trackFocus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (isTracking) {
        stopTracking();
      }
    };
  }, []);

  return {
    timeSpent,
    isTracking,
    startTracking,
    stopTracking,
    resetTime,
    getTimeSpentSeconds
  };
};

export default useTimeTracking;
