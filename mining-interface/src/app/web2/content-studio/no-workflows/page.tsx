'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { ExclamationTriangleIcon, SparklesIcon } from '@heroicons/react/24/outline'

export default function NoWorkflowsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [industry, setIndustry] = useState<string>('')
  const [contentType, setContentType] = useState<string>('image')

  useEffect(() => {
    // Get content type from query params
    const type = searchParams.get('type') || 'image'
    setContentType(type)

    // Fetch account industry
    const fetchIndustry = async () => {
      const web2Auth = localStorage.getItem('burnie_web2_auth')
      const accountId = localStorage.getItem('burnie_web2_account_id')

      if (!web2Auth || !accountId) {
        router.push('/web2/auth')
        return
      }

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'}/web2-accounts/${accountId}`,
          {
            headers: {
              'Authorization': `Bearer ${web2Auth}`
            }
          }
        )
        
        if (response.ok) {
          const data = await response.json()
          const accountIndustry = data.data?.industry || ''
          setIndustry(accountIndustry)
        }
      } catch (error) {
        console.error('Failed to fetch industry:', error)
      }
    }

    fetchIndustry()
  }, [router, searchParams])

  const getIndustryDisplayName = (industryValue: string) => {
    if (!industryValue) return 'your industry'
    return industryValue.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      <div className={'flex-1 flex flex-col overflow-hidden transition-all duration-300 ' + (sidebarExpanded ? 'ml-64' : 'ml-20')}>
        {/* Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <h1 className="text-xl font-semibold text-white">Content Studio</h1>
        </header>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="max-w-2xl w-full">
            {/* Warning Card */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl border border-yellow-500/30 p-12 text-center">
              {/* Icon */}
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 bg-yellow-500/20 rounded-full flex items-center justify-center">
                  <ExclamationTriangleIcon className="w-10 h-10 text-yellow-500" />
                </div>
              </div>

              {/* Title */}
              <h2 className="text-3xl font-bold text-white mb-4">
                Workflows Not Available Yet
              </h2>

              {/* Message */}
              <p className="text-lg text-gray-300 mb-2">
                No {contentType} generation workflows have been created yet for
              </p>
              <p className="text-2xl font-bold text-yellow-400 mb-8">
                {getIndustryDisplayName(industry)}
              </p>

              {/* Info */}
              <div className="bg-gray-700/30 border border-gray-600/50 rounded-xl p-6 mb-8">
                <p className="text-gray-300 text-center">
                  We're continuously expanding our workflow library to support more industries. 
                  <br />
                  Your industry-specific workflows are coming soon!
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={() => router.push('/web2/content-studio')}
                  className="px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
                >
                  ← Back to Content Studio
                </button>
                <button
                  onClick={() => router.push('/web2/dashboard')}
                  className="px-8 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-medium rounded-lg transition-all"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

