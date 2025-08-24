'use client'

import React from 'react'
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

  const handleNavigation = (item: NavigationItem) => {
    if (item.requiresAuth && !isAuthenticated) {
      return // Don't navigate if auth required but not authenticated
    }
    router.push(item.route)
  }

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-yapper-surface/95 backdrop-blur-md border-t border-yapper-border">
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
