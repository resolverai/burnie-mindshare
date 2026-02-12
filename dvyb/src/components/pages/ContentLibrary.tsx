"use client";

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Search, Eye, Heart, MessageCircle, Share2, Loader2, Play, Sparkles, Grid3X3, List, Pencil, Download } from "lucide-react";
import { PostDetailDialog } from "@/components/calendar/PostDetailDialog";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";
import { CreateAdFlowModal } from "@/components/pages/CreateAdFlowModal";
import { PricingModal } from "@/components/PricingModal";
import { contentLibraryApi, accountApi, hasEditOrDownloadAccess } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";
import { clearOAuthFlowState, getOAuthFlowState } from "@/lib/oauthFlowState";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  trackContentLibraryViewed, 
  trackContentItemClicked, 
  trackGenerateContentClicked,
  trackMyContentSearch,
  trackMyContentFilterApplied,
  trackLimitsReached,
  trackContentEditClicked,
  trackContentDownloadClicked,
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

type ContentStateTab = "all" | "draft" | "scheduled" | "published";

interface ContentLibraryProps {
  onEditDesignModeChange?: (isEditMode: boolean) => void;
  hasActiveSubscription?: boolean;
  onShowPricingModal?: () => void;
}

export interface ContentLibraryRef {
  openCreateNew: () => void;
}

// Helper function to check if content has a draft in localStorage
const hasEditedDraft = (contentId: number, postIndex: number): boolean => {
  if (typeof window === 'undefined') return false;
  const storageKey = `video-edit-draft-${contentId}-${postIndex}`;
  const savedDraft = localStorage.getItem(storageKey);
  if (!savedDraft) return false;
  
  try {
    const draftData = JSON.parse(savedDraft);
    const savedAt = new Date(draftData.savedAt);
    const hoursSinceSave = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
    // Only show "Edited" if draft is recent (within 24 hours)
    return hoursSinceSave < 24;
  } catch {
    return false;
  }
};

/** Download content media - uses backend proxy to avoid CORS (like AdDetailModal download) */
const downloadMedia = async (item: {
  image: string;
  title: string;
  contentId: number;
  postIndex: number;
}): Promise<void> => {
  try {
    await contentLibraryApi.downloadContentMedia(item.contentId, item.postIndex, item.title);
  } catch {
    // Fallback: try direct fetch (may fail on CORS)
    const url = item.image;
    if (!url) return;
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();
      const isVideo = url.includes(".mp4") || url.includes("video");
      const ext = isVideo ? ".mp4" : "." + (url.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1]?.toLowerCase() || "png");
      const filename = (item.title || "content").replace(/[^a-z0-9]/gi, "_").slice(0, 40) + ext;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  }
};

