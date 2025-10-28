import { useState, useRef, useCallback } from 'react'

interface GenerationProgress {
  progress_percent: number
  progress_message: string
  current_step: string
  status: string
  generated_image_urls?: string[]
  twitter_text?: string
  youtube_description?: string
  instagram_caption?: string
  linkedin_post?: string
  error_message?: string
}

export const useGenerationPolling = () => {
  const isPollingRef = useRef(false)
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null)

  const startPolling = useCallback((
    jobId: string,
    onProgress: (progress: GenerationProgress) => void,
    onComplete: (progress: GenerationProgress) => void,
    onError: (error: string) => void
  ) => {
    console.log(`🚀 startPolling called for job ${jobId}, isPolling: ${isPollingRef.current}`)
    if (isPollingRef.current) {
      console.log(`⚠️  Already polling, skipping start for job ${jobId}`)
      return
    }

    console.log(`✅ Setting isPolling to true for job ${jobId}`)
    isPollingRef.current = true
    
    const interval = setInterval(async () => {
      console.log(`🔄 Polling interval tick for job ${jobId}`)
      // Check if polling should stop
      if (!isPollingRef.current) {
        console.log(`⏹️  Polling stopped for job ${jobId}`)
        clearInterval(interval)
        return
      }

      try {
        // Fetch the generation record for this job
        console.log(`🔍 Polling for job ${jobId}...`)
        const response = await fetch(
          (process.env.NEXT_PUBLIC_TYPESCRIPT_BACKEND_URL || 'http://localhost:3001') + `/api/web2-generated-content/job/${jobId}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )

        console.log(`📡 Polling response status: ${response.status}`)
        if (!response.ok) {
          console.error('Failed to fetch progress:', response.status, response.statusText)
          // Don't stop polling on network errors - retry on next interval
          return
        }

        const data = await response.json()
        console.log(`📊 Polling response data:`, data)
        if (data.success && data.data) {
          const latestRecord = data.data
          console.log(`✅ Found record for job ${jobId}:`, {
            id: latestRecord.id,
            status: latestRecord.status,
            progress_percent: latestRecord.progress_percent,
            progress_message: latestRecord.progress_message
          })
          
          // Debug logging
          console.log('📊 Polling update:', {
            status: latestRecord.status,
            progress_percent: latestRecord.progress_percent,
            progress_message: latestRecord.progress_message,
            current_step: latestRecord.current_step
          })
          
          // Update progress with job_id for fetching per_image_metadata
          console.log(`📝 Polling update with job_id ${jobId} for per_image_metadata fetch`)
          onProgress({
            ...latestRecord,
            job_id: jobId
          })
          
          // Check if generation is complete
          if (latestRecord.status === 'completed') {
            console.log(`✅ Generation completed for job ${jobId}, stopping polling`)
            clearInterval(interval)
            setPollInterval(null)
            isPollingRef.current = false
            onComplete({
              ...latestRecord,
              job_id: jobId
            })
            return
          } else if (latestRecord.status === 'error') {
            console.log(`❌ Generation error for job ${jobId}, stopping polling`)
            clearInterval(interval)
            setPollInterval(null)
            isPollingRef.current = false
            onError(latestRecord.error_message || 'Unknown error')
            return
          } else {
            // Still generating - continue polling
            console.log(`🔄 Job ${jobId} still generating (${latestRecord.progress_percent}%) - continuing to poll`)
          }
        } else {
          console.log(`⚠️  No data found for job ${jobId}, continuing to poll...`)
        }
      } catch (error) {
        console.error('Error polling progress:', error)
        // Don't stop polling on errors - retry on next interval
      }
    }, 3000) // Poll every 3 seconds

    setPollInterval(interval)

    // Stop polling after 15 minutes to prevent infinite polling (increased from 5 minutes)
    // This allows for slow external APIs while still preventing infinite polling
    setTimeout(() => {
      console.log(`⏰ Polling timeout reached for job ${jobId} after 15 minutes`)
      stopPolling()
    }, 900000) // 15 minutes = 900,000 ms
  }, [])

  const stopPolling = useCallback(() => {
    console.log(`⏹️  stopPolling called, isPolling: ${isPollingRef.current}`)
    if (pollInterval) {
      clearInterval(pollInterval)
      setPollInterval(null)
    }
    isPollingRef.current = false
  }, [pollInterval])

  return {
    isPolling: isPollingRef.current,
    startPolling,
    stopPolling
  }
}
