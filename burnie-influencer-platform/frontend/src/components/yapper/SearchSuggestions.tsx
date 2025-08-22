'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import marketplaceService from '../../services/marketplaceService'

interface SearchSuggestionsProps {
  onSelectSuggestion: (type: 'platform' | 'project' | 'postType', value: string) => void
}

export default function SearchSuggestions({ onSelectSuggestion }: SearchSuggestionsProps) {
  const [isOpen, setIsOpen] = useState(false)

  const { data: suggestions, isLoading } = useQuery({
    queryKey: ['search-suggestions'],
    queryFn: marketplaceService.getSearchSuggestions,
    staleTime: 10 * 60 * 1000, // 10 minutes
  })

  if (isLoading || !suggestions) {
    return null
  }

  const { platforms, projects, postTypes } = suggestions

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-white/70 hover:text-white text-sm underline cursor-pointer"
      >
        Search suggestions
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 bg-white/10 backdrop-blur-md rounded-lg p-4 min-w-[300px] z-50 border border-white/20">
          <div className="space-y-4">
            {/* Platforms */}
            {platforms.length > 0 && (
              <div>
                <h4 className="text-white font-semibold text-sm mb-2">Platforms</h4>
                <div className="flex flex-wrap gap-2">
                  {platforms.map((platform) => (
                    <button
                      key={platform}
                      onClick={() => {
                        onSelectSuggestion('platform', platform)
                        setIsOpen(false)
                      }}
                      className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-xs rounded-full transition-colors"
                    >
                      {platform}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Projects */}
            {projects.length > 0 && (
              <div>
                <h4 className="text-white font-semibold text-sm mb-2">Projects</h4>
                <div className="flex flex-wrap gap-2">
                  {projects.map((project) => (
                    <button
                      key={project}
                      onClick={() => {
                        onSelectSuggestion('project', project)
                        setIsOpen(false)
                      }}
                      className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-xs rounded-full transition-colors"
                    >
                      {project}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Post Types */}
            {postTypes.length > 0 && (
              <div>
                <h4 className="text-white font-semibold text-sm mb-2">Post Types</h4>
                <div className="flex flex-wrap gap-2">
                  {postTypes.map((postType) => (
                    <button
                      key={postType}
                      onClick={() => {
                        onSelectSuggestion('postType', postType)
                        setIsOpen(false)
                      }}
                      className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-xs rounded-full transition-colors"
                    >
                      {postType}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
