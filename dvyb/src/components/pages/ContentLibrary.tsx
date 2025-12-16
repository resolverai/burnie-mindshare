"use client";


import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Filter, Eye, Heart, MessageCircle, Share2, Loader2, Play, Calendar as CalendarIcon, Sparkles } from "lucide-react";
import { PostDetailDialog } from "@/components/calendar/PostDetailDialog";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";
import { PricingModal } from "@/components/PricingModal";
import { contentLibraryApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";
import { clearOAuthFlowState, getOAuthFlowState } from "@/lib/oauthFlowState";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { 
  trackContentLibraryViewed, 
  trackContentItemClicked, 
  trackGenerateContentClicked,
  trackContentSearched,
} from "@/lib/mixpanel";

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
  originalMediaUrl?: string; // S3 key for image edits
  status: "scheduled" | "generated" | "published" | "not-selected" | "posted" | "selected" | "pending-review";
  selected?: boolean;
  analytics?: PlatformAnalytics[];
  createdAt?: string;
  requestedPlatforms?: string[];
  allCaptions?: string;
  videoModel?: string | null; // Model used for video generation (for aspect ratio)
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
  const [selectedItems, setSelectedItems] = useState<ContentItem[]>([]); // Selected/accepted content
  const [pendingReviewItems, setPendingReviewItems] = useState<ContentItem[]>([]); // Content pending review
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { accountId } = useAuth();
  
  // Generate Content Dialog state
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [onboardingJobId, setOnboardingJobId] = useState<string | null>(null);
  
  // Usage limit and pricing modal
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [quotaType, setQuotaType] = useState<'image' | 'video' | 'both'>('both');
  const [showInactiveAccountDialog, setShowInactiveAccountDialog] = useState(false);
  const [usageData, setUsageData] = useState<any>(null);
  const [canSkipPricingModal, setCanSkipPricingModal] = useState(false); // True if only one quota exhausted
  
  // Onboarding guide
  const { completeStep } = useOnboardingGuide();
  
  // Toast
  const { toast } = useToast();
  
  // Ref for infinite scroll observer
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  // PRIORITY CHECK: Onboarding generation job (auto-open dialog for new users)
  useEffect(() => {
    const storedJobId = localStorage.getItem('dvyb_onboarding_generation_job_id');
    if (storedJobId) {
      console.log('🎉 [PRIORITY] Onboarding generation detected on Content Library:', storedJobId);
      
      // Set a synchronous flag to prevent other checks from interfering
      localStorage.setItem('dvyb_onboarding_dialog_pending', 'true');
      
      // Clear any stale OAuth flow state
      clearOAuthFlowState();
      localStorage.removeItem('dvyb_oauth_success');
      
      // Store in state for dialog
      setOnboardingJobId(storedJobId);
      
      // Clear the job ID flag immediately to prevent re-opening on reload
      localStorage.removeItem('dvyb_onboarding_generation_job_id');
      
      // Mark auto_content_viewed as complete
      completeStep('auto_content_viewed');
      
      // Open dialog after a delay to ensure page is ready
      setTimeout(() => {
        console.log('🎉 Opening GenerateContentDialog for onboarding on Content Library...');
        setShowGenerateDialog(true);
        // Clear the pending flag once dialog is opened
        localStorage.removeItem('dvyb_onboarding_dialog_pending');
      }, 800);
    }
  }, []); // Run once on mount

  // Track if we've already processed OAuth on this mount
  const oauthProcessedRef = useRef(false);
  
  // Check for OAuth flow state (returning from authorization)
  useEffect(() => {
    // Skip if onboarding dialog is pending
    if (localStorage.getItem('dvyb_onboarding_dialog_pending') === 'true') {
      return;
    }
    
    // Prevent double-processing in React Strict Mode
    if (oauthProcessedRef.current) {
      console.log('🔄 [ContentLibrary] OAuth already processed, skipping...');
      return;
    }
    
    // Check for OAuth success (user just returned from authorization)
    const oauthSuccessStr = localStorage.getItem('dvyb_oauth_success');
    const flowState = getOAuthFlowState();
    
    console.log('🔍 [ContentLibrary] Checking OAuth state:', { 
      hasOAuthSuccess: !!oauthSuccessStr, 
      hasFlowState: !!flowState,
      flowSource: flowState?.source 
    });
    
    if (!oauthSuccessStr) {
      return; // No OAuth success, nothing to do
    }
    
    // Only handle if flow was initiated from content library
    if (flowState && flowState.source === 'content_library') {
      // Mark as processed
      oauthProcessedRef.current = true;
      
      console.log('🔄 [ContentLibrary] OAuth success detected, resuming flow...', flowState);
      
      try {
        const oauthSuccess = JSON.parse(oauthSuccessStr);
        
        // Show success toast
        toast({
          title: `${oauthSuccess.platform.charAt(0).toUpperCase() + oauthSuccess.platform.slice(1)} Connected`,
          description: oauthSuccess.message,
        });
      } catch (e) {
        console.error('Error parsing OAuth success:', e);
      }
      
      // Clear the success flag
      localStorage.removeItem('dvyb_oauth_success');
      
      // Open dialog after a short delay for better UX
      setTimeout(() => {
        console.log('🎉 [ContentLibrary] Opening GenerateContentDialog to complete post/schedule flow...');
        setShowGenerateDialog(true);
      }, 300);
    } else if (flowState && flowState.source !== 'content_library') {
      // Flow was initiated from another page - don't handle here
      console.log('⚠️ [ContentLibrary] OAuth flow from different source, ignoring...');
    } else {
      // OAuth success but no flow state - just clear the flag
      console.log('✅ [ContentLibrary] OAuth success without pending flow');
      localStorage.removeItem('dvyb_oauth_success');
    }
  }, []); // Run once on mount

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
        const { scheduled, selected, pendingReview, notSelected, posted } = response.data;
        const pagination = response.pagination || {};
        const moreAvailable = pagination.hasMore || false;
          
          // Transform backend data to ContentItem format
          const transformContent = (item: any, status: string): ContentItem => {
            // Get platform text for this specific post
            const platformText = item.platformText || {};
            const requestedPlatforms = item.requestedPlatforms || [];
            const editedCaptions = item.editedCaptions || {};
            
            // Helper to get caption for a platform (prioritize edited captions)
            const getCaptionForPlatform = (platform: string): string => {
              // First check edited captions (highest priority)
              if (editedCaptions[platform]) {
                return editedCaptions[platform];
              }
              // Then check platformText.platforms (system-generated, may also have edited merged in)
              if (platformText.platforms?.[platform]) {
                return platformText.platforms[platform];
              }
              return '';
            };
            
            // Get caption based on first requested platform, then fall back to any available
            const getDescription = (): string => {
              // First try requested platforms in order
              for (const platform of requestedPlatforms) {
                const caption = getCaptionForPlatform(platform.toLowerCase());
                if (caption) return caption;
              }
              // Fall back to any available platform
              const fallbackOrder = ['twitter', 'instagram', 'linkedin', 'tiktok'];
              for (const platform of fallbackOrder) {
                const caption = getCaptionForPlatform(platform);
                if (caption) return caption;
              }
              return '';
            };
            
            const description = getDescription();
            
            // Extract title from topic or first caption (using same logic)
            const title = platformText.topic || description.substring(0, 60) || 'Untitled Post';
            
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
              originalMediaUrl: item.originalMediaUrl || '', // S3 key for image edits
              status: status as any,
              selected: status === 'not-selected' ? false : undefined,
              analytics: item.analytics || undefined,
              createdAt: item.createdAt,
              requestedPlatforms: item.requestedPlatforms || [],
              allCaptions, // Store all captions for search
              videoModel: item.videoModel || null, // Video model for aspect ratio (kling = 1:1, veo3 = 9:16)
            };
          };
          
          // Transform scheduled content (always replace, not append)
          const scheduledTransformed = (scheduled || []).map((item: any) => transformContent(item, 'scheduled'));
          
          // Transform selected content
          const selectedTransformed = (selected || []).map((item: any) => transformContent(item, 'selected'));
          
          // Transform pending review content
          const pendingReviewTransformed = (pendingReview || []).map((item: any) => transformContent(item, 'pending-review'));
          
          // For first page load or filter change, set all category items
          if (!append) {
            setScheduledItems(scheduledTransformed);
            setSelectedItems(selectedTransformed);
            setPendingReviewItems(pendingReviewTransformed);
          } else {
            // On infinite scroll, append any new items
            setScheduledItems(prev => {
              const existingIds = new Set(prev.map(item => item.id));
              const newScheduled = scheduledTransformed.filter(item => !existingIds.has(item.id));
              return [...prev, ...newScheduled];
            });
            setSelectedItems(prev => {
              const existingIds = new Set(prev.map(item => item.id));
              const newSelected = selectedTransformed.filter(item => !existingIds.has(item.id));
              return [...prev, ...newSelected];
            });
            setPendingReviewItems(prev => {
              const existingIds = new Set(prev.map(item => item.id));
              const newPendingReview = pendingReviewTransformed.filter(item => !existingIds.has(item.id));
              return [...prev, ...newPendingReview];
            });
          }
          
          // Combine not-selected and posted content for pagination
          const newContent = [
            ...(notSelected || []).map((item: any) => transformContent(item, 'not-selected')),
            ...(posted || []).map((item: any) => transformContent(item, 'published')),
          ];
          
          if (append) {
            // Deduplicate on append to prevent showing same items twice
            setContentItems(prev => {
              const existingIds = new Set(prev.map(item => item.id));
              const deduplicatedNew = newContent.filter(item => !existingIds.has(item.id));
              return [...prev, ...deduplicatedNew];
            });
          } else {
            setContentItems(newContent);
          }
          
          setHasMore(moreAvailable);
          
          // Track search if there's a search query (only on first page, not on infinite scroll append)
          if (searchQuery && !append) {
            const totalResults = scheduledTransformed.length + selectedTransformed.length + pendingReviewTransformed.length + newContent.length;
            trackContentSearched(searchQuery, totalResults);
          }
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
    setScheduledItems([]);
    setSelectedItems([]);
    setPendingReviewItems([]);
    fetchContentLibrary(1, false);
  }, [fetchContentLibrary]);

  // Initial load - reset when filters change
  useEffect(() => {
    setPage(1);
    setContentItems([]);
    setScheduledItems([]);
    setSelectedItems([]);
    setPendingReviewItems([]);
    fetchContentLibrary(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, searchQuery, dateRange, showPosted]);

  // Track page view
  useEffect(() => {
    trackContentLibraryViewed();
  }, []);

  // Infinite scroll observer - use refs to avoid recreating observer on every state change
  const hasMoreRef = useRef(hasMore);
  const isLoadingMoreRef = useRef(isLoadingMore);
  const isLoadingRef = useRef(isLoading);
  const pageRef = useRef(page);
  
  // Keep refs in sync with state
  useEffect(() => {
    hasMoreRef.current = hasMore;
    isLoadingMoreRef.current = isLoadingMore;
    isLoadingRef.current = isLoading;
    pageRef.current = page;
  }, [hasMore, isLoadingMore, isLoading, page]);

  // Set up observer once
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && 
            hasMoreRef.current && 
            !isLoadingMoreRef.current && 
            !isLoadingRef.current) {
          const nextPage = pageRef.current + 1;
          setPage(nextPage);
          fetchContentLibrary(nextPage, true);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
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
  }, [fetchContentLibrary]); // Only recreate when fetchContentLibrary changes

  // Use separate state for each category (shows all items in each category)
  // Order: Scheduled, Selected, Pending Review, Not Selected
  const scheduledContent = scheduledItems;
  const selectedContent = selectedItems;
  const pendingReviewContent = pendingReviewItems;
  // contentItems only contains not-selected and posted (for infinite scroll)
  const notSelectedContent = contentItems.filter(item => item.status === "not-selected");
  const postedContent = contentItems.filter(item => item.status === "published");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "bg-primary";
      case "selected":
        return "bg-emerald-500";
      case "pending-review":
        return "bg-amber-500";
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

  // Refresh content after generation
  const handleGenerationComplete = () => {
    // Reset pagination and refetch ALL category states
    setPage(1);
    setContentItems([]);
    setScheduledItems([]);
    setSelectedItems([]);
    setPendingReviewItems([]);
    fetchContentLibrary(1, false);
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
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 pb-24">
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
                      trackContentItemClicked(item.contentId, item.image?.includes('.mp4') ? 'video' : 'image', 'posted');
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
                        trackContentItemClicked(item.contentId, item.image?.includes('.mp4') ? 'video' : 'image', 'scheduled');
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
                  <p className="text-gray-400 text-xs md:text-sm mt-2">Schedule posts from the "Selected" or "Pending Review" sections below</p>
              </div>
            )}
            </div>

            {/* Selected Section */}
            {selectedContent.length > 0 && (
              <div className="mb-6 md:mb-8">
                <h2 className="text-lg md:text-xl font-semibold mb-3 md:mb-4">
                  Selected {isLoading ? '' : `(${selectedContent.length})`}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {selectedContent.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => {
                        trackContentItemClicked(item.contentId, item.image?.includes('.mp4') ? 'video' : 'image', 'selected');
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
                          selected
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
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Review Section */}
            {pendingReviewContent.length > 0 && (
              <div className="mb-6 md:mb-8">
                <h2 className="text-lg md:text-xl font-semibold mb-3 md:mb-4">
                  Pending Review {isLoading ? '' : `(${pendingReviewContent.length})`}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {pendingReviewContent.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => {
                        trackContentItemClicked(item.contentId, item.image?.includes('.mp4') ? 'video' : 'image', 'pending-review');
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
                          pending review
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
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Not Selected Section */}
            {notSelectedContent.length > 0 && (
              <div className="mb-6 md:mb-8">
                <h2 className="text-lg md:text-xl font-semibold mb-3 md:mb-4">
                  Not Selected {isLoading ? '' : `(${notSelectedContent.length})`}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                  {notSelectedContent.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => {
                        trackContentItemClicked(item.contentId, item.image?.includes('.mp4') ? 'video' : 'image', 'not-selected');
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
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {(scheduledContent.length === 0 && selectedContent.length === 0 && pendingReviewContent.length === 0 && notSelectedContent.length === 0) && !isLoading && (
              <div className="text-center py-16">
                <p className="text-muted-foreground">No content found</p>
                <p className="text-muted-foreground text-sm mt-2">Generate some content to get started</p>
              </div>
            )}
          </>
        )}
        
        {/* Infinite Scroll Trigger - Always at bottom */}
        <div ref={loadMoreRef} className="flex justify-center py-8 min-h-[60px]">
          {isLoadingMore && (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          )}
          {!hasMore && !isLoading && contentItems.length > 0 && (
            <p className="text-sm text-muted-foreground">No more content to load</p>
          )}
        </div>
        
        {/* Loading State */}
        {isLoading && page === 1 && (
          <div className="flex justify-center items-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
      </div>

      <PostDetailDialog
        post={selectedPost ? {
          ...selectedPost,
          generatedContentId: selectedPost.contentId, // Map contentId to generatedContentId
        } : null}
        open={showPostDetail}
        onOpenChange={setShowPostDetail}
        onEditDesignModeChange={onEditDesignModeChange}
        onScheduleComplete={handleRefreshAfterSchedule}
        // Pending review functionality
        pendingReviewItems={pendingReviewContent.map(item => ({
          ...item,
          generatedContentId: item.contentId,
        }))}
        onAcceptReject={(accepted, post) => {
          // Remove the accepted/rejected item from the pending review list
          const remainingItems = pendingReviewContent.filter(item => item.id !== post.id);
          setPendingReviewItems(remainingItems);
          
          // If there are more items, show the next one
          if (remainingItems.length > 0) {
            // Find next item to show
            const currentIndex = pendingReviewContent.findIndex(item => item.id === post.id);
            const nextIndex = currentIndex < remainingItems.length ? currentIndex : 0;
            setSelectedPost({
              ...remainingItems[nextIndex],
              generatedContentId: remainingItems[nextIndex].contentId,
            } as any);
          }
        }}
        onAllReviewed={() => {
          // Refresh content library after all items reviewed
          handleRefreshAfterSchedule();
        }}
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

      {/* Generate Content Dialog */}
      <GenerateContentDialog 
        open={showGenerateDialog} 
        onOpenChange={(open) => {
          setShowGenerateDialog(open);
          // Clear onboarding job ID when dialog closes
          if (!open) {
            setOnboardingJobId(null);
            // Refresh content after generation
            handleGenerationComplete();
          }
        }}
        parentPage="content_library"
        initialJobId={onboardingJobId}
        onDialogClosed={() => {
          // Ensure onboarding steps are marked as completed
          completeStep('auto_content_viewed');
          completeStep('content_library_visited');
          // Refresh content
          handleGenerationComplete();
        }}
      />

      {/* Floating Generate Content Button - Always visible on scroll (all devices) */}
      <div className="fixed bottom-6 right-6 lg:right-20 z-50">
        {/* Mobile: round icon button */}
        <Button 
          onClick={async () => {
            // Track event
            trackGenerateContentClicked('content_library');
            
            // Check account status and usage limits
            try {
              const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/usage`, {
                credentials: 'include',
                headers: {
                  ...(() => {
                    const accountId = localStorage.getItem('dvyb_account_id');
                    return accountId ? { 'X-DVYB-Account-ID': accountId } : {};
                  })(),
                },
              });
              const data = await response.json();
              
              if (data.success && data.data) {
                setUsageData(data.data);
                
                // First check if account is active
                if (data.data.isAccountActive === false) {
                  setShowInactiveAccountDialog(true);
                  return;
                }
                
                // Check quota limits
                const noImagesLeft = data.data.remainingImages === 0;
                const noVideosLeft = data.data.remainingVideos === 0;
                
                if (noImagesLeft && noVideosLeft) {
                  // BOTH quotas exhausted - must upgrade, cannot skip
                  setQuotaType('both');
                  setCanSkipPricingModal(false);
                  setShowPricingModal(true);
                } else if (noImagesLeft && !noVideosLeft) {
                  // Only image quota exhausted - can skip and generate videos
                  setQuotaType('image');
                  setCanSkipPricingModal(true);
                  setShowPricingModal(true);
                } else if (noVideosLeft && !noImagesLeft) {
                  // Only video quota exhausted - can skip and generate images
                  setQuotaType('video');
                  setCanSkipPricingModal(true);
                  setShowPricingModal(true);
                } else {
                  setShowGenerateDialog(true);
                }
              }
            } catch (error) {
              console.error('Failed to check usage:', error);
              setShowGenerateDialog(true);
            }
          }}
          className="md:hidden btn-gradient-cta rounded-full h-14 w-14 p-0"
          size="icon"
        >
          <Sparkles className="w-6 h-6" />
        </Button>
        {/* Tablet/Desktop: full button with text */}
        <Button 
          onClick={async () => {
            // Track event
            trackGenerateContentClicked('content_library');
            
            // Check account status and usage limits
            try {
              const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/usage`, {
                credentials: 'include',
                headers: {
                  ...(() => {
                    const accountId = localStorage.getItem('dvyb_account_id');
                    return accountId ? { 'X-DVYB-Account-ID': accountId } : {};
                  })(),
                },
              });
              const data = await response.json();
              
              if (data.success && data.data) {
                setUsageData(data.data);
                
                // First check if account is active
                if (data.data.isAccountActive === false) {
                  setShowInactiveAccountDialog(true);
                  return;
                }
                
                // Check quota limits
                const noImagesLeft = data.data.remainingImages === 0;
                const noVideosLeft = data.data.remainingVideos === 0;
                
                if (noImagesLeft && noVideosLeft) {
                  // BOTH quotas exhausted - must upgrade, cannot skip
                  setQuotaType('both');
                  setCanSkipPricingModal(false);
                  setShowPricingModal(true);
                } else if (noImagesLeft && !noVideosLeft) {
                  // Only image quota exhausted - can skip and generate videos
                  setQuotaType('image');
                  setCanSkipPricingModal(true);
                  setShowPricingModal(true);
                } else if (noVideosLeft && !noImagesLeft) {
                  // Only video quota exhausted - can skip and generate images
                  setQuotaType('video');
                  setCanSkipPricingModal(true);
                  setShowPricingModal(true);
                } else {
                  setShowGenerateDialog(true);
                }
              }
            } catch (error) {
              console.error('Failed to check usage:', error);
              setShowGenerateDialog(true);
            }
          }}
          className="hidden md:flex btn-gradient-cta px-8 py-6 text-lg font-semibold"
        >
          <Sparkles className="w-6 h-6 mr-2" />
          Generate Content
        </Button>
      </div>

      {/* Full-screen Pricing Modal */}
      <PricingModal
        open={showPricingModal}
        onClose={() => {
          setShowPricingModal(false);
          // If user can skip (only one quota exhausted), proceed to generate
          if (canSkipPricingModal) {
            setShowGenerateDialog(true);
          }
        }}
        currentPlanInfo={usageData ? {
          planName: usageData.planName || 'Free Trial',
          planId: usageData.planId || null,
          monthlyPrice: usageData.monthlyPrice || 0,
          annualPrice: usageData.annualPrice || 0,
          billingCycle: usageData.billingCycle || 'monthly',
          isFreeTrialPlan: usageData.isFreeTrialPlan || false,
        } : null}
        quotaType={quotaType}
        isAuthenticated={true}
        canSkip={canSkipPricingModal}
        reason="quota_exhausted"
      />

      {/* Inactive Account Dialog */}
      <AlertDialog open={showInactiveAccountDialog} onOpenChange={setShowInactiveAccountDialog}>
        <AlertDialogContent className="w-[90vw] sm:w-[85vw] md:max-w-md p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-lg sm:text-xl">
              Account Not Active
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-center space-y-3 sm:space-y-4 pt-3 sm:pt-4">
                <p className="text-sm sm:text-base text-muted-foreground">
                  Your account is currently not active. Content generation is temporarily unavailable.
                </p>
                <p className="text-sm sm:text-base text-muted-foreground">
                  Please reach out to our support team to reactivate your account.
                </p>
                <div className="bg-primary/5 dark:bg-primary/10 p-3 sm:p-4 rounded-lg mt-3 sm:mt-4">
                  <p className="text-xs sm:text-sm text-muted-foreground mb-1">Contact Support:</p>
                  <a 
                    href="mailto:social@dvyb.ai" 
                    className="text-primary hover:text-primary/80 font-medium text-base sm:text-lg break-all"
                  >
                    social@dvyb.ai
                  </a>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="justify-center pt-2 sm:pt-4">
            <Button 
              onClick={() => setShowInactiveAccountDialog(false)}
              className="w-full sm:w-auto min-w-[120px]"
            >
              Close
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
