'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Web2Sidebar from '@/components/Web2Sidebar'
import { SparklesIcon, PhotoIcon, CheckCircleIcon, ClockIcon, Bars3Icon } from '@heroicons/react/24/outline'

export default function Web2DashboardPage() {
  const router = useRouter()
  const [accountData, setAccountData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [isUploadingLogo, setIsUploadingLogo] = useState(false)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)

  useEffect(() => {
    // Check authentication
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const accountId = localStorage.getItem('burnie_web2_account_id')

    if (!web2Auth || !accountId) {
      router.push('/web2/auth')
      return
    }

    // Fetch account data and brand context
    const fetchData = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'
        
        // Fetch account data
        const response = await fetch(
          `${apiUrl}/web2-auth/me`,
          {
            headers: {
              'Authorization': `Bearer ${web2Auth}`
            }
          }
        )

        if (response.ok) {
          const data = await response.json()
          setAccountData(data.data)

          // Fetch brand context to get logo
          try {
            console.log('📸 Fetching brand context for account:', accountId)
            const brandContextResponse = await fetch(
              `${apiUrl}/web2-account-context/account/${accountId}`,
              {
                headers: {
                  'Authorization': `Bearer ${web2Auth}`
                }
              }
            )

            console.log('📸 Brand context response status:', brandContextResponse.status)
            
            if (brandContextResponse.ok) {
              const brandContextData = await brandContextResponse.json()
              console.log('📸 Brand context data:', brandContextData)
              const logoS3Url = brandContextData.data?.logo_url
              console.log('📸 Logo S3 URL:', logoS3Url)

              // If logo exists, generate presigned URL
              if (logoS3Url) {
                console.log('📸 Generating presigned URL for:', logoS3Url)
                const presignedResponse = await fetch(
                  `${apiUrl}/web2-account-context/presigned-url?s3_url=${encodeURIComponent(logoS3Url)}`,
                  {
                    headers: {
                      'Authorization': `Bearer ${web2Auth}`
                    }
                  }
                )

                console.log('📸 Presigned URL response status:', presignedResponse.status)
                
                if (presignedResponse.ok) {
                  const presignedData = await presignedResponse.json()
                  console.log('📸 Presigned URL data:', presignedData)
                  const finalUrl = presignedData.data?.presigned_url || null
                  console.log('📸 Final logo URL:', finalUrl)
                  setLogoUrl(finalUrl)
                } else {
                  const errorText = await presignedResponse.text()
                  console.error('📸 Presigned URL error:', errorText)
                }
              } else {
                console.log('📸 No logo URL found in brand context')
              }
            } else {
              const errorText = await brandContextResponse.text()
              console.error('📸 Brand context error:', errorText)
            }
          } catch (logoError) {
            console.error('📸 Error fetching logo:', logoError)
            // Don't fail the whole page if logo fetch fails
          }
        } else {
          // Redirect to auth if token invalid
          router.push('/web2/auth')
        }
      } catch (error) {
        console.error('Error fetching account data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [router])

  const handleLogoUpload = async (file: File) => {
    const web2Auth = localStorage.getItem('burnie_web2_auth')
    const accountId = localStorage.getItem('burnie_web2_account_id')

    if (!web2Auth || !accountId) {
      alert('Authentication required')
      return
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      alert('Please upload a valid image file (JPEG, PNG, GIF, WebP, or SVG)')
      return
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB')
      return
    }

    setIsUploadingLogo(true)

    try {
      const apiUrl = process.env.NEXT_PUBLIC_BURNIE_API_URL || 'http://localhost:3001/api'

      // Upload logo to S3
      const formData = new FormData()
      formData.append('logo', file)
      formData.append('account_id', accountId)

      const uploadResponse = await fetch(`${apiUrl}/web2-account-context/upload-logo`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${web2Auth}`
        },
        body: formData
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload logo')
      }

      const uploadResult = await uploadResponse.json()
      const s3Url = uploadResult.data.s3_url

      console.log('✅ Logo uploaded to S3:', s3Url)

      // Update brand context with new logo URL
      const updateResponse = await fetch(`${apiUrl}/web2-account-context/account/${accountId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${web2Auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          logo_url: s3Url
        })
      })

      if (!updateResponse.ok) {
        throw new Error('Failed to update brand context')
      }

      console.log('✅ Brand context updated with new logo')

      // Generate presigned URL for display
      const presignedResponse = await fetch(
        `${apiUrl}/web2-account-context/presigned-url?s3_url=${encodeURIComponent(s3Url)}`,
        {
          headers: {
            'Authorization': `Bearer ${web2Auth}`
          }
        }
      )

      if (presignedResponse.ok) {
        const presignedData = await presignedResponse.json()
        setLogoUrl(presignedData.data?.presigned_url || null)
        console.log('✅ Logo updated successfully')
      }
    } catch (error) {
      console.error('Error uploading logo:', error)
      alert('Failed to upload logo. Please try again.')
    } finally {
      setIsUploadingLogo(false)
    }
  }

  const handleLogoDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDraggingLogo(false)

    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleLogoUpload(files[0])
    }
  }

  const handleLogoDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDraggingLogo(true)
  }

  const handleLogoDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDraggingLogo(false)
  }

  const handleLogoClick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/jpg,image/png,image/gif,image/webp,image/svg+xml'
    input.onchange = (e: any) => {
      const file = e.target.files?.[0]
      if (file) {
        handleLogoUpload(file)
      }
    }
    input.click()
  }

  if (isLoading) {
    return (
      <div className="flex h-screen">
        <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
        <div className={`flex-1 flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 transition-all duration-300 ${
          sidebarExpanded ? 'ml-64' : 'ml-20'
        }`}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
            <p className="text-gray-400">Loading dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden">
      <Web2Sidebar isExpanded={sidebarExpanded} onToggle={() => setSidebarExpanded(!sidebarExpanded)} />
      
      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
        sidebarExpanded ? 'ml-64' : 'ml-20'
      }`}>
        {/* Fixed Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex items-center px-6 flex-shrink-0">
          <h1 className="text-xl font-semibold text-white">Dashboard</h1>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              Welcome back, {accountData?.user?.full_name || accountData?.user?.twitter_username}! 👋
            </h1>
            <p className="text-gray-400">
              Let's create some amazing content today
            </p>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400 mb-1">Total Content</p>
                  <p className="text-2xl font-bold text-white">0</p>
                </div>
                <PhotoIcon className="w-10 h-10 text-blue-400" />
              </div>
            </div>

            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400 mb-1">Published</p>
                  <p className="text-2xl font-bold text-white">0</p>
                </div>
                <CheckCircleIcon className="w-10 h-10 text-green-400" />
              </div>
            </div>

            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400 mb-1">Scheduled</p>
                  <p className="text-2xl font-bold text-white">0</p>
                </div>
                <ClockIcon className="w-10 h-10 text-orange-400" />
              </div>
            </div>

            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400 mb-1">This Month</p>
                  <p className="text-2xl font-bold text-white">0</p>
                </div>
                <SparklesIcon className="w-10 h-10 text-purple-400" />
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <button
              onClick={() => router.push('/web2/content-studio')}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 rounded-xl p-8 text-left transition-all transform hover:scale-105"
            >
              <SparklesIcon className="w-12 h-12 text-white mb-4" />
              <h3 className="text-2xl font-bold text-white mb-2">Create New Content</h3>
              <p className="text-blue-100">
                Generate AI-powered images and videos for your social media
              </p>
            </button>

            <button
              onClick={() => router.push('/web2/content-library')}
              className="bg-gray-800/50 hover:bg-gray-800 backdrop-blur-sm rounded-xl border border-gray-700/50 hover:border-gray-600 p-8 text-left transition-all"
            >
              <PhotoIcon className="w-12 h-12 text-blue-400 mb-4" />
              <h3 className="text-2xl font-bold text-white mb-2">Content Library</h3>
              <p className="text-gray-400">
                View and manage all your generated content
              </p>
            </button>
          </div>

          {/* Account Info */}
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl border border-gray-700/50 p-6">
            <h2 className="text-xl font-bold text-white mb-6">Account Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Logo Section - Always show, spans full width */}
              <div className="md:col-span-2">
                <p className="text-sm text-gray-400 mb-3">Account Logo</p>
                <div className="flex items-center gap-4">
                  <div 
                    className={`w-24 h-24 rounded-lg border-2 ${
                      isDraggingLogo 
                        ? 'border-blue-500 bg-blue-500/10' 
                        : 'border-gray-700 hover:border-gray-600'
                    } bg-gray-900 flex items-center justify-center overflow-hidden cursor-pointer transition-all relative group`}
                    onClick={handleLogoClick}
                    onDrop={handleLogoDrop}
                    onDragOver={handleLogoDragOver}
                    onDragLeave={handleLogoDragLeave}
                  >
                    {isUploadingLogo ? (
                      <div className="flex flex-col items-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2"></div>
                        <p className="text-xs text-gray-400">Uploading...</p>
                      </div>
                    ) : logoUrl ? (
                      <>
                        <img 
                          src={logoUrl} 
                          alt="Account Logo" 
                          className="w-full h-full object-contain"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <PhotoIcon className="w-8 h-8 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center">
                        <PhotoIcon className="w-8 h-8 text-gray-600 mb-1" />
                        <p className="text-xs text-gray-500">Upload</p>
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    {logoUrl ? (
                      <>
                        <p className="text-white font-medium mb-1">Logo uploaded</p>
                        <p className="text-sm text-gray-400 mb-2">This logo will be used in your generated content</p>
                        <button
                          onClick={handleLogoClick}
                          disabled={isUploadingLogo}
                          className="text-sm text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                        >
                          Click or drag & drop to change logo
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-white font-medium mb-1">No logo uploaded</p>
                        <p className="text-sm text-gray-400 mb-2">Click or drag & drop to upload your logo</p>
                        <p className="text-xs text-gray-500">Supported: JPEG, PNG, GIF, WebP, SVG (max 5MB)</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              <div>
                <p className="text-sm text-gray-400">Account Type</p>
                <p className="text-white font-medium capitalize">{accountData?.user?.account?.account_type || 'Individual'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Business Name</p>
                <p className="text-white font-medium">{accountData?.user?.account?.business_name || accountData?.user?.full_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Connected Platform</p>
                <p className="text-white font-medium">
                  𝕏 @{accountData?.user?.twitter_username}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Account Status</p>
                <p className="text-green-400 font-medium">Active</p>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
