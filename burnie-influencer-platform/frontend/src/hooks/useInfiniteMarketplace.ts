import { useState, useEffect, useCallback, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import marketplaceService, { type MarketplaceParams, type MarketplaceResponse } from '../services/marketplaceService'

interface UseInfiniteMarketplaceOptions {
  search?: string
  platform_source?: string
  project_name?: string
  post_type?: string
  sort_by?: string
  limit?: number
}

export function useInfiniteMarketplace(options: UseInfiniteMarketplaceOptions = {}) {
  const {
    search = '',
    platform_source,
    project_name,
    post_type,
    sort_by = 'bidding_enabled',
    limit = 18
  } = options

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch
  } = useInfiniteQuery({
    queryKey: ['marketplace', search, platform_source, project_name, post_type, sort_by, limit],
    queryFn: async ({ pageParam = 1 }) => {
      const params: MarketplaceParams = {
        page: pageParam,
        limit,
        sort_by
      }

      if (search.trim()) params.search = search.trim()
      if (platform_source && platform_source !== 'all') params.platform_source = platform_source
      if (project_name && project_name !== 'all') params.project_name = project_name
      if (post_type && post_type !== 'all') params.post_type = post_type

      return marketplaceService.getContent(params)
    },
    getNextPageParam: (lastPage: MarketplaceResponse) => {
      return lastPage.pagination.hasNextPage ? lastPage.pagination.nextPage : undefined
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })

  // Flatten all pages into a single array
  const allContent = data?.pages.flatMap(page => page.data) || []

  // Get pagination info from the last page
  const pagination = data?.pages[data.pages.length - 1]?.pagination

  // Load more content when scrolling
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Intersection observer for infinite scroll
  const observerRef = useRef<IntersectionObserver>()
  const lastElementRef = useCallback((node: HTMLElement | null) => {
    if (isLoading) return

    if (observerRef.current) observerRef.current.disconnect()

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage) {
        loadMore()
      }
    })

    if (node) observerRef.current.observe(node)
  }, [isLoading, hasNextPage, loadMore])

  // Reset when search/filters change
  useEffect(() => {
    refetch()
  }, [search, platform_source, project_name, post_type, sort_by, refetch])

  return {
    content: allContent,
    pagination,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    loadMore,
    lastElementRef,
    refetch
  }
}
