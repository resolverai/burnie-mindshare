'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { 
  HomeIcon, 
  DocumentTextIcon, 
  CalendarIcon, 
  Cog6ToothIcon, 
  PhotoIcon, 
  ArrowRightOnRectangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline'

interface ProjectsSidebarProps {
  projectId: string
  isExpanded: boolean
  onToggle: () => void
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

  const handleLogout = () => {
    localStorage.removeItem('burnie_project_id')
    router.push('/')
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
      <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname?.startsWith(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center ${isExpanded ? 'px-4' : 'px-3 justify-center'} py-3 text-sm font-medium rounded-lg transition-colors group relative ${
                isActive
                  ? 'bg-gradient-to-r from-orange-500/20 to-red-500/20 text-orange-400 border border-orange-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
              title={!isExpanded ? item.name : ''}
            >
              <item.icon className={`w-5 h-5 ${isExpanded ? 'mr-3' : ''} flex-shrink-0`} />
              {isExpanded && <span>{item.name}</span>}
              
              {/* Tooltip for collapsed state */}
              {!isExpanded && (
                <div className="absolute left-full ml-6 px-2 py-1 bg-gray-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                  {item.name}
                </div>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Logout Button - Fixed at bottom */}
      <div className="p-3 border-t border-gray-800 flex-shrink-0">
        <button
          onClick={handleLogout}
          className={`flex items-center w-full ${isExpanded ? 'px-4' : 'px-3 justify-center'} py-3 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors group relative`}
          title={!isExpanded ? 'Logout' : ''}
        >
          <ArrowRightOnRectangleIcon className={`w-5 h-5 ${isExpanded ? 'mr-3' : ''} flex-shrink-0`} />
          {isExpanded && <span>Logout</span>}
          
          {/* Tooltip for collapsed state */}
          {!isExpanded && (
            <div className="absolute left-full ml-6 px-2 py-1 bg-gray-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
              Logout
            </div>
          )}
        </button>
      </div>
    </div>
  )
}


