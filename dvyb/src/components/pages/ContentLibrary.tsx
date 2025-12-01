"use client";


import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Filter, Eye, Heart, MessageCircle, Share2, Loader2, Play, Calendar as CalendarIcon } from "lucide-react";
import { PostDetailDialog } from "@/components/calendar/PostDetailDialog";
import { contentLibraryApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";

interface PlatformAnalytics {
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

interface ContentItem {
  id: string;
  contentId: number; // For linking to generated content
  postIndex: number; // Index within generated content
  date: string;
  time: string;
  type: "Post" | "Story";
  platforms: string[];
  title: string;
  description: string; // Truncated for UI display
  fullPlatformTexts?: any; // Full platform texts for posting (not truncated)
  image: string;
  status: "scheduled" | "generated" | "published" | "not-selected" | "posted";
  selected?: boolean;
  analytics?: PlatformAnalytics[];
  createdAt?: string;
  requestedPlatforms?: string[];
  allCaptions?: string;
}

interface ContentLibraryProps {
  onEditDesignModeChange?: (isEditMode: boolean) => void;
}

export const ContentLibrary = ({ onEditDesignModeChange }: ContentLibraryProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPost, setSelectedPost] = useState<ContentItem | null>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [showPosted, setShowPosted] = useState(false);
  const [showAnalyticsDialog, setShowAnalyticsDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [scheduledItems, setScheduledItems] = useState<ContentItem[]>([]); // Separate state for all scheduled
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { accountId } = useAuth();
  
  // Ref for infinite scroll observer
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Fetch content library data
  const fetchContentLibrary = useCallback(async (pageNum: number, append: boolean = false) => {
    if (!accountId) {
      setIsLoading(false);
      return;
    }

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      const response = await contentLibraryApi.getContentLibrary({
        page: pageNum,
        limit: 12,
        search: searchQuery,
        dateFrom: dateRange?.from?.toISOString(),
        dateTo: dateRange?.to?.toISOString(),
        showPosted,
      });
      
      if (response.success && response.data) {
        const { scheduled, notSelected, posted } = response.data;
        const pagination = response.pagination || {};
        const moreAvailable = pagination.hasMore || false;
          
          // Transform backend data to ContentItem format
          const transformContent = (item: any, status: string): ContentItem => {
            // Get platform text for this specific post
            const platformText = item.platformText || {};
            
            // Extract title from topic or first caption
            const title = platformText.topic || 
                         (platformText.platforms?.instagram || 
                          platformText.platforms?.twitter ||
                          platformText.platforms?.linkedin ||
                          platformText.platforms?.tiktok || 
                          'Untitled Post').substring(0, 60);
            
            // Extract description
            const description = platformText.platforms?.instagram || 
                               platformText.platforms?.twitter ||
                               platformText.platforms?.linkedin ||
                               platformText.platforms?.tiktok || 
                               '';
            
            // Collect all platform captions for search
            const allCaptions = [
              platformText.topic || '',
              platformText.platforms?.instagram || '',
              platformText.platforms?.twitter || '',
              platformText.platforms?.linkedin || '',
              platformText.platforms?.tiktok || '',
            ].join(' ');
            
            // Media URL is already set for this specific post
            const mediaUrl = item.mediaUrl || '';
            
            // Format date and time if scheduled
            let dateStr = '';
            let timeStr = '';
            if (item.scheduledFor) {
              const schedDate = new Date(item.scheduledFor);
              dateStr = schedDate.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                weekday: 'short' 
              });
              timeStr = schedDate.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
              });
            }
            
            return {
              id: item.id.toString(),
              contentId: item.contentId, // For linking to generated content
              postIndex: item.postIndex, // Index within generated content
              date: dateStr,
              time: timeStr,
              type: "Post",
              platforms: item.requestedPlatforms || [],
              title,
              description: description.substring(0, 100) + (description.length > 100 ? '...' : ''), // Truncated for UI
              fullPlatformTexts: platformText.platforms, // FULL text for posting (not truncated)
              image: mediaUrl,
              status: status as any,
              selected: status === 'not-selected' ? false : undefined,
              analytics: item.analytics || undefined,
              createdAt: item.createdAt,
              requestedPlatforms: item.requestedPlatforms || [],
              allCaptions, // Store all captions for search
            };
          };
          
          // Transform scheduled content (always replace, not append)
          const scheduledTransformed = scheduled.map((item: any) => transformContent(item, 'scheduled'));
          
          // For first page load or filter change, set scheduled items
          if (!append) {
            setScheduledItems(scheduledTransformed);
          } else {
            // On infinite scroll, append any new scheduled items
            setScheduledItems(prev => {
              const existingIds = new Set(prev.map(item => item.id));
              const newScheduled = scheduledTransformed.filter(item => !existingIds.has(item.id));
              return [...prev, ...newScheduled];
            });
          }
          
          // Combine not-selected and posted content for pagination
          const newContent = [
            ...notSelected.map((item: any) => transformContent(item, 'not-selected')),
            ...posted.map((item: any) => transformContent(item, 'published')),
          ];
          
          if (append) {
            setContentItems(prev => [...prev, ...newContent]);
          } else {
            setContentItems(newContent);
          }
          
          setHasMore(moreAvailable);
        }
      } catch (error) {
        console.error("Failed to fetch content library:", error);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }, [accountId, searchQuery, dateRange, showPosted]);

  // Handler to refresh content after scheduling
  const handleRefreshAfterSchedule = useCallback(() => {
    // Reset to page 1 and fetch fresh data
    setPage(1);
    setHasMore(true);
    setContentItems([]);
    setScheduledItems([]); // Also clear scheduled items
    fetchContentLibrary(1, false);
  }, [fetchContentLibrary]);

  // Initial load - reset when filters change
  useEffect(() => {
    setPage(1);
    setContentItems([]);
    setScheduledItems([]); // Also clear scheduled items
    fetchContentLibrary(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, searchQuery, dateRange, showPosted]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isLoading) {
          const nextPage = page + 1;
          setPage(nextPage);
          fetchContentLibrary(nextPage, true);
        }
      },
      { threshold: 0.1 }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMore, isLoadingMore, isLoading, page, fetchContentLibrary]);

  // Use separate scheduledItems state (always shows all scheduled posts)
  const scheduledContent = scheduledItems;
  // contentItems only contains not-selected and posted (for infinite scroll)
  const notSelectedContent = contentItems.filter(item => item.status === "not-selected");
  const postedContent = contentItems.filter(item => item.status === "published");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "bg-blue-500";
      case "generated":
        return "bg-green-500";
      case "published":
        return "bg-purple-500";
      case "not-selected":
        return "bg-orange-500";
      default:
        return "bg-gray-500";
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k";
    }
    return num.toString();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Content Library</h1>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 md:gap-4 w-full md:w-auto">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Posted Content</span>
                <Switch checked={showPosted} onCheckedChange={setShowPosted} />
              </div>
              
              {/* Date Range Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-[240px] justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange?.from && dateRange?.to
                      ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`
                      : dateRange?.from
                      ? `From ${format(dateRange.from, "MMM d, yyyy")}`
                      : dateRange?.to
                      ? `Until ${format(dateRange.to, "MMM d, yyyy")}`
                      : "All dates"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <div className="p-3">
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={setDateRange}
                      numberOfMonths={1}
                      initialFocus
                    />
                    <div className="flex gap-2 pt-3 border-t mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          setDateRange(undefined);
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              
              <div className="relative w-full sm:w-64 md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search content..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button variant="outline" className="hidden w-full sm:w-auto">
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Content Grid */}
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
        {showPosted ? (
          // Posted Content as Cards
          <>
            {postedContent.length === 0 && !isLoading ? (
              <div className="text-center py-16">
                <p className="text-muted-foreground">No posted content found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {postedContent.map((item) => (
                  <Card
                    key={item.id}
                    className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                    onClick={() => {
                      setSelectedPost(item);
                      setShowAnalyticsDialog(true);
                    }}
                  >
                    <div className="relative">
                      {item.image && (item.image.includes('video') || item.image.includes('.mp4')) ? (
                        <>
                          <video
                            src={item.image}
                            className="w-full aspect-square object-cover"
                            muted
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Play className="h-12 w-12 text-white" fill="white" />
                          </div>
                        </>
                      ) : (
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full aspect-square object-cover group-hover:scale-105 transition-transform"
                        />
                      )}
                      <Badge
                        className={`absolute top-2 right-2 ${getStatusColor(item.status)}`}
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          {item.platforms.includes("instagram") && (
                            <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                          )}
                          {item.platforms.includes("twitter") && (
                            <div className="w-5 h-5 rounded bg-black" />
                          )}
                          {item.platforms.includes("linkedin") && (
                            <div className="w-5 h-5 rounded bg-blue-600" />
                          )}
                          {item.platforms.includes("tiktok") && (
                            <div className="w-5 h-5 rounded bg-black" />
                          )}
                        </div>
                        <span className="text-xs font-medium">{item.type}</span>
                      </div>
                      <h3 className="font-semibold text-sm line-clamp-2">{item.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.date} at {item.time}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : (
          // Scheduled and Not Selected Content
          <>
            {/* Scheduled Section - Always visible */}
            <div className="mb-6 md:mb-8">
              <h2 className="text-lg md:text-xl font-semibold mb-3 md:mb-4">
                Scheduled {isLoading ? '' : `(${scheduledContent.length})`}
              </h2>
              {scheduledContent.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {scheduledContent.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => {
                        setSelectedPost(item);
                        setShowPostDetail(true);
                      }}
                    >
                      <div className="relative">
                        {item.image && (item.image.includes('video') || item.image.includes('.mp4')) ? (
                          <>
                            <video
                              src={item.image}
                              className="w-full aspect-square object-cover"
                              muted
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Play className="h-12 w-12 text-white" fill="white" />
                            </div>
                          </>
                        ) : (
                          <img
                            src={item.image}
                            alt={item.title}
                            className="w-full aspect-square object-cover group-hover:scale-105 transition-transform"
                          />
                        )}
                        <Badge
                          className={`absolute top-2 right-2 ${getStatusColor(item.status)}`}
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <div className="p-3 md:p-4 space-y-2 md:space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            {item.platforms.includes("instagram") && (
                              <div className="w-4 h-4 md:w-5 md:h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                            )}
                            {item.platforms.includes("twitter") && (
                              <div className="w-4 h-4 md:w-5 md:h-5 rounded bg-black" />
                            )}
                            {item.platforms.includes("linkedin") && (
                              <div className="w-4 h-4 md:w-5 md:h-5 rounded bg-blue-600" />
                            )}
                            {item.platforms.includes("tiktok") && (
                              <div className="w-4 h-4 md:w-5 md:h-5 rounded bg-black" />
                            )}
                          </div>
                          <span className="text-xs font-medium">{item.type}</span>
                        </div>
                        <h3 className="font-semibold text-sm md:text-base line-clamp-2">{item.title}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.date} at {item.time}
                        </p>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 md:py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <p className="text-gray-500 text-sm md:text-base font-medium">No posts scheduled</p>
                  <p className="text-gray-400 text-xs md:text-sm mt-2">Schedule posts from the "Not Selected" section below</p>
                </div>
              )}
            </div>

            {/* Not Selected Section - Always visible */}
            <div>
              <h2 className="text-lg md:text-xl font-semibold mb-3 md:mb-4">Not Selected ({notSelectedContent.length})</h2>
              {notSelectedContent.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {notSelectedContent.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => {
                        setSelectedPost(item);
                        setShowPostDetail(true);
                      }}
                    >
                      <div className="relative">
                        {item.image && (item.image.includes('video') || item.image.includes('.mp4')) ? (
                          <>
                            <video
                              src={item.image}
                              className="w-full aspect-square object-cover"
                              muted
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Play className="h-12 w-12 text-white" fill="white" />
                            </div>
                          </>
                        ) : (
                          <img
                            src={item.image}
                            alt={item.title}
                            className="w-full aspect-square object-cover group-hover:scale-105 transition-transform"
                          />
                        )}
                        <Badge
                          className={`absolute top-2 right-2 ${getStatusColor(item.status)}`}
                        >
                          not selected
                        </Badge>
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            {item.platforms.includes("instagram") && (
                              <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                            )}
                            {item.platforms.includes("twitter") && (
                              <div className="w-5 h-5 rounded bg-black" />
                            )}
                            {item.platforms.includes("linkedin") && (
                              <div className="w-5 h-5 rounded bg-blue-600" />
                            )}
                            {item.platforms.includes("tiktok") && (
                              <div className="w-5 h-5 rounded bg-black" />
                            )}
                          </div>
                          <span className="text-xs font-medium">{item.type}</span>
                        </div>
                        <h3 className="font-semibold text-sm line-clamp-2">{item.title}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.description}
                        </p>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 md:py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <p className="text-gray-500 text-sm md:text-base font-medium">No unscheduled posts</p>
                  <p className="text-gray-400 text-xs md:text-sm mt-2">All generated content has been scheduled or posted</p>
                </div>
              )}
            </div>

            {(scheduledContent.length === 0 && notSelectedContent.length === 0) && !isLoading && (
              <div className="text-center py-16">
                <p className="text-muted-foreground">No content found</p>
              </div>
            )}
          </>
        )}
        
        {/* Infinite Scroll Trigger - Always at bottom */}
        {hasMore && !isLoading && (
          <div ref={loadMoreRef} className="flex justify-center py-8">
            {isLoadingMore && (
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            )}
          </div>
        )}
        
        {/* Loading State */}
        {isLoading && page === 1 && (
          <div className="flex justify-center items-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
      </div>

      <PostDetailDialog
        post={selectedPost}
        open={showPostDetail}
        onOpenChange={setShowPostDetail}
        onEditDesignModeChange={onEditDesignModeChange}
        onScheduleComplete={handleRefreshAfterSchedule}
      />

      {/* Analytics Dialog */}
      <Dialog open={showAnalyticsDialog} onOpenChange={setShowAnalyticsDialog}>
        <DialogContent className="w-[95vw] max-w-2xl h-auto max-h-[90vh] overflow-y-auto p-4 md:p-6">
          {selectedPost && (
            <div className="space-y-4 md:space-y-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="w-full sm:w-32 h-32 rounded overflow-hidden bg-gray-100 relative">
                  {selectedPost.image && (selectedPost.image.includes('video') || selectedPost.image.includes('.mp4')) ? (
                    <>
                      <video
                        src={selectedPost.image}
                        className="w-full h-full object-cover"
                        muted
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Play className="h-8 w-8 text-white" fill="white" />
                      </div>
                    </>
                  ) : (
                    <img
                      src={selectedPost.image}
                      alt={selectedPost.title}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1">
                  <h2 className="text-xl md:text-2xl font-bold mb-2">{selectedPost.title}</h2>
                  <p className="text-sm md:text-base text-muted-foreground mb-3">{selectedPost.description}</p>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    <div className="flex items-center gap-1">
                      {selectedPost.platforms.includes("instagram") && (
                        <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                      )}
                      {selectedPost.platforms.includes("twitter") && (
                        <div className="w-5 h-5 rounded bg-black" />
                      )}
                      {selectedPost.platforms.includes("linkedin") && (
                        <div className="w-5 h-5 rounded bg-blue-600" />
                      )}
                      {selectedPost.platforms.includes("tiktok") && (
                        <div className="w-5 h-5 rounded bg-black" />
                      )}
                    </div>
                    <span className="text-xs md:text-sm text-muted-foreground">
                      Posted on {selectedPost.date} at {selectedPost.time}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 md:pt-6">
                <h3 className="text-lg md:text-xl font-semibold mb-3 md:mb-4">Analytics</h3>
                <div className="space-y-4 md:space-y-6">
                  {selectedPost.analytics?.map((analytics) => (
                    <div key={analytics.platform} className="space-y-2 md:space-y-3">
                      <div className="flex items-center gap-2">
                        {analytics.platform === "instagram" && (
                          <div className="w-5 h-5 md:w-6 md:h-6 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                        )}
                        {analytics.platform === "twitter" && (
                          <div className="w-5 h-5 md:w-6 md:h-6 rounded bg-black" />
                        )}
                        {analytics.platform === "linkedin" && (
                          <div className="w-5 h-5 md:w-6 md:h-6 rounded bg-blue-600" />
                        )}
                        {analytics.platform === "tiktok" && (
                          <div className="w-5 h-5 md:w-6 md:h-6 rounded bg-black" />
                        )}
                        <span className="font-medium capitalize text-sm md:text-base">{analytics.platform}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                        <div className="bg-muted/50 p-3 md:p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Eye className="w-3 h-3 md:w-4 md:h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Views</span>
                          </div>
                          <p className="text-xl md:text-2xl font-bold">{formatNumber(analytics.views)}</p>
                        </div>
                        <div className="bg-muted/50 p-3 md:p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Heart className="w-3 h-3 md:w-4 md:h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Likes</span>
                          </div>
                          <p className="text-xl md:text-2xl font-bold">{formatNumber(analytics.likes)}</p>
                        </div>
                        <div className="bg-muted/50 p-3 md:p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageCircle className="w-3 h-3 md:w-4 md:h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Comments</span>
                          </div>
                          <p className="text-xl md:text-2xl font-bold">{formatNumber(analytics.comments)}</p>
                        </div>
                        <div className="bg-muted/50 p-3 md:p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Share2 className="w-3 h-3 md:w-4 md:h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Shares</span>
                          </div>
                          <p className="text-xl md:text-2xl font-bold">{formatNumber(analytics.shares)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
