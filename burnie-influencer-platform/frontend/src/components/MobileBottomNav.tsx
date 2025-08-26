'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Image from 'next/image'

interface NavigationItem {
  id: string
  label: string
  icon: string
  route: string
  requiresAuth?: boolean
}

interface MobileBottomNavProps {
  navigationItems: NavigationItem[]
  isAuthenticated?: boolean
}

export default function MobileBottomNav({ navigationItems, isAuthenticated = false }: MobileBottomNavProps) {
  const router = useRouter()
  const pathname = usePathname()
  
  // State for bottom navigation visibility
  const [isVisible, setIsVisible] = useState(true)

  // Scroll detection for bottom navigation hiding - ONLY when PurchaseContentModal is open
  useEffect(() => {
    // Check if PurchaseContentModal is currently open
    const isModalOpen = () => {
      // Only look for the PurchaseContentModal specifically
      const modal = document.querySelector('[class*="PurchaseContentModal"]')
      return !!modal
    }

    // Listen for scroll events on modal elements (PurchaseContentModal)
    const handleModalScroll = (event: Event) => {
      const target = event.target as HTMLElement
      if (!target) return
      
      // Check if this is the PurchaseContentModal scrollable content
      const isModalContent = target.closest('.modal-scrollable') || 
                           target.closest('[class*="overflow-y-auto"]') ||
                           target.closest('[class*="PurchaseContentModal"]')
      
      if (!isModalContent) return
      
      const scrollTop = target.scrollTop
      const scrollHeight = target.scrollHeight
      const clientHeight = target.clientHeight
      
      // Calculate modal scroll percentage
      const modalScrollPercentage = scrollTop / (scrollHeight - clientHeight)
      
      // Determine scroll direction by comparing with previous scroll position
      const lastScrollTop = parseInt(target.dataset.lastScrollTop || '0', 10)
      const isScrollingUp = scrollTop < lastScrollTop
      const isScrollingDown = scrollTop > lastScrollTop
      
      // Store current scroll position for next comparison
      target.dataset.lastScrollTop = scrollTop.toString()
      
      // Hide navigation when scrolling down and 70% scrolled
      if (isScrollingDown && modalScrollPercentage > 0.7 && isVisible) {
        console.log('📱 Modal scrolling down 70% - hiding navigation')
        setIsVisible(false)
      }
      // Show navigation when scrolling up and less than 70% scrolled
      else if (isScrollingUp && modalScrollPercentage < 0.7 && !isVisible) {
        console.log('📱 Modal scrolling up - showing navigation')
        setIsVisible(true)
      }
      // Always show navigation when at the very top of modal
      else if (scrollTop < 50 && !isVisible) {
        console.log('📱 Modal at top - showing navigation')
        setIsVisible(true)
      }
    }

    // Listen for scroll events on modal elements
    const modalElements = document.querySelectorAll('.modal-scrollable, [class*="overflow-y-auto"]')
    modalElements.forEach(element => {
      element.addEventListener('scroll', handleModalScroll, { passive: true })
    })
    
    // Also listen for any new modal elements that might be added dynamically
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Check for removed nodes (modal closed)
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element
            // If PurchaseContentModal is removed, show navigation
            if (element.querySelector('[class*="PurchaseContentModal"]') || 
                element.matches('[class*="PurchaseContentModal"]')) {
              if (!isVisible) {
                console.log('📱 Modal closed - showing navigation')
                setIsVisible(true)
              }
            }
          }
        })
        
        // Check for added nodes (modal opened)
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element
            const scrollableElements = element.querySelectorAll('.modal-scrollable, [class*="overflow-y-auto"]')
            scrollableElements.forEach(scrollableElement => {
              scrollableElement.addEventListener('scroll', handleModalScroll, { passive: true })
            })
          }
        })
      })
    })
    
    observer.observe(document.body, { childList: true, subtree: true })
    
    // Remove automatic periodic check - navigation should only show when user scrolls up
    // const checkModalState = () => {
    //   if (!isModalOpen() && !isVisible) {
    //     setIsVisible(true)
    //   }
    // }
    // const modalCheckInterval = setInterval(checkModalState, 1000) // Check every second
    
    return () => {
      modalElements.forEach(element => {
        element.removeEventListener('scroll', handleModalScroll)
      })
      observer.disconnect()
      // clearInterval(modalCheckInterval) // No longer needed
    }
  }, [isVisible])

  const handleNavigation = (item: NavigationItem) => {
    if (item.requiresAuth && !isAuthenticated) {
      return // Don't navigate if auth required but not authenticated
    }
    router.push(item.route)
  }

  return (
    <nav 
      className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-yapper-surface/95 backdrop-blur-md border-t border-yapper-border transition-transform duration-300 ease-out ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <div className="flex items-center justify-around px-2 py-2">
        {navigationItems.map((item) => {
          const isActive = pathname === item.route
          const isDisabled = item.requiresAuth && !isAuthenticated
          
          return (
            <button
              key={item.id}
              onClick={() => handleNavigation(item)}
              disabled={isDisabled}
              className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg transition-all duration-200 min-w-[60px] ${
                isActive 
                  ? 'text-white bg-yapper-muted/50' 
                  : isDisabled
                  ? 'text-white/40 cursor-not-allowed'
                  : 'text-white/70 hover:text-white hover:bg-yapper-muted/30'
              }`}
            >
              <Image 
                src={item.icon} 
                alt={item.label} 
                width={20} 
                height={20} 
                className={`w-5 h-5 mb-1 ${
                  isActive ? 'opacity-100' : 'opacity-70'
                }`}
              />
              <span className="text-xs font-medium leading-tight text-center">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
