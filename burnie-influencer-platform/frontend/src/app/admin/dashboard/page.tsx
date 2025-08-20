'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { 
  PlusIcon,
  MegaphoneIcon,
  CalendarDaysIcon,
  CurrencyDollarIcon,
  UsersIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  CpuChipIcon,
  ClockIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline'
import { FireIcon as FireIconSolid } from '@heroicons/react/24/solid'

interface AdminUser {
  id: number
  username: string
  last_login?: string
}

interface Campaign {
  id: string
  title: string
  description: string
  projectName?: string
  projectLogo?: string
  campaignBanner?: string
  tokenTicker?: string
  category: string
  rewardPool: string | number // bigint from database comes as string
  entryFee: string | number   // bigint from database comes as string
  maxSubmissions: string | number  // may come as string
  currentSubmissions: string | number // may come as string
  maxYappers?: number
  status: string
  campaignType: string
  platformSource?: string
  rewardToken?: string
  brandGuidelines?: string
  startDate?: string
  endDate?: string
  createdAt: string
  updatedAt: string
}

export default function AdminDashboard() {
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [mlTraining, setMlTraining] = useState({
    isTraining: false,
    trainingId: '',
    progress: 0,
    message: '',
    showMLSection: false,
    trainingResults: null as any // Store detailed training results
  })
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    projectName: '',
    projectLogo: null as File | null,
    campaignBanner: null as File | null,
    projectTwitterHandle: '', // For fetching latest tweets
    tokenTicker: 'ROAST',
    category: '',
    campaignType: '',
    rewardPool: '',
    maxYappers: '100',
    platformSource: 'burnie',
    startDate: '',
    endDate: '',
    guidelines: ''
  })
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [bannerPreview, setBannerPreview] = useState<string>('')
  
  // Project search states
  const [projectSearchResults, setProjectSearchResults] = useState<Array<{id: number, name: string, logo?: string}>>([])
  const [showProjectDropdown, setShowProjectDropdown] = useState(false)
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)
  const projectSearchRef = useRef<HTMLDivElement>(null)

  // Web3 Campaign Types
  const CAMPAIGN_TYPES = [
    { value: 'feature_launch', label: '🚀 Feature Launch' },
    { value: 'showcase', label: '✨ Showcase' },
    { value: 'awareness', label: '📢 Awareness' },
    { value: 'roast', label: '🔥 Roast' },
    { value: 'meme', label: '😂 Meme' },
    { value: 'creative', label: '🎨 Creative' },
    { value: 'viral', label: '⚡ Viral' },
    { value: 'social', label: '👥 Social' },
    { value: 'educational', label: '📚 Educational' },
    { value: 'technical', label: '🔧 Technical' },
  ]

  // Comprehensive Web3 Categories
  const WEB3_CATEGORIES = [
    { value: 'defi', label: '🏦 DeFi' },
    { value: 'nft', label: '🖼️ NFT' },
    { value: 'gaming', label: '🎮 Gaming' },
    { value: 'metaverse', label: '🌐 Metaverse' },
    { value: 'dao', label: '🏛️ DAO' },
    { value: 'infrastructure', label: '🏗️ Infrastructure' },
    { value: 'layer1', label: '1️⃣ Layer 1' },
    { value: 'layer2', label: '2️⃣ Layer 2' },
    { value: 'trading', label: '📈 Trading' },
    { value: 'meme_coins', label: '🐕 Meme Coins' },
    { value: 'social_fi', label: '💬 SocialFi' },
    { value: 'ai_crypto', label: '🤖 AI & Crypto' },
    { value: 'rwa', label: '🏠 Real World Assets' },
    { value: 'prediction_markets', label: '🔮 Prediction Markets' },
    { value: 'privacy', label: '🔒 Privacy' },
    { value: 'cross_chain', label: '🌉 Cross Chain' },
    { value: 'yield_farming', label: '🌾 Yield Farming' },
    { value: 'liquid_staking', label: '💧 Liquid Staking' },
    { value: 'derivatives', label: '📊 Derivatives' },
    { value: 'payments', label: '💳 Payments' },
    { value: 'identity', label: '🆔 Identity' },
    { value: 'security', label: '🛡️ Security' },
    { value: 'tools', label: '🔨 Tools' },
    { value: 'analytics', label: '📊 Analytics' },
    { value: 'education', label: '🎓 Education' },
    { value: 'other', label: '📦 Other' },
  ]

  // Campaign Source Options
  const PLATFORM_SOURCES = [
    { value: 'burnie', label: '🔥 Burnie (Internal)' },
    { value: 'cookie.fun', label: '🍪 Cookie.fun' },
    { value: 'yaps.kaito.ai', label: '🤖 Yaps.Kaito.ai' },
    { value: 'yap.market', label: '💬 Yap.market' },
    { value: 'amplifi.now', label: '📢 Amplifi.now' },
    { value: 'arbus', label: '🚌 Arbus' },
    { value: 'trendsage.xyz', label: '📈 Trendsage.xyz' },
    { value: 'bantr', label: '💬 Bantr' },
  ]
  const router = useRouter()

  // Check admin authentication on mount
  useEffect(() => {
    const token = localStorage.getItem('adminToken')
    const user = localStorage.getItem('adminUser')
    
    if (!token || !user) {
      router.push('/admin')
      return
    }

    try {
      setAdminUser(JSON.parse(user))
    } catch (error) {
      router.push('/admin')
    }
  }, [router])

  // Close project dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectSearchRef.current && !projectSearchRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Search projects function
  const searchProjects = async (query: string) => {
    if (!query.trim()) {
      setProjectSearchResults([])
      setShowProjectDropdown(false)
      return
    }

    setIsLoadingProjects(true)
    try {
      const token = getAdminToken()
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/projects/search?q=${encodeURIComponent(query)}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setProjectSearchResults(data.data || [])
        setShowProjectDropdown(true)
      }
    } catch (error) {
      console.error('Error searching projects:', error)
    } finally {
      setIsLoadingProjects(false)
    }
  }

  // Handle project name input change
  const handleProjectNameChange = (value: string) => {
    setFormData({ ...formData, projectName: value })
    searchProjects(value)
  }

  // Handle project selection from dropdown
  const selectProject = (project: {id: number, name: string, logo?: string}) => {
    setFormData({ ...formData, projectName: project.name })
    setShowProjectDropdown(false)
    setProjectSearchResults([])
  }

  // Get admin token for API calls
  const getAdminToken = () => {
    return localStorage.getItem('adminToken')
  }

  // Fetch campaigns
  const { data: campaigns, isLoading: campaignsLoading, refetch: refetchCampaigns } = useQuery({
    queryKey: ['admin-campaigns'],
    queryFn: async () => {
      const token = getAdminToken()
      if (!token) throw new Error('No admin token')

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/campaigns?limit=1000`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch campaigns')
      }

      const data = await response.json()
      return data.data
    },
    enabled: !!adminUser,
    refetchInterval: 30000,
  })

  // Filter and sort campaigns by end date (ascending order)
  const filteredAndSortedCampaigns = campaigns?.items?.filter((campaign: Campaign) =>
    campaign.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (campaign.platformSource || '').toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a: Campaign, b: Campaign) => {
    // Sort by end date in ascending order (earliest end date first)
    const dateA = new Date(a.endDate || '9999-12-31').getTime()
    const dateB = new Date(b.endDate || '9999-12-31').getTime()
    return dateA - dateB
  }) || []

  const totalPages = Math.ceil(filteredAndSortedCampaigns.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedCampaigns = filteredAndSortedCampaigns.slice(startIndex, startIndex + itemsPerPage)

  // Reset page when search changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  // Fetch admin analytics
  const { data: adminAnalytics, isLoading: analyticsLoading, error: analyticsError } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: async () => {
      const token = getAdminToken()
      if (!token) throw new Error('No admin token')

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/analytics`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch analytics')
      }

      const data = await response.json()
      return data.data
    },
    enabled: !!adminUser,
    refetchInterval: 30000, // Refresh every 30 seconds
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  })

  const handleLogout = () => {
    localStorage.removeItem('adminToken')
    localStorage.removeItem('adminUser')
    router.push('/admin')
  }

  // ML Training Functions
  const startMLTraining = async (algorithm = 'random_forest') => {
    try {
      setMlTraining(prev => ({ ...prev, isTraining: true, progress: 0, message: 'Starting training...' }))
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:8000'}/admin/ml/train-models`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          algorithm: algorithm,
          force_retrain: true
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        setMlTraining(prev => ({ 
          ...prev, 
          trainingId: data.training_id,
          message: data.message
        }))
        
        // Poll for training status
        pollTrainingStatus(data.training_id)
      } else {
        throw new Error(data.message || 'Training failed to start')
      }
    } catch (error) {
      console.error('❌ ML Training failed:', error)
      setMlTraining(prev => ({ 
        ...prev, 
        isTraining: false, 
        message: `Training failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }))
    }
  }

  const pollTrainingStatus = async (trainingId: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:8000'}/admin/ml/training-status/${trainingId}`)
      const data = await response.json()
      
      setMlTraining(prev => ({
        ...prev,
        progress: data.progress || 0,
        message: data.message || 'Training in progress...',
        trainingResults: data.summary // Store detailed results
      }))
      
      if (data.status === 'completed') {
        setMlTraining(prev => ({ 
          ...prev, 
          isTraining: false, 
          progress: 100,
          message: `Training completed! ${data.summary?.successful || 0}/${data.summary?.total_platforms || 0} models trained successfully.`,
          trainingResults: {
            ...data.summary,
            platforms: data.results, // Store detailed per-platform results
            total_models: Object.values(data.results || {}).reduce((acc: number, platform: any) => {
              if (platform.metadata?.algorithms) {
                return acc + platform.metadata.algorithms.length;
              }
              return acc;
            }, 0)
          }
        }))
      } else if (data.status === 'error') {
        setMlTraining(prev => ({ 
          ...prev, 
          isTraining: false, 
          message: `Training failed: ${data.error || 'Unknown error'}`
        }))
      } else if (data.status === 'training' || data.status === 'initializing') {
        // Continue polling
        setTimeout(() => pollTrainingStatus(trainingId), 3000)
      }
    } catch (error) {
      console.error('❌ Failed to poll training status:', error)
      setMlTraining(prev => ({ 
        ...prev, 
        isTraining: false, 
        message: 'Failed to get training status'
      }))
    }
  }

  const handleEditCampaign = async (campaign: Campaign) => {
    setEditingCampaign(campaign)
    setFormData({
      title: campaign.title,
      description: campaign.description,
      projectName: campaign.projectName || '',
      projectLogo: null,
      campaignBanner: null,
      projectTwitterHandle: (campaign as any).projectTwitterHandle || '', // Add Twitter handle support
      tokenTicker: campaign.tokenTicker || 'ROAST',
      category: campaign.category,
      campaignType: campaign.campaignType,
      rewardPool: campaign.rewardPool?.toString() || '',
      maxYappers: campaign.maxYappers?.toString() || '100',
      platformSource: campaign.platformSource || 'burnie',
      startDate: campaign.startDate ? new Date(campaign.startDate).toISOString().split('T')[0] : '',
      endDate: campaign.endDate ? new Date(campaign.endDate).toISOString().split('T')[0] : '',
      guidelines: campaign.brandGuidelines || ''
    })
    
    // Set logo preview if campaign has a project logo
    if (campaign.projectLogo) {
      try {
        const { getDisplayableLogoUrl } = await import('../../../utils/s3Utils')
        const displayUrl = await getDisplayableLogoUrl(campaign.projectLogo)
        if (displayUrl) {
          setLogoPreview(displayUrl)
        }
      } catch (error) {
        console.error('Error loading campaign logo for editing:', error)
        setLogoPreview('')
      }
    } else {
      setLogoPreview('')
    }

    // Set banner preview if campaign has a banner
    if (campaign.campaignBanner) {
      console.log('🎨 Campaign has banner, attempting to load preview:', campaign.campaignBanner)
      try {
        const { getDisplayableBannerUrl } = await import('../../../utils/s3Utils')
        const displayUrl = await getDisplayableBannerUrl(campaign.campaignBanner)
        console.log('🎨 Banner display URL result:', displayUrl)
        if (displayUrl) {
          setBannerPreview(displayUrl)
          console.log('🎨 Banner preview set successfully')
        } else {
          console.warn('🎨 No display URL returned for banner')
          setBannerPreview('')
        }
      } catch (error) {
        console.error('🎨 Error loading campaign banner for editing:', error)
        setBannerPreview('')
      }
    } else {
      console.log('🎨 Campaign has no banner, clearing preview')
      setBannerPreview('')
    }
    
    setShowEditForm(true)
  }

  const handleUpdateCampaign = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = getAdminToken()
      if (!token) throw new Error('No admin token')

      // Handle logo upload first if present
      let logoUrl = editingCampaign?.projectLogo || ''
      if (formData.projectLogo) {
        const logoFormData = new FormData()
        logoFormData.append('logo', formData.projectLogo)
        logoFormData.append('projectName', formData.projectName || 'untitled')
        
        const logoResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/upload-logo`, {
        method: 'POST',
          body: logoFormData,
        })
        
        if (logoResponse.ok) {
          const logoResult = await logoResponse.json()
          logoUrl = logoResult.data.logoUrl
        }
      }

      // Handle banner upload if present
      let bannerUrl = editingCampaign?.campaignBanner || ''
      if (formData.campaignBanner) {
        const bannerFormData = new FormData()
        bannerFormData.append('banner', formData.campaignBanner)
        bannerFormData.append('campaignName', formData.title || 'untitled')
        
        const bannerResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/upload-banner`, {
          method: 'POST',
          body: bannerFormData,
        })
        
        if (bannerResponse.ok) {
          const bannerResult = await bannerResponse.json()
          bannerUrl = bannerResult.data.bannerUrl
        }
      }

      // Prepare campaign data
      const campaignData = {
        title: formData.title,
        description: formData.description,
        projectName: formData.projectName,
        projectLogo: logoUrl,
        campaignBanner: bannerUrl,
        projectTwitterHandle: formData.projectTwitterHandle,
        tokenTicker: formData.tokenTicker,
        category: formData.category,
        campaignType: formData.campaignType,
        rewardPool: formData.rewardPool,
        maxYappers: formData.maxYappers,
        platformSource: formData.platformSource,
        startDate: formData.startDate,
        endDate: formData.endDate,
        guidelines: formData.guidelines
      }

      console.log('📝 Updating campaign with data:', campaignData)
      console.log('🖼️ Logo URL being sent:', logoUrl)
      console.log('🔍 Existing campaign logo:', editingCampaign?.projectLogo)

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/campaigns/${editingCampaign?.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(campaignData),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        // Twitter data fetching now happens automatically in backend (background)
        if (formData.projectTwitterHandle && formData.projectTwitterHandle.trim()) {
          console.log('🐦 Twitter data fetch will be triggered in background by backend')
        }

        // Reset form and close modal
        setFormData({
          title: '',
          description: '',
          projectName: '',
          projectLogo: null,
          campaignBanner: null,
          projectTwitterHandle: '',
          tokenTicker: 'ROAST',
          category: '',
          campaignType: '',
          rewardPool: '',
          maxYappers: '100',
          platformSource: 'burnie',
          startDate: '',
          endDate: '',
          guidelines: ''
        })
        setLogoPreview('')
        setBannerPreview('')
        setShowEditForm(false)
        setEditingCampaign(null)
        
        // Refresh campaigns list
        refetchCampaigns()
      } else {
        alert(data.error || 'Failed to update campaign')
      }
    } catch (error) {
      alert('Failed to update campaign')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const token = getAdminToken()
      if (!token) throw new Error('No admin token')

      // Handle logo upload first if present
      let logoUrl = ''
      if (formData.projectLogo) {
        const logoFormData = new FormData()
        logoFormData.append('logo', formData.projectLogo)
        logoFormData.append('projectName', formData.projectName || 'untitled')
        
        const logoResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/upload-logo`, {
          method: 'POST',
          body: logoFormData,
        })
        
        if (logoResponse.ok) {
          const logoResult = await logoResponse.json()
          logoUrl = logoResult.data.logoUrl
        }
      }

      // Handle banner upload if present
      let bannerUrl = ''
      if (formData.campaignBanner) {
        const bannerFormData = new FormData()
        bannerFormData.append('banner', formData.campaignBanner)
        bannerFormData.append('campaignName', formData.title || 'untitled')
        
        const bannerResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/upload-banner`, {
          method: 'POST',
          body: bannerFormData,
        })
        
        if (bannerResponse.ok) {
          const bannerResult = await bannerResponse.json()
          bannerUrl = bannerResult.data.bannerUrl
        }
      }

      // Prepare campaign data
      const campaignData = {
          title: formData.title,
          description: formData.description,
        projectName: formData.projectName,
        projectLogo: logoUrl,
        campaignBanner: bannerUrl,
        tokenTicker: formData.tokenTicker,
        category: formData.category,
        campaignType: formData.campaignType,
        rewardPool: formData.rewardPool,
        maxYappers: formData.maxYappers,
        platformSource: formData.platformSource,
        startDate: formData.startDate,
        endDate: formData.endDate,
        guidelines: formData.guidelines
      }

      console.log('📊 Creating campaign with data:', campaignData)
      console.log('🖼️ Logo URL being sent:', logoUrl)

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/campaigns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(campaignData),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        // Reset form and close modal
        setFormData({
          title: '',
          description: '',
          projectName: '',
          projectLogo: null,
          campaignBanner: null,
          projectTwitterHandle: '',
          tokenTicker: 'ROAST',
          category: '',
          campaignType: '',
          rewardPool: '',
          maxYappers: '100',
          platformSource: 'burnie',
          startDate: '',
          endDate: '',
          guidelines: ''
        })
        setLogoPreview('')
        setBannerPreview('')
        setShowCreateForm(false)
        
        // Refresh campaigns list
        refetchCampaigns()
      } else {
        alert(data.error || 'Failed to create campaign')
      }
    } catch (error) {
      alert('Failed to create campaign')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (!adminUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-xl">
                  <FireIconSolid className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold gradient-text">Burnie Admin</h1>
                  <p className="text-xs text-gray-500">Campaign Management</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {adminUser.username}</span>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowRightOnRectangleIcon className="h-5 w-5" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Dashboard Overview */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Campaign Dashboard</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Campaigns</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {analyticsLoading ? 'Loading...' : (adminAnalytics?.totalCampaigns || campaigns?.items?.length || 0)}
                  </p>
                  {analyticsError && <p className="text-xs text-red-500">Using fallback data</p>}
                </div>
                <MegaphoneIcon className="h-8 w-8 text-orange-500" />
              </div>
            </div>

            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Active Campaigns</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {analyticsLoading ? 'Loading...' : (adminAnalytics?.activeCampaigns || campaigns?.items?.filter((c: Campaign) => c.status === 'active').length || 0)}
                  </p>
                  {analyticsError && <p className="text-xs text-red-500">Using fallback data</p>}
                </div>
                <ChartBarIcon className="h-8 w-8 text-green-500" />
              </div>
            </div>

            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Number of Yappers</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {analyticsLoading ? 'Loading...' : (adminAnalytics?.totalYappers?.toLocaleString() || '0')}
                  </p>
                  {analyticsError && <p className="text-xs text-red-500">Database unavailable</p>}
                </div>
                <UsersIcon className="h-8 w-8 text-blue-500" />
              </div>
            </div>

            <div className="metric-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Total Purchase Value</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {analyticsLoading ? 'Loading...' : `$${adminAnalytics?.totalPurchaseValue?.toLocaleString() || '0'} USDC`}
                  </p>
                  <p className="text-xs text-gray-400">
                    {analyticsLoading ? '' : `${adminAnalytics?.totalTransactions || 0} transactions`}
                  </p>
                  {analyticsError && <p className="text-xs text-red-500">Price data unavailable</p>}
                </div>
                <CurrencyDollarIcon className="h-8 w-8 text-purple-500" />
              </div>
            </div>
          </div>
        </div>

        {/* ML Training Section */}
        <div className="mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl">
                  <CpuChipIcon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Mindshare ML Models</h3>
                  <p className="text-sm text-gray-600">Train AI models for mindshare prediction across platforms</p>
                </div>
              </div>
              <button
                onClick={() => setMlTraining(prev => ({ ...prev, showMLSection: !prev.showMLSection }))}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {mlTraining.showMLSection ? 'Hide Details' : 'Show Details'}
              </button>
            </div>

            {mlTraining.showMLSection && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <CheckCircleIcon className="h-5 w-5 text-green-500" />
                      <span className="font-medium">Training Data</span>
                    </div>
                    <p className="text-sm text-gray-600">100+ training records across cookie.fun and yaps.kaito.ai</p>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <CpuChipIcon className="h-5 w-5 text-blue-500" />
                      <span className="font-medium">Algorithms</span>
                    </div>
                    <p className="text-sm text-gray-600">Random Forest, Gradient Boosting, SVR, and more</p>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <ClockIcon className="h-5 w-5 text-orange-500" />
                      <span className="font-medium">Training Time</span>
                    </div>
                    <p className="text-sm text-gray-600">~3-5 minutes per platform</p>
                  </div>
                </div>

                {mlTraining.isTraining && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <span className="font-medium text-blue-900">Training in Progress</span>
                    </div>
                    <div className="mb-2">
                      <div className="flex justify-between text-sm text-blue-800 mb-1">
                        <span>{mlTraining.message}</span>
                        <span>{mlTraining.progress}%</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${mlTraining.progress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}

                {!mlTraining.isTraining && mlTraining.message && (
                  <div className={`border rounded-lg p-4 ${
                    mlTraining.message.includes('completed') 
                      ? 'bg-green-50 border-green-200 text-green-800' 
                      : mlTraining.message.includes('failed') 
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : 'bg-gray-50 border-gray-200 text-gray-800'
                  }`}>
                    <p className="text-sm">{mlTraining.message}</p>
                  </div>
                )}

                                <div className="flex space-x-3">
                  <button
                    onClick={() => startMLTraining('random_forest')}
                    disabled={mlTraining.isTraining}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <CpuChipIcon className="h-4 w-4" />
                    <span>{mlTraining.isTraining ? 'Training...' : 'Train All Models'}</span>
                  </button>
                  
                  <a
                    href={`${process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:8000'}/docs#/Admin%20ML`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    View API Docs
                  </a>
                </div>

                {mlTraining.trainingResults && (
                  <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">🎯 Ensemble Training Results</h4>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                        <p className="text-sm text-blue-600 font-medium">Total Platforms</p>
                        <p className="text-2xl font-bold text-blue-900">{mlTraining.trainingResults.total_platforms || 0}</p>
                      </div>
                      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                        <p className="text-sm text-green-600 font-medium">Successful Models</p>
                        <p className="text-2xl font-bold text-green-900">{mlTraining.trainingResults.successful || 0}</p>
                      </div>
                      <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                        <p className="text-sm text-purple-600 font-medium">Total Algorithms</p>
                        <p className="text-2xl font-bold text-purple-900">{mlTraining.trainingResults.total_models || 0}</p>
                      </div>
                      <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                        <p className="text-sm text-red-600 font-medium">Failed Models</p>
                        <p className="text-2xl font-bold text-red-900">{mlTraining.trainingResults.failed || 0}</p>
                      </div>
                    </div>

                    {mlTraining.trainingResults.platforms && (
                      <div className="space-y-4">
                        <h5 className="text-md font-semibold text-gray-800">📊 Platform Performance Details</h5>
                        {Object.entries(mlTraining.trainingResults.platforms).map(([platform, result]: [string, any]) => (
                          <div key={platform} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <h6 className="text-lg font-medium text-gray-900">🌐 {platform}</h6>
                              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                                result.status === 'success' 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {result.status === 'success' ? '✅ Success' : '❌ Failed'}
                              </span>
                            </div>
                            
                            {result.status === 'success' && result.metadata && (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                  <div className="text-sm font-semibold text-gray-700 mb-2">🎯 Ensemble Performance</div>
                                  <div className="space-y-1">
                                    <div className="flex justify-between">
                                      <span className="text-sm text-gray-600">R² Score:</span>
                                      <span className="text-sm font-medium text-purple-600">
                                        {(result.metadata.ensemble_metrics?.r2 * 100 || 0).toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-sm text-gray-600">RMSE:</span>
                                      <span className="text-sm font-medium text-gray-900">
                                        {result.metadata.ensemble_metrics?.rmse?.toFixed(4) || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-sm text-gray-600">Training Samples:</span>
                                      <span className="text-sm font-medium text-gray-900">
                                        {result.metadata.training_samples || 0}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="bg-gray-50 p-4 rounded-lg">
                                  <div className="text-sm font-semibold text-gray-700 mb-2">🤖 Algorithm Performance</div>
                                  <div className="space-y-1 max-h-20 overflow-y-auto">
                                    {result.metadata.individual_metrics && Object.entries(result.metadata.individual_metrics).map(([algorithm, metrics]: [string, any]) => (
                                      <div key={algorithm} className="flex justify-between text-xs">
                                        <span className="text-gray-600 capitalize">{algorithm.replace('_', ' ')}:</span>
                                        <span className="font-medium text-blue-600">
                                          {(metrics.r2 * 100 || 0).toFixed(1)}%
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                            
                            {result.status !== 'success' && (
                              <div className="bg-red-50 p-3 rounded border border-red-200">
                                <p className="text-sm text-red-700">
                                  <strong>Error:</strong> {result.message || 'Training failed'}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Create Campaign Button */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-gray-900">Campaign Management</h3>
          <button
            onClick={() => {
              // Clear form data before opening create modal
              setFormData({
                title: '',
                description: '',
                projectName: '',
                projectLogo: null,
                campaignBanner: null,
                projectTwitterHandle: '',
                tokenTicker: 'ROAST',
                category: '',
                campaignType: '',
                rewardPool: '',
                maxYappers: '100',
                platformSource: 'burnie',
                startDate: '',
                endDate: '',
                guidelines: ''
              })
              setLogoPreview('')
              setBannerPreview('')
              setShowCreateForm(true)
            }}
            className="btn-primary flex items-center space-x-2"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Create Campaign</span>
          </button>
          
          <button
            onClick={() => router.push('/admin/snapshots')}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center space-x-2"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Snapshot Management</span>
          </button>
        </div>

        {/* Campaigns List */}
        <div className="card">
          <div className="card-header">
            <h4 className="text-lg font-semibold text-gray-900">All Campaigns</h4>
            <p className="text-sm text-gray-500">Manage your platform campaigns</p>
          </div>

          {/* Search Bar */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="relative">
              <input
                type="text"
                placeholder="Search campaigns by title, description, category, or platform..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            {searchTerm && (
              <p className="mt-2 text-sm text-gray-600">
                Found {filteredAndSortedCampaigns.length} campaign{filteredAndSortedCampaigns.length !== 1 ? 's' : ''} matching "{searchTerm}"
              </p>
            )}
          </div>
          
          {campaignsLoading ? (
            <div className="card-content text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading campaigns...</p>
            </div>
          ) : filteredAndSortedCampaigns.length > 0 ? (
            <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reward Pool</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max Yappers</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">End Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedCampaigns.map((campaign: Campaign) => (
                    <tr key={campaign.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-medium text-gray-900">{campaign.title}</div>
                          <div className="text-sm text-gray-500 truncate max-w-xs">{campaign.description}</div>
                        </div>
                      </td>
                        <td className="px-6 py-4 text-sm text-gray-900 capitalize">{campaign.category?.replace('_', ' ')}</td>
                        <td className="px-6 py-4 text-sm text-gray-900 capitalize">{campaign.platformSource || 'burnie'}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          <div className="max-w-xs truncate" title={campaign.rewardPool?.toString() || ''}>
                            {campaign.rewardPool || 'Not specified'}
                          </div>
                      </td>
                        <td className="px-6 py-4 text-sm text-gray-900">{campaign.maxYappers || 100}</td>
                      <td className="px-6 py-4">
                        <span className={`status-indicator ${
                          campaign.status === 'ACTIVE' ? 'status-active' :
                          campaign.status === 'COMPLETED' ? 'status-completed' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1).toLowerCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {campaign.endDate ? formatDate(campaign.endDate) : 'No end date'}
                      </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          <button
                            onClick={() => handleEditCampaign(campaign)}
                            className="text-orange-600 hover:text-orange-700 font-medium"
                          >
                            Edit
                          </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setCurrentPage(Math.max(currentPage - 1, 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-600">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(Math.min(currentPage + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                  <div className="text-sm text-gray-600">
                    Showing {filteredAndSortedCampaigns.length} campaigns
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card-content text-center py-12">
              <MegaphoneIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-500 text-lg">No campaigns created yet</p>
              <p className="text-gray-400 text-sm">Create your first campaign to get started</p>
            </div>
          )}
        </div>
      </div>

      {/* Edit Campaign Modal */}
      {showEditForm && editingCampaign && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Edit Campaign</h3>
                <button
                  onClick={() => {
                    setShowEditForm(false)
                    setEditingCampaign(null)
                    setFormData({
                      title: '',
                      description: '',
                      projectName: '',
                      projectLogo: null,
                      campaignBanner: null,
                      projectTwitterHandle: '',
                      tokenTicker: 'ROAST',
                      category: '',
                      campaignType: '',
                      rewardPool: '',
                      maxYappers: '100',
                      platformSource: 'burnie',
                      startDate: '',
                      endDate: '',
                      guidelines: ''
                    })
                    setLogoPreview('')
                    setBannerPreview('')
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={handleUpdateCampaign} className="p-6 space-y-6">
              {/* Same form structure as create campaign */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Title *
                  </label>
                  <input
                    type="text"
                    id="title"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="input-field"
                    placeholder="Enter campaign title"
                  />
                </div>

                <div ref={projectSearchRef} className="relative">
                  <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-2">
                    Project Name *
                  </label>
                  <input
                    type="text"
                    id="projectName"
                    required
                    value={formData.projectName}
                    onChange={(e) => handleProjectNameChange(e.target.value)}
                    onFocus={() => {
                      if (formData.projectName.trim()) {
                        searchProjects(formData.projectName)
                      }
                    }}
                    className="input-field"
                    placeholder="Search existing projects or enter new project name"
                    autoComplete="off"
                  />
                  
                  {/* Loading indicator */}
                  {isLoadingProjects && (
                    <div className="absolute right-3 top-9 text-gray-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                    </div>
                  )}
                  
                  {/* Search results dropdown */}
                  {showProjectDropdown && projectSearchResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                      {projectSearchResults.map((project) => (
                        <div
                          key={project.id}
                          onClick={() => selectProject(project)}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center space-x-2"
                        >
                          {project.logo && (
                            <img src={project.logo} alt="" className="w-6 h-6 rounded-full object-cover" />
                          )}
                          <span className="text-sm">{project.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* No results message */}
                  {showProjectDropdown && projectSearchResults.length === 0 && formData.projectName.trim() && !isLoadingProjects && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
                      <div className="px-4 py-2 text-sm text-gray-500">
                        No existing projects found. A new project will be created.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="projectLogo" className="block text-sm font-medium text-gray-700 mb-2">
                  Project Logo (Optional)
                </label>
                <input
                  type="file"
                  id="projectLogo"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setFormData({ ...formData, projectLogo: e.target.files[0] });
                      setLogoPreview(URL.createObjectURL(e.target.files[0]));
                    } else {
                      setFormData({ ...formData, projectLogo: null });
                      setLogoPreview('');
                    }
                  }}
                  className="input-field"
                />
                {logoPreview && (
                  <div className="mt-2">
                    <img 
                      src={logoPreview} 
                      alt="Project Logo Preview" 
                      className="max-w-sm h-auto rounded-md" 
                    />
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="campaignBanner" className="block text-sm font-medium text-gray-700 mb-2">
                  Campaign Banner (Optional)
                </label>
                <input
                  type="file"
                  id="campaignBanner"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setFormData({ ...formData, campaignBanner: e.target.files[0] });
                      setBannerPreview(URL.createObjectURL(e.target.files[0]));
                    } else {
                      setFormData({ ...formData, campaignBanner: null });
                      setBannerPreview('');
                    }
                  }}
                  className="input-field"
                />
                {bannerPreview && (
                  <div className="mt-2">
                    <img 
                      src={bannerPreview} 
                      alt="Campaign Banner Preview" 
                      className="max-w-sm h-auto rounded-md" 
                    />
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="projectTwitterHandle" className="block text-sm font-medium text-gray-700 mb-2">
                  Project Twitter Handle <span className="text-gray-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="projectTwitterHandle"
                  value={formData.projectTwitterHandle}
                  onChange={(e) => setFormData({ ...formData, projectTwitterHandle: e.target.value })}
                  className="input-field"
                  placeholder="@projectname"
                />
                <p className="text-xs text-gray-500 mt-1">We'll fetch latest tweets for content context</p>
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                  Project Description *
                </label>
                <textarea
                  id="description"
                  required
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field"
                  placeholder="Describe the project and its objectives"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="tokenTicker" className="block text-sm font-medium text-gray-700 mb-2">
                    Token Ticker *
                  </label>
                  <input
                    type="text"
                    id="tokenTicker"
                    required
                    value={formData.tokenTicker}
                    onChange={(e) => setFormData({ ...formData, tokenTicker: e.target.value.toUpperCase() })}
                    className="input-field"
                    placeholder="ROAST"
                    maxLength={10}
                  />
                </div>

                <div>
                  <label htmlFor="platformSource" className="block text-sm font-medium text-gray-700 mb-2">
                    Platform Source *
                  </label>
                  <select
                    id="platformSource"
                    required
                    value={formData.platformSource}
                    onChange={(e) => setFormData({ ...formData, platformSource: e.target.value })}
                    className="input-field"
                  >
                    {PLATFORM_SOURCES.map((platform) => (
                      <option key={platform.value} value={platform.value}>
                        {platform.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="guidelines" className="block text-sm font-medium text-gray-700 mb-2">
                  Campaign Guidelines
                </label>
                <textarea
                  id="guidelines"
                  rows={2}
                  value={formData.guidelines}
                  onChange={(e) => setFormData({ ...formData, guidelines: e.target.value })}
                  className="input-field"
                  placeholder="Optional campaign guidelines and requirements"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
                    Category *
                  </label>
                  <select
                    id="category"
                    required
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select a category</option>
                    {WEB3_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="campaignType" className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Type *
                  </label>
                  <select
                    id="campaignType"
                    required
                    value={formData.campaignType}
                    onChange={(e) => setFormData({ ...formData, campaignType: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select a campaign type</option>
                    {CAMPAIGN_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="rewardPool" className="block text-sm font-medium text-gray-700 mb-2">
                    Reward Pool ({formData.tokenTicker || 'TOKEN'}) *
                  </label>
                  <textarea
                    id="rewardPool"
                    required
                    rows={3}
                    value={formData.rewardPool}
                    onChange={(e) => setFormData({ ...formData, rewardPool: e.target.value })}
                    className="input-field resize-vertical"
                    placeholder="10000 tokens for top contributors, 5000 for community engagement, 2000 for best memes..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="maxYappers" className="block text-sm font-medium text-gray-700 mb-2">
                    Max Yappers *
                  </label>
                  <input
                    type="number"
                    id="maxYappers"
                    required
                    min="1"
                    value={formData.maxYappers}
                    onChange={(e) => setFormData({ ...formData, maxYappers: e.target.value })}
                    className="input-field"
                    placeholder="100"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Number of yappers to distribute the reward pool among
                  </p>
                </div>
                </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    id="startDate"
                    required
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="input-field"

                  />
                </div>

                <div>
                  <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-2">
                    End Date *
                  </label>
                  <input
                    type="date"
                    id="endDate"
                    required
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="input-field"

                  />
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditForm(false)
                    setEditingCampaign(null)
                  }}
                  className="flex-1 btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Updating...' : 'Update Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Campaign Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Create New Campaign</h3>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateCampaign} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Title *
                  </label>
                  <input
                    type="text"
                    id="title"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="input-field"
                    placeholder="Enter campaign title"
                  />
                </div>

                <div ref={projectSearchRef} className="relative">
                  <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-2">
                    Project Name *
                  </label>
                  <input
                    type="text"
                    id="projectName"
                    required
                    value={formData.projectName}
                    onChange={(e) => handleProjectNameChange(e.target.value)}
                    onFocus={() => {
                      if (formData.projectName.trim()) {
                        searchProjects(formData.projectName)
                      }
                    }}
                    className="input-field"
                    placeholder="Search existing projects or enter new project name"
                    autoComplete="off"
                  />
                  
                  {/* Loading indicator */}
                  {isLoadingProjects && (
                    <div className="absolute right-3 top-9 text-gray-400">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                    </div>
                  )}
                  
                  {/* Search results dropdown */}
                  {showProjectDropdown && projectSearchResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                      {projectSearchResults.map((project) => (
                        <div
                          key={project.id}
                          onClick={() => selectProject(project)}
                          className="px-4 py-2 hover:bg-gray-100 cursor-pointer flex items-center space-x-2"
                        >
                          {project.logo && (
                            <img src={project.logo} alt="" className="w-6 h-6 rounded-full object-cover" />
                          )}
                          <span className="text-sm">{project.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* No results message */}
                  {showProjectDropdown && projectSearchResults.length === 0 && formData.projectName.trim() && !isLoadingProjects && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
                      <div className="px-4 py-2 text-sm text-gray-500">
                        No existing projects found. A new project will be created.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="projectLogo" className="block text-sm font-medium text-gray-700 mb-2">
                  Project Logo (Optional)
                </label>
                <input
                  type="file"
                  id="projectLogo"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setFormData({ ...formData, projectLogo: e.target.files[0] });
                      setLogoPreview(URL.createObjectURL(e.target.files[0]));
                    } else {
                      setFormData({ ...formData, projectLogo: null });
                      setLogoPreview('');
                    }
                  }}
                  className="input-field"
                />
                {logoPreview && (
                  <div className="mt-2">
                    <img src={logoPreview} alt="Project Logo Preview" className="max-w-sm h-auto rounded-md" />
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="campaignBannerEdit" className="block text-sm font-medium text-gray-700 mb-2">
                  Campaign Banner (Optional)
                </label>
                <input
                  type="file"
                  id="campaignBannerEdit"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setFormData({ ...formData, campaignBanner: e.target.files[0] });
                      setBannerPreview(URL.createObjectURL(e.target.files[0]));
                    } else {
                      setFormData({ ...formData, campaignBanner: null });
                      setBannerPreview('');
                    }
                  }}
                  className="input-field"
                />
                {bannerPreview && (
                  <div className="mt-2">
                    <img 
                      src={bannerPreview} 
                      alt="Campaign Banner Preview" 
                      className="max-w-sm h-auto rounded-md" 
                    />
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="projectTwitterHandle" className="block text-sm font-medium text-gray-700 mb-2">
                  Project Twitter Handle <span className="text-gray-500">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="projectTwitterHandle"
                  value={formData.projectTwitterHandle}
                  onChange={(e) => setFormData({ ...formData, projectTwitterHandle: e.target.value })}
                  className="input-field"
                  placeholder="@projectname"
                />
                <p className="text-xs text-gray-500 mt-1">We'll fetch latest tweets for content context</p>
              </div>

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                  Project Description *
                </label>
                <textarea
                  id="description"
                  required
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field"
                  placeholder="Describe the project and its objectives"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="tokenTicker" className="block text-sm font-medium text-gray-700 mb-2">
                    Token Ticker *
                  </label>
                  <input
                    type="text"
                    id="tokenTicker"
                    required
                    value={formData.tokenTicker}
                    onChange={(e) => setFormData({ ...formData, tokenTicker: e.target.value.toUpperCase() })}
                    className="input-field"
                    placeholder="ROAST"
                    maxLength={10}
                  />
                </div>

                <div>
                  <label htmlFor="platformSource" className="block text-sm font-medium text-gray-700 mb-2">
                    Platform Source *
                  </label>
                  <select
                    id="platformSource"
                    required
                    value={formData.platformSource}
                    onChange={(e) => setFormData({ ...formData, platformSource: e.target.value })}
                    className="input-field"
                  >
                    {PLATFORM_SOURCES.map((platform) => (
                      <option key={platform.value} value={platform.value}>
                        {platform.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="guidelines" className="block text-sm font-medium text-gray-700 mb-2">
                  Campaign Guidelines
                </label>
                <textarea
                  id="guidelines"
                  rows={2}
                  value={formData.guidelines}
                  onChange={(e) => setFormData({ ...formData, guidelines: e.target.value })}
                  className="input-field"
                  placeholder="Optional campaign guidelines and requirements"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
                    Category *
                  </label>
                  <select
                    id="category"
                    required
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select a category</option>
                    {WEB3_CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="campaignType" className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Type *
                  </label>
                  <select
                    id="campaignType"
                    required
                    value={formData.campaignType}
                    onChange={(e) => setFormData({ ...formData, campaignType: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select a campaign type</option>
                    {CAMPAIGN_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="rewardPool" className="block text-sm font-medium text-gray-700 mb-2">
                    Reward Pool ({formData.tokenTicker || 'TOKEN'}) *
                  </label>
                  <textarea
                    id="rewardPool"
                    required
                    rows={3}
                    value={formData.rewardPool}
                    onChange={(e) => setFormData({ ...formData, rewardPool: e.target.value })}
                    className="input-field resize-vertical"
                    placeholder="10000 tokens for top contributors, 5000 for community engagement, 2000 for best memes..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="maxYappers" className="block text-sm font-medium text-gray-700 mb-2">
                    Max Yappers *
                  </label>
                  <input
                    type="number"
                    id="maxYappers"
                    required
                    min="1"
                    value={formData.maxYappers}
                    onChange={(e) => setFormData({ ...formData, maxYappers: e.target.value })}
                    className="input-field"
                    placeholder="100"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Number of yappers to distribute the reward pool among
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                  <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    id="startDate"
                    required
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="input-field"

                  />
                </div>

                <div>
                  <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-2">
                  End Date *
                </label>
                <input
                  type="date"
                    id="endDate"
                  required
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="input-field"
                  min={new Date().toISOString().split('T')[0]}
                />
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
} 