'use client'

import { useEffect, useMemo, useState, DragEvent } from 'react'
import { useParams } from 'next/navigation'
import { getApiUrlWithFallback } from '@/utils/api-config'
import { 
  DocumentTextIcon,
  LinkIcon,
  CloudArrowUpIcon,
  CheckIcon,
  XMarkIcon,
  TrashIcon
} from '@heroicons/react/24/outline'

type TabKey = 'logo' | 'details' | 'text' | 'handles' | 'links'

interface DocumentData {
  name: string
  url: string
  text: string
  timestamp?: string
}

interface LinkData {
  url: string
  timestamp?: string
}

export default function ProjectContextPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const [tab, setTab] = useState<TabKey>('logo')
  const [ctx, setCtx] = useState<any>(null)
  const apiUrl = useMemo(() => getApiUrlWithFallback(), [])
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [links, setLinks] = useState<LinkData[]>([])
  const [twitterHandles, setTwitterHandles] = useState<string[]>([])
  const [githubRepos, setGithubRepos] = useState<string[]>([])
  const [websiteUrls, setWebsiteUrls] = useState<string[]>([])
  
  // Form state
  const [projectName, setProjectName] = useState('')
  const [website, setWebsite] = useState('')
  const [chain, setChain] = useState('')
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [tone, setTone] = useState('')
  const [category, setCategory] = useState('')
  const [brandValues, setBrandValues] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#000000')
  const [secondaryColor, setSecondaryColor] = useState('#000000')
  const [accentColor, setAccentColor] = useState('#000000')
  const [keywords, setKeywords] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [goals, setGoals] = useState('')
  const [contentText, setContentText] = useState('')
  const [documentFiles, setDocumentFiles] = useState<File[]>([])
  const [uploadedDocuments, setUploadedDocuments] = useState<DocumentData[]>([])

  useEffect(() => {
    const load = async () => {
      if (!apiUrl || !projectId) {
        console.error('Missing apiUrl or projectId')
        return
      }
      
      try {
        const resp = await fetch(`${apiUrl}/projects/${projectId}/context`)
        if (!resp.ok) {
          console.error(`Failed to fetch context: ${resp.status}`)
          return
        }
        
        const data = await resp.json()
        if (data?.data) {
          setCtx(data.data)
          
          // Load form fields
          setProjectName(data.data.project_name || '')
          setWebsite(data.data.website || '')
          setChain(data.data.chain || '')
          setTokenSymbol(data.data.tokenSymbol || '')
          setTone(data.data.tone || '')
          setCategory(data.data.category || '')
          setBrandValues(data.data.brand_values || '')
          setKeywords(data.data.keywords || '')
          setCompetitors(data.data.competitors || '')
          setGoals(data.data.goals || '')
          setContentText(data.data.content_text || '')
          
          // Load colors
          if (data.data.color_palette) {
            setPrimaryColor(data.data.color_palette.primary || '#000000')
            setSecondaryColor(data.data.color_palette.secondary || '#000000')
            setAccentColor(data.data.color_palette.accent || '#000000')
          }
          
          // Load links (convert from old format if needed)
          if (data.data.linksJson) {
            if (Array.isArray(data.data.linksJson) && data.data.linksJson.length > 0) {
              if (typeof data.data.linksJson[0] === 'string') {
                // Old format: array of strings
                setLinks(data.data.linksJson.map((url: string) => ({ url, timestamp: new Date().toISOString() })))
              } else {
                // New format: array of objects
                setLinks(data.data.linksJson)
              }
            } else {
              setLinks([])
            }
          } else {
            setLinks([])
          }
          
          // Load platform handles - convert from old format if needed
          const handles = data.data.platform_handles || {}
          if (handles && typeof handles === 'object') {
            // Handle old format: { twitter: 'handle', github: 'repo' }
            // Or new format: { twitter: ['handle1', 'handle2'], github: ['repo1', 'repo2'] }
            if (Array.isArray(handles.twitter)) {
              setTwitterHandles(handles.twitter.filter((h: string) => h && h.trim()))
            } else if (handles.twitter && typeof handles.twitter === 'string') {
              setTwitterHandles(handles.twitter.trim() ? [handles.twitter.trim()] : [])
            } else {
              setTwitterHandles([])
            }
            
            if (Array.isArray(handles.github)) {
              setGithubRepos(handles.github.filter((r: string) => r && r.trim()))
            } else if (handles.github && typeof handles.github === 'string') {
              setGithubRepos(handles.github.trim() ? [handles.github.trim()] : [])
            } else {
              setGithubRepos([])
            }
            
            if (Array.isArray(handles.website)) {
              setWebsiteUrls(handles.website.filter((u: string) => u && u.trim()))
            } else if (handles.website && typeof handles.website === 'string') {
              setWebsiteUrls(handles.website.trim() ? [handles.website.trim()] : [])
            } else {
              setWebsiteUrls([])
            }
          } else {
            setTwitterHandles([])
            setGithubRepos([])
            setWebsiteUrls([])
          }
          
          // Load documents
          if (data.data.documents_text) {
            setUploadedDocuments(data.data.documents_text)
          }
          
          // Load logo preview - use presigned URL from backend (cached with Redis)
          if (data.data.logo_url_presigned) {
            setLogoPreview(data.data.logo_url_presigned)
          } else if (data.data.logo_url) {
            // Fallback: try to generate presigned URL if not provided
            try {
              const s3Key = data.data.logo_url.startsWith('/') ? data.data.logo_url.slice(1) : data.data.logo_url
              const pres = await fetch(`${apiUrl}/projects/${projectId}/presigned-url`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ s3_key: s3Key }) 
              })
              if (pres.ok) {
                const presData = await pres.json()
                if (presData?.success && presData?.presigned_url) {
                  setLogoPreview(presData.presigned_url)
                }
              }
            } catch (e) {
              console.error('Failed to generate presigned URL for logo:', e)
            }
          }
        } else {
          setCtx({})
        }
      } catch (error) {
        console.error('Error loading context:', error)
      }
    }
    load()
  }, [apiUrl, projectId])

  const saveAll = async () => {
    if (!apiUrl || !projectId) {
      console.error('Missing apiUrl or projectId')
      setSaveStatus('error')
      return
    }
    
    setSaving(true)
    setSaveStatus('saving')
    try {
      // Prepare links with timestamps (update existing, add timestamp to new)
      const linksToSave: LinkData[] = links.map(link => {
        if (link.url && !link.timestamp) {
          return { ...link, timestamp: new Date().toISOString() }
        }
        return link
      }).filter(link => link.url && link.url.trim())

      // Prepare documents with timestamps for newly uploaded ones
      const documentsToSave: DocumentData[] = [...uploadedDocuments]
      
      const body = {
        project_name: projectName || null,
        website,
        chain,
        tokenSymbol,
        tone,
        category: category || null,
        brand_values: brandValues, // Now text, not array
        color_palette: {
          primary: primaryColor,
          secondary: secondaryColor,
          accent: accentColor
        },
        keywords,
        competitors,
        goals,
        content_text: contentText,
        links: linksToSave,
        platform_handles: {
          twitter: twitterHandles.filter(h => h && h.trim()),
          github: githubRepos.filter(r => r && r.trim()),
          website: websiteUrls.filter(u => u && u.trim())
        },
        document_urls: Array.isArray(documentsToSave) && documentsToSave.length > 0 
          ? documentsToSave.map(d => d.url).filter(Boolean)
          : null,
        documents_text: documentsToSave
      }
      
      const resp = await fetch(`${apiUrl}/projects/${projectId}/context`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(body) 
      })
      
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.error || `Save failed: ${resp.status}`)
      }
      
      const data = await resp.json()
      if (data?.success && data?.data) {
        setCtx(data.data)
        // Update logo preview with new presigned URL from response
        if (data.data.logo_url_presigned) {
          setLogoPreview(data.data.logo_url_presigned)
        }
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        setSaveStatus('error')
      }
    } catch (err) {
      console.error('Save failed:', err)
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const uploadLogo = async (file: File) => {
    if (!apiUrl || !projectId) {
      alert('API URL or Project ID not configured')
      return
    }
    
    try {
      const formData = new FormData()
      formData.append('logo', file)
      
      const uploadResp = await fetch(`${apiUrl}/projects/${projectId}/upload-logo`, {
        method: 'POST',
        body: formData
      })
      
      if (!uploadResp.ok) {
        const errData = await uploadResp.json().catch(() => ({}))
        throw new Error(errData.error || `Upload failed: ${uploadResp.status}`)
      }
      
      const uploadResult = await uploadResp.json()
      if (!uploadResult?.success || !uploadResult?.data?.s3_key) {
        throw new Error('Invalid upload response')
      }
      
      const logoUrl = uploadResult.data.s3_key
      
      // Generate presigned URL for preview
      const presResp = await fetch(`${apiUrl}/projects/${projectId}/presigned-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3_key: logoUrl })
      })
      if (presResp.ok) {
        const presData = await presResp.json()
        if (presData?.success && presData?.presigned_url) {
          setLogoPreview(presData.presigned_url)
        }
      }
      
      await saveAll()
    } catch (err) {
      console.error('Logo upload failed:', err)
      alert(`Failed to upload logo: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const uploadDocuments = async (files: File[]) => {
    if (files.length === 0) return
    
    if (!apiUrl || !projectId) {
      alert('API URL or Project ID not configured')
      return
    }
    
    const uploaded: DocumentData[] = []
    const s3Keys: string[] = []
    const timestamp = new Date().toISOString()
    
    // Step 1: Upload all files to S3 first
    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('document', file)
        
        const uploadResp = await fetch(`${apiUrl}/projects/${projectId}/upload-document`, {
          method: 'POST',
          body: formData
        })
        
        if (!uploadResp.ok) {
          const errData = await uploadResp.json().catch(() => ({}))
          console.error(`Document upload failed for ${file.name}:`, errData.error || uploadResp.status)
          continue
        }
        
        const uploadResult = await uploadResp.json()
        if (uploadResult?.success && uploadResult?.data?.s3_key) {
          const s3Key = uploadResult.data.s3_key
          s3Keys.push(s3Key)
          
          // Create placeholder entry (text will be filled after extraction)
          uploaded.push({
            name: file.name,
            url: s3Key,
            text: '',
            timestamp
          })
          console.log(`✅ Document uploaded: ${file.name} -> ${s3Key}`)
        }
      } catch (err) {
        console.error(`Error uploading document ${file.name}:`, err)
      }
    }
    
    // Step 2: Extract text from all uploaded documents at once
    if (s3Keys.length > 0 && apiUrl && projectId) {
      try {
        console.log(`Triggering text extraction for ${s3Keys.length} documents:`, s3Keys)
        const extractResp = await fetch(`${apiUrl}/projects/${projectId}/context/extract-documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_urls: s3Keys })
        })
        
        if (extractResp.ok) {
          const extractData = await extractResp.json()
          if (extractData?.data?.documents_text && Array.isArray(extractData.data.documents_text)) {
            // Create a map of S3 keys to extracted text
            const extractedMap = new Map<string, string>()
            extractData.data.documents_text.forEach((doc: DocumentData) => {
              if (doc.url && doc.text) {
                extractedMap.set(doc.url, doc.text)
              }
            })
            
            // Update uploaded documents with extracted text
            uploaded.forEach(doc => {
              const extractedText = extractedMap.get(doc.url)
              if (extractedText) {
                doc.text = extractedText
              }
            })
            
            console.log(`✅ Text extraction completed for ${extractedMap.size}/${s3Keys.length} documents`)
          }
        } else {
          const errData = await extractResp.json().catch(() => ({}))
          console.warn('Document extraction request failed:', errData.error || extractResp.status)
        }
      } catch (err) {
        console.error('Document extraction request failed (non-critical):', err)
        // Continue anyway - documents are saved even if extraction fails
      }
    }
    
    // Step 3: Update state with all uploaded documents
    if (uploaded.length > 0) {
      setUploadedDocuments(prev => [...prev, ...uploaded])
      setDocumentFiles([])
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Project Context</h1>
        
        {/* Save Button at Top */}
        <button
          onClick={saveAll}
          disabled={saving}
          className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center space-x-2 ${
            saveStatus === 'saved' 
              ? 'bg-green-600 hover:bg-green-700 text-white' 
              : saveStatus === 'error'
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : saving
              ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {saveStatus === 'saving' && <span>Saving...</span>}
          {saveStatus === 'saved' && (
            <>
              <CheckIcon className="w-5 h-5" />
              <span>Saved!</span>
            </>
          )}
          {saveStatus === 'idle' && <span>Save All Changes</span>}
          {saveStatus === 'error' && <span>Error - Try Again</span>}
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        {(
          [
            { key: 'logo', label: 'Logo' },
            { key: 'details', label: 'Details' },
            { key: 'text', label: 'Text & Content' },
            { key: 'handles', label: 'Platform Handles' },
            { key: 'links', label: 'Links' },
          ] as { key: TabKey; label: string }[]
        ).map(t => (
          <button 
            key={t.key} 
            onClick={() => setTab(t.key)} 
            className={`px-3 py-2 rounded-lg text-sm ${
              tab === t.key 
                ? 'bg-orange-600 text-white' 
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="glass p-6 rounded-2xl border border-gray-800">
        {tab === 'logo' && (
          <div>
            <div
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={(e: DragEvent) => { 
                e.preventDefault()
                const f = e.dataTransfer.files?.[0]
                if (f && f.type.startsWith('image/')) uploadLogo(f) 
              }}
              className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-orange-500 transition-colors"
            >
              <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p className="text-gray-400 mb-2">Drag & drop your logo here, or click to choose</p>
              <input type="file" accept="image/*" id="projLogo" className="hidden" onChange={(e)=>{ const f=e.target.files?.[0]; if (f) uploadLogo(f) }} />
              <label htmlFor="projLogo" className="inline-block px-3 py-2 bg-gray-800 rounded-md text-sm text-gray-200 cursor-pointer">Choose file</label>
            </div>
            {logoPreview && (
              <div className="mt-4">
                <img src={logoPreview} className="h-16 w-16 rounded-md object-cover" alt="logo" />
              </div>
            )}
          </div>
        )}

        {tab === 'details' && (
          <div className="space-y-6">
            <div>
              <label className="block text-gray-300 mb-2">Project Name</label>
              <input 
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" 
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter project name"
              />
            </div>
            
            <div>
              <label className="block text-gray-300 mb-2">Website</label>
              <input 
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" 
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-300 mb-2">Chain/Network <span className="text-gray-500 text-sm">(Optional)</span></label>
                <select 
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none" 
                  value={chain}
                  onChange={(e) => setChain(e.target.value)}
                >
                  <option value="">Not specified (pre-launch or non-blockchain)</option>
                  <option value="Ethereum">Ethereum</option>
                  <option value="Base">Base</option>
                  <option value="Polygon">Polygon</option>
                  <option value="Solana">Solana</option>
                  <option value="Arbitrum">Arbitrum</option>
                  <option value="Optimism">Optimism</option>
                  <option value="BSC">BSC</option>
                  <option value="Avalanche">Avalanche</option>
                  <option value="Fantom">Fantom</option>
                </select>
              </div>
              
              <div>
                <label className="block text-gray-300 mb-2">Token Symbol <span className="text-gray-500 text-sm">(Optional)</span></label>
                <input 
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" 
                  placeholder="Leave blank if token not released yet"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-300 mb-2">Tone</label>
                <select 
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none" 
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
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none" 
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
            
            {/* Brand Values - Now Textarea in separate line */}
            <div>
              <label className="block text-gray-300 mb-2">Brand Values</label>
              <textarea 
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" 
                rows={4}
                value={brandValues}
                onChange={(e) => setBrandValues(e.target.value)}
                placeholder="Describe your brand values, principles, and what makes your project unique..."
              />
            </div>
            
            {/* Color Palette with values displayed */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-gray-300 mb-2">Primary Color</label>
                <div className="flex space-x-2">
                  <input 
                    type="color" 
                    className="w-16 h-10 bg-transparent border border-gray-700 rounded cursor-pointer" 
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  />
                  <input 
                    type="text"
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#000000"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-gray-300 mb-2">Secondary Color</label>
                <div className="flex space-x-2">
                  <input 
                    type="color" 
                    className="w-16 h-10 bg-transparent border border-gray-700 rounded cursor-pointer" 
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                  />
                  <input 
                    type="text"
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    placeholder="#000000"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-gray-300 mb-2">Accent Color</label>
                <div className="flex space-x-2">
                  <input 
                    type="color" 
                    className="w-16 h-10 bg-transparent border border-gray-700 rounded cursor-pointer" 
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                  />
                  <input 
                    type="text"
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    placeholder="#000000"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'text' && (
          <div className="space-y-6">
            {/* Text Areas - Web2 Style */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                  <h3 className="text-lg font-semibold text-white">Keywords</h3>
                </div>
                <p className="text-sm text-gray-400 mb-4">Key terms and keywords relevant to your project...</p>
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
                  <h3 className="text-lg font-semibold text-white">Competitors</h3>
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
                  <h3 className="text-lg font-semibold text-white">Goals</h3>
                </div>
                <p className="text-sm text-gray-400 mb-4">Your project goals and objectives...</p>
                <textarea
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  placeholder="Describe goals..."
                  className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="lg:col-span-2 bg-gray-800/50 rounded-xl border border-gray-700 p-6">
                <div className="flex items-center space-x-3 mb-4">
                  <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                  <h3 className="text-lg font-semibold text-white">Content / Notes</h3>
                </div>
                <p className="text-sm text-gray-400 mb-4">Add any other relevant information, notes, or context...</p>
                <textarea
                  value={contentText}
                  onChange={(e) => setContentText(e.target.value)}
                  placeholder="Add notes and context..."
                  className="w-full h-40 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Document Upload - Multi-file drag and drop */}
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6">
              <div className="flex items-center space-x-3 mb-4">
                <DocumentTextIcon className="w-6 h-6 text-orange-400" />
                <h3 className="text-lg font-semibold text-white">Documents</h3>
              </div>
              <p className="text-sm text-gray-400 mb-4">Upload PDF or DOCX files. Text will be automatically extracted.</p>
              
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const files = Array.from(e.dataTransfer.files).filter(f => 
                    f.type === 'application/pdf' || 
                    f.type === 'application/msword' || 
                    f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                    f.name.toLowerCase().endsWith('.pdf') ||
                    f.name.toLowerCase().endsWith('.docx') ||
                    f.name.toLowerCase().endsWith('.doc')
                  )
                  if (files.length > 0) {
                    setDocumentFiles(prev => [...prev, ...files])
                  }
                }}
                className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-orange-500 transition-colors"
              >
                <CloudArrowUpIcon className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p className="text-gray-400 mb-2">Drag & drop PDF or DOCX files here, or click to choose</p>
                <input 
                  type="file" 
                  accept=".pdf,.docx,.doc" 
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
                  className="inline-block px-3 py-2 bg-gray-800 rounded-md text-sm text-gray-200 cursor-pointer"
                >
                  Choose files
                </label>
              </div>
              
              {/* Files to upload */}
              {documentFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {documentFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300">
                      <span className="truncate mr-3">{file.name}</span>
                      <div className="flex items-center space-x-2">
                        <button 
                          type="button" 
                          onClick={() => setDocumentFiles(documentFiles.filter((_, i) => i !== idx))} 
                          className="px-2 py-1 bg-red-700/70 rounded text-white text-xs"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await uploadDocuments([file])
                            setDocumentFiles(documentFiles.filter((_, i) => i !== idx))
                          }}
                          className="px-2 py-1 bg-blue-600 rounded text-white text-xs"
                        >
                          Upload
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => uploadDocuments(documentFiles)}
                    className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm"
                  >
                    Upload All ({documentFiles.length})
                  </button>
                </div>
              )}
              
              {/* Uploaded documents list */}
              {uploadedDocuments.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-sm font-medium text-gray-300 mb-2">Uploaded Documents ({uploadedDocuments.length})</h4>
                  {uploadedDocuments.map((doc, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300">
                      <div className="flex-1">
                        <span className="font-medium">{doc.name}</span>
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
                        onClick={() => setUploadedDocuments(uploadedDocuments.filter((_, i) => i !== idx))}
                        className="px-2 py-1 bg-red-700/70 rounded text-white text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'handles' && (
          <div className="space-y-6">
            <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Platform Handles & URLs</h3>
                <p className="text-sm text-gray-400">Add handles and URLs you want to follow/mimic for content inspiration. We'll analyze their style, tone, and patterns to generate better content for your project.</p>
              </div>

              {/* Twitter Handles - Multiple */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Twitter/X Handles</label>
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
                      className="px-2 py-1 bg-red-700/70 rounded text-white text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTwitterHandles([...twitterHandles, ''])}
                  className="text-sm text-purple-300 hover:text-white"
                >
                  + Add Twitter handle
                </button>
                <p className="text-xs text-gray-500 mt-1">Handles you want to follow/mimic for content inspiration</p>
              </div>

              {/* GitHub Repositories - Multiple */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">GitHub Repositories</label>
                {githubRepos.map((repo, idx) => (
                  <div key={idx} className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={repo}
                      onChange={(e) => {
                        const next = [...githubRepos]
                        next[idx] = e.target.value
                        setGithubRepos(next)
                      }}
                      placeholder="https://github.com/username/repo or username/repo"
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                    />
                    <button
                      type="button"
                      onClick={() => setGithubRepos(githubRepos.filter((_, i) => i !== idx))}
                      className="px-2 py-1 bg-red-700/70 rounded text-white text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setGithubRepos([...githubRepos, ''])}
                  className="text-sm text-purple-300 hover:text-white"
                >
                  + Add GitHub repository
                </button>
                <p className="text-xs text-gray-500 mt-1">Repositories you want to reference for content inspiration</p>
              </div>

              {/* Website URLs - Multiple */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">Website URLs</label>
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
                      className="px-2 py-1 bg-red-700/70 rounded text-white text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setWebsiteUrls([...websiteUrls, ''])}
                  className="text-sm text-purple-300 hover:text-white"
                >
                  + Add website URL
                </button>
                <p className="text-xs text-gray-500 mt-1">Website URLs you want to reference for content inspiration</p>
              </div>
            </div>
          </div>
        )}

        {tab === 'links' && (
          <div className="space-y-4">
            <div>
              <label className="block text-gray-300 mb-2">Documentation & Resource Links</label>
              <p className="text-sm text-gray-400 mb-4">Add links to documentation, resources, or other relevant URLs</p>
              
              {links.map((link, i) => (
                <div key={i} className="flex items-center gap-2 mb-2">
                  <input 
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" 
                    value={link.url || ''}
                    onChange={(e) => {
                      const next = [...links]
                      next[i] = { ...next[i], url: e.target.value }
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
                    className="px-2 py-1 bg-red-700/70 rounded text-white text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
              
              <button 
                onClick={() => setLinks([...links, { url: '', timestamp: new Date().toISOString() }])} 
                className="text-sm text-purple-300 hover:text-white"
              >
                + Add another link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
