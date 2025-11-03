'use client'

import React, { useState, useRef, useEffect } from 'react'
import { PlayIcon, PauseIcon, SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/outline'

interface VideoPlayerProps {
  src: string
  poster?: string
  autoPlay?: boolean
  muted?: boolean
  loop?: boolean
  controls?: boolean
  className?: string
  onError?: (error: any) => void
  onLoadStart?: () => void
  onCanPlay?: () => void
}

export default function VideoPlayer({
  src,
  poster,
  autoPlay = false,
  muted = false,
  loop = false,
  controls = true,
  className = '',
  onError,
  onLoadStart,
  onCanPlay
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(muted)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  // Effect to handle src changes and initialize video
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Set src and load video when src prop is provided
    if (src) {
      const currentSrc = video.src || video.currentSrc || ''
      if (currentSrc !== src) {
        console.log('🔄 VideoPlayer: Setting video src', { currentSrc, newSrc: src })
        video.src = src
      }
      // Always call load() to ensure video is ready, especially when component remounts
      // This handles cases where same URL is used but we want fresh playback
      video.load()
      setIsLoading(true)
      setHasError(false)
    } else {
      // Clear src if new src is empty/null
      if (video.src || video.currentSrc) {
        console.log('🔄 VideoPlayer: Clearing video src')
        video.src = ''
        video.load()
        setIsLoading(true)
        setHasError(false)
      }
    }

    const handleLoadStart = () => {
      setIsLoading(true)
      setHasError(false)
      onLoadStart?.()
    }

    const handleCanPlay = () => {
      setIsLoading(false)
      try {
        video.volume = 1.0
        // ensure DOM reflects current mute state
        video.muted = isMuted
        video.defaultMuted = isMuted
        if (autoPlay) {
          const p = video.play()
          if (p && typeof p.then === 'function') {
            p.catch(() => {/* autoplay may be blocked until user gesture */})
          }
        }
      } catch {}
      onCanPlay?.()
    }

    const handleError = (e: any) => {
      setIsLoading(false)
      setHasError(true)
      onError?.(e)
    }

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleVolumeChange = () => {
      const nowMuted = video.muted
      setIsMuted(nowMuted)
      if (!nowMuted) {
        try {
          video.volume = 1.0
          const p = video.play()
          if (p && typeof p.then === 'function') {
            p.catch(() => {})
          }
        } catch {}
      }
    }

    video.addEventListener('loadstart', handleLoadStart)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('error', handleError)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('volumechange', handleVolumeChange)

    return () => {
      video.removeEventListener('loadstart', handleLoadStart)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('error', handleError)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('volumechange', handleVolumeChange)
    }
  }, [src, onError, onLoadStart, onCanPlay, autoPlay, isMuted])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play()
    } else {
      video.pause()
    }
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return

    const nextMuted = !isMuted
    setIsMuted(nextMuted)
    try {
      video.muted = nextMuted
      video.defaultMuted = nextMuted
      if (!nextMuted) {
        video.volume = 1.0
        const p = video.play()
        if (p && typeof p.then === 'function') {
          p.catch(() => {})
        }
      }
    } catch {}
  }

  if (hasError) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`}>
        <div className="text-center p-4">
          <div className="text-gray-500 mb-2">⚠️</div>
          <p className="text-sm text-gray-600">Video failed to load</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative group w-full ${className}`} style={{ minHeight: 0, position: 'relative' }}>
      <video
        ref={videoRef}
        src={src || undefined}
        poster={poster}
        autoPlay={autoPlay}
        muted={isMuted}
        controls={controls}
        loop={loop}
        playsInline
        preload="auto"
        className="w-full h-full object-contain rounded-lg"
        style={{ 
          maxWidth: '100%', 
          maxHeight: '100%',
          width: '100%',
          height: 'auto',
          display: 'block'
        }}
        onError={() => setHasError(true)}
        onPlay={() => {
          const v = videoRef.current
          if (!v) return
          // ensure volume is up when playing and unmuted
          if (!isMuted) {
            try { v.volume = 1.0 } catch {}
          }
        }}
        onClick={() => {
          const v = videoRef.current
          if (!v) return
          // On user interaction, ensure unmute path works across browsers
          if (!isMuted && v.paused) {
            try {
              v.volume = 1.0
              v.muted = false
              v.defaultMuted = false
              const p = v.play()
              if (p && typeof p.then === 'function') {
                p.catch(() => {})
              }
            } catch {}
          }
        }}
      />
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      )}

      {/* Rely on native controls; custom overlays removed to avoid interference with audio/mute */}
    </div>
  )
}
