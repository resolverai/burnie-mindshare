'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ContentRequestManagement from '@/components/admin/ContentRequestManagement'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

export default function ContentRequestsAdminPage() {
  const [adminUser, setAdminUser] = useState<any>(null)
  const router = useRouter()

  useEffect(() => {
    // Check if admin is logged in
    const adminToken = localStorage.getItem('adminToken')
    const adminUserData = localStorage.getItem('adminUser')
    
    if (!adminToken || !adminUserData) {
      router.push('/admin')
      return
    }

    try {
      setAdminUser(JSON.parse(adminUserData))
    } catch (error) {
      console.error('Error parsing admin user data:', error)
      router.push('/admin')
    }
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    localStorage.removeItem('adminUser')
    router.push('/admin')
  }

  if (!adminUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => router.push('/admin/dashboard')}
              className="p-2 text-gray-700 hover:text-gray-900 transition-colors border border-gray-300 rounded-lg hover:bg-gray-50"
              title="Back to Dashboard"
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Content Request Management</h1>
              <p className="text-gray-600 mt-2">Manage and track content requests from users</p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {adminUser.username}</span>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <ContentRequestManagement />
      </div>
    </div>
  )
}
