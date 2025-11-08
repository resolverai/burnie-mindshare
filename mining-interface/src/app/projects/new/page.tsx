'use client'

import { useState, useEffect, DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { getApiUrlWithFallback } from '@/utils/api-config'

export default function NewProjectOnboardingPage() {
  const router = useRouter()
  useEffect(() => {
    const checkTwitterStatus = async () => {
      try {
        const pid = localStorage.getItem('burnie_project_id')
        if (!pid) {
          router.replace('/projects/auth')
          return
        }
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl) {
          console.error('API URL not configured')
          return
        }
        
        const resp = await fetch(`${apiUrl}/projects/${pid}/twitter/status`, {
          credentials: 'include' // Include cookies for session
        })
        if (!resp.ok) {
          console.error(`Failed to check Twitter status: ${resp.status}`)
          router.replace('/projects/auth')
          return
        }
        
        const data = await resp.json()
        if (!data?.success || !data.valid) {
          router.replace('/projects/auth')
          return
        }
        // If context already exists, go straight to dashboard
        try {
          const ctxResp = await fetch(`${apiUrl}/projects/${pid}/context`, {
            credentials: 'include' // Include cookies for session
          })
          if (ctxResp.ok) {
            const ctxData = await ctxResp.json()
            if (ctxData?.data) {
              router.replace(`/projects/${pid}/dashboard`)
              return
            }
          }
        } catch (e) {
          console.error('Error checking context:', e)
          // continue showing onboarding
        }
      } catch {
        router.replace('/projects/auth')
      }
    }
    checkTwitterStatus()
  }, [router])
  const [logoPreview, setLogoPreview] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState({
    name: '',
    website: '',
    links: [],
    chain: '',
    tokenSymbol: '',
    tone: '',
    category: '',
    keywords: '',
    competitors: '',
    goals: '',
  })
  const [docs, setDocs] = useState<{ file: File; name: string }[]>([])

  const [logoFile, setLogoFile] = useState<File | null>(null)
  const onLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setLogoPreview(url)
      setLogoFile(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return // Prevent double submission
    
    setIsSubmitting(true)
    try {
      const projectId = localStorage.getItem('burnie_project_id')
      if (!projectId) { 
        setIsSubmitting(false)
        router.replace('/projects/auth')
        return 
      }
      
      // Validate logo is provided (required)
      if (!logoFile) {
        setIsSubmitting(false)
        alert('Project logo is required. Please upload a logo.')
        return
      }
      
      const apiUrl = getApiUrlWithFallback()
      if (!apiUrl) {
        setIsSubmitting(false)
        alert('API URL not configured. Please check your environment variables.')
        return
      }

      // Upload logo to S3 via backend (required) - like Web2
      let logoUrl: string | undefined
      if (logoFile) {
        try {
          const formData = new FormData()
          formData.append('logo', logoFile)
          
          const uploadResp = await fetch(`${apiUrl}/projects/${projectId}/upload-logo`, {
            method: 'POST',
            credentials: 'include', // Include cookies for session
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
          
          // Store the S3 key (not the s3:// URL) for logo_url
          logoUrl = uploadResult.data.s3_key
          console.log('✅ Logo uploaded, saving S3 key:', logoUrl)
        } catch (err) {
          console.error('❌ Logo upload failed:', err)
          setIsSubmitting(false)
          alert(`Failed to upload logo: ${err instanceof Error ? err.message : 'Unknown error'}`)
          return // Prevent form submission if logo fails (since it's required)
        }
      }
      
      // Ensure logoUrl is set (required field)
      if (!logoUrl) {
        setIsSubmitting(false)
        alert('Logo upload failed. Please try again.')
        return
      }

      // Upload documents to S3 via backend (like Web2) with timestamps
      const documentUrls: string[] = []
      const timestamp = new Date().toISOString()
      for (const d of docs) {
        try {
          const formData = new FormData()
          formData.append('document', d.file)
          
          const uploadResp = await fetch(`${apiUrl}/projects/${projectId}/upload-document`, {
            method: 'POST',
            credentials: 'include', // Include cookies for session
            body: formData
          })
          
          if (!uploadResp.ok) {
            const errData = await uploadResp.json().catch(() => ({}))
            console.error(`Document upload failed for ${d.name}:`, errData.error || uploadResp.status)
            continue // Skip failed uploads but continue with others
          }
          
          const uploadResult = await uploadResp.json()
          if (uploadResult?.success && uploadResult?.data?.s3_key) {
            // Store S3 keys (not public URLs)
            const s3Key = uploadResult.data.s3_key
            documentUrls.push(s3Key)
            console.log(`✅ Document uploaded: ${d.name} -> ${s3Key}`)
          }
        } catch (err) {
          console.error(`Error uploading document ${d.name}:`, err)
        }
      }

      // Ensure logoUrl is set (required field)
      if (!logoUrl) {
        setIsSubmitting(false)
        alert('Logo upload failed. Please try again.')
        return
      }

      // Save context (initial)
      const contextPayload: any = {
        project_name: form.name || null,
        website: form.website || null,
        chain: form.chain || null,
        tokenSymbol: form.tokenSymbol || null,
        tone: form.tone || null,
        category: form.category || null,
        keywords: form.keywords || null,
        competitors: form.competitors || null,
        goals: form.goals || null,
        links: Array.isArray(form.links) 
          ? form.links.filter(l => l && typeof l === 'string' && l.trim().length > 0).map(url => ({ url, timestamp: new Date().toISOString() }))
          : [],
        document_urls: Array.isArray(documentUrls) && documentUrls.length > 0 ? documentUrls : null,
        logo_url: logoUrl // Always set logo_url since it's required
      }
      console.log('Saving context with logo_url:', logoUrl)
      const saveResp = await fetch(`${apiUrl}/projects/${projectId}/context`, {
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies for session
        body: JSON.stringify(contextPayload)
      })
      if (!saveResp.ok) {
        const errData = await saveResp.json().catch(() => ({}))
        throw new Error(`Failed to save context: ${saveResp.status} - ${errData.error || 'Unknown error'}`)
      }
      const saveData = await saveResp.json()
      console.log('Context saved successfully:', saveData)

      // Trigger server-side text extraction to populate documents_text
      if (documentUrls.length > 0) {
        try {
          console.log('Triggering text extraction for documents:', documentUrls)
          const extractResp = await fetch(`${apiUrl}/projects/${projectId}/context/extract-documents`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            credentials: 'include', // Include cookies for session
            body: JSON.stringify({ document_urls: documentUrls })
          })
          
          if (!extractResp.ok) {
            const errData = await extractResp.json().catch(() => ({}))
            console.warn('Document extraction request failed:', errData.error || extractResp.status)
          } else {
            const extractData = await extractResp.json()
            console.log('✅ Document text extraction completed:', extractData)
          }
        } catch (err) {
          console.error('Document extraction request failed (non-critical):', err)
          // Continue anyway - documents are saved even if extraction fails
        }
      }

      router.push(`/projects/${projectId}/daily-posts`)
    } catch (err) {
      console.error('Onboarding submission failed:', err)
      alert(`Failed to save project information: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6">Tell us about your project.</h1>
        <form onSubmit={handleSubmit} className="glass p-6 rounded-2xl border border-gray-800 space-y-6">
          <div>
            <label className="block text-gray-300 mb-2">Project Logo (required)</label>
            <div
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={(e: DragEvent) => { e.preventDefault(); const file = e.dataTransfer.files?.[0]; if (file) onLogoChange({ target: { files: [file] } } as any) }}
              className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-purple-500 transition-colors"
            >
              <p className="text-gray-400 mb-2">Drag & drop your logo here, or click to choose</p>
              <input type="file" accept="image/*" onChange={onLogoChange} className="hidden" id="logoUpload" />
              <label htmlFor="logoUpload" className="inline-block px-3 py-2 bg-gray-800 rounded-md text-sm text-gray-200 cursor-pointer">Choose file</label>
              {logoPreview && (
                <div className="mt-3 flex items-center justify-center">
                  <img src={logoPreview} alt="logo" className="h-16 w-16 rounded-md object-cover" />
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-gray-300 mb-2">Project Name</label>
            <input className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required />
          </div>

          <div>
            <label className="block text-gray-300 mb-2">Website</label>
            <input className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" value={form.website} onChange={e=>setForm({...form,website:e.target.value})} placeholder="https://yourproject.com" />
          </div>

          <div>
            <label className="block text-gray-300 mb-2">Documentation & Resources</label>
            {form.links.length === 0 && (
              <p className="text-gray-500 text-sm mb-2">Optional. Add if you have docs or resources.</p>
            )}
            {form.links.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2 mb-2">
                <input className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" value={link} onChange={e=>{
                  const next = [...form.links]; next[idx] = e.target.value; setForm({...form,links:next})
                }} placeholder="https://docs.yourproject.com" />
                <button type="button" onClick={()=>{ const next = form.links.filter((_,i)=>i!==idx); setForm({...form,links:next}) }} className="px-2 py-1 bg-red-700/70 rounded text-white text-xs">Remove</button>
              </div>
            ))}
            <button type="button" onClick={()=>setForm({...form,links:[...form.links,'']})} className="text-sm text-purple-300 hover:text-white">+ Add another link</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-300 mb-2">Chain/Network <span className="text-gray-500 text-sm">(Optional - for pre-launch projects)</span></label>
              <select className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none" value={form.chain} onChange={e=>setForm({...form,chain:e.target.value})}>
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
              <label className="block text-gray-300 mb-2">Token Symbol <span className="text-gray-500 text-sm">(Optional - for pre-launch projects)</span></label>
              <input className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Leave blank if token not released yet" value={form.tokenSymbol} onChange={e=>setForm({...form,tokenSymbol:e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-300 mb-2">Tone</label>
              <select className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none" value={form.tone} onChange={e=>setForm({...form,tone:e.target.value})}>
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
              <select className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white appearance-none" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
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

          {/* Color palette and brand values are set later in Context screen */}

          <div>
            <label className="block text-gray-300 mb-2">Keywords (optional)</label>
            <textarea className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" rows={3} value={form.keywords} onChange={e=>setForm({...form,keywords:e.target.value})} />
          </div>
          <div>
            <label className="block text-gray-300 mb-2">Competitors (optional)</label>
            <textarea className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" rows={3} value={form.competitors} onChange={e=>setForm({...form,competitors:e.target.value})} />
          </div>
          <div>
            <label className="block text-gray-300 mb-2">Goals (optional)</label>
            <textarea className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white" rows={3} value={form.goals} onChange={e=>setForm({...form,goals:e.target.value})} />
          </div>

          <div>
            <label className="block text-gray-300 mb-2">Upload PDFs or DOCX (optional)</label>
            <div
              onDragOver={(e: DragEvent) => e.preventDefault()}
              onDrop={async (e: DragEvent) => { e.preventDefault(); const fls = Array.from(e.dataTransfer.files || []); if (!fls.length) return; setDocs(prev => [...prev, ...fls.map(f=>({ file: f, name: f.name }))]) }}
              className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-purple-500 transition-colors"
            >
              <p className="text-gray-400">Drag & drop .pdf or .docx files</p>
            </div>
            {docs.length > 0 && (
              <div className="mt-3 space-y-2">
                {docs.map((d, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300">
                    <span className="truncate mr-3">{d.name}</span>
                    <button type="button" onClick={()=>setDocs(docs.filter((_,idx)=>idx!==i))} className="px-2 py-1 bg-red-700/70 rounded text-white text-xs">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button 
              type="submit" 
              disabled={isSubmitting}
              className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center space-x-2 ${
                isSubmitting 
                  ? 'bg-gray-600 text-gray-300 cursor-not-allowed' 
                  : 'bg-orange-600 hover:bg-orange-700 text-white'
              }`}
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


