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
    tokenTicker: '',
    category: '',
    campaignType: '',
    rewardPool: '',
    maxYappers: '100',
    platformSource: 'burnie',
    startDate: '',
    endDate: '',
    guidelines: '',
    somniaWhitelisted: false, // Add Somnia whitelist checkbox
    // New fields for admin context
    colorPalette: {
      primary: '',
      secondary: '',
      accent: ''
    }
  })
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [bannerPreview, setBannerPreview] = useState<string>('')
  const [uploadedDocuments, setUploadedDocuments] = useState<Array<{
    name: string
    url: string
    text?: string
    timestamp: string
    type: string
    error?: string
  }>>([])
  const [isDragging, setIsDragging] = useState(false)
  
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
    { value: 'wallchain', label: '🔗 Wallchain' },
    { value: 'galxe', label: '🎯 Galxe' },
    { value: 'alphabot', label: '🤖 Alphabot' },
    { value: 'independent', label: '🆓 Independent' },
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

  // Document upload functions
  const uploadDocuments = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return

    try {
      const formDataToSend = new FormData()
      filesToUpload.forEach((file) => formDataToSend.append('documents', file))

      const resp = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/admin/campaigns/extract-documents`, {
        method: 'POST',
        body: formDataToSend,
      })

      if (resp.ok) {
        const result = await resp.json()
        
        // Add timestamps if not present
        const docsWithTimestamps = result.data.map((doc: any) => ({
          ...doc,
          timestamp: doc.timestamp || new Date().toISOString(),
        }))
        
        setUploadedDocuments(prev => [...prev, ...docsWithTimestamps])
        
        console.log(`✅ Uploaded ${filesToUpload.length} files`)
        alert(`${filesToUpload.length} document(s) uploaded successfully`)
      } else {
        throw new Error('Failed to upload documents')
      }
    } catch (error) {
      console.error('Document upload failed:', error)
      alert('Failed to upload documents')
    }
  }

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type === 'application/pdf' || 
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.type === 'application/msword'
    )

    if (files.length > 0) {
      await uploadDocuments(files)
    } else {
      alert('Please upload only PDF or DOC files')
    }
  }

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files)
      await uploadDocuments(files)
      e.target.value = '' // Reset input
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
      tokenTicker: campaign.tokenTicker || '',
      category: campaign.category,
      campaignType: campaign.campaignType,
      rewardPool: campaign.rewardPool?.toString() || '',
      maxYappers: campaign.maxYappers?.toString() || '100',
      platformSource: campaign.platformSource || 'burnie',
      startDate: campaign.startDate ? new Date(campaign.startDate).toISOString().split('T')[0] : '',
      endDate: campaign.endDate ? new Date(campaign.endDate).toISOString().split('T')[0] : '',
      guidelines: campaign.brandGuidelines || '',
      somniaWhitelisted: (campaign as any).project?.somniaWhitelisted || false, // Get from project relation
      colorPalette: (campaign as any).color_palette || { primary: '', secondary: '', accent: '' }
    })
    
    // Load documents if present
    if ((campaign as any).documents_text) {
      setUploadedDocuments((campaign as any).documents_text)
    } else {
      setUploadedDocuments([])
    }
    
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
      const documentS3Keys = uploadedDocuments.map(doc => doc.url).filter(url => url)
      
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
        guidelines: formData.guidelines,
        somniaWhitelisted: formData.somniaWhitelisted, // Send Somnia whitelist status
        documents_text: uploadedDocuments, // Full details with text and timestamps
        document_urls: documentS3Keys, // Just S3 keys for quick access
        color_palette: formData.colorPalette
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
          tokenTicker: '',
          category: '',
          campaignType: '',
          rewardPool: '',
          maxYappers: '100',
          platformSource: 'burnie',
          startDate: '',
          endDate: '',
          guidelines: '',
          somniaWhitelisted: false, // Reset Somnia checkbox
          colorPalette: { primary: '', secondary: '', accent: '' }
        })
        setLogoPreview('')
        setBannerPreview('')
        setUploadedDocuments([])
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
      const documentS3Keys = uploadedDocuments.map(doc => doc.url).filter(url => url)
      
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
        guidelines: formData.guidelines,
        somniaWhitelisted: formData.somniaWhitelisted, // Send Somnia whitelist status
        documents_text: uploadedDocuments, // Full details with text and timestamps
        document_urls: documentS3Keys, // Just S3 keys for quick access
        color_palette: formData.colorPalette
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
          tokenTicker: '',
          category: '',
          campaignType: '',
          rewardPool: '',
          maxYappers: '100',
          platformSource: 'burnie',
          startDate: '',
          endDate: '',
          guidelines: '',
          somniaWhitelisted: false, // Reset Somnia checkbox
          colorPalette: { primary: '', secondary: '', accent: '' }
        })
        setLogoPreview('')
        setBannerPreview('')
        setUploadedDocuments([])
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

        {/* Campaign Management Header */}
        <div className="mb-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Campaign Management</h3>
          
          {/* Management Buttons */}
          <div className="flex flex-nowrap gap-2 overflow-x-auto pb-2">
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
                  tokenTicker: '',
                  category: '',
                  campaignType: '',
                  rewardPool: '',
                  maxYappers: '100',
                  platformSource: 'burnie',
                  startDate: '',
                  endDate: '',
                  guidelines: '',
                  somniaWhitelisted: false, // Reset Somnia checkbox
                  colorPalette: { primary: '', secondary: '', accent: '' }
                })
                setLogoPreview('')
                setBannerPreview('')
                setUploadedDocuments([])
                setShowCreateForm(true)
              }}
              className="px-2 py-1.5 bg-orange-600 text-white text-xs rounded-lg hover:bg-orange-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <PlusIcon className="h-3 w-3" />
              <span>Create Campaign</span>
            </button>
            
            <button
              onClick={() => router.push('/admin/snapshots')}
              className="px-2 py-1.5 bg-orange-600 text-white text-xs rounded-lg hover:bg-orange-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Snapshots</span>
            </button>
            
            <button
              onClick={() => router.push('/admin/referrals')}
              className="px-2 py-1.5 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>Referrals</span>
            </button>
            
            <button
              onClick={() => router.push('/admin/content-requests')}
              className="px-2 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Content Requests</span>
            </button>
            
            <button
              onClick={() => router.push('/admin/waitlist')}
              className="px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Waitlist</span>
            </button>
            
            <button
              onClick={() => router.push('/admin/twitter-handles')}
              className="px-2 py-1.5 bg-cyan-600 text-white text-xs rounded-lg hover:bg-cyan-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>Twitter Handles</span>
            </button>
            
            <button
              onClick={() => router.push('/admin/content-meter')}
              className="px-2 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span>Content Meter</span>
            </button>
            
            <button
              onClick={() => router.push('/admin/approved-miners')}
              className="px-2 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 transition-colors flex items-center space-x-1 whitespace-nowrap"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
              <span>Add Miners</span>
            </button>
          </div>
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
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 placeholder-gray-500"
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
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700"
                    >
                      Previous
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-600">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(Math.min(currentPage + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700"
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
                      tokenTicker: '',
                      category: '',
                      campaignType: '',
                      rewardPool: '',
                      maxYappers: '100',
                      platformSource: 'burnie',
                      startDate: '',
                      endDate: '',
                      guidelines: '',
                      somniaWhitelisted: false, // Reset Somnia checkbox
                      colorPalette: { primary: '', secondary: '', accent: '' }
                    })
                    setLogoPreview('')
                    setBannerPreview('')
                    setUploadedDocuments([])
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

              {/* Color Palette Section */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Brand Colors (Optional)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="primaryColor" className="block text-xs text-gray-600 mb-1">
                      Primary Color
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        id="primaryColor"
                        value={formData.colorPalette.primary || '#000000'}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, primary: e.target.value }
                        })}
                        className="w-20 h-12 rounded border-2 border-gray-300 cursor-pointer"
                        style={{ backgroundColor: formData.colorPalette.primary || '#000000' }}
                      />
                      <input
                        type="text"
                        value={formData.colorPalette.primary || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, primary: e.target.value }
                        })}
                        placeholder="#000000"
                        className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-gray-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="secondaryColor" className="block text-xs text-gray-600 mb-1">
                      Secondary Color
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        id="secondaryColor"
                        value={formData.colorPalette.secondary || '#000000'}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, secondary: e.target.value }
                        })}
                        className="w-20 h-12 rounded border-2 border-gray-300 cursor-pointer"
                        style={{ backgroundColor: formData.colorPalette.secondary || '#000000' }}
                      />
                      <input
                        type="text"
                        value={formData.colorPalette.secondary || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, secondary: e.target.value }
                        })}
                        placeholder="#000000"
                        className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-gray-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="accentColor" className="block text-xs text-gray-600 mb-1">
                      Accent Color
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        id="accentColor"
                        value={formData.colorPalette.accent || '#000000'}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, accent: e.target.value }
                        })}
                        className="w-20 h-12 rounded border-2 border-gray-300 cursor-pointer"
                        style={{ backgroundColor: formData.colorPalette.accent || '#000000' }}
                      />
                      <input
                        type="text"
                        value={formData.colorPalette.accent || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, accent: e.target.value }
                        })}
                        placeholder="#000000"
                        className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-gray-900"
                      />
                    </div>
                  </div>
                </div>
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
                    Token Ticker (Optional)
                  </label>
                  <input
                    type="text"
                    id="tokenTicker"
                    value={formData.tokenTicker}
                    onChange={(e) => setFormData({ ...formData, tokenTicker: e.target.value.toUpperCase() })}
                    className="input-field"
                    placeholder="Enter token ticker (e.g., ROAST, BTC, ETH) or leave blank"
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

              {/* Somnia Whitelist Checkbox */}
              <div className="flex items-center space-x-2 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                <input
                  type="checkbox"
                  id="somniaWhitelisted"
                  checked={formData.somniaWhitelisted}
                  onChange={(e) => setFormData({ ...formData, somniaWhitelisted: e.target.checked })}
                  className="w-4 h-4 text-purple-600 bg-white border-gray-300 rounded focus:ring-purple-500 focus:ring-2 cursor-pointer"
                />
                <label htmlFor="somniaWhitelisted" className="flex items-center cursor-pointer">
                  <span className="text-sm font-medium text-gray-900">
                    ✨ Somnia Project
                  </span>
                  <span className="ml-2 text-xs text-gray-600">
                    (Enable purchases with TOAST on Somnia Testnet)
                  </span>
                </label>
              </div>

              {/* Document Upload Section */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Admin Context Documents (Optional)
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                  }}
                  onDrop={handleFileDrop}
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                    isDragging
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileInput}
                    className="hidden"
                    id="document-upload"
                  />
                  <label
                    htmlFor="document-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-gray-600">
                      Drop PDF or DOC files here, or click to browse
                    </span>
                    <span className="text-xs text-gray-500 mt-1">
                      Upload project documentation, whitepapers, etc.
                    </span>
                  </label>
                </div>

                {/* Uploaded Documents List */}
                {uploadedDocuments.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-medium text-gray-700">
                      Uploaded Documents ({uploadedDocuments.length})
                    </p>
                    {uploadedDocuments.map((doc, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {doc.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {doc.text ? `Text extracted (${doc.text.length} chars)` : doc.error || 'Processing...'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadedDocuments(uploadedDocuments.filter((_, i) => i !== idx))
                          }}
                          className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-xs transition-colors ml-3 flex-shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                    Reward Pool {formData.tokenTicker ? `(${formData.tokenTicker})` : '(Optional Token)'} *
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

              {/* Color Palette Section */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Brand Colors (Optional)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="primaryColorEdit" className="block text-xs text-gray-600 mb-1">
                      Primary Color
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        id="primaryColorEdit"
                        value={formData.colorPalette.primary || '#000000'}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, primary: e.target.value }
                        })}
                        className="w-20 h-12 rounded border-2 border-gray-300 cursor-pointer"
                        style={{ backgroundColor: formData.colorPalette.primary || '#000000' }}
                      />
                      <input
                        type="text"
                        value={formData.colorPalette.primary || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, primary: e.target.value }
                        })}
                        placeholder="#000000"
                        className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-gray-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="secondaryColorEdit" className="block text-xs text-gray-600 mb-1">
                      Secondary Color
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        id="secondaryColorEdit"
                        value={formData.colorPalette.secondary || '#000000'}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, secondary: e.target.value }
                        })}
                        className="w-20 h-12 rounded border-2 border-gray-300 cursor-pointer"
                        style={{ backgroundColor: formData.colorPalette.secondary || '#000000' }}
                      />
                      <input
                        type="text"
                        value={formData.colorPalette.secondary || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, secondary: e.target.value }
                        })}
                        placeholder="#000000"
                        className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-gray-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="accentColorEdit" className="block text-xs text-gray-600 mb-1">
                      Accent Color
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="color"
                        id="accentColorEdit"
                        value={formData.colorPalette.accent || '#000000'}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, accent: e.target.value }
                        })}
                        className="w-20 h-12 rounded border-2 border-gray-300 cursor-pointer"
                        style={{ backgroundColor: formData.colorPalette.accent || '#000000' }}
                      />
                      <input
                        type="text"
                        value={formData.colorPalette.accent || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          colorPalette: { ...formData.colorPalette, accent: e.target.value }
                        })}
                        placeholder="#000000"
                        className="w-28 px-2 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-gray-900"
                      />
                    </div>
                  </div>
                </div>
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
                    Token Ticker (Optional)
                  </label>
                  <input
                    type="text"
                    id="tokenTicker"
                    value={formData.tokenTicker}
                    onChange={(e) => setFormData({ ...formData, tokenTicker: e.target.value.toUpperCase() })}
                    className="input-field"
                    placeholder="Enter token ticker (e.g., ROAST, BTC, ETH) or leave blank"
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

              {/* Somnia Whitelist Checkbox */}
              <div className="flex items-center space-x-2 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
                <input
                  type="checkbox"
                  id="somniaWhitelisted"
                  checked={formData.somniaWhitelisted}
                  onChange={(e) => setFormData({ ...formData, somniaWhitelisted: e.target.checked })}
                  className="w-4 h-4 text-purple-600 bg-white border-gray-300 rounded focus:ring-purple-500 focus:ring-2 cursor-pointer"
                />
                <label htmlFor="somniaWhitelisted" className="flex items-center cursor-pointer">
                  <span className="text-sm font-medium text-gray-900">
                    ✨ Somnia Project
                  </span>
                  <span className="ml-2 text-xs text-gray-600">
                    (Enable purchases with TOAST on Somnia Testnet)
                  </span>
                </label>
              </div>

              {/* Document Upload Section */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Admin Context Documents (Optional)
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                  }}
                  onDrop={handleFileDrop}
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                    isDragging
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileInput}
                    className="hidden"
                    id="document-upload"
                  />
                  <label
                    htmlFor="document-upload"
                    className="cursor-pointer flex flex-col items-center"
                  >
                    <svg className="w-12 h-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm text-gray-600">
                      Drop PDF or DOC files here, or click to browse
                    </span>
                    <span className="text-xs text-gray-500 mt-1">
                      Upload project documentation, whitepapers, etc.
                    </span>
                  </label>
                </div>

                {/* Uploaded Documents List */}
                {uploadedDocuments.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-medium text-gray-700">
                      Uploaded Documents ({uploadedDocuments.length})
                    </p>
                    {uploadedDocuments.map((doc, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {doc.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {doc.text ? `Text extracted (${doc.text.length} chars)` : doc.error || 'Processing...'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadedDocuments(uploadedDocuments.filter((_, i) => i !== idx))
                          }}
                          className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-xs transition-colors ml-3 flex-shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                    Reward Pool {formData.tokenTicker ? `(${formData.tokenTicker})` : '(Optional Token)'} *
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