'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { getApiUrlWithFallback } from '@/utils/api-config'
import { showToast } from '@/utils/toast'
import {
  DocumentTextIcon,
  LinkIcon,
  CloudArrowUpIcon,
  CheckIcon,
  XMarkIcon,
  TrophyIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowLeftIcon,
  SparklesIcon,
  PhotoIcon,
  InformationCircleIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline'
import { useQuery } from '@tanstack/react-query'
import Image from 'next/image'

// Types
interface Campaign {
  id: number
  title: string
  description: string
  brandGuidelines?: string
  category: string
  platform_source: string
  campaign_type: string
  projectName?: string
  projectLogo?: string
  tokenTicker?: string
  project?: {
    id: number
    name: string
    logoUrl?: string
  }
}

interface DocumentData {
  name: string
  url: string
  text: string
  timestamp: string
}

interface LinkData {
  url: string
  timestamp: string
}

type TabKey = 'logo' | 'details' | 'text' | 'handles' | 'links'

const tabs = [
  { id: 'logo' as TabKey, label: 'Logo', icon: PhotoIcon },
  { id: 'details' as TabKey, label: 'Details', icon: InformationCircleIcon },
  { id: 'text' as TabKey, label: 'Text & Content', icon: DocumentTextIcon },
  { id: 'handles' as TabKey, label: 'Platform Handles', icon: GlobeAltIcon },
  { id: 'links' as TabKey, label: 'Links', icon: LinkIcon },
]

export default function MiningContext() {
  const { address: walletAddress } = useAccount()
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [tab, setTab] = useState<TabKey>('logo')
  const apiUrl = useMemo(() => getApiUrlWithFallback(), [])
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Logo state - read-only, fetched from campaign
  const [logoPreview, setLogoPreview] = useState<string>('')

  // Details state
  const [projectName, setProjectName] = useState('')
  const [website, setWebsite] = useState('')
  const [chain, setChain] = useState('')
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [tone, setTone] = useState('')
  const [category, setCategory] = useState('')
  const [projectDetails, setProjectDetails] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#000000')
  const [secondaryColor, setSecondaryColor] = useState('#000000')
  const [accentColor, setAccentColor] = useState('#000000')

  // Text & Content state
  const [keywords, setKeywords] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [goals, setGoals] = useState('')
  const [contentText, setContentText] = useState('')
  const [documentFiles, setDocumentFiles] = useState<File[]>([])
  const [uploadedDocuments, setUploadedDocuments] = useState<DocumentData[]>([])

  // Platform Handles state (removed github)
  const [twitterHandles, setTwitterHandles] = useState<string[]>([])
  const [websiteUrls, setWebsiteUrls] = useState<string[]>([])

  // Links state
  const [links, setLinks] = useState<LinkData[]>([])

  // Campaign list state
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [itemsPerPage] = useState<number>(10)
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<number>>(new Set())

  // Fetch campaigns
  const { data: campaignsData, isLoading: campaignsLoading } = useQuery({
    queryKey: ['marketplace-ready-campaigns'],
    queryFn: async () => {
      const resp = await fetch(`${apiUrl}/campaigns/marketplace-ready?limit=100`)
      if (!resp.ok) throw new Error('Failed to fetch campaigns')
      return resp.json()
    },
    enabled: !!apiUrl,
  })

  const campaigns = campaignsData?.data || []

  // Filter and paginate campaigns
  const filteredCampaigns = campaigns.filter((campaign: Campaign) =>
    !searchTerm ||
    campaign.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.platform_source?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    campaign.projectName?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const totalPages = Math.ceil(filteredCampaigns.length / itemsPerPage)
  const paginatedCampaigns = filteredCampaigns.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  const toggleCampaignExpansion = (campaignId: number) => {
    setExpandedCampaigns(prev => {
      const next = new Set(prev)
      if (next.has(campaignId)) {
        next.delete(campaignId)
      } else {
        next.add(campaignId)
      }
      return next
    })
  }

  // Load existing context when campaign is selected
  useEffect(() => {
    if (!selectedCampaign || !walletAddress) return

    const loadContext = async () => {
      try {
        console.log('Loading context for campaign:', selectedCampaign.id, 'wallet:', walletAddress)
        
        // First, try to load saved context
        const resp = await fetch(
          `${apiUrl}/mining-context/user/${walletAddress}/campaign/${selectedCampaign.id}`
        )
        
        if (resp.ok) {
          const result = await resp.json()
          console.log('Context API response:', result)
          const ctx = result?.data
          
          if (ctx) {
            // Context exists - load ALL fields from saved context
            console.log('✅ Found saved context, loading all fields from user_mining_context')
            
            setProjectName(ctx.project_name || '')
            setWebsite(ctx.website || '')
            setChain(ctx.chain || '')
            setTokenSymbol(ctx.tokenSymbol || '')
            setTone(ctx.tone || '')
            setCategory(ctx.category || '')
            setProjectDetails(ctx.brand_values || '')
            
            // ALWAYS use campaign colors (admin-set), not saved user colors
            const campaignColorPalette = (selectedCampaign as any).color_palette || {}
            console.log('🎨 Campaign data:', selectedCampaign)
            console.log('🎨 Campaign color_palette field:', (selectedCampaign as any).color_palette)
            console.log('🎨 Extracted color palette:', campaignColorPalette)
            setPrimaryColor(campaignColorPalette.primary || '#000000')
            setSecondaryColor(campaignColorPalette.secondary || '#000000')
            setAccentColor(campaignColorPalette.accent || '#000000')
            console.log('🎨 Using admin-set colors from campaign:', {
              primary: campaignColorPalette.primary || '#000000',
              secondary: campaignColorPalette.secondary || '#000000',
              accent: campaignColorPalette.accent || '#000000'
            })
            
            setKeywords(ctx.keywords || '')
            setCompetitors(ctx.competitors || '')
            setGoals(ctx.goals || '')
            setContentText(ctx.content_text || '')
            
            // Load uploaded documents
            const docsToLoad = ctx.documents_text || []
            console.log('📄 Loading documents from saved context:', docsToLoad)
            console.log('📄 Number of documents:', Array.isArray(docsToLoad) ? docsToLoad.length : 'not an array')
            setUploadedDocuments(docsToLoad)
            
            setLinks(ctx.linksJson || [])
            setTwitterHandles(ctx.platform_handles?.twitter || [])
            setWebsiteUrls(ctx.platform_handles?.website || [])
            
            // Load logo from saved context if available, otherwise from campaign
            const logoSource = ctx.logo_url || selectedCampaign.projectLogo
            
            if (logoSource) {
              try {
                let s3Key = logoSource
                
                if (s3Key.includes('amazonaws.com/')) {
                  s3Key = s3Key.split('amazonaws.com/')[1]
                } else if (s3Key.startsWith('http')) {
                  s3Key = s3Key.replace(/^https?:\/\/[^\/]+\//, '')
                }
                
                const logoResp = await fetch(`${apiUrl}/mining-context/presigned-url`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ s3_key: s3Key }),
                })
                
                if (logoResp.ok) {
                  const logoResult = await logoResp.json()
                  if (logoResult.presigned_url) {
                    setLogoPreview(logoResult.presigned_url)
                  } else {
                    setLogoPreview(logoSource)
                  }
                } else {
                  setLogoPreview(logoSource)
                }
              } catch (e) {
                console.error('Failed to get presigned URL for logo:', e)
                setLogoPreview(logoSource)
              }
            }
            
            return // Exit early - we loaded from saved context
          }
        }
        
        // No saved context found - use campaign defaults
        console.log('ℹ️ No saved context, using campaign defaults')
        console.log('🎨 Campaign data (new context):', selectedCampaign)
        console.log('🎨 Campaign color_palette field (new context):', (selectedCampaign as any).color_palette)
        
        setProjectName(selectedCampaign.projectName || '')
        setTokenSymbol(selectedCampaign.tokenTicker || '')
        setCategory(selectedCampaign.category || '')
        setProjectDetails(selectedCampaign.description || '')
        
        // ALWAYS use campaign colors (admin-set)
        const campaignColorPalette = (selectedCampaign as any).color_palette || {}
        setPrimaryColor(campaignColorPalette.primary || '#000000')
        setSecondaryColor(campaignColorPalette.secondary || '#000000')
        setAccentColor(campaignColorPalette.accent || '#000000')
        console.log('🎨 Using admin-set colors from campaign (new context):', {
          primary: campaignColorPalette.primary || '#000000',
          secondary: campaignColorPalette.secondary || '#000000',
          accent: campaignColorPalette.accent || '#000000'
        })
        
        // Reset other fields to empty
        setWebsite('')
        setChain('')
        setTone('')
        setKeywords('')
        setCompetitors('')
        setGoals('')
        setContentText('')
        setUploadedDocuments([])
        setLinks([])
        setTwitterHandles([])
        setWebsiteUrls([])
        
        // Load logo from campaign
        if (selectedCampaign.projectLogo) {
          try {
            let s3Key = selectedCampaign.projectLogo
            
            if (s3Key.includes('amazonaws.com/')) {
              s3Key = s3Key.split('amazonaws.com/')[1]
            } else if (s3Key.startsWith('http')) {
              s3Key = s3Key.replace(/^https?:\/\/[^\/]+\//, '')
            }
            
            const logoResp = await fetch(`${apiUrl}/mining-context/presigned-url`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ s3_key: s3Key }),
            })
            
            if (logoResp.ok) {
              const logoResult = await logoResp.json()
              if (logoResult.presigned_url) {
                setLogoPreview(logoResult.presigned_url)
              } else {
                setLogoPreview(selectedCampaign.projectLogo)
              }
            } else {
              setLogoPreview(selectedCampaign.projectLogo)
            }
          } catch (e) {
            console.error('Failed to get presigned URL for logo:', e)
            setLogoPreview(selectedCampaign.projectLogo)
          }
        }
        
      } catch (error) {
        console.error('Failed to load context:', error)
        // On error, use campaign defaults
        setProjectName(selectedCampaign.projectName || '')
        setTokenSymbol(selectedCampaign.tokenTicker || '')
        setCategory(selectedCampaign.category || '')
        setProjectDetails(selectedCampaign.description || '')
      }
    }

    loadContext()
  }, [selectedCampaign, walletAddress, apiUrl])

  // Upload documents
  const uploadDocuments = async (filesToUpload: File[]) => {
    if (!walletAddress || !selectedCampaign || filesToUpload.length === 0) return

    try {
      const formData = new FormData()
      filesToUpload.forEach((file) => formData.append('documents', file))
      formData.append('walletAddress', walletAddress)
      formData.append('campaignId', selectedCampaign.id.toString())

      const resp = await fetch(`${apiUrl}/mining-context/extract-documents`, {
        method: 'POST',
        body: formData,
      })

      if (resp.ok) {
        const result = await resp.json()
        // result contains:
        // - data: documents_text array (with name, url/S3 key, text, timestamp, type)
        // - document_urls: array of S3 keys
        
        // Ensure timestamps are added
        const docsWithTimestamps = result.data.map((doc: any) => ({
          ...doc,
          timestamp: doc.timestamp || new Date().toISOString(),
        }))
        
        // Merge with existing documents
        setUploadedDocuments(prev => [...prev, ...docsWithTimestamps])
        
        console.log(`✅ Uploaded ${filesToUpload.length} files:`)
        console.log(`   - documents_text entries: ${docsWithTimestamps.length}`)
        console.log(`   - document_urls (S3 keys): ${result.document_urls?.length || 0}`)
        
        showToast(`${filesToUpload.length} document(s) uploaded successfully`, 'success')
      } else {
        throw new Error('Failed to upload documents')
      }
    } catch (error) {
      console.error('Document upload failed:', error)
      showToast('Failed to upload documents', 'error')
    }
  }

  // Save all changes
  const saveAll = async () => {
    if (!walletAddress || !selectedCampaign) {
      showToast('Please connect wallet and select a campaign', 'error')
      return
    }

    setSaving(true)
    setSaveStatus('saving')

    try {
      // Extract S3 keys from uploadedDocuments for document_urls column
      const documentS3Keys = uploadedDocuments.map(doc => doc.url).filter(url => url)
      
      // Prepare payload
      const payload = {
        project_name: projectName,
        website,
        chain,
        tokenSymbol,
        tone,
        category,
        brand_values: projectDetails, // Storing in brand_values field
        color_palette: {
          primary: primaryColor,
          secondary: secondaryColor,
          accent: accentColor,
        },
        keywords,
        competitors,
        goals,
        content_text: contentText,
        documents_text: uploadedDocuments, // Full details with text and timestamps
        document_urls: documentS3Keys,     // Just S3 keys for quick access
        linksJson: links.map(link => ({
          ...link,
          timestamp: link.timestamp || new Date().toISOString(),
        })),
        platform_handles: {
          twitter: twitterHandles.filter(h => h.trim()),
          website: websiteUrls.filter(u => u.trim()),
        },
        logo_url: selectedCampaign.projectLogo, // Store original logo URL
      }
      
      console.log('💾 Saving context:')
      console.log(`   - documents_text entries: ${uploadedDocuments.length}`)
      console.log(`   - document_urls (S3 keys): ${documentS3Keys.length}`)
      console.log(`   - links: ${links.length}`)
      console.log(`   - Documents being saved:`, uploadedDocuments.map(d => d.name))
      console.log(`   - S3 keys being saved:`, documentS3Keys)

      const resp = await fetch(
        `${apiUrl}/mining-context/user/${walletAddress}/campaign/${selectedCampaign.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      if (resp.ok) {
        const result = await resp.json()
        console.log('✅ Save response:', result)
        setSaveStatus('saved')
        showToast('Context saved successfully!', 'success')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        const errorText = await resp.text()
        console.error('❌ Save failed:', resp.status, errorText)
        throw new Error('Failed to save context')
      }
    } catch (error) {
      console.error('Save failed:', error)
      setSaveStatus('error')
      showToast('Failed to save context', 'error')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } finally {
      setSaving(false)
    }
  }

  // Save button component
  const SaveButton = () => (
    <button
      onClick={saveAll}
      disabled={saving || !walletAddress || !selectedCampaign}
      className={`inline-flex items-center px-6 py-3 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white ${
        saving
          ? 'bg-orange-700 cursor-not-allowed'
          : 'bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500'
      }`}
    >
      {saving ? (
        <>
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Saving...
        </>
      ) : saveStatus === 'saved' ? (
        <>
          <CheckIcon className="-ml-1 mr-2 h-4 w-4" aria-hidden="true" />
          Saved!
        </>
      ) : saveStatus === 'error' ? (
        <>
          <XMarkIcon className="-ml-1 mr-2 h-4 w-4" aria-hidden="true" />
          Error
        </>
      ) : (
        <>
          <CloudArrowUpIcon className="-ml-1 mr-2 h-4 w-4" aria-hidden="true" />
          Save Changes
        </>
      )}
    </button>
  )

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        {!selectedCampaign ? (
          // Campaign Selection View
          <div className="bg-gray-800/50 backdrop-blur-md rounded-xl border border-gray-700/50 p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center">
              <TrophyIcon className="h-6 w-6 text-orange-400 mr-2" />
              Select Campaign to Manage Context
            </h2>

            {/* Search Bar */}
            <div className="relative mb-4">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search campaigns by title, project, category, or platform..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setCurrentPage(1)
                }}
                className="w-full pl-10 pr-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            {campaignsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400 mx-auto"></div>
                <p className="text-gray-400 mt-2">Loading campaigns...</p>
              </div>
            ) : (
              <>
                {paginatedCampaigns.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    No campaigns found matching your search.
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {paginatedCampaigns.map((campaign) => (
                      <div
                        key={campaign.id}
                        className="p-4 rounded-lg border-2 border-gray-600 bg-gray-700/30 hover:border-orange-400 hover:bg-orange-500/10 transition-all cursor-pointer"
                        onClick={() => setSelectedCampaign(campaign)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center mb-2">
                              <h3 className="text-lg font-semibold text-white">{campaign.title}</h3>
                              {campaign.projectName && (
                                <span className="ml-2 px-2 py-1 bg-gray-600/20 text-gray-300 text-xs rounded-full">
                                  {campaign.projectName}
                                </span>
                              )}
                              <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
                                campaign.campaign_type === 'social' ? 'bg-green-500/20 text-green-400' :
                                campaign.campaign_type === 'meme' ? 'bg-purple-500/20 text-purple-400' :
                                campaign.campaign_type === 'educational' ? 'bg-blue-500/20 text-blue-400' :
                                campaign.campaign_type === 'roast' ? 'bg-red-500/20 text-red-400' :
                                campaign.campaign_type === 'creative' ? 'bg-cyan-500/20 text-cyan-400' :
                                campaign.campaign_type === 'viral' ? 'bg-pink-500/20 text-pink-400' :
                                'bg-orange-500/20 text-orange-400'
                              }`}>
                                {campaign.campaign_type.charAt(0).toUpperCase() + campaign.campaign_type.slice(1)}
                              </span>
                            </div>
                            <p className="text-gray-400 text-sm mb-2 line-clamp-2">{campaign.description}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleCampaignExpansion(campaign.id)
                            }}
                            className="flex items-center text-gray-400 hover:text-white transition-colors text-sm ml-4"
                          >
                            {expandedCampaigns.has(campaign.id) ? (
                              <>
                                <span className="mr-1">Hide</span>
                                <ChevronUpIcon className="h-4 w-4" />
                              </>
                            ) : (
                              <>
                                <span className="mr-1">Show</span>
                                <ChevronDownIcon className="h-4 w-4" />
                              </>
                            )}
                          </button>
                        </div>
                        {expandedCampaigns.has(campaign.id) && (
                          <div className="mt-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700/50">
                            <h4 className="text-sm font-medium text-orange-400 mb-2">📋 Brand Guidelines</h4>
                            <p className="text-gray-300 text-sm leading-relaxed">
                              {campaign.brandGuidelines || 'No specific brand guidelines provided.'}
                            </p>
                          </div>
                        )}
                        <div className="mt-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedCampaign(campaign)
                            }}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
                          >
                            <SparklesIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                            Manage Context
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex justify-center items-center space-x-2 mt-6">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="p-2 rounded-lg bg-gray-700 border border-gray-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum = i + 1
                      if (totalPages > 5 && currentPage > 3) {
                        if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = currentPage - 2 + i
                        }
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                            currentPage === pageNum
                              ? 'bg-orange-500 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="p-2 rounded-lg bg-gray-700 border border-gray-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600 transition-colors"
                    >
                      <ChevronRightIcon className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          // Context Management View
          <div className="space-y-4">
            {/* Condensed Campaign Header - Single Line */}
            <div className="bg-gray-800/50 backdrop-blur-md rounded-xl border border-gray-700/50 p-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSelectedCampaign(null)}
                  className="inline-flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  <ArrowLeftIcon className="h-5 w-5 mr-2" />
                  Back
                </button>
                <div className="flex items-center space-x-3">
                  <SparklesIcon className="h-5 w-5 text-orange-400" />
                  <span className="text-lg font-semibold text-white">{selectedCampaign.title}</span>
                  {selectedCampaign.projectName && (
                    <>
                      <span className="text-gray-500">•</span>
                      <span className="text-sm text-gray-400">{selectedCampaign.projectName}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <SaveButton />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="bg-gray-800/50 backdrop-blur-md rounded-xl border border-gray-700/50 overflow-hidden">
              <div className="flex border-b border-gray-700/50">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex-1 flex items-center justify-center space-x-2 px-4 py-3 text-sm font-medium transition-colors ${
                      tab === t.id
                        ? 'bg-orange-500/20 text-orange-400 border-b-2 border-orange-500'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700/30'
                    }`}
                  >
                    <t.icon className="h-5 w-5" />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-6">
                {tab === 'logo' && (
                  <div className="max-w-2xl mx-auto space-y-6">
                    <div className="text-center">
                      <h3 className="text-lg font-semibold text-white mb-2">Project Logo</h3>
                      <p className="text-sm text-gray-400">Logo is set by the project admin and cannot be changed by miners</p>
                    </div>

                    {/* Logo Preview */}
                    <div className="flex justify-center">
                      <div className="w-48 h-48 bg-gray-700/50 border-2 border-gray-600 rounded-lg flex items-center justify-center overflow-hidden">
                        {logoPreview ? (
                          <Image
                            src={logoPreview}
                            alt="Project logo"
                            width={192}
                            height={192}
                            className="object-contain"
                          />
                        ) : (
                          <div className="text-center">
                            <PhotoIcon className="h-16 w-16 text-gray-500 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">No logo available</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'details' && (
                  <div className="max-w-4xl mx-auto space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-gray-300 mb-2">Project Name</label>
                        <input
                          type="text"
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                          placeholder="Your Project Name"
                          value={projectName}
                          onChange={(e) => setProjectName(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-gray-300 mb-2">Website</label>
                        <input
                          type="text"
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                          placeholder="https://yourproject.com"
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-gray-300 mb-2">Chain/Network <span className="text-gray-500 text-sm">(Optional)</span></label>
                        <select
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                          value={chain}
                          onChange={(e) => setChain(e.target.value)}
                        >
                          <option value="">Select chain</option>
                          <option value="Ethereum">Ethereum</option>
                          <option value="Base">Base</option>
                          <option value="Polygon">Polygon</option>
                          <option value="Solana">Solana</option>
                          <option value="Arbitrum">Arbitrum</option>
                          <option value="Optimism">Optimism</option>
                          <option value="BSC">BSC</option>
                          <option value="Avalanche">Avalanche</option>
                          <option value="Fantom">Fantom</option>
                          <option value="Somnia">Somnia</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-gray-300 mb-2">Token Symbol <span className="text-gray-500 text-sm">(Optional)</span></label>
                        <input
                          type="text"
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                          placeholder="e.g., ETH, SOL"
                          value={tokenSymbol}
                          onChange={(e) => setTokenSymbol(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-gray-300 mb-2">Tone</label>
                        <select
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                          value={tone}
                          onChange={(e) => setTone(e.target.value)}
                        >
                          <option value="">Select tone</option>
                          <option value="Professional">Professional</option>
                          <option value="Informative">Informative</option>
                          <option value="Casual">Casual</option>
                          <option value="Technical">Technical</option>
                          <option value="Playful">Playful</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-gray-300 mb-2">Category</label>
                        <select
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option value="">Select category</option>
                          <option value="defi">DeFi</option>
                          <option value="nft">NFT</option>
                          <option value="gaming">Gaming</option>
                          <option value="metaverse">Metaverse</option>
                          <option value="dao">DAO</option>
                          <option value="infrastructure">Infrastructure</option>
                          <option value="layer 1">Layer 1</option>
                          <option value="layer 2">Layer 2</option>
                          <option value="trading">Trading</option>
                          <option value="meme coins">Meme Coins</option>
                          <option value="socialfi">SocialFi</option>
                          <option value="ai & crypto">AI & Crypto</option>
                          <option value="real world assets">Real World Assets</option>
                          <option value="prediction markets">Prediction Markets</option>
                          <option value="privacy">Privacy</option>
                          <option value="cross chain">Cross Chain</option>
                          <option value="yield farming">Yield Farming</option>
                          <option value="liquid staking">Liquid Staking</option>
                          <option value="derivatives">Derivatives</option>
                          <option value="payments">Payments</option>
                          <option value="identity">Identity</option>
                          <option value="security">Security</option>
                          <option value="tools">Tools</option>
                          <option value="analytics">Analytics</option>
                          <option value="education">Education</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-300 mb-2">Project Details</label>
                      <textarea
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                        rows={4}
                        value={projectDetails}
                        onChange={(e) => setProjectDetails(e.target.value)}
                        placeholder="Describe your project, its goals, unique features, and any other relevant details..."
                      />
                    </div>

                    <div>
                      <label className="block text-gray-300 mb-3">
                        Color Palette 
                        <span className="text-xs text-gray-500 ml-2">(Set by Admin - Read Only)</span>
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Primary Color</label>
                          <div className="flex space-x-2">
                            <div
                              className="w-16 h-10 bg-transparent border-2 border-gray-700 rounded"
                              style={{ backgroundColor: primaryColor || '#000000' }}
                              title="Color set by admin"
                            />
                            <input
                              type="text"
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-400 cursor-not-allowed"
                              value={primaryColor || 'Not set'}
                              readOnly
                              disabled
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Secondary Color</label>
                          <div className="flex space-x-2">
                            <div
                              className="w-16 h-10 bg-transparent border-2 border-gray-700 rounded"
                              style={{ backgroundColor: secondaryColor || '#000000' }}
                              title="Color set by admin"
                            />
                            <input
                              type="text"
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-400 cursor-not-allowed"
                              value={secondaryColor || 'Not set'}
                              readOnly
                              disabled
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm text-gray-400 mb-2">Accent Color</label>
                          <div className="flex space-x-2">
                            <div
                              className="w-16 h-10 bg-transparent border-2 border-gray-700 rounded"
                              style={{ backgroundColor: accentColor || '#000000' }}
                              title="Color set by admin"
                            />
                            <input
                              type="text"
                              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-400 cursor-not-allowed"
                              value={accentColor || 'Not set'}
                              readOnly
                              disabled
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'text' && (
                  <div className="max-w-6xl mx-auto space-y-6">
                    {/* Text Areas Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                        <div className="flex items-center space-x-3 mb-4">
                          <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                          <h4 className="text-lg font-semibold text-white">Keywords</h4>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">Key terms relevant to your project...</p>
                        <textarea
                          value={keywords}
                          onChange={(e) => setKeywords(e.target.value)}
                          placeholder="Enter keywords..."
                          className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                        />
                      </div>

                      <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                        <div className="flex items-center space-x-3 mb-4">
                          <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                          <h4 className="text-lg font-semibold text-white">Competitors</h4>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">List your main competitors...</p>
                        <textarea
                          value={competitors}
                          onChange={(e) => setCompetitors(e.target.value)}
                          placeholder="List competitors..."
                          className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                        />
                      </div>

                      <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                        <div className="flex items-center space-x-3 mb-4">
                          <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                          <h4 className="text-lg font-semibold text-white">Goals</h4>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">Your project goals and objectives...</p>
                        <textarea
                          value={goals}
                          onChange={(e) => setGoals(e.target.value)}
                          placeholder="Describe goals..."
                          className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                        />
                      </div>

                      <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                        <div className="flex items-center space-x-3 mb-4">
                          <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                          <h4 className="text-lg font-semibold text-white">Additional Notes</h4>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">Any other relevant information...</p>
                        <textarea
                          value={contentText}
                          onChange={(e) => setContentText(e.target.value)}
                          placeholder="Add notes and context..."
                          className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                        />
                      </div>
                    </div>

                    {/* Document Upload */}
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                      <div className="flex items-center space-x-3 mb-4">
                        <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                        <h4 className="text-lg font-semibold text-white">Documents & Images</h4>
                      </div>
                      <p className="text-sm text-gray-400 mb-4">Upload PDF, DOCX files, or images (PNG, JPG, JPEG). Text will be extracted from documents.</p>

                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const files = Array.from(e.dataTransfer.files).filter(f =>
                            f.type === 'application/pdf' ||
                            f.type === 'application/msword' ||
                            f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                            f.type === 'image/png' ||
                            f.type === 'image/jpeg' ||
                            f.type === 'image/jpg' ||
                            f.name.toLowerCase().endsWith('.pdf') ||
                            f.name.toLowerCase().endsWith('.docx') ||
                            f.name.toLowerCase().endsWith('.doc') ||
                            f.name.toLowerCase().endsWith('.png') ||
                            f.name.toLowerCase().endsWith('.jpg') ||
                            f.name.toLowerCase().endsWith('.jpeg')
                          )
                          if (files.length > 0) {
                            setDocumentFiles(prev => [...prev, ...files])
                          }
                        }}
                        className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-orange-500 transition-colors"
                      >
                        <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                        <p className="text-gray-400 mb-2">Drag & drop files here, or click to choose</p>
                        <p className="text-xs text-gray-500 mb-3">Supported: PDF, DOCX, PNG, JPG, JPEG</p>
                        <input
                          type="file"
                          accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
                          multiple
                          id="docUpload"
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || [])
                            if (files.length > 0) {
                              setDocumentFiles(prev => [...prev, ...files])
                            }
                          }}
                        />
                        <label
                          htmlFor="docUpload"
                          className="inline-block px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-200 cursor-pointer transition-colors"
                        >
                          Choose Files
                        </label>
                      </div>

                      {/* Files to Upload */}
                      {documentFiles.length > 0 && (
                        <div className="mt-4 space-y-2">
                          {documentFiles.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                              <span className="text-sm text-gray-300 truncate flex-1">{file.name}</span>
                              <div className="flex items-center space-x-2 ml-3">
                                <button
                                  type="button"
                                  onClick={() => setDocumentFiles(documentFiles.filter((_, i) => i !== idx))}
                                  className="px-3 py-1 bg-red-700/70 hover:bg-red-700 rounded text-white text-xs transition-colors"
                                >
                                  Remove
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await uploadDocuments([file])
                                    setDocumentFiles(documentFiles.filter((_, i) => i !== idx))
                                  }}
                                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs transition-colors"
                                >
                                  Upload
                                </button>
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={async () => {
                              await uploadDocuments(documentFiles)
                              setDocumentFiles([])
                            }}
                            className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-colors"
                          >
                            Upload All ({documentFiles.length})
                          </button>
                        </div>
                      )}

                      {/* Uploaded Documents */}
                      {uploadedDocuments.length > 0 && (
                        <div className="mt-6">
                          <h5 className="text-sm font-medium text-gray-300 mb-3">Uploaded Documents ({uploadedDocuments.length})</h5>
                          <div className="space-y-2">
                            {uploadedDocuments.map((doc, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg px-3 py-2">
                                <div className="flex-1">
                                  <span className="text-sm font-medium text-white">{doc.name}</span>
                                  {doc.timestamp && (
                                    <span className="text-xs text-gray-500 ml-2">
                                      ({new Date(doc.timestamp).toLocaleDateString()})
                                    </span>
                                  )}
                                  {doc.text && (
                                    <span className="text-xs text-green-400 ml-2">✓ Text extracted</span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const removedDoc = uploadedDocuments[idx]
                                    console.log(`🗑️ Removing document: ${removedDoc.name}`)
                                    setUploadedDocuments(uploadedDocuments.filter((_, i) => i !== idx))
                                    showToast(`Removed ${removedDoc.name}. Click "Save Changes" to persist.`, 'success')
                                  }}
                                  className="px-3 py-1 bg-red-700/70 hover:bg-red-700 rounded text-white text-xs transition-colors ml-3"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'handles' && (
                  <div className="max-w-4xl mx-auto space-y-6">
                    <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6 space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold text-white mb-2">Platform Handles & URLs</h3>
                        <p className="text-sm text-gray-400">Add handles and URLs for content inspiration. We'll analyze their style and patterns.</p>
                      </div>

                      {/* Twitter Handles */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Twitter/X Handles</label>
                        {twitterHandles.map((handle, idx) => (
                          <div key={idx} className="flex items-center gap-2 mb-2">
                            <span className="px-3 py-2 bg-gray-700 border border-r-0 border-gray-600 rounded-l-lg text-gray-400">@</span>
                            <input
                              type="text"
                              value={handle}
                              onChange={(e) => {
                                const next = [...twitterHandles]
                                next[idx] = e.target.value
                                setTwitterHandles(next)
                              }}
                              placeholder="username"
                              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-r-lg text-white focus:outline-none focus:border-orange-500"
                            />
                            <button
                              type="button"
                              onClick={() => setTwitterHandles(twitterHandles.filter((_, i) => i !== idx))}
                              className="px-3 py-1 bg-red-700/70 hover:bg-red-700 rounded text-white text-xs transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setTwitterHandles([...twitterHandles, ''])}
                          className="text-sm text-purple-300 hover:text-white transition-colors"
                        >
                          + Add Twitter handle
                        </button>
                      </div>

                      {/* Website URLs */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-3">Website URLs</label>
                        {websiteUrls.map((url, idx) => (
                          <div key={idx} className="flex items-center gap-2 mb-2">
                            <input
                              type="text"
                              value={url}
                              onChange={(e) => {
                                const next = [...websiteUrls]
                                next[idx] = e.target.value
                                setWebsiteUrls(next)
                              }}
                              placeholder="https://yourproject.com"
                              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                            />
                            <button
                              type="button"
                              onClick={() => setWebsiteUrls(websiteUrls.filter((_, i) => i !== idx))}
                              className="px-3 py-1 bg-red-700/70 hover:bg-red-700 rounded text-white text-xs transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setWebsiteUrls([...websiteUrls, ''])}
                          className="text-sm text-purple-300 hover:text-white transition-colors"
                        >
                          + Add website URL
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'links' && (
                  <div className="max-w-4xl mx-auto space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2">Documentation & Resource Links</h3>
                      <p className="text-sm text-gray-400 mb-6">Add links to documentation, resources, or other relevant URLs</p>
                    </div>

                    <div className="space-y-3">
                      {links.map((link, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                            value={link.url || ''}
                            onChange={(e) => {
                              const next = [...links]
                              next[i] = { ...next[i], url: e.target.value, timestamp: next[i].timestamp || new Date().toISOString() }
                              setLinks(next)
                            }}
                            placeholder="https://docs.example.com"
                          />
                          {link.timestamp && (
                            <span className="text-xs text-gray-500 whitespace-nowrap">
                              {new Date(link.timestamp).toLocaleDateString()}
                            </span>
                          )}
                          <button
                            onClick={() => setLinks(links.filter((_, idx) => idx !== i))}
                            className="px-3 py-1 bg-red-700/70 hover:bg-red-700 rounded text-white text-xs transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      ))}

                      <button
                        onClick={() => setLinks([...links, { url: '', timestamp: new Date().toISOString() }])}
                        className="text-sm text-purple-300 hover:text-white transition-colors"
                      >
                        + Add another link
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Save Button */}
              <div className="px-6 pb-6 flex justify-end border-t border-gray-700/50 pt-6">
                <SaveButton />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
