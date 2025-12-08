"use client";


import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, Loader2, Play } from "lucide-react";
import { format } from "date-fns";
import { postingApi, authApi, socialConnectionsApi, oauth1Api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { saveOAuthFlowState, getOAuthFlowState, clearOAuthFlowState, updateOAuthFlowState } from "@/lib/oauthFlowState";
import { 
  trackScheduleDialogOpened,
  trackScheduleDialogClosed,
  trackScheduleSubmitted,
  trackScheduleSuccess,
  trackScheduleFailed,
  trackOAuth2Started,
  trackOAuth1Started,
  trackScheduleButtonClicked,
} from "@/lib/mixpanel";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  onScheduleComplete: () => void;
  // Optional prop to pass generatedContentId directly from parent (ensures it's always available)
  generatedContentIdOverride?: number | null;
  // Which page the dialog is opened from (for OAuth redirects)
  parentPage?: 'home' | 'content_library';
  // Generated posts to restore when returning from OAuth
  generatedPosts?: any[];
}

// Mock scheduled posts
const scheduledPosts = [
  { date: new Date(2024, 10, 13), time: "15:00", title: "Turn humor into your fastest growth hack" },
  { date: new Date(2024, 10, 14), time: "15:00", title: "Create viral AI-made videos" },
  { date: new Date(2024, 10, 15), time: "12:00", title: "Decentralized content" },
  { date: new Date(2024, 10, 16), time: "09:00", title: "Power to creators" },
];