const ContentLibraryInner = forwardRef<ContentLibraryRef, ContentLibraryProps>(({ onEditDesignModeChange, hasActiveSubscription = true, onShowPricingModal }, ref) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [contentStateTab, setContentStateTab] = useState<ContentStateTab>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedPost, setSelectedPost] = useState<ContentItem | null>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [openInEditDesignMode, setOpenInEditDesignMode] = useState(false);
  const [showAnalyticsDialog, setShowAnalyticsDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [scheduledItems, setScheduledItems] = useState<ContentItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<ContentItem[]>([]);
  const [pendingReviewItems, setPendingReviewItems] = useState<ContentItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { accountId } = useAuth();
  
  // Generate Content Dialog state (for onboarding/OAuth flows only)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [onboardingJobId, setOnboardingJobId] = useState<string | null>(null);
  // Create Ad Flow Modal (same as Discover "Create my own Ad" - replaces old Create New flow)
  const [showCreateAdFlow, setShowCreateAdFlow] = useState(false);
  
  // Usage limit and pricing modal
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [quotaType, setQuotaType] = useState<'image' | 'video' | 'both'>('both');
  const [showInactiveAccountDialog, setShowInactiveAccountDialog] = useState(false);
  const [usageData, setUsageData] = useState<any>(null);
  const [canSkipPricingModal, setCanSkipPricingModal] = useState(false); // True if only one quota exhausted
  const [mustSubscribeToFreemium, setMustSubscribeToFreemium] = useState(false); // True if opt-out trial required
  
  // Trial limit exceeded dialog
  const [showTrialLimitDialog, setShowTrialLimitDialog] = useState(false);
  const [isEndingTrial, setIsEndingTrial] = useState(false);
  // Upgrade modal for edit/regeneration (when user has subscription but over plan limit)
  const [showUpgradeModalForEdit, setShowUpgradeModalForEdit] = useState(false);
  
  // Onboarding guide
  const { completeStep } = useOnboardingGuide();
  
  // Toast
  const { toast } = useToast();
  
  // Ref for infinite scroll observer
  const loadMoreRef = useRef<HTMLDivElement>(null);
  
  // PRIORITY CHECK: Onboarding generation job (auto-open dialog for new users)
  // Skip for Flow 2 users who already saw their content on ProductShotGeneration screen
  useEffect(() => {
    // Check if user completed Flow 2 - they already saw their content, skip auto-dialog
    const flow2Complete = localStorage.getItem('dvyb_flow_2_complete');
    if (flow2Complete === 'true') {
      console.log('📦 Flow 2 complete - skipping auto GenerateContentDialog');
      localStorage.removeItem('dvyb_flow_2_complete');
      localStorage.removeItem('dvyb_onboarding_generation_job_id'); // Clean up if present
      return;
    }
    
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
        showAll: contentStateTab === "all",
        showPosted: contentStateTab === "published",
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
          
        }
      } catch (error) {
        console.error("Failed to fetch content library:", error);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }, [accountId, searchQuery, contentStateTab]);

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

  // When design is saved: close dialog, wait for backend to process, then refetch (user returns to My Ads with updated content)
  const handleDesignSaved = useCallback(() => {
    setShowPostDetail(false);
    setSelectedPost(null);
    setOpenInEditDesignMode(false);
    setTimeout(() => handleRefreshAfterSchedule(), 2500);
  }, [handleRefreshAfterSchedule]);

  // Initial load - reset when filters change
  useEffect(() => {
    setPage(1);
    setContentItems([]);
    setScheduledItems([]);
    setSelectedItems([]);
    setPendingReviewItems([]);
    fetchContentLibrary(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, searchQuery, contentStateTab]);

  // Track page view
  useEffect(() => {
    trackContentLibraryViewed();
  }, []);

  // Track search only when user stops typing (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim()) {
        trackMyContentSearch(searchQuery.trim(), "my-ads");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Track content state tab (filter) changes
  const prevContentStateTab = useRef(contentStateTab);
  useEffect(() => {
    if (prevContentStateTab.current !== contentStateTab) {
      trackMyContentFilterApplied("content_state", contentStateTab, "my-ads");
      prevContentStateTab.current = contentStateTab;
    }
  }, [contentStateTab]);

  // Track search only when user stops typing (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim()) {
        trackMyContentSearch(searchQuery.trim(), "my-ads");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [searchQuery, contentStateTab]);

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

  const formatStatusLabel = (status: string) => {
    switch (status) {
      case "pending-review":
        return "Pending review";
      case "not-selected":
        return "Draft";
      case "generated":
        return "Draft";
      default:
        return status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, " ");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "bg-sky-100 text-sky-700";
      case "selected":
        return "bg-emerald-100 text-emerald-700";
      case "pending-review":
        return "bg-amber-100 text-amber-800";
      case "generated":
        return "bg-gray-200 text-gray-600";
      case "published":
        return "bg-emerald-100 text-emerald-800";
      case "not-selected":
        return "bg-gray-200 text-gray-600";
      case "draft":
        return "bg-gray-200 text-gray-600";
      default:
        return "bg-gray-200 text-gray-600";
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

  const handleCreateNewClick = useCallback(async () => {
    trackGenerateContentClicked('content_library');
    try {
      const res = await accountApi.getUsage();
      if (res.success && res.data) {
        setUsageData(res.data);
        if (res.data.isAccountActive === false) {
          setShowInactiveAccountDialog(true);
          return;
        }
        if (res.data.isTrialLimitExceeded) {
          trackLimitsReached('content_library_trial', 'both');
          setShowTrialLimitDialog(true);
          return;
        }
        const noImagesLeft = res.data.remainingImages === 0;
        if (noImagesLeft) {
          trackLimitsReached('content_library_create', 'both');
          onShowPricingModal?.();
          return;
        }
      }
      setShowCreateAdFlow(true);
    } catch (error) {
      console.error('Failed to check usage:', error);
      setShowCreateAdFlow(true);
    }
  }, [onShowPricingModal]);

  useImperativeHandle(ref, () => ({
    openCreateNew: handleCreateNewClick,
  }), [handleCreateNewClick]);

  const handleShowUpgradeModalForEdit = useCallback(async () => {
    try {
      const res = await accountApi.getUsage();
      if (res.success && res.data) {
        setUsageData(res.data);
        setQuotaType("image");
        setCanSkipPricingModal(false);
        setMustSubscribeToFreemium(false);
        setShowUpgradeModalForEdit(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Flatten content by state tab for display
  // Draft = Pending Review + Selected + Not Selected
  const draftContent = [...pendingReviewItems, ...selectedContent, ...notSelectedContent].filter(Boolean);
  const allContent =
    contentStateTab === "all"
      ? [...scheduledContent, ...selectedContent, ...draftContent, ...postedContent]
      : contentStateTab === "draft"
        ? draftContent
        : contentStateTab === "scheduled"
          ? scheduledContent
          : contentStateTab === "published"
            ? postedContent
            : [];

  return (
    <div className="min-h-screen bg-[hsl(var(--app-content-bg))]">
      {/* Search + Content state tabs + View toggle (wander-style px-4) */}
      <div className="border-b border-border bg-[hsl(var(--app-content-bg))] px-4 py-4 lg:py-5">
        <div className="flex flex-col gap-4">
          {/* Search bar - same style as Discover */}
          <div className="w-full">
            <div className="flex items-center gap-3 px-4 py-2.5 max-w-2xl h-10 border border-[hsl(var(--discover-input-border))] rounded-full bg-[hsl(var(--app-content-bg))]">
              <Search className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-[hsl(var(--app-content-bg))] outline-none text-sm min-w-0 text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          {/* Content state tabs + grid/list toggle - hidden for now (functionality preserved) */}
          <div className="hidden flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-secondary rounded-full p-1">
              {(["all", "draft", "scheduled", "published"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setContentStateTab(tab);
                    trackMyContentFilterApplied("content_state", tab, "my-ads");
                  }}
                  className={`px-3 lg:px-4 py-2 rounded-full text-xs lg:text-sm font-medium transition-all capitalize ${
                    contentStateTab === tab ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
              {/* Grid vs List toggle - right next to Published tab */}
              <div className="flex items-center ml-1 pl-2 border-l border-border">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-2 rounded-md transition-colors ${viewMode === "grid" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  aria-label="Grid view"
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-2 rounded-md transition-colors ${viewMode === "list" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  aria-label="List view"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content Grid (wander-style px-4) */}
      <div className="px-4 py-4 lg:py-5 pb-24">
        {allContent.length === 0 && !isLoading ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No content found</p>
          </div>
        ) : viewMode === "list" ? (
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-secondary/50 text-left text-sm text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Content</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allContent.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-secondary/30 transition-colors cursor-pointer"
                    onClick={async () => {
                      try {
                        const res = await accountApi.getUsage();
                        const u = res.success ? res.data : null;
                        const canAccess = hasEditOrDownloadAccess(u);
                        if (!canAccess && onShowPricingModal) {
                          onShowPricingModal();
                          return;
                        }
                      } catch {
                        if (onShowPricingModal) { onShowPricingModal(); return; }
                      }
                      const isPosted = item.status === "published" || item.status === "posted";
                      trackContentItemClicked(item.contentId, item.image?.includes('.mp4') ? 'video' : 'image', isPosted ? 'posted' : 'scheduled');
                      setSelectedPost(item);
                      if (isPosted) setShowAnalyticsDialog(true);
                      else setShowPostDetail(true);
                    }}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                          {item.image && (item.image.includes('video') || item.image.includes('.mp4')) ? (
                            <video src={item.image} className="w-full h-full object-cover" muted />
                          ) : (
                            <img src={item.image} alt={item.title} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <span className="font-medium">{item.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {/* Status badge - hidden for now */}
                      <Badge className={`hidden ${getStatusColor(item.status)}`}>{formatStatusLabel(item.status)}</Badge>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{item.date} {item.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {allContent.map((item) => {
              const isPosted = item.status === "published" || item.status === "posted";
              const isVideo = item.image?.includes('.mp4') || item.image?.includes('video');
              const handleEdit = async (e: React.MouseEvent) => {
                e.stopPropagation();
                trackContentEditClicked({
                  source: 'content_library',
                  contentType: isVideo ? 'video' : 'image',
                  contentId: item.contentId,
                  postIndex: item.postIndex,
                });
                try {
                  const res = await accountApi.getUsage();
                  const u = res.success ? res.data : null;
                  const hasAccess = hasEditOrDownloadAccess(u);
                  if (hasAccess) {
                    trackContentItemClicked(item.contentId, isVideo ? 'video' : 'image', isPosted ? 'posted' : 'scheduled');
                    setSelectedPost(item);
                    if (isPosted) setShowAnalyticsDialog(true);
                    else {
                      setOpenInEditDesignMode(!isVideo);
                      setShowPostDetail(true);
                    }
                    return;
                  }
                  // Free trial: allow edit once after visiting discover; then show pricing
                  const shouldBlock = u?.hasVisitedDiscover && (u?.freeTrialEditSaveCount ?? 0) >= 1;
                  if (shouldBlock && onShowPricingModal) {
                    onShowPricingModal();
                    return;
                  }
                } catch {
                  if (onShowPricingModal) { onShowPricingModal(); return; }
                }
                trackContentItemClicked(item.contentId, isVideo ? 'video' : 'image', isPosted ? 'posted' : 'scheduled');
                setSelectedPost(item);
                if (isPosted) setShowAnalyticsDialog(true);
                else {
                  setOpenInEditDesignMode(!isVideo);
                  setShowPostDetail(true);
                }
              };
              return (
                <Card
                  key={item.id}
                  className="overflow-hidden hover:shadow-lg transition-all group"
                >
                    <div className="relative aspect-[9/16] bg-muted overflow-hidden">
                      {item.image && (item.image.includes('video') || item.image.includes('.mp4')) ? (
                        <>
                          <video
                            src={item.image}
                            className="w-full h-full object-cover"
                            muted
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                            <Play className="h-12 w-12 text-white" fill="white" />
                          </div>
                        </>
                      ) : (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                      />
                      )}
                      {/* Status badge - hidden for now */}
                      <Badge
                        className={`hidden absolute top-2 right-2 z-10 shadow-sm ${getStatusColor(item.status)}`}
                      >
                        {formatStatusLabel(item.status)}
                      </Badge>
                      {hasEditedDraft(item.contentId, item.postIndex) && (
                        <Badge className="absolute top-2 left-2 z-10 shadow-sm bg-amber-500 hover:bg-amber-600 text-white">
                          Edited
                        </Badge>
                      )}
                      {/* Hover overlay with Edit/Download buttons (like wander-discover-connect) - always visible on touch devices */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full gap-2"
                          onClick={handleEdit}
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-2 bg-background/80 backdrop-blur-sm"
                          onClick={async (e) => {
                            e.stopPropagation();
                            trackContentDownloadClicked({
                              source: 'content_library',
                              contentType: isVideo ? 'video' : 'image',
                              contentId: item.contentId,
                              postIndex: item.postIndex,
                            });
                            try {
                              const res = await accountApi.getUsage();
                              const u = res.success ? res.data : null;
                              const canAccess = hasEditOrDownloadAccess(u);
                              if (!canAccess && onShowPricingModal) {
                                onShowPricingModal();
                                return;
                              }
                            } catch {
                              if (onShowPricingModal) { onShowPricingModal(); return; }
                            }
                            if (item.image) downloadMedia(item);
                          }}
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </Button>
                      </div>
                    </div>
                    <div className="px-3 py-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          {item.platforms.includes("instagram") && (
                            <div className="w-5 h-5 rounded bg-[#E1306C]" />
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
                        {item.date} {item.time}
                      </p>
                    </div>
                  </Card>
                );
              })}
            </div>
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
        onOpenChange={(open) => {
          setShowPostDetail(open);
          if (!open) setOpenInEditDesignMode(false);
        }}
        initialEditDesignMode={openInEditDesignMode}
        onEditDesignModeChange={onEditDesignModeChange}
        onScheduleComplete={handleRefreshAfterSchedule}
        onDesignSaved={handleDesignSaved}
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
        onShowUpgradeModal={handleShowUpgradeModalForEdit}
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
                        <div className="w-5 h-5 rounded bg-[#E1306C]" />
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
                          <div className="w-5 h-5 md:w-6 md:h-6 rounded bg-[hsl(var(--landing-accent-orange))]" />
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

      {/* Generate Content Dialog - only for onboarding/OAuth flows, NOT for Create New button */}
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
        expectedImageCount={onboardingJobId ? 2 : undefined}
        landingStyle={!!onboardingJobId}
        onDialogClosed={() => {
          // Ensure onboarding steps are marked as completed
          completeStep('auto_content_viewed');
          completeStep('content_library_visited');
          // Refresh content
          handleGenerationComplete();
        }}
      />

      {/* Create Ad Flow Modal - same flow as Discover "Create my own Ad" (replaces old Create New flow) */}
      <CreateAdFlowModal
        open={showCreateAdFlow}
        onOpenChange={(open) => {
          setShowCreateAdFlow(open);
          if (!open) {
            handleGenerationComplete();
          }
        }}
        onDesignSaved={handleRefreshAfterSchedule}
      />

      {/* Mobile: Floating Create button - Bottom right */}
      <div className="fixed bottom-6 right-6 z-50 md:hidden">
        <Button
          onClick={handleCreateNewClick}
          className="bg-foreground text-background hover:bg-foreground/90 rounded-full h-14 w-14 p-0"
          size="icon"
        >
          <Sparkles className="w-6 h-6" />
        </Button>
      </div>
      
      {/* Full-screen Pricing Modal (Create flow + Edit/Regenerate flow) */}
      <PricingModal
        open={showPricingModal || showUpgradeModalForEdit}
        onClose={() => {
          const wasCreateFlow = showPricingModal;
          setShowPricingModal(false);
          setShowUpgradeModalForEdit(false);
          // If user can skip (only one quota exhausted), proceed to Create Ad flow
          // Note: When mustSubscribeToFreemium is true, we don't auto-open
          if (wasCreateFlow && canSkipPricingModal && !mustSubscribeToFreemium) {
            setShowCreateAdFlow(true);
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
        canSkip={!mustSubscribeToFreemium && canSkipPricingModal}
        reason={mustSubscribeToFreemium ? 'freemium_required' : 'quota_exhausted'}
        userFlow={usageData?.initialAcquisitionFlow || 'website_analysis'}
        mustSubscribe={mustSubscribeToFreemium}
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

      {/* Trial Limit Exceeded Dialog - Pay Early or Wait */}
      <AlertDialog open={showTrialLimitDialog} onOpenChange={setShowTrialLimitDialog}>
        <AlertDialogContent className="w-[90vw] sm:w-[85vw] md:max-w-lg p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-lg sm:text-xl">
              Trial Limit Reached
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-center space-y-3 sm:space-y-4 pt-3 sm:pt-4">
                <p className="text-sm sm:text-base text-muted-foreground">
                  You&apos;ve used all your free trial content. To continue generating, you can:
                </p>
                <div className="bg-primary/5 dark:bg-primary/10 p-3 sm:p-4 rounded-lg space-y-2">
                  <p className="text-sm sm:text-base font-medium text-foreground">
                    💳 Pay now and continue creating
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Your card will be charged immediately and you&apos;ll get full access to your plan.
                  </p>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Or wait until your trial ends on{' '}
                  <span className="font-medium text-foreground">
                    {usageData?.freemiumTrialEndsAt 
                      ? format(new Date(usageData.freemiumTrialEndsAt), 'MMM d, yyyy')
                      : 'the scheduled date'}
                  </span>
                  , when your card will be charged automatically.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 pt-4">
            <AlertDialogCancel 
              className="w-full sm:w-auto"
              disabled={isEndingTrial}
            >
              Wait for Trial to End
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full sm:w-auto btn-gradient-cta"
              disabled={isEndingTrial}
              onClick={async (e) => {
                e.preventDefault();
                setIsEndingTrial(true);
                try {
                  const result = await accountApi.endTrialEarly();
                  if (result.success) {
                    toast({
                      title: "Payment Successful!",
                      description: "Your subscription is now active. You can continue generating content.",
                    });
                    setShowTrialLimitDialog(false);
                    // Open Create Ad flow (same as Discover)
                    setShowCreateAdFlow(true);
                  } else {
                    toast({
                      variant: "destructive",
                      title: "Payment Failed",
                      description: result.error || "Could not process payment. Please try again.",
                    });
                  }
                } catch (error: any) {
                  toast({
                    variant: "destructive",
                    title: "Error",
                    description: error.message || "An unexpected error occurred.",
                  });
                } finally {
                  setIsEndingTrial(false);
                }
              }}
            >
              {isEndingTrial ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Pay Now & Continue"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

export const ContentLibrary = ContentLibraryInner;
