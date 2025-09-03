'use client'

import { useEffect } from 'react'
import { preventAppKitModals } from '../utils/appkitModalPrevention'

export default function AppKitModalPrevention() {
  useEffect(() => {
    // Prevent AppKit modals globally
    const cleanup = preventAppKitModals()
    
    // Cleanup function
    return cleanup
  }, [])

  return null // This component doesn't render anything
}
