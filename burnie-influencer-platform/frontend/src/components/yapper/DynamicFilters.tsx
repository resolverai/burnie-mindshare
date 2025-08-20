'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { fetchFilterOptions } from '../../services/filterService'

interface DynamicFiltersProps {
  selectedPlatform: string
  selectedProject: string
  onPlatformChange: (platform: string) => void
  onProjectChange: (project: string) => void
  searchTerm?: string
  onSearchChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export default function DynamicFilters({
  selectedPlatform,
  selectedProject,
  onPlatformChange,
  onProjectChange,
  searchTerm,
  onSearchChange
}: DynamicFiltersProps) {
  const [isPlatformDropdownOpen, setIsPlatformDropdownOpen] = useState(false)
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false)
  const platformDropdownRef = useRef<HTMLDivElement>(null)
  const projectDropdownRef = useRef<HTMLDivElement>(null)

  // Fetch filter options
  const { data: filterOptions = { platforms: [], projects: [] } } = useQuery({
    queryKey: ['filter-options'],
    queryFn: fetchFilterOptions,
    staleTime: 10 * 60 * 1000, // 10 minutes
  })

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(event.target as Node)) {
        setIsPlatformDropdownOpen(false)
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Platform configuration
  const platformIcons: Record<string, string> = {
    'cookie.fun': '/openledger.svg',
    'yaps.kaito.ai': '/sapien.svg',
    'burnie': '/openledger.svg',
    'openledger': '/openledger.svg',
    'kaito': '/sapien.svg'
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] items-start md:items-end gap-6">
      {/* Platforms Filter */}
      <div className="flex flex-col items-start gap-3">
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
              />
              {platform === 'cookie.fun' ? 'Cookie.fun' : 
               platform === 'yaps.kaito.ai' ? 'Kaito.ai' : 
               platform}
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
                      />
                      {platform === 'cookie.fun' ? 'Cookie.fun' : 
                       platform === 'yaps.kaito.ai' ? 'Kaito.ai' : 
                       platform}
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
        <div className="flex flex-col items-start gap-3">
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

      {/* Search Bar */}
      {onSearchChange && (
        <div className="flex flex-col items-start gap-3 md:items-end">
          <div className="flex md:hidden">
            <span className="text-sm font-medium tracking-wide text-white/80 mr-1">Search</span>
          </div>
          <div className="relative w-full md:w-72">
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