export const ScheduleDialog = ({ open, onOpenChange, post, onScheduleComplete, generatedContentIdOverride, parentPage = 'content_library', generatedPosts = [] }: ScheduleDialogProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState("12:00");
  const [showOverlapDialog, setShowOverlapDialog] = useState(false);
  const [conflictingPost, setConflictingPost] = useState<any>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authPlatforms, setAuthPlatforms] = useState<string[]>([]);
  const [currentAuthIndex, setCurrentAuthIndex] = useState(0);
  const [needsOAuth1, setNeedsOAuth1] = useState(false);
  const [isVideoPost, setIsVideoPost] = useState(false);
  const [capturedPost, setCapturedPost] = useState<any>(null); // Capture post data when scheduling starts
  const { toast } = useToast();

  // Track dialog open
  useEffect(() => {
    if (open && post) {
      const contentType = post.image?.includes('.mp4') || post.type === 'Video' ? 'video' : 'image';
      trackScheduleDialogOpened('content_library', contentType);
    }
  }, [open, post]);

  // Check for pending OAuth flow and resume it
  useEffect(() => {
    if (!open) return;
    
    const flowState = getOAuthFlowState();
    // Check for schedule flows from any valid source (home, content_library, or legacy schedule_dialog)
    if (!flowState || flowState.type !== 'schedule') return;
    
    // Verify the source matches our parent page (or is legacy schedule_dialog)
    const validSources = ['home', 'content_library', 'schedule_dialog'];
    if (!validSources.includes(flowState.source)) return;
    
    console.log('🔄 ScheduleDialog - Resuming OAuth flow from saved state:', flowState);
    
    // Restore date/time
    if (flowState.scheduledDateTime) {
      setSelectedDate(new Date(flowState.scheduledDateTime));
    }
    if (flowState.selectedTime) {
      setSelectedTime(flowState.selectedTime);
    }
    
    // Restore captured post
    if (flowState.post) {
      setCapturedPost(flowState.post);
    }
    
    // Check what's next in the flow
    const nextPlatformIndex = flowState.currentPlatformIndex;
    
    if (nextPlatformIndex < flowState.platformsToAuth.length) {
      // More OAuth2 platforms to authorize - redirect to next one
      const nextPlatform = flowState.platformsToAuth[nextPlatformIndex];
      console.log(`🔐 ScheduleDialog - Continuing OAuth flow - next platform: ${nextPlatform}`);
      
      toast({
        title: `Connecting ${nextPlatform.charAt(0).toUpperCase() + nextPlatform.slice(1)}...`,
        description: "Redirecting to authorize...",
      });
      
      // Short delay then redirect
      setTimeout(async () => {
        try {
          let authUrlResponse;
          switch (nextPlatform) {
            case 'twitter':
              authUrlResponse = await authApi.getTwitterLoginUrl();
              break;
            case 'instagram':
              authUrlResponse = await socialConnectionsApi.getInstagramAuthUrl();
              break;
            case 'linkedin':
              authUrlResponse = await socialConnectionsApi.getLinkedInAuthUrl();
              break;
            case 'tiktok':
              authUrlResponse = await socialConnectionsApi.getTikTokAuthUrl();
              break;
          }
          
          if (authUrlResponse?.data) {
            window.location.href = authUrlResponse.data.authUrl || authUrlResponse.data.oauth_url;
          }
        } catch (error) {
          console.error('Error getting auth URL:', error);
          toast({
            title: "Connection Failed",
            description: "Unable to connect. Please try again.",
            variant: "destructive",
          });
          clearOAuthFlowState();
        }
      }, 1000);
      
    } else if (flowState.needsOAuth1 && !flowState.oauth1Completed) {
      // Need OAuth1 for Twitter video
      console.log('🎬 ScheduleDialog - Continuing OAuth flow - OAuth1 needed for video');
      
      toast({
        title: "One more step for videos...",
        description: "Redirecting for video upload authorization...",
      });
      
      // Initiate OAuth1 redirect flow
      setTimeout(async () => {
        try {
          const response = await oauth1Api.initiateOAuth1();
          const { authUrl, state, oauthTokenSecret } = response.data;
          
          // Store OAuth1 state
          localStorage.setItem('oauth1_state', state);
          localStorage.setItem('oauth1_token_secret', oauthTokenSecret);
          
          window.location.href = authUrl;
        } catch (error) {
          console.error('Error initiating OAuth1:', error);
          toast({
            title: "Connection Failed",
            description: "Unable to authorize video uploads. Please try again.",
            variant: "destructive",
          });
          clearOAuthFlowState();
        }
      }, 1000);
      
    } else {
      // All auth complete - proceed with scheduling
      console.log('✅ ScheduleDialog - All authorization complete - proceeding with schedule');
      
      toast({
        title: "Authorization Complete!",
        description: "Scheduling your post now...",
      });
      
      // Small delay then schedule - pass data directly from flowState to avoid race condition
      // React state updates are async, so we can't rely on selectedDate/capturedPost being set yet
      setTimeout(() => {
        setIsScheduling(true);
        performScheduleWithData(
          flowState.post,
          flowState.scheduledDateTime ? new Date(flowState.scheduledDateTime) : null,
          flowState.selectedTime || "12:00"
        ).then(() => {
          clearOAuthFlowState();
        });
      }, 500);
    }
  }, [open]);

  // Reset captured post when dialog closes
  useEffect(() => {
    if (!open) {
      setCapturedPost(null);
    }
  }, [open]);

  // Get current date/time in user's timezone
  const getCurrentDateTime = () => {
    return new Date();
  };

  // Check if selected date/time is in the past
  const isDateTimeInPast = (date: Date, time: string): boolean => {
    const [hours, minutes] = time.split(":").map(Number);
    const scheduledDateTime = new Date(date);
    scheduledDateTime.setHours(hours, minutes, 0, 0);
    return scheduledDateTime <= getCurrentDateTime();
  };

  // Get minimum time for today
  const getMinTime = (): string => {
    if (!selectedDate) return "00:00";
    
    const today = new Date();
    const isToday = selectedDate.toDateString() === today.toDateString();
    
    if (isToday) {
      // For today, minimum time is current time + 5 minutes
      const minDate = new Date(today.getTime() + 5 * 60 * 1000);
      const hours = minDate.getHours().toString().padStart(2, '0');
      const minutes = minDate.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    
    return "00:00";
  };

  const checkForOverlap = (date: Date, time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const scheduledDateTime = new Date(date);
    scheduledDateTime.setHours(hours, minutes, 0, 0);

    for (const scheduled of scheduledPosts) {
      const [schedHours, schedMinutes] = scheduled.time.split(":").map(Number);
      const existingDateTime = new Date(scheduled.date);
      existingDateTime.setHours(schedHours, schedMinutes, 0, 0);

      const diffInMinutes = Math.abs((scheduledDateTime.getTime() - existingDateTime.getTime()) / (1000 * 60));

      if (diffInMinutes < 120) {
        return scheduled;
      }
    }
    return null;
  };

  const handleSchedule = async () => {
    if (!selectedDate || !post) return;
    
    // Track Schedule button clicked
    const contentType = post.image?.includes('.mp4') || post.type === 'Video' ? 'video' : 'image';
    const platformsForTracking = post.requestedPlatforms || post.platforms || ['twitter'];
    trackScheduleButtonClicked(platformsForTracking[0] || 'twitter', contentType);

    // Validate date/time is not in the past
    if (isDateTimeInPast(selectedDate, selectedTime)) {
      toast({
        title: "Invalid Schedule Time",
        description: "Cannot schedule posts in the past. Please select a future date and time.",
        variant: "destructive",
      });
      return;
    }

    // Capture post data at the start of scheduling to ensure it doesn't change during OAuth flows
    // Use generatedContentIdOverride prop if post doesn't have generatedContentId (handles GenerateContentDialog flow)
    const effectiveGeneratedContentId = post.generatedContentId || generatedContentIdOverride;
    const postSnapshot = { 
      ...post,
      generatedContentId: effectiveGeneratedContentId, // Ensure generatedContentId is always set
    };
    setCapturedPost(postSnapshot);
    
    console.log('📸 ScheduleDialog - Captured post snapshot:', {
      'post.generatedContentId': post.generatedContentId,
      'generatedContentIdOverride prop': generatedContentIdOverride,
      'effective generatedContentId': effectiveGeneratedContentId,
      'postIndex': postSnapshot.postIndex,
    });

    setIsScheduling(true);

    try {
      // Get platforms with multiple fallbacks to ensure never empty
      let platforms = postSnapshot.requestedPlatforms || postSnapshot.platforms || [];
      
      // Extra safeguard: If still empty, use default
      if (!platforms || platforms.length === 0) {
        platforms = ['twitter']; // Default fallback
        console.warn('⚠️ No platforms found in ScheduleDialog handleSchedule, using default:', platforms);
      }
      
      console.log('📅 ScheduleDialog handleSchedule - Platforms:', {
        'post.requestedPlatforms': post.requestedPlatforms,
        'post.platforms': post.platforms,
        'final platforms': platforms,
        'platforms length': platforms?.length,
      });
      
      // Detect video by checking the media URL
      const isVideo = post.image && (post.image.includes('video') || post.image.includes('.mp4'));
      setIsVideoPost(isVideo);
      
      // Validate OAuth2 tokens for all platforms
      const validation = await postingApi.validateTokens({
        platforms,
        requireOAuth1ForTwitterVideo: false, // Check OAuth2 first
      });

      console.log('🔍 ScheduleDialog - Token validation result:', validation.data);

      // Check if any platforms need OAuth2 reauth
      const platformsNeedingAuth = validation.data.platforms
        .filter((p: any) => p.requiresReauth || !p.connected)
        .map((p: any) => p.platform);

      if (platformsNeedingAuth.length > 0) {
        // Use redirect-based OAuth2 flow
        console.log('🔐 ScheduleDialog - Platforms needing OAuth2:', platformsNeedingAuth);
        setIsScheduling(false);
        
        // Combine date and time for saving
        const [hours, minutes] = selectedTime.split(":").map(Number);
        const scheduledDateTime = new Date(selectedDate);
        scheduledDateTime.setHours(hours, minutes, 0, 0);
        
        // Save flow state before redirecting
        saveOAuthFlowState({
          type: 'schedule',
          source: parentPage, // Use the page where schedule was initiated
          post: {
            id: postSnapshot.id,
            type: postSnapshot.type || (isVideo ? 'Video' : 'Image'),
            image: postSnapshot.image,
            description: postSnapshot.description,
            requestedPlatforms: platforms,
            platforms: platforms,
            platformTexts: postSnapshot.platformTexts,
            fullPlatformTexts: postSnapshot.fullPlatformTexts,
            postIndex: postSnapshot.postIndex,
            generatedContentId: postSnapshot.generatedContentId,
          },
          platformsToAuth: platformsNeedingAuth,
          currentPlatformIndex: 0,
          needsOAuth1: isVideo && platforms.includes('twitter'),
          oauth1Completed: false,
          scheduledDateTime: scheduledDateTime.toISOString(),
          selectedTime: selectedTime,
          generatedPosts: generatedPosts, // Pass generated posts for restoration
          generatedContentId: postSnapshot.generatedContentId,
        });
        
        // Get auth URL for first platform
        const firstPlatform = platformsNeedingAuth[0];
        
        toast({
          title: `Connecting ${firstPlatform.charAt(0).toUpperCase() + firstPlatform.slice(1)}...`,
          description: "Redirecting to authorize...",
        });
        
        let authUrlResponse;
        switch (firstPlatform) {
          case 'twitter':
            authUrlResponse = await authApi.getTwitterLoginUrl();
            break;
          case 'instagram':
            authUrlResponse = await socialConnectionsApi.getInstagramAuthUrl();
            break;
          case 'linkedin':
            authUrlResponse = await socialConnectionsApi.getLinkedInAuthUrl();
            break;
          case 'tiktok':
            authUrlResponse = await socialConnectionsApi.getTikTokAuthUrl();
            break;
          default:
            throw new Error(`Unsupported platform: ${firstPlatform}`);
        }
        
        // Redirect to OAuth
        window.location.href = authUrlResponse.data.authUrl || authUrlResponse.data.oauth_url;
        return;
      }

      console.log('✅ ScheduleDialog - All OAuth2 tokens valid');
      
      // For Twitter video posts, also check OAuth1
      if (isVideo && platforms.includes('twitter')) {
        console.log('🎬 ScheduleDialog - Video post for Twitter, checking OAuth1...');
        const oauth1Status = await oauth1Api.getOAuth1Status();
        
        if (!oauth1Status.data.oauth1Valid) {
          console.log('🔐 ScheduleDialog - OAuth1 needed for Twitter video - using redirect');
          setIsScheduling(false);
          
          // Combine date and time for saving
          const [hours, minutes] = selectedTime.split(":").map(Number);
          const scheduledDateTime = new Date(selectedDate);
          scheduledDateTime.setHours(hours, minutes, 0, 0);
          
          // Save flow state for OAuth1
          saveOAuthFlowState({
            type: 'schedule',
            source: parentPage, // Use the page where schedule was initiated
            post: {
              id: postSnapshot.id,
              type: postSnapshot.type || 'Video',
              image: postSnapshot.image,
              description: postSnapshot.description,
              requestedPlatforms: platforms,
              platforms: platforms,
              platformTexts: postSnapshot.platformTexts,
              fullPlatformTexts: postSnapshot.fullPlatformTexts,
              postIndex: postSnapshot.postIndex,
              generatedContentId: postSnapshot.generatedContentId,
            },
            platformsToAuth: [], // OAuth2 already done
            currentPlatformIndex: 0,
            needsOAuth1: true,
            oauth1Completed: false,
            scheduledDateTime: scheduledDateTime.toISOString(),
            selectedTime: selectedTime,
            generatedPosts: generatedPosts, // Pass generated posts for restoration
            generatedContentId: postSnapshot.generatedContentId,
          });
          
          toast({
            title: "Video Authorization Required",
            description: "Redirecting to authorize video uploads...",
          });
          
          // Initiate OAuth1 redirect flow
          const response = await oauth1Api.initiateOAuth1();
          const { authUrl, state, oauthTokenSecret } = response.data;
          
          // Store OAuth1 state
          localStorage.setItem('oauth1_state', state);
          localStorage.setItem('oauth1_token_secret', oauthTokenSecret);
          
          window.location.href = authUrl;
          return;
        }
        console.log('✅ ScheduleDialog - OAuth1 valid for Twitter video');
      }
      
      // All authorizations complete, proceed with scheduling
      await performSchedule();
    } catch (error: any) {
      console.error('Error scheduling:', error);
      toast({
        title: "Couldn't Schedule Post",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setIsScheduling(false);
    }
  };
  
  // Note: initiateOAuth1Flow removed - using redirect-based OAuth1 flow instead

  // Version that accepts data directly as parameters (for resuming from OAuth flow)
  // This avoids race conditions with React state updates
  const performScheduleWithData = async (
    postData: typeof post | null,
    dateData: Date | null,
    timeData: string
  ) => {
    console.log('📅 performScheduleWithData called with:', { postData, dateData, timeData });
    
    if (!dateData || !postData) {
      console.error('❌ performScheduleWithData - Missing required data:', { postData: !!postData, dateData: !!dateData });
      toast({
        title: "Scheduling Failed",
        description: "Missing required data. Please try again.",
        variant: "destructive",
      });
      setIsScheduling(false);
      return;
    }

    try {
      // Combine date and time
      const [hours, minutes] = timeData.split(":").map(Number);
      const scheduledDateTime = new Date(dateData);
      scheduledDateTime.setHours(hours, minutes, 0, 0);

      // Validate future date
      if (scheduledDateTime <= new Date()) {
        toast({
          title: "Invalid Date",
          description: "Please select a future date and time",
          variant: "destructive",
        });
        setIsScheduling(false);
        return;
      }

      // Get platforms with multiple fallbacks
      let platforms = postData.requestedPlatforms || postData.platforms || [];
      if (!platforms || platforms.length === 0) {
        platforms = ['twitter'];
        console.warn('⚠️ No platforms found, using default:', platforms);
      }
      
      const finalGeneratedContentId = postData.generatedContentId || generatedContentIdOverride;
      
      console.log('📅 performScheduleWithData - Using data:', {
        'generatedContentId': finalGeneratedContentId,
        'postIndex': postData.postIndex,
        'platforms': platforms,
      });
      
      const mediaUrl = postData.image;
      
      // Detect media type
      const detectMediaType = (url: string | undefined): 'image' | 'video' => {
        if (!url) return 'image';
        const urlLower = url.toLowerCase();
        if (urlLower.includes('.mp4') || urlLower.includes('.mov') || 
            urlLower.includes('.avi') || urlLower.includes('.webm') ||
            urlLower.includes('.mkv') || urlLower.includes('video') || 
            urlLower.includes('stitched_video')) {
          return 'video';
        }
        if ((postData as any).type === 'Video') return 'video';
        return 'image';
      };
      
      const mediaType = detectMediaType(postData.image);

      // Get platform texts with edited captions taking priority
      const originalPlatformTexts = (postData as any).fullPlatformTexts || {};
      const editedCaptions = (postData as any).editedCaptions || {};
      const finalPlatformTexts = { ...originalPlatformTexts };
      Object.keys(editedCaptions).forEach(platform => {
        if (editedCaptions[platform]) {
          finalPlatformTexts[platform] = editedCaptions[platform];
        }
      });
      
      // Call schedule API
      const response = await postingApi.schedulePost({
        scheduledFor: scheduledDateTime.toISOString(),
        platforms,
        content: {
          caption: postData.description || (postData as any).title,
          platformTexts: finalPlatformTexts,
          mediaUrl,
          mediaType,
          generatedContentId: finalGeneratedContentId,
          postIndex: postData.postIndex,
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      toast({
        title: "Post Scheduled!",
        description: `Your post will be published on ${scheduledDateTime.toLocaleDateString()} at ${scheduledDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      });

      setIsScheduling(false);
      onScheduleComplete?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error scheduling:', error);
      toast({
        title: "Couldn't Schedule Post",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setIsScheduling(false);
    }
  };

  const performSchedule = async () => {
    // Use captured post data (snapshot from when scheduling started) to ensure consistency
    const postToSchedule = capturedPost || post;
    
    if (!selectedDate || !postToSchedule) return;

    try {
      // Combine date and time
      const [hours, minutes] = selectedTime.split(":").map(Number);
      const scheduledDateTime = new Date(selectedDate);
      scheduledDateTime.setHours(hours, minutes, 0, 0);

      // Validate future date
      if (scheduledDateTime <= new Date()) {
        toast({
          title: "Invalid Date",
          description: "Please select a future date and time",
          variant: "destructive",
        });
        setIsScheduling(false);
        return;
      }

      // Get platforms with multiple fallbacks to ensure never empty
      let platforms = postToSchedule.requestedPlatforms || postToSchedule.platforms || [];
      
      // Extra safeguard: If still empty, use default
      if (!platforms || platforms.length === 0) {
        platforms = ['twitter']; // Default fallback
        console.warn('⚠️ No platforms found in ScheduleDialog performSchedule, using default:', platforms);
      }
      
      // CRITICAL: Final fallback for generatedContentId
      // Use override prop if postToSchedule doesn't have it (handles async state updates during OAuth flow)
      const finalGeneratedContentId = postToSchedule.generatedContentId || generatedContentIdOverride;
      
      console.log('📅 ScheduleDialog performSchedule - Using captured post:', {
        'postToSchedule.generatedContentId': postToSchedule.generatedContentId,
        'generatedContentIdOverride': generatedContentIdOverride,
        'final generatedContentId': finalGeneratedContentId,
        'postToSchedule.postIndex': postToSchedule.postIndex,
        'postToSchedule.requestedPlatforms': postToSchedule.requestedPlatforms,
        'postToSchedule.platforms': postToSchedule.platforms,
        'final platforms': platforms,
      });
      
      const mediaUrl = postToSchedule.image; // S3 URL
      
      // Robust video detection - check multiple indicators
      const detectMediaType = (url: string | undefined): 'image' | 'video' => {
        if (!url) return 'image';
        
        const urlLower = url.toLowerCase();
        
        // Check file extension
        if (urlLower.includes('.mp4') || urlLower.includes('.mov') || 
            urlLower.includes('.avi') || urlLower.includes('.webm') ||
            urlLower.includes('.mkv')) {
          return 'video';
        }
        
        // Check if URL contains 'video' keyword
        if (urlLower.includes('video') || urlLower.includes('stitched_video')) {
          return 'video';
        }
        
        // Check post.type if available
        if ((postToSchedule as any).type === 'Video') {
          return 'video';
        }
        
        // Default to image
        return 'image';
      };
      
      const mediaType = detectMediaType(postToSchedule.image);
      console.log(`📋 Media type detected: ${mediaType} for URL: ${postToSchedule.image?.substring(0, 80)}...`);

      // Get the full platform texts (not truncated)
      // Use fullPlatformTexts if available, otherwise fall back to description
      const originalPlatformTexts = (postToSchedule as any).fullPlatformTexts || {};
      
      // Merge with user-edited captions (edited captions take priority)
      const editedCaptions = (postToSchedule as any).editedCaptions || {};
      const finalPlatformTexts = { ...originalPlatformTexts };
      
      // Override with user-edited captions for each platform
      Object.keys(editedCaptions).forEach(platform => {
        if (editedCaptions[platform]) {
          finalPlatformTexts[platform] = editedCaptions[platform];
        }
      });
      
      console.log('📤 ScheduleDialog - Sending to API:', {
        'postToSchedule.generatedContentId': postToSchedule.generatedContentId,
        'generatedContentIdOverride': generatedContentIdOverride,
        'final generatedContentId': finalGeneratedContentId,
        'postIndex': postToSchedule.postIndex,
        'originalPlatformTexts': originalPlatformTexts,
        'editedCaptions': editedCaptions,
        'finalPlatformTexts': finalPlatformTexts,
      });
      
      // Track schedule submitted
      trackScheduleSubmitted({
        platform: platforms[0] || 'unknown',
        contentType: mediaType,
        scheduledFor: scheduledDateTime.toISOString(),
      });
      
      // Call schedule API - use finalGeneratedContentId which has fallback to override prop
      const response = await postingApi.schedulePost({
        scheduledFor: scheduledDateTime.toISOString(),
        platforms,
        content: {
          caption: postToSchedule.description || postToSchedule.title, // For display purposes
          platformTexts: finalPlatformTexts, // Full texts with edited captions taking priority
          mediaUrl,
          mediaType,
          generatedContentId: finalGeneratedContentId, // Use final value with fallbacks
          postIndex: postToSchedule.postIndex,
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // Track schedule success
      trackScheduleSuccess({
        platform: platforms[0] || 'unknown',
        contentType: mediaType,
        scheduledFor: scheduledDateTime.toISOString(),
      });

      toast({
        title: "Post Scheduled",
        description: `Scheduled for ${format(scheduledDateTime, "MMM dd, yyyy 'at' h:mm a")}`,
      });

      trackScheduleDialogClosed('scheduled');
      
      // Call onScheduleComplete with 'true' to indicate successful scheduling
      onScheduleComplete();
      // Close the schedule dialog
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error scheduling:', error);
      
      // Track schedule failure (use post data to get platform)
      const platformForTracking = postToSchedule?.requestedPlatforms?.[0] || postToSchedule?.platforms?.[0] || 'unknown';
      trackScheduleFailed(error.message || 'Unknown error', platformForTracking);
      
      toast({
        title: "Couldn't Schedule Post",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScheduling(false);
    }
  };

  // Note: handleAuthPlatform removed - using redirect-based OAuth flow instead

  const handleReplacePost = () => {
    setShowOverlapDialog(false);
    onScheduleComplete();
    onOpenChange(false);
  };

  const handleChangeTime = () => {
    setShowOverlapDialog(false);
  };

  const getPostsForDate = (date: Date) => {
    return scheduledPosts.filter(
      (post) => post.date.toDateString() === date.toDateString()
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] max-w-4xl h-auto max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl md:text-2xl">Schedule Post</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 py-4">
            {/* Calendar Section */}
            <div className="space-y-4">
              <div>
                <Label className="text-sm sm:text-base">Select Date</Label>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md border mx-auto lg:mx-0"
                  disabled={(date) => {
                    // Disable past dates (before today)
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return date < today;
                  }}
                  modifiers={{
                    scheduled: scheduledPosts.map(p => p.date)
                  }}
                  modifiersStyles={{
                    scheduled: {
                      fontWeight: 'bold',
                      backgroundColor: 'hsl(var(--primary) / 0.1)',
                    }
                  }}
                />
              </div>

              <div>
                <Label htmlFor="time" className="text-sm sm:text-base">Select Time</Label>
                <div className="relative mt-2">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="time"
                    type="time"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    min={getMinTime()}
                    className="pl-10 text-sm sm:text-base"
                  />
                </div>
                {selectedDate && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedDate.toDateString() === new Date().toDateString()
                      ? `Minimum time: ${getMinTime()} (current time + 5 min)`
                      : "Select any time for future dates"}
                  </p>
                )}
              </div>
            </div>

            {/* Scheduled Posts Section */}
            <div className="space-y-4">
              <div>
                <Label className="text-sm sm:text-base">Scheduled Posts</Label>
                {selectedDate ? (
                  <div className="mt-2 space-y-2">
                    {getPostsForDate(selectedDate).length > 0 ? (
                      getPostsForDate(selectedDate).map((post, idx) => (
                        <Card key={idx} className="p-2 sm:p-3">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
                            <span className="text-xs sm:text-sm font-medium">{post.time}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {post.title}
                          </p>
                        </Card>
                      ))
                    ) : (
                      <p className="text-xs sm:text-sm text-muted-foreground py-4">
                        No posts scheduled for this date
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs sm:text-sm text-muted-foreground mt-2">
                    Select a date to see scheduled posts
                  </p>
                )}
              </div>

              {/* Post Preview */}
              {post && (
                <div>
                  <Label className="text-sm sm:text-base">Post Preview</Label>
                  <Card className="mt-2 overflow-hidden">
                    <div className="relative w-full aspect-video bg-gray-100">
                      {post.image && (post.image.includes('video') || post.image.includes('.mp4')) ? (
                        <>
                          <video
                            src={post.image}
                            className="w-full h-full object-cover"
                            muted
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Play className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 text-white" fill="white" />
                          </div>
                        </>
                      ) : (
                    <img
                      src={post.image}
                      alt={post.title}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-2 sm:p-3">
                      <p className="font-medium text-xs sm:text-sm">{post.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {post.description}
                      </p>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-4">
            <Button 
              variant="outline" 
              className="flex-1 text-sm sm:text-base py-2 sm:py-3" 
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-sm sm:text-base py-2 sm:py-3"
              onClick={handleSchedule}
              disabled={!selectedDate || isScheduling}
            >
              {isScheduling ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                  <span className="text-sm sm:text-base">Scheduling...</span>
                </>
              ) : (
                <span className="text-sm sm:text-base">Schedule Post</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Note: Authorization Dialog removed - using redirect-based OAuth */}

      <AlertDialog open={showOverlapDialog} onOpenChange={setShowOverlapDialog}>
        <AlertDialogContent className="w-[95vw] sm:w-[90vw] md:w-auto max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base sm:text-lg md:text-xl">
              Post Time Conflict
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm">
              There is already a post scheduled within 2 hours of your selected time ({selectedTime}).
              <br />
              <br />
              <strong>Conflicting post:</strong> {conflictingPost?.title} at {conflictingPost?.time}
              <br />
              <br />
              Would you like to replace the existing post or change your timing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              className="w-full sm:w-auto text-sm sm:text-base"
              onClick={handleChangeTime}
            >
              Change Time
            </Button>
            <Button 
              onClick={handleReplacePost} 
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-sm sm:text-base"
            >
              Replace Post
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
