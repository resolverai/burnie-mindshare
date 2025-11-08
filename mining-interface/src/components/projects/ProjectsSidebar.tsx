'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  HomeIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
  PhotoIcon,
  ArrowRightOnRectangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline'
import { getApiUrlWithFallback } from '@/utils/api-config'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ProjectsSidebarProps {
  projectId: string
  isExpanded: boolean
  onToggle: () => void
}

function SidebarTooltip({ children, enabled, label }: { children: ReactNode; enabled: boolean; label: string }) {
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    setMounted(true)
  }, [])

  const show = () => {
    if (!enabled || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPosition({
      top: rect.top + rect.height / 2,
      left: rect.right + 16
    })
    setVisible(true)
  }

  const hide = () => setVisible(false)

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="relative"
      >
        {children}
      </div>
      {mounted && enabled && visible && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] -translate-y-1/2"
          style={{ top: position.top, left: position.left }}
        >
          <div className="relative flex items-center gap-2 rounded-xl border border-white/10 bg-gray-900/95 px-3 py-1.5 text-sm font-medium text-white shadow-[0_18px_40px_rgba(16,24,40,0.35)] backdrop-blur-md">
            <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]">{label}</span>
            <span className="absolute left-[-6px] top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border border-white/10 border-l-transparent border-t-transparent bg-gray-900/95" />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default function ProjectsSidebar({ projectId, isExpanded, onToggle }: ProjectsSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  const base = `/projects/${projectId}`
  const navigation = [
    { name: 'Dashboard', href: `${base}/dashboard`, icon: HomeIcon },
    { name: 'Context', href: `${base}/context`, icon: DocumentTextIcon },
    { name: 'Daily Posts', href: `${base}/daily-posts`, icon: PhotoIcon },
    { name: 'My Content', href: `${base}/my-content`, icon: DocumentTextIcon },
    { name: 'Settings', href: `${base}/settings`, icon: Cog6ToothIcon },
  ]

  const handleLogout = async () => {
    try {
      // Call backend to clear session cookie
      const apiUrl = getApiUrlWithFallback()
      if (apiUrl) {
        await fetch(`${apiUrl}/projects/logout`, {
          method: 'POST',
          credentials: 'include', // Include cookies to clear them
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }
    } catch (error) {
      console.error('Error during logout:', error)
    } finally {
      // Clear localStorage
      localStorage.removeItem('burnie_project_id')
      // Redirect to home
      router.push('/')
    }
  }

  return (
    <div className={`fixed inset-y-0 left-0 z-50 bg-gray-900 border-r border-gray-800 transition-all duration-300 ease-in-out flex flex-col ${
      isExpanded ? 'w-64' : 'w-20'
    }`}>
      {/* Logo and Toggle */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800 flex-shrink-0">
        {isExpanded ? (
          <>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xl">🔥</span>
              </div>
              <span className="text-xl font-bold text-white">BURNIE</span>
            </div>
            <button
              onClick={onToggle}
              className="text-gray-400 hover:text-white transition-colors p-1"
              title="Collapse sidebar"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>
          </>
        ) : (
          <button
            onClick={onToggle}
            className="w-full flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            title="Expand sidebar"
          >
            <ChevronRightIcon className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Navigation - Scrollable */}
      <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto overflow-visible">
        {navigation.map((item) => {
          const isActive = pathname?.startsWith(item.href)
          return (
            <SidebarTooltip key={item.name} enabled={!isExpanded} label={item.name}>
              <Link
                href={item.href}
                className={`flex items-center ${isExpanded ? 'px-4' : 'px-3 justify-center'} py-3 text-sm font-medium rounded-lg transition-colors ${
                  isActive
                    ? 'bg-gradient-to-r from-orange-500/20 to-red-500/20 text-orange-400 border border-orange-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
                aria-label={!isExpanded ? item.name : undefined}
                title={isExpanded ? item.name : undefined}
              >
                <item.icon className={`w-5 h-5 ${isExpanded ? 'mr-3' : ''} flex-shrink-0`} />
                {isExpanded && <span>{item.name}</span>}
              </Link>
            </SidebarTooltip>
          )
        })}
      </nav>

      {/* Logout Button - Fixed at bottom */}
      <div className="p-3 border-t border-gray-800 flex-shrink-0">
        <SidebarTooltip enabled={!isExpanded} label="Logout">
          <button
            onClick={handleLogout}
            className={`flex items-center w-full ${isExpanded ? 'px-4' : 'px-3 justify-center'} py-3 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors`}
            aria-label={!isExpanded ? 'Logout' : undefined}
            title={isExpanded ? 'Logout' : undefined}
          >
            <ArrowRightOnRectangleIcon className={`w-5 h-5 ${isExpanded ? 'mr-3' : ''} flex-shrink-0`} />
            {isExpanded && <span>Logout</span>}
          </button>
        </SidebarTooltip>
      </div>
    </div>
  )
}


