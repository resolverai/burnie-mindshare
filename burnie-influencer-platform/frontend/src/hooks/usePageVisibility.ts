'use client'

import { useState, useEffect } from 'react'

/**
 * Hook to detect when user returns to the page after app switching (mobile wallet flow)
 * This is crucial for detecting when users return from wallet apps on mobile
 */
export function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(true)
  const [wasHidden, setWasHidden] = useState(false)
  const [returnedFromBackground, setReturnedFromBackground] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleVisibilityChange = () => {
      const isCurrentlyVisible = !document.hidden
      
      console.log('📱 Page visibility changed:', {
        isCurrentlyVisible,
        wasHidden,
        timestamp: new Date().toISOString()
      })

      if (!isCurrentlyVisible) {
        // Page is being hidden (user switching to wallet app)
        setIsVisible(false)
        setWasHidden(true)
        console.log('📱 Page hidden - user likely switched to wallet app')
      } else if (wasHidden) {
        // Page is becoming visible after being hidden (user returning from wallet app)
        setIsVisible(true)
        setReturnedFromBackground(true)
        console.log('📱 Page visible after being hidden - user returned from wallet app')
        
        // Clear the flag after a short delay to allow other components to react
        setTimeout(() => {
          setReturnedFromBackground(false)
        }, 2000)
      } else {
        // Page is visible (normal state)
        setIsVisible(true)
      }
    }

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Also listen for focus events as backup
    const handleFocus = () => {
      if (wasHidden) {
        console.log('📱 Window focused after being hidden - user returned')
        setReturnedFromBackground(true)
        setTimeout(() => {
          setReturnedFromBackground(false)
        }, 2000)
      }
    }

    const handleBlur = () => {
      console.log('📱 Window blurred - user likely switching apps')
      setWasHidden(true)
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    // Initial state
    setIsVisible(!document.hidden)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [wasHidden])

  return {
    isVisible,
    wasHidden,
    returnedFromBackground
  }
}
