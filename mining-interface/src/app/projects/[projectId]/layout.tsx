'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProjectsSidebar from '@/components/projects/ProjectsSidebar'
import { getApiUrlWithFallback } from '@/utils/api-config'

export default function ProjectLayout({ children, params }: { children: React.ReactNode, params: { projectId: string } }) {
  const [expanded, setExpanded] = useState(false)
  const projectId = params.projectId
  const router = useRouter()

  useEffect(() => {
    const guard = async () => {
      try {
        if (!projectId) {
          router.replace('/projects/auth')
          return
        }
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl) {
          console.error('API URL not configured')
          return
        }
        
        try {
          const resp = await fetch(`${apiUrl}/projects/${projectId}/twitter/status`)
          if (!resp.ok) {
            router.replace('/projects/auth')
            return
          }
          const data = await resp.json()
          if (!data?.success || !data.valid) {
            router.replace('/projects/auth')
            return
          }
          // Ensure context exists; otherwise force onboarding
          try {
            const ctxResp = await fetch(`${apiUrl}/projects/${projectId}/context`)
            if (!ctxResp.ok) {
              const isOnboarding = typeof window !== 'undefined' && window.location.pathname.includes('/projects/new')
              if (!isOnboarding) router.replace('/projects/new')
              return
            }
            const ctxData = await ctxResp.json()
            const hasContext = !!ctxData?.data
            const isOnboarding = typeof window !== 'undefined' && window.location.pathname.includes('/projects/new')
            if (!hasContext && !isOnboarding) {
              router.replace('/projects/new')
            }
          } catch (e) {
            console.error('Context check failed:', e)
            // If context check fails, default to onboarding
            const isOnboarding = typeof window !== 'undefined' && window.location.pathname.includes('/projects/new')
            if (!isOnboarding) router.replace('/projects/new')
          }
        } catch (e) {
          console.error('Twitter status check failed:', e)
          router.replace('/projects/auth')
        }
      } catch (e) {
        console.error('Guard check failed:', e)
        router.replace('/projects/auth')
      }
    }
    guard()
  }, [projectId, router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800">
      <ProjectsSidebar projectId={projectId} isExpanded={expanded} onToggle={() => setExpanded(!expanded)} />
      <main className={`transition-all duration-300 ease-in-out overflow-y-auto h-screen ${
        expanded ? 'ml-64' : 'ml-20'
      }`}>
        {children}
      </main>
    </div>
  )
}


