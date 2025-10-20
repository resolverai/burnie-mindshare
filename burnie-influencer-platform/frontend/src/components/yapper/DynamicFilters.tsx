'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { ChevronDown } from 'lucide-react'
import { fetchFilterOptions } from '../../services/filterService'


interface DynamicFiltersProps {
  selectedPlatform: string
  selectedProject: string
  selectedPostType: string
  videoOnly?: boolean
  onPlatformChange: (platform: string) => void
  onProjectChange: (project: string) => void
  onPostTypeChange: (postType: string) => void
  onVideoOnlyChange?: (videoOnly: boolean) => void
  searchTerm?: string
  onSearchChange?: (e: React.ChangeEvent<HTMLInputElement>) => void

}

export default function DynamicFilters({
  selectedPlatform,
  selectedProject,
  selectedPostType,
  videoOnly = false,
  onPlatformChange,
  onProjectChange,
  onPostTypeChange,
  onVideoOnlyChange,
  searchTerm,
  onSearchChange
}: DynamicFiltersProps) {
  // Desktop dropdown states
  const [isPlatformDropdownOpen, setIsPlatformDropdownOpen] = useState(false)
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false)
  const [isPostTypeDropdownOpen, setIsPostTypeDropdownOpen] = useState(false)
  
  // Mobile dropdown states (separate from desktop)
  const [isMobilePlatformDropdownOpen, setIsMobilePlatformDropdownOpen] = useState(false)
  const [isMobilePostTypeDropdownOpen, setIsMobilePostTypeDropdownOpen] = useState(false)
  
  // Desktop dropdown refs
  const platformDropdownRef = useRef<HTMLDivElement>(null)
  const projectDropdownRef = useRef<HTMLDivElement>(null)
  const postTypeDropdownRef = useRef<HTMLDivElement>(null)
  
  // Mobile dropdown refs (separate from desktop)
  const mobilePlatformDropdownRef = useRef<HTMLDivElement>(null)
  const mobilePostTypeDropdownRef = useRef<HTMLDivElement>(null)

  // Fetch filter options
  const { data: filterOptions = { platforms: [], projects: [] } } = useQuery({
    queryKey: ['filter-options'],
    queryFn: fetchFilterOptions,
    staleTime: 10 * 60 * 1000, // 10 minutes
  })

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Desktop dropdowns
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(event.target as Node)) {
        setIsPlatformDropdownOpen(false)
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false)
      }
      if (postTypeDropdownRef.current && !postTypeDropdownRef.current.contains(event.target as Node)) {
        setIsPostTypeDropdownOpen(false)
      }
      
      // Mobile dropdowns
      if (mobilePlatformDropdownRef.current && !mobilePlatformDropdownRef.current.contains(event.target as Node)) {
        setIsMobilePlatformDropdownOpen(false)
      }
      if (mobilePostTypeDropdownRef.current && !mobilePostTypeDropdownRef.current.contains(event.target as Node)) {
        setIsMobilePostTypeDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Platform configuration - using appropriate platform-related icons
  const platformIcons: Record<string, string> = {
    'cookie.fun': '/globe.svg',
    'yaps.kaito.ai': '/globe.svg',
    'burnie': '/globe.svg',
    'openledger': '/openledger.svg',
    'kaito': '/globe.svg'
  }

  // Filter out 'all' from platforms and projects since we have hardcoded "All" buttons
  const platformsWithoutAll = filterOptions.platforms.filter(p => p !== 'all')
  const projectsWithoutAll = filterOptions.projects.filter(p => p !== 'all')

  // Show first 2 platforms (excluding 'all'), put rest in dropdown
  const visiblePlatforms = platformsWithoutAll.slice(0, 2) 
  const hiddenPlatforms = platformsWithoutAll.slice(2)

  // Show first 2 projects (excluding 'all'), put rest in dropdown  
  const visibleProjects = projectsWithoutAll.slice(0, 2)
  const hiddenProjects = projectsWithoutAll.slice(2)

  // Get display names for platforms
  const getPlatformDisplayName = (platform: string) => {
    switch (platform) {
      case 'cookie.fun': return 'Cookie.fun'
      case 'yaps.kaito.ai': return 'Kaito.ai'
      case 'wallchain': return 'Wallchain'
      case 'galxe': return 'Galxe'
      case 'alphabot': return 'Alphabot'
      case 'independent': return 'Independent'
      default: return platform
    }
  }

  // Get display names for post types
  const getPostTypeDisplayName = (postType: string) => {
    switch (postType) {
      case 'thread': return 'Regular Post'
      case 'shitpost': return 'Meme Post'
      case 'longpost': return 'Long Post'
      default: return postType
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_auto_1fr] items-start lg:items-end gap-6">
      {/* Mobile & Tablet: Side-by-side dropdowns */}
      <div className="lg:hidden flex flex-col gap-6 w-full">
        {/* Platforms and Post Type row */}
        <div className="flex gap-4">
          {/* Platforms Dropdown */}
          <div className="flex-1 flex flex-col gap-3">
            <div className="flex">
              <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Platforms</span>
            </div>
            <div className="relative" ref={mobilePlatformDropdownRef}>
              <button
                onClick={() => setIsMobilePlatformDropdownOpen(!isMobilePlatformDropdownOpen)}
                className="w-full flex items-center justify-between rounded-[8px] h-9 px-3 bg-[#451616] hover:bg-[#743636] transition-colors text-white text-sm"
              >
                <span>{selectedPlatform === 'all' ? 'All' : getPlatformDisplayName(selectedPlatform)}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${isMobilePlatformDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isMobilePlatformDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#451616] rounded-[12px] border border-[#743636] z-10">
                  <button
                    onClick={() => {
                      onPlatformChange('all')
                      setIsMobilePlatformDropdownOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#743636] transition-colors rounded-t-[12px] ${
                      selectedPlatform === 'all' ? 'bg-[#743636] text-white font-semibold' : 'text-white/80'
                    }`}
                  >
                    All
                  </button>
                  {platformsWithoutAll.map((platform, index) => (
                    <button
                      key={platform}
                      onClick={() => {
                        onPlatformChange(platform)
                        setIsMobilePlatformDropdownOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-[#743636] transition-colors flex items-center gap-2 ${
                        selectedPlatform === platform ? 'bg-[#743636] text-white font-semibold' : 'text-white/80'
                      } ${index === platformsWithoutAll.length - 1 ? 'rounded-b-[12px]' : ''}`}
                    >
                      <Image 
                        src={platformIcons[platform] || '/openledger.svg'} 
                        alt={platform} 
                        width={16} 
                        height={16} 
                        className="filter brightness-0 invert" // Make icon white
                      />
                      {getPlatformDisplayName(platform)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Post Type Dropdown */}
          <div className="flex-1 flex flex-col gap-3">
            <div className="flex">
              <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Post Type</span>
            </div>
            <div className="relative" ref={mobilePostTypeDropdownRef}>
              <button
                onClick={() => setIsMobilePostTypeDropdownOpen(!isMobilePostTypeDropdownOpen)}
                className="w-full flex items-center justify-between rounded-[8px] h-9 px-3 bg-[#451616] hover:bg-[#743636] transition-colors text-white text-sm"
              >
                <span>{selectedPostType === 'all' ? 'All' : getPostTypeDisplayName(selectedPostType)}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${isMobilePostTypeDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isMobilePostTypeDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#451616] rounded-[12px] border border-[#743636] z-10">
                  <button
                    onClick={() => {
                      onPostTypeChange('all')
                      setIsMobilePostTypeDropdownOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#743636] transition-colors rounded-t-[12px] ${
                      selectedPostType === 'all' ? 'bg-[#743636] text-white font-semibold' : 'text-white/80'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => {
                      onPostTypeChange('thread')
                      setIsMobilePostTypeDropdownOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#743636] transition-colors ${
                      selectedPostType === 'thread' ? 'bg-[#743636] text-white font-semibold' : 'text-white/80'
                    }`}
                  >
                    Regular Post
                  </button>
                  <button
                    onClick={() => {
                      onPostTypeChange('shitpost')
                      setIsMobilePostTypeDropdownOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#743636] transition-colors ${
                      selectedPostType === 'shitpost' ? 'bg-[#743636] text-white font-semibold' : 'text-white/80'
                    }`}
                  >
                    Meme Post
                  </button>
                  <button
                    onClick={() => {
                      onPostTypeChange('longpost')
                      setIsMobilePostTypeDropdownOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#743636] transition-colors rounded-b-[12px] ${
                      selectedPostType === 'longpost' ? 'bg-[#743636] text-white font-semibold' : 'text-white/80'
                    }`}
                  >
                    Long Post
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Video Only Checkbox - Mobile */}
        {onVideoOnlyChange && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={videoOnly}
                onChange={(e) => onVideoOnlyChange(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-white/10 text-orange-600 focus:ring-orange-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-sm text-white/80">Video posts only</span>
            </label>
          </div>
        )}

        {/* Search Bar */}
        {onSearchChange && (
          <div className="w-full">
            <div className="relative w-full">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/70" />
              <input
                type="text"
                placeholder="Search by campaign, platform"
                value={searchTerm || ''}
                onChange={onSearchChange}
                className="rounded-[8px] h-8 w-full bg-white/10 placeholder:text-white/30 text-white pl-10 pr-4 border border-white/20 focus:border-white/40 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Desktop: Original layout with some items outside dropdowns */}
      <div className="hidden lg:flex flex-col items-start gap-3">
        <div className="flex">
          <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Platforms</span>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          {/* All Button */}
          <button 
            onClick={() => onPlatformChange('all')}
            className={`badge-yapper ${selectedPlatform === 'all' ? '!bg-[#743636] !text-white font-semibold' : ''}`}
          >
            All
          </button>

          {/* Visible Platform Buttons */}
          {visiblePlatforms.map((platform) => (
            <button 
              key={platform}
              onClick={() => onPlatformChange(platform)}
              className={`badge-yapper flex items-center gap-2 ${selectedPlatform === platform ? '!bg-[#743636] !text-white font-semibold' : ''}`}
            >
              <Image 
                src={platformIcons[platform] || '/openledger.svg'} 
                alt={platform} 
                width={16} 
                height={16} 
                className="filter brightness-0 invert" // Make icon white
              />
              {getPlatformDisplayName(platform)}
            </button>
          ))}

          {/* More Platforms Dropdown */}
          {hiddenPlatforms.length > 0 && (
            <div className="relative" ref={platformDropdownRef}>
              <button 
                onClick={() => setIsPlatformDropdownOpen(!isPlatformDropdownOpen)}
                className="badge-yapper flex items-center gap-2"
              >
                {hiddenPlatforms.length} more
                <Image 
                  src="/arrowdown.svg" 
                  alt="Arrow down" 
                  width={12} 
                  height={12}
                  className={`transition-transform duration-200 ${isPlatformDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isPlatformDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 min-w-[200px] bg-[#492222] border border-white/20 rounded-lg shadow-lg z-50">
                  {hiddenPlatforms.map((platform) => (
                    <button
                      key={platform}
                      onClick={() => {
                        onPlatformChange(platform)
                        setIsPlatformDropdownOpen(false)
                      }}
                      className={`w-full px-4 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg flex items-center gap-2 ${selectedPlatform === platform ? 'bg-[#743636] text-white font-semibold' : 'text-white hover:bg-white/10'}`}
                    >
                      <Image 
                        src={platformIcons[platform] || '/openledger.svg'} 
                        alt={platform} 
                        width={16} 
                        height={16} 
                        className="filter brightness-0 invert" // Make icon white
                      />
                      {getPlatformDisplayName(platform)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Projects Filter - Temporarily Hidden */}
      {false && (
        <div className="hidden lg:flex flex-col items-start gap-3">
          <div className="flex">
            <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Projects</span>
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            {/* All Button */}
            <button 
              onClick={() => onProjectChange('all')}
              className={`badge-yapper ${selectedProject === 'all' ? '!bg-[#743636] !text-white font-semibold' : ''}`}
            >
              All
            </button>

            {/* Visible Project Buttons */}
            {visibleProjects.map((project) => (
              <button 
                key={project}
                onClick={() => onProjectChange(project)}
                className={`badge-yapper ${selectedProject === project ? '!bg-[#743636] !text-white font-semibold' : ''}`}
              >
                {project}
              </button>
            ))}

            {/* More Projects Dropdown */}
            {hiddenProjects.length > 0 && (
              <div className="relative" ref={projectDropdownRef}>
                <button 
                  onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                  className="badge-yapper flex items-center gap-2"
                >
                  {hiddenProjects.length} more
                  <Image 
                    src="/arrowdown.svg" 
                    alt="Arrow down" 
                    width={12} 
                  height={12}
                    className={`transition-transform duration-200 ${isProjectDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {isProjectDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 min-w-[200px] bg-[#492222] border border-white/20 rounded-lg shadow-lg z-50">
                    {hiddenProjects.map((project) => (
                      <button
                        key={project}
                        onClick={() => {
                          onProjectChange(project)
                          setIsProjectDropdownOpen(false)
                        }}
                        className={`w-full px-4 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg ${selectedProject === project ? 'bg-[#743636] text-white font-semibold' : 'text-white hover:bg-white/10'}`}
                      >
                        {project}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Post Type Filter - Desktop */}
      <div className="hidden lg:flex flex-col items-start gap-3">
        <div className="flex">
          <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Post Type</span>
        </div>
        <div className="flex items-center gap-3">
          {/* All Button */}
          <button 
            onClick={() => onPostTypeChange('all')}
            className={`badge-yapper ${selectedPostType === 'all' ? '!bg-[#743636] !text-white font-semibold' : ''}`}
          >
            All
          </button>

          {/* Post Type Dropdown */}
          <div className="relative" ref={postTypeDropdownRef}>
            <button 
              onClick={() => setIsPostTypeDropdownOpen(!isPostTypeDropdownOpen)}
              className="badge-yapper flex items-center gap-2"
            >
              {selectedPostType === 'all' ? 'All Post Types' : 
               selectedPostType === 'thread' ? 'Regular Post' :
               selectedPostType === 'shitpost' ? 'Meme Post' :
               selectedPostType === 'longpost' ? 'Long Post' : 'Select Type'}
              <Image 
                src="/arrowdown.svg" 
                alt="Arrow down" 
                width={12} 
                height={12}
                className={`transition-transform duration-200 ${isPostTypeDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isPostTypeDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 min-w-[200px] bg-[#492222] border border-white/20 rounded-lg shadow-lg z-50">
                <button
                  onClick={() => {
                    onPostTypeChange('thread')
                    setIsPostTypeDropdownOpen(false)
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors first:rounded-t-lg ${selectedPostType === 'thread' ? 'bg-[#743636] text-white font-semibold' : 'text-white hover:bg-white/10'}`}
                >
                  Regular Post
                </button>
                <button
                  onClick={() => {
                    onPostTypeChange('shitpost')
                    setIsPostTypeDropdownOpen(false)
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors ${selectedPostType === 'shitpost' ? 'bg-[#743636] text-white font-semibold' : 'text-white hover:bg-white/10'}`}
                >
                  Meme Post
                </button>
                <button
                  onClick={() => {
                    onPostTypeChange('longpost')
                    setIsPostTypeDropdownOpen(false)
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors last:rounded-b-lg ${selectedPostType === 'longpost' ? 'bg-[#743636] text-white font-semibold' : 'text-white hover:bg-white/10'}`}
                >
                  Long Post
                </button>
              </div>
            )}
          </div>

          {/* Video Only Checkbox - Desktop */}
          {onVideoOnlyChange && (
            <label className="flex items-center gap-2 cursor-pointer badge-yapper">
              <input
                type="checkbox"
                checked={videoOnly}
                onChange={(e) => onVideoOnlyChange(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-white/10 text-orange-600 focus:ring-orange-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-sm">Video posts</span>
            </label>
          )}
        </div>
      </div>

      {/* Search Bar - Desktop */}
      {onSearchChange && (
        <div className="hidden lg:flex flex-col items-start gap-3 lg:items-end">
          <div className="flex lg:hidden">
            <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Search</span>
          </div>
          <div className="relative w-full lg:w-72">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/70" />
            <input
              type="text"
              placeholder="Search by campaign, platform"
              value={searchTerm || ''}
              onChange={onSearchChange}
              className="rounded-[8px] h-8 w-full bg-white/10 placeholder:text-white/30 text-white pl-10 pr-4 border border-white/20 focus:border-white/40 focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}
