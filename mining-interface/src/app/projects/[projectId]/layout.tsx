'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import ProjectsSidebar from '@/components/projects/ProjectsSidebar'
import { getApiUrlWithFallback } from '@/utils/api-config'

export default function ProjectLayout({ children, params }: { children: React.ReactNode, params: { projectId: string } }) {
  const [expanded, setExpanded] = useState(false)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const projectId = params.projectId
  const router = useRouter()

  useEffect(() => {
    const guard = async () => {
      // Prevent guard from running if already on auth page
      if (typeof window !== 'undefined' && window.location.pathname.includes('/projects/auth')) {
        return
      }
      
      setIsChecking(true)
      try {
        if (!projectId) {
          router.replace('/projects/auth')
          return
        }
        const apiUrl = getApiUrlWithFallback()
        if (!apiUrl) {
          console.error('API URL not configured')
          setIsChecking(false)
          return
        }
        
        // Step 1: Get user's actual project_id from backend FIRST (quick check)
        // This allows us to immediately redirect if project ID doesn't match
        let userProjectId: number | null = null
        try {
          const myProjectResp = await fetch(`${apiUrl}/projects/my-project`, {
            credentials: 'include' // Include cookies for session
          })
          
          if (myProjectResp.status === 401) {
            // Not authenticated
            console.log('Not authenticated, redirecting to auth')
            setIsChecking(false)
            router.replace('/projects/auth')
            return
          }
          
          if (!myProjectResp.ok) {
            const errorData = await myProjectResp.json().catch(() => ({}))
            console.error('Failed to get user project:', myProjectResp.status, errorData)
            setIsChecking(false)
            // Only redirect if it's an auth error, otherwise show error
            if (myProjectResp.status === 401 || myProjectResp.status === 404) {
              router.replace('/projects/auth')
            }
            return
          }
          
          const myProjectData = await myProjectResp.json()
          if (myProjectData?.success && myProjectData?.data?.project_id) {
            userProjectId = myProjectData.data.project_id
          } else {
            // No project found or invalid response - treat as not authenticated
            console.error('No project found for user or invalid response:', myProjectData)
            setIsChecking(false)
            router.replace('/projects/auth')
            return
          }
        } catch (e) {
          console.error('Failed to get user project:', e)
          setIsChecking(false)
          // Don't redirect on network errors - just show error
          // Only redirect if it's clearly an auth issue
          if (e instanceof TypeError && e.message.includes('fetch')) {
            // Network error - don't redirect, just stop checking
            return
          }
          router.replace('/projects/auth')
          return
        }
        
        // Step 2: IMMEDIATELY check if URL project_id matches user's project_id
        // If mismatch, redirect to same page with correct project ID (fast redirect, no other checks)
        const requestedProjectId = parseInt(projectId, 10)
        if (isNaN(requestedProjectId) || requestedProjectId !== userProjectId) {
          console.log(`Project ID mismatch: requested ${requestedProjectId}, user has ${userProjectId} - redirecting immediately`)
          setIsChecking(false)
          // Preserve the current page path and redirect to the same page with correct project ID
          const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
          // Extract the page path after /projects/[projectId]/
          const pathMatch = currentPath.match(/\/projects\/\d+\/(.+)$/)
          const pagePath = pathMatch ? pathMatch[1] : 'dashboard' // Default to dashboard if no match
          // Redirect to the same page but with user's correct project ID
          router.replace(`/projects/${userProjectId}/${pagePath}`)
          return
        }
        
        // Step 3: Verify Twitter tokens are valid and set cookie if needed
        // Only do this if project IDs match (to avoid unnecessary checks)
        try {
          const resp = await fetch(`${apiUrl}/projects/${projectId}/twitter/status`, {
            credentials: 'include' // Include cookies for session
          })
          if (!resp.ok) {
            setIsChecking(false)
            router.replace('/projects/auth')
            return
          }
          const data = await resp.json()
          if (!data?.success || !data.valid) {
            setIsChecking(false)
            router.replace('/projects/auth')
            return
          }
          // Cookie should now be set (either was already set, or was auto-set by status endpoint)
        } catch (e) {
          console.error('Twitter status check failed:', e)
          setIsChecking(false)
          router.replace('/projects/auth')
          return
        }
          
          // Step 4: Ensure context exists; otherwise force onboarding
          try {
            const ctxResp = await fetch(`${apiUrl}/projects/${projectId}/context`, {
              credentials: 'include'
            })
            if (!ctxResp.ok) {
              if (ctxResp.status === 401) {
                // Unauthorized - redirect to auth
                setIsChecking(false)
                router.replace('/projects/auth')
                return
              }
              const isOnboarding = typeof window !== 'undefined' && window.location.pathname.includes('/projects/new')
              if (!isOnboarding) {
                setIsChecking(false)
                router.replace('/projects/new')
              }
              return
            }
            const ctxData = await ctxResp.json()
            if (ctxData?.success === false && ctxData?.requiresAuth) {
              // Authorization failed
              setIsChecking(false)
              router.replace('/projects/auth')
              return
            }
            const hasContext = !!ctxData?.data
            const isOnboarding = typeof window !== 'undefined' && window.location.pathname.includes('/projects/new')
            if (!hasContext && !isOnboarding) {
              setIsChecking(false)
              router.replace('/projects/new')
              return
            }
          } catch (e) {
            console.error('Context check failed:', e)
            // If context check fails, default to onboarding
            const isOnboarding = typeof window !== 'undefined' && window.location.pathname.includes('/projects/new')
            if (!isOnboarding) {
              setIsChecking(false)
              router.replace('/projects/new')
            }
            return
          }
          
          // All checks passed - authorize
          setIsAuthorized(true)
      } catch (e) {
        console.error('Guard check failed:', e)
        setIsChecking(false)
        router.replace('/projects/auth')
      } finally {
        setIsChecking(false)
      }
    }
    guard()
  }, [projectId, router])

  // Show loading state until authorization is verified
  if (isChecking || !isAuthorized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-gray-400">Verifying authorization...</p>
        </div>
      </div>
    )
  }

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


