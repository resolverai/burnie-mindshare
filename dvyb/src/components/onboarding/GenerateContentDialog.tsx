"use client";


import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { X, Plus, Upload, Link, Loader2, Twitter, Instagram, Linkedin } from "lucide-react";
import { PostDetailDialog } from "@/components/calendar/PostDetailDialog";
import { ScheduleDialog } from "@/components/calendar/ScheduleDialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { adhocGenerationApi, postingApi, oauth1Api, authApi, socialConnectionsApi } from "@/lib/api";
import { saveOAuthFlowState, getOAuthFlowState, clearOAuthFlowState, updateOAuthFlowState } from "@/lib/oauthFlowState";
import { useToast } from "@/hooks/use-toast";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { TikTokIcon } from "@/components/icons/TikTokIcon";
import { FileDropZone } from "@/components/ui/file-drop-zone";

interface GenerateContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialJobId?: string | null; // For onboarding auto-generation
  onDialogClosed?: () => void; // Callback when dialog closes for any reason (Done, scheduling, etc.)
}

type Step = "topic" | "platform" | "context" | "review" | "generating" | "results";

const TOPICS = [
  "Product Launch",
  "Industry Insights",
  "Customer Stories",
  "Behind the Scenes",
];

const PLATFORMS = [
  { 
    id: "twitter", 
    name: "Twitter", 
    IconComponent: Twitter,
    color: "bg-black" 
  },
  { 
    id: "instagram", 
    name: "Instagram", 
    IconComponent: Instagram,
    color: "bg-gradient-to-br from-purple-500 to-pink-500" 
  },
  { 
    id: "linkedin", 
    name: "LinkedIn", 
    IconComponent: Linkedin,
    color: "bg-blue-600" 
  },
  { 
    id: "tiktok", 
    name: "TikTok", 
    IconComponent: TikTokIcon,
    color: "bg-black" 
  },
];

export const GenerateContentDialog = ({ open, onOpenChange, initialJobId, onDialogClosed }: GenerateContentDialogProps) => {
  const [step, setStep] = useState<Step>("topic");
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [customTopic, setCustomTopic] = useState("");
  const [showCustomTopic, setShowCustomTopic] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [contextText, setContextText] = useState("");
  const [uploadedS3Urls, setUploadedS3Urls] = useState<string[]>([]);
  const [inspirationLinks, setInspirationLinks] = useState<string[]>([""]);
  const [imagePostCount, setImagePostCount] = useState([2]);
  const [videoPostCount, setVideoPostCount] = useState([2]);
  const [imageSliderMax, setImageSliderMax] = useState(4);
  const [videoSliderMax, setVideoSliderMax] = useState(4);
  const [usageData, setUsageData] = useState<any>(null);
  const [generatedPosts, setGeneratedPosts] = useState<any[]>([]);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showPostingDialog, setShowPostingDialog] = useState(false);
  const [showPostNowOverlap, setShowPostNowOverlap] = useState(false);
  const [postingComplete, setPostingComplete] = useState(false);
  const [postingResults, setPostingResults] = useState<any[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [needsOAuth1, setNeedsOAuth1] = useState(false);
  const [pendingPost, setPendingPost] = useState<any>(null);
  const [oauth1State, setOAuth1State] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [generationUuid, setGenerationUuid] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [postSchedules, setPostSchedules] = useState<Record<string, any>>({});
  const [generatedContentId, setGeneratedContentId] = useState<number | null>(null);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authPlatforms, setAuthPlatforms] = useState<string[]>([]);
  const [currentAuthIndex, setCurrentAuthIndex] = useState(0);
  const { toast } = useToast();

  // Fetch usage data when dialog opens
  useEffect(() => {
    if (open) {
      const fetchUsageData = async () => {
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/usage`, {
            credentials: 'include',
          });
          const data = await response.json();
          
          console.log('📊 Usage data fetched:', data.data);
          
          if (data.success && data.data) {
            setUsageData(data.data);
            
            const { remainingImages, remainingVideos } = data.data;
            
            // Calculate individual slider max values (capped at 4)
            const maxImages = Math.min(4, remainingImages);
            const maxVideos = Math.min(4, remainingVideos);
            
            setImageSliderMax(maxImages);
            setVideoSliderMax(maxVideos);
            
            // Calculate default values: 2 images + 2 videos (adjusted by limits)
            // Total max is 4
            const defaultImages = Math.min(2, maxImages);
            const defaultVideos = Math.min(2, maxVideos);
            
            // If one type is limited, give more to the other (up to 4 total)
            let finalImages = defaultImages;
            let finalVideos = defaultVideos;
            
            // If we can't get 2 videos, try to get more images
            if (defaultVideos < 2 && maxImages > defaultImages) {
              const shortfall = 2 - defaultVideos;
              finalImages = Math.min(defaultImages + shortfall, maxImages, 4 - finalVideos);
            }
            
            // If we can't get 2 images, try to get more videos
            if (defaultImages < 2 && maxVideos > defaultVideos) {
              const shortfall = 2 - defaultImages;
              finalVideos = Math.min(defaultVideos + shortfall, maxVideos, 4 - finalImages);
            }
            
            // Ensure at least 1 post total
            if (finalImages + finalVideos === 0) {
              if (maxImages > 0) finalImages = 1;
              else if (maxVideos > 0) finalVideos = 1;
            }
            
            console.log(`🎚️ Setting sliders: ${finalImages} images (max ${maxImages}), ${finalVideos} videos (max ${maxVideos})`);
            setImagePostCount([finalImages]);
            setVideoPostCount([finalVideos]);
          }
        } catch (error) {
          console.error('Failed to fetch usage data:', error);
        }
      };
      
      fetchUsageData();
    } else {
      // Reset when dialog closes
      setImageSliderMax(4);
      setVideoSliderMax(4);
      setImagePostCount([2]);
      setVideoPostCount([2]);
      setUsageData(null);
    }
  }, [open]);

  // Handle onboarding auto-generation
  useEffect(() => {
    if (open && initialJobId) {
      console.log('🎉 Auto-opening with onboarding generation job:', initialJobId);
      
      // Set initial state for onboarding generation
      setSelectedTopic('Product Launch');
      setSelectedPlatforms(['twitter']);  // Twitter only for faster demo
      setJobId(initialJobId);
      setGenerationUuid(initialJobId); // May be uuid format
      setImagePostCount([2]);
      setVideoPostCount([0]);
      
      // Create placeholder posts
      const placeholders = Array.from({ length: 2 }, (_, i) => ({
        id: String(i + 1),
        date: new Date().toISOString().split('T')[0],
        time: "10:00 AM",
        type: "Loading",
        platforms: ['twitter'],  // Twitter only for faster demo
        requestedPlatforms: ['twitter'],  // Twitter only for faster demo
        title: 'Product Launch',
        description: "Generating content...",
        image: null,
        platformTexts: {},
        isGenerating: true,
      }));
      
      setGeneratedPosts(placeholders);
      
      // Skip directly to results step
      setStep("results");
      
      // Start polling immediately
      setTimeout(() => {
        pollGenerationStatus();
      }, 1000);
    }
  }, [open, initialJobId]);

  // Check for pending OAuth flow and resume it
  useEffect(() => {
    if (!open) return;
    
    const flowState = getOAuthFlowState();
    if (!flowState) return;
    
    // Handle schedule_dialog flows - open ScheduleDialog to resume
    if (flowState.source === 'schedule_dialog' && flowState.type === 'schedule') {
      console.log('🔄 Resuming Schedule flow from GenerateContentDialog...', flowState);
      
      // Restore generated posts if available
      if (flowState.generatedPosts && flowState.generatedPosts.length > 0) {
        setGeneratedPosts(flowState.generatedPosts);
        setStep("results");
      }
      
      if (flowState.generatedContentId) {
        setGeneratedContentId(flowState.generatedContentId);
      }
      
      // Restore selected post
      if (flowState.post) {
        setSelectedPost(flowState.post);
      }
      
      // Auto-open ScheduleDialog after a short delay
      setTimeout(() => {
        console.log('📅 Auto-opening ScheduleDialog to resume flow...');
        setShowScheduleDialog(true);
      }, 500);
      
      return; // ScheduleDialog will handle the rest
    }
    
    // Handle generate_dialog flows (Post Now)
    if (flowState.source !== 'generate_dialog') return;
    
    console.log('🔄 Resuming OAuth flow from saved state:', flowState);
    
    // Restore state
    const { post, generatedPosts: savedPosts, generatedContentId: savedContentId, generationUuid: savedGenerationUuid, platformsToAuth, currentPlatformIndex, needsOAuth1, oauth1Completed } = flowState;
    
    // Restore generated posts if available
    if (savedPosts && savedPosts.length > 0) {
      setGeneratedPosts(savedPosts);
      setStep("results");
      
      // Check if any posts are still generating (isGenerating flag or Loading type)
      const stillGenerating = savedPosts.some((p: any) => p.isGenerating || p.type === 'Loading');
      
      if (stillGenerating && savedGenerationUuid) {
        console.log('🔄 Posts still generating, resuming polling with UUID:', savedGenerationUuid);
        setGenerationUuid(savedGenerationUuid);
        setJobId(savedGenerationUuid);
        
        // Resume polling after a short delay
        setTimeout(() => {
          pollGenerationStatus();
        }, 1000);
      }
    }
    
    if (savedContentId) {
      setGeneratedContentId(savedContentId);
    }
    
    // Restore pending post
    if (post) {
      setPendingPost(post);
      setSelectedPost(post);
    }
    
    // Check what's next in the flow
    const nextPlatformIndex = currentPlatformIndex;
    
    if (nextPlatformIndex < platformsToAuth.length) {
      // More OAuth2 platforms to authorize - redirect to next one
      const nextPlatform = platformsToAuth[nextPlatformIndex];
      console.log(`🔐 Continuing OAuth flow - next platform: ${nextPlatform}`);
      
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
      
    } else if (needsOAuth1 && !oauth1Completed) {
      // Need OAuth1 for Twitter video
      console.log('🎬 Continuing OAuth flow - OAuth1 needed for video');
      
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
      // All auth complete - proceed with posting
      console.log('✅ All authorization complete - proceeding with post');
      
      clearOAuthFlowState();
      
      if (post) {
        toast({
          title: "Authorization Complete!",
          description: "Posting your content now...",
        });
        
        // Small delay then post
        setTimeout(() => {
          startPosting(post);
        }, 500);
      }
    }
  }, [open]);

  const handleFilesSelected = async (files: File[]): Promise<string[]> => {
    try {
      // Upload each file to S3 and get presigned URLs for preview
      const uploadPromises = files.map(file => adhocGenerationApi.uploadImage(file));
      const s3Urls = await Promise.all(uploadPromises);
      
      // Update state with new URLs
      setUploadedS3Urls(prev => [...prev, ...s3Urls]);
      
      return s3Urls;
    } catch (error: any) {
      throw new Error(error.message || "Failed to upload files. Please try again.");
    }
  };

  const handleRemoveFile = (url: string) => {
    setUploadedS3Urls(prev => prev.filter(u => u !== url));
  };

  const handleGenerate = async () => {
    const topic = customTopic || selectedTopic;
    
    // Use user-selected values directly from sliders
    const numberOfImages = imagePostCount[0];
    const numberOfVideos = videoPostCount[0];
    const totalPosts = numberOfImages + numberOfVideos;
    
    console.log(`📊 Generating ${totalPosts} posts: ${numberOfImages} images, ${numberOfVideos} videos`);
    if (usageData) {
      console.log(`📊 Remaining limits: ${usageData.remainingImages} images, ${usageData.remainingVideos} videos`);
    }
    
    // Immediately show grid with placeholder posts
    const placeholders = Array.from({ length: totalPosts }, (_, i) => ({
      id: String(i + 1),
      date: new Date().toISOString().split('T')[0],
      time: "10:00 AM",
      type: "Loading",
      platforms: selectedPlatforms,
      title: topic,
      description: "Generating content...",
      image: null,
      platformTexts: {},
      isGenerating: true,
    }));
    
    setGeneratedPosts(placeholders);
    setStep("results"); // Show results grid immediately with placeholders
    
    try {
      // Extract S3 keys from presigned URLs for API submission
      const s3Keys = uploadedS3Urls.length > 0 
        ? uploadedS3Urls.map(url => adhocGenerationApi.extractS3Key(url))
        : undefined;
      
      // Start generation
      const response = await adhocGenerationApi.generateContent({
        topic,
        platforms: selectedPlatforms,
        number_of_posts: totalPosts,
        number_of_images: numberOfImages,
        number_of_videos: numberOfVideos,
        user_prompt: contextText || undefined,
        user_images: s3Keys,  // Send S3 keys, not presigned URLs
        inspiration_links: inspirationLinks.filter(link => link.trim()).length > 0 
          ? inspirationLinks.filter(link => link.trim()) 
          : undefined,
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Generation failed');
      }
      
      setJobId(response.job_id || null);
      setGenerationUuid(response.uuid || null);
      
      // Poll for status and progressively update grid
      pollGenerationStatus();
      
    } catch (error: any) {
      console.error('Generation error:', error);
      toast({
        title: "Couldn't Generate Content",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setStep("review");
      setGeneratedPosts([]);
    }
  };
  
  const pollGenerationStatus = async () => {
    const pollInterval = setInterval(async () => {
      try {
        const status = await adhocGenerationApi.getStatus();
        
        if (status.success) {
          const data = status.data;
          
          // Progressively update grid with generated content
          // Priority 1: Check progressive content in metadata (real-time updates)
          // Priority 2: Check final arrays when generation completes
          const progressiveContent = data?.metadata?.progressiveContent || [];
          const imageUrls = data?.generatedImageUrls || [];
          const videoUrls = data?.generatedVideoUrls || [];
          const platformTexts = data?.platformTexts || [];
          
          // Store generatedContentId as soon as we have it (not just on completion)
          // This ensures Schedule can work even before generation completes
          if (data?.id && !generatedContentId) {
            setGeneratedContentId(data.id);
            console.log('📦 Set generatedContentId early:', data.id);
          }
          
          if (progressiveContent.length > 0 || imageUrls.length > 0 || videoUrls.length > 0) {
            // Update posts with available content
            setGeneratedPosts(prev => prev.map((post, index) => {
              // Check if this post has progressive content
              const progressiveItem = progressiveContent.find((item: any) => item.postIndex === index);
              
              if (progressiveItem) {
                // Use progressive content (real-time update)
                const isVideo = progressiveItem.contentType === 'video';
                const platformTextsObj = progressiveItem.platformText?.platforms || {};
                const firstPlatform = selectedPlatforms[0] || 'instagram';
                
                // Ensure requestedPlatforms is always an array
                const platforms = Array.isArray(data?.requestedPlatforms) && data.requestedPlatforms.length > 0
                  ? data.requestedPlatforms
                  : selectedPlatforms;
                
                console.log('🔍 Progressive update - Post', index, ':', {
                  'data.requestedPlatforms': data?.requestedPlatforms,
                  'selectedPlatforms': selectedPlatforms,
                  'final platforms': platforms
                });
                
                return {
                  ...post,
                  type: isVideo ? "Video" : "Post",
                  title: progressiveItem.platformText?.topic || post.title,
                  description: platformTextsObj[firstPlatform] || Object.values(platformTextsObj)[0] || "Content ready",
                  image: progressiveItem.contentUrl,
                  platformTexts: platformTextsObj,
                  generatedContentId: data?.id, // Store the dvyb_generated_content.id
                  postIndex: index, // Store the index within the arrays
                  requestedPlatforms: platforms, // Store platforms with fallback
                  isGenerating: false,
                };
              }
              
              // Fallback: Check final arrays (for backwards compatibility)
              const textEntry = platformTexts[index];
              const isClip = textEntry?.content_type === 'clip';
              const mediaUrl = isClip 
                ? videoUrls[index] 
                : imageUrls[index];
              
              // If media is available, update the placeholder
              if (mediaUrl && textEntry) {
                const platformTextsObj = textEntry.platforms || {};
                const firstPlatform = selectedPlatforms[0] || 'instagram';
                
                // Ensure requestedPlatforms is always an array
                const platforms = Array.isArray(data?.requestedPlatforms) && data.requestedPlatforms.length > 0
                  ? data.requestedPlatforms
                  : selectedPlatforms;
                
                console.log('🔍 Fallback update - Post', index, ':', {
                  'data.requestedPlatforms': data?.requestedPlatforms,
                  'selectedPlatforms': selectedPlatforms,
                  'final platforms': platforms
                });
                
                return {
                  ...post,
                  type: isClip ? "Video" : "Post",
                  title: textEntry.topic || post.title,
                  description: platformTextsObj[firstPlatform] || Object.values(platformTextsObj)[0] || "Content ready",
                  image: mediaUrl,
                  platformTexts: platformTextsObj,
                  generatedContentId: data?.id, // Store the dvyb_generated_content.id
                  postIndex: index, // Store the index within the arrays
                  requestedPlatforms: platforms, // Store platforms with fallback
                  isGenerating: false,
                };
              }
              
              return post; // Keep placeholder
            }));
          }
          
          if (status.status === 'completed') {
            clearInterval(pollInterval);
            console.log('✅ Generation completed!');
            
            // Mark any remaining placeholders as failed (they didn't get content)
            setGeneratedPosts(prev => prev.map((post) => {
              if (post.isGenerating || !post.image) {
                // This placeholder never got content - mark as failed
                return {
                  ...post,
                  isGenerating: false,
                  isFailed: true,
                  description: "Unable to generate content",
                  image: null,
                };
              }
              return post;
            }));
            
            // Fetch schedules for this content (generatedContentId already set above)
            if (data?.id) {
              fetchSchedules(data.id);
            }
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            throw new Error(status.progress_message || 'Generation failed');
          }
          
          // Update progress state
          setProgressPercent(status.progress_percent || 0);
          setProgressMessage(status.progress_message || "");
          
          // Log progress
          console.log(`Progress: ${status.progress_percent}% - ${status.progress_message}`);
        }
      } catch (error: any) {
        clearInterval(pollInterval);
        console.error('Status poll error:', error);
        toast({
          title: "Generation Failed",
          description: "Something went wrong while generating your content. Please try again.",
          variant: "destructive",
        });
        setStep("review");
        setGeneratedPosts([]);
      }
    }, 3000); // Poll every 3 seconds
  };

  const fetchSchedules = async (contentId: number) => {
    try {
      const response = await postingApi.getSchedules(contentId);
      if (response.success && response.data) {
        // Create a map of postIndex -> schedule
        const scheduleMap: Record<string, any> = {};
        response.data.forEach((schedule: any) => {
          if (schedule.postMetadata?.postIndex !== undefined) {
            const key = `${contentId}-${schedule.postMetadata.postIndex}`;
            scheduleMap[key] = schedule;
          }
        });
        setPostSchedules(scheduleMap);
      }
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }
  };

  const handlePostClick = (post: any) => {
    setSelectedPost(post);
    setShowPostDetail(true);
  };

  const handleScheduleClick = (post: any) => {
    // Use platforms from post data (saved during generation), not current state
    // Multiple fallbacks to ensure platforms are never empty
    let platforms = post.requestedPlatforms || post.platforms || selectedPlatforms;
    
    // Extra safeguard: If still empty (shouldn't happen), use auto-gen default
    if (!platforms || platforms.length === 0) {
      platforms = ['twitter']; // Default for auto-generation (Twitter only for faster demo)
      console.warn('⚠️ No platforms found in handleScheduleClick, using default:', platforms);
    }
    
    // Create updated post object with guaranteed platforms and generatedContentId
    const updatedPost = {
      ...post,
      requestedPlatforms: platforms,
      platforms: platforms,
      generatedContentId: post.generatedContentId || generatedContentId,
    };
    
    console.log('🗓️ handleScheduleClick - Post data:', {
      'post.generatedContentId': post.generatedContentId,
      'state generatedContentId': generatedContentId,
      'final generatedContentId': updatedPost.generatedContentId,
      'post.requestedPlatforms': post.requestedPlatforms,
      'post.platforms': post.platforms,
      'selectedPlatforms': selectedPlatforms,
      'final platforms': platforms,
      'platforms length': platforms?.length,
      'post.postIndex': post.postIndex,
      'updatedPost': updatedPost
    });
    
    setSelectedPost(updatedPost);
    setShowScheduleDialog(true);
  };

  const handleScheduleComplete = () => {
    // Refresh schedules after scheduling
    if (generatedContentId) {
      fetchSchedules(generatedContentId);
    }
  };

  // Note: handleAuthPlatform removed - using redirect-based OAuth flow instead

  const handlePostNowClick = async (post: any) => {
    console.log('🎬 handlePostNowClick START:', {
      'post.type': post.type,
      'post.requestedPlatforms': post.requestedPlatforms,
      'post.platforms': post.platforms,
      'post.image': post.image?.substring(0, 50) + '...',
    });
    
    // Use platforms from post data (saved during generation), not current state
    // Multiple fallbacks to ensure platforms are never empty
    let platforms = post.requestedPlatforms || post.platforms || selectedPlatforms;
    
    // Extra safeguard: If still empty (shouldn't happen), use auto-gen default
    if (!platforms || platforms.length === 0) {
      platforms = ['twitter']; // Default for auto-generation (Twitter only for faster demo)
      console.warn('⚠️ No platforms found in handlePostNowClick, using default:', platforms);
    }
    
    // Create updated post object with guaranteed platforms
    const updatedPost = {
      ...post,
      requestedPlatforms: platforms,
      platforms: platforms,
      generatedContentId: generatedContentId,
    };
    
    console.log('📝 Updated post object:', {
      'type': updatedPost.type,
      'platforms': updatedPost.platforms,
      'requestedPlatforms': updatedPost.requestedPlatforms,
    });
    
    setSelectedPost(updatedPost);
    setPendingPost(updatedPost);

    try {
      // IMPORTANT: Always validate OAuth2 only (not OAuth1) to avoid confusion
      // OAuth1 for Twitter videos is checked separately below
      const validation = await postingApi.validateTokens({
        platforms,
        requireOAuth1ForTwitterVideo: false,
      });

      console.log('🔍 Token validation result:', validation.data);

      // Check if any platforms need OAuth2 reauth or are not connected
      const platformsNeedingAuth = validation.data.platforms
        .filter((p: any) => p.requiresReauth || !p.connected)
        .map((p: any) => p.platform);

      if (platformsNeedingAuth.length > 0) {
        // Platforms need OAuth2 - use redirect-based auth flow
        console.log('🔐 Platforms needing OAuth2:', platformsNeedingAuth);
        
        // Determine if OAuth1 will be needed after OAuth2
        const needsOAuth1ForVideo = platforms.includes('twitter') && post.type === 'Video';
        
        // Save flow state before redirecting
        saveOAuthFlowState({
          type: 'post_now',
          source: 'generate_dialog',
          post: {
            id: post.id,
            type: post.type,
            image: post.image,
            description: post.description,
            requestedPlatforms: platforms,
            platforms: platforms,
            platformTexts: post.platformTexts,
            fullPlatformTexts: post.fullPlatformTexts,
            postIndex: post.postIndex,
            generatedContentId: generatedContentId,
          },
          platformsToAuth: platformsNeedingAuth,
          currentPlatformIndex: 0,
          needsOAuth1: needsOAuth1ForVideo,
          oauth1Completed: false,
          generatedPosts: generatedPosts,
          generatedContentId: generatedContentId,
          generationUuid: generationUuid,
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

      // All OAuth2 tokens valid - now check OAuth1 for Twitter videos
      if (platforms.includes('twitter') && post.type === 'Video') {
        console.log('📹 Twitter video detected - checking OAuth1 status');
        const oauth1Status = await oauth1Api.getOAuth1Status();
        console.log('🔍 OAuth1 status:', oauth1Status.data);
        
        // Check if OAuth1 token is valid (not just present)
        if (!oauth1Status.data.oauth1Valid) {
          console.log('⚠️ OAuth1 not valid - initiating redirect OAuth1 flow');
          
          // Save flow state for OAuth1
          saveOAuthFlowState({
            type: 'post_now',
            source: 'generate_dialog',
            post: {
              id: post.id,
              type: post.type,
              image: post.image,
              description: post.description,
              requestedPlatforms: platforms,
              platforms: platforms,
              platformTexts: post.platformTexts,
              fullPlatformTexts: post.fullPlatformTexts,
              postIndex: post.postIndex,
              generatedContentId: generatedContentId,
            },
            platformsToAuth: [], // OAuth2 already done
            currentPlatformIndex: 0,
            needsOAuth1: true,
            oauth1Completed: false,
            generatedPosts: generatedPosts,
            generatedContentId: generatedContentId,
            generationUuid: generationUuid,
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
        console.log('✅ OAuth1 valid - proceeding with posting');
      }

      // All validations passed, proceed with posting
      console.log('🚀 All auth checks passed - starting post');
      await startPosting(updatedPost);
    } catch (error: any) {
      console.error('Error in Post Now flow:', error);
      toast({
        title: "Connection Failed",
        description: "Couldn't connect to your accounts. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Note: initiateOAuth1Flow removed - using redirect-based OAuth1 flow instead

  const startPosting = async (post: any) => {
    console.log('📤 startPosting called with:', {
      'post.type': post.type,
      'post.image': post.image?.substring(0, 60) + '...',
      'post.description': post.description?.substring(0, 50) + '...',
      'post.requestedPlatforms': post.requestedPlatforms,
    });
    
    setShowPostingDialog(true);
    setPostingComplete(false);
    setIsPosting(true);
    setPostingResults([]);

    try {
      // Extract media URL and type
      const mediaUrl = post.image; // This contains the S3 URL
      const mediaType = post.type === 'Video' ? 'video' : 'image';
      
      console.log('📤 Media info:', {
        'mediaType': mediaType,
        'mediaUrl': mediaUrl?.substring(0, 60) + '...',
        'post.type': post.type,
      });
      
      // Use platforms from post data (saved during generation), not current state
      // Multiple fallbacks to ensure platforms are never empty
      let platforms = post.requestedPlatforms || selectedPlatforms;
      
      // Extra safeguard: If still empty (shouldn't happen), use auto-gen default
      if (!platforms || platforms.length === 0) {
        platforms = ['twitter']; // Default for auto-generation (Twitter only for faster demo)
        console.warn('⚠️ No platforms found, using default:', platforms);
      }
      
      console.log('🚀 Start Posting - Post data:', {
        'post.requestedPlatforms': post.requestedPlatforms,
        'selectedPlatforms': selectedPlatforms,
        'final platforms': platforms,
        'platforms length': platforms?.length,
        'post': post
      });

      // Call posting API
      const response = await postingApi.postNow({
        platforms: platforms, // Use saved platforms, not current state
        content: {
          caption: post.description || post.title, // Fallback caption
          platformTexts: post.platformTexts || {}, // Platform-specific full texts
          mediaUrl: mediaUrl,
          mediaType: mediaType,
          generatedContentId: post.generatedContentId, // ID of dvyb_generated_content record
          postIndex: post.postIndex, // Index within the arrays (for tracking)
        },
      });

      setPostingResults(response.data.results);
      setPostingComplete(true);

      // Check if any platform needs OAuth1
      const needsOAuth1 = response.data.results.some((r: any) => r.needsOAuth1);
      if (needsOAuth1) {
        setNeedsOAuth1(true);
        toast({
          title: "Video Authorization Required",
          description: "Twitter requires separate authorization for video uploads.",
          variant: "default",
        });
      } else {
        const platforms = post.requestedPlatforms || selectedPlatforms;
        const successCount = response.data.results.filter((r: any) => r.success).length;
        toast({
          title: "Posting Complete",
          description: `Posted to ${successCount}/${platforms.length} platform(s)`,
          variant: successCount > 0 ? "default" : "destructive",
        });
      }
    } catch (error: any) {
      console.error('Posting error:', error);
      setPostingComplete(true);
      toast({
        title: "Couldn't Post",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsPosting(false);
    }
  };

  const handleReplaceAndPost = () => {
    setShowPostNowOverlap(false);
    if (selectedPost) {
      startPosting(selectedPost);
    }
  };

  const handleScheduleInstead = () => {
    setShowPostNowOverlap(false);
    setShowScheduleDialog(true);
  };

  const resetDialog = () => {
    setStep("topic");
    setSelectedTopic("");
    setCustomTopic("");
    setShowCustomTopic(false);
    setSelectedPlatforms([]);
    setContextText("");
    setUploadedS3Urls([]);
    setInspirationLinks([""]);
    setImagePostCount([2]);
    setVideoPostCount([2]);
    setGeneratedPosts([]);
    setJobId(null);
    setGenerationUuid(null);
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
    // Notify parent that dialog has closed (for onboarding tracking)
    onDialogClosed?.();
  };

  const renderStep = () => {
    switch (step) {
      case "topic":
        return (
          <div className="space-y-4 sm:space-y-5 md:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold mb-1 sm:mb-2">Choose a topic</h2>
              <p className="text-sm sm:text-base text-muted-foreground">Select a topic or add your own</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              {TOPICS.map((topic) => (
                <Card
                  key={topic}
                  className={`p-4 sm:p-5 md:p-6 cursor-pointer transition-all hover:border-primary ${
                    selectedTopic === topic ? "border-primary bg-primary/5" : ""
                  }`}
                  onClick={() => {
                    setSelectedTopic(topic);
                    setCustomTopic(""); // Clear custom topic when selecting a predefined topic
                    setShowCustomTopic(false); // Hide custom topic input
                  }}
                >
                  <p className="font-medium text-center text-sm sm:text-base">{topic}</p>
                </Card>
              ))}
            </div>

            {showCustomTopic ? (
              <div className="space-y-2">
                <Input
                  placeholder="Enter your custom topic..."
                  value={customTopic}
                  onChange={(e) => {
                    setCustomTopic(e.target.value);
                    setSelectedTopic(""); // Clear selected topic when typing custom topic
                  }}
                  className="text-sm sm:text-base"
                  autoFocus
                />
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full gap-2 text-sm sm:text-base h-10 sm:h-11"
                onClick={() => setShowCustomTopic(true)}
              >
                <Plus className="w-4 h-4" />
                Add custom topic
              </Button>
            )}

            <Button
              className="w-full text-sm sm:text-base h-10 sm:h-11"
              disabled={!selectedTopic && !customTopic}
              onClick={() => setStep("platform")}
            >
              Continue
            </Button>
          </div>
        );

      case "platform":
        return (
          <div className="space-y-4 sm:space-y-5 md:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold mb-1 sm:mb-2">Choose platform(s)</h2>
              <p className="text-sm sm:text-base text-muted-foreground">Select where you want to post</p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4">
              {PLATFORMS.map((platform) => (
                <Card
                  key={platform.id}
                  className={`p-4 sm:p-5 md:p-6 cursor-pointer transition-all hover:border-primary ${
                    selectedPlatforms.includes(platform.id) ? "border-primary bg-primary/5" : ""
                  }`}
                  onClick={() => {
                    setSelectedPlatforms(prev =>
                      prev.includes(platform.id)
                        ? prev.filter(p => p !== platform.id)
                        : [...prev, platform.id]
                    );
                  }}
                >
                  <div className="flex flex-col items-center gap-1.5 sm:gap-2">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full ${platform.color} flex items-center justify-center text-white`}>
                      <platform.IconComponent className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" />
                    </div>
                    <p className="font-medium text-xs sm:text-sm md:text-base text-center">{platform.name}</p>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 text-sm sm:text-base h-10 sm:h-11" onClick={() => setStep("topic")}>
                Back
              </Button>
              <Button
                className="flex-1 text-sm sm:text-base h-10 sm:h-11"
                disabled={selectedPlatforms.length === 0}
                onClick={() => setStep("context")}
              >
                Continue
              </Button>
            </div>
          </div>
        );

      case "context":
        return (
          <div className="space-y-4 sm:space-y-5 md:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold mb-1 sm:mb-2">Add context</h2>
              <p className="text-sm sm:text-base text-muted-foreground">Provide additional details for better content</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs sm:text-sm font-medium mb-1.5 sm:mb-2 block">Instructions</label>
                <Textarea
                  placeholder="Add any specific instructions or context..."
                  value={contextText}
                  onChange={(e) => setContextText(e.target.value)}
                  rows={4}
                  className="text-sm sm:text-base"
                />
              </div>

              <div>
                <label className="text-xs sm:text-sm font-medium mb-1.5 sm:mb-2 block">Upload files</label>
                <FileDropZone
                  onFilesSelected={handleFilesSelected}
                  accept="image/*"
                  multiple={true}
                  maxFiles={10}
                  currentFiles={uploadedS3Urls}
                  onRemove={handleRemoveFile}
                  preview={true}
                  uploadType="images"
                />
              </div>

              <div>
                <label className="text-xs sm:text-sm font-medium mb-1.5 sm:mb-2 block">Inspiration links</label>
                <div className="space-y-2">
                  {inspirationLinks.map((link, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        placeholder="Paste URL, X link, Instagram link..."
                        value={link}
                        onChange={(e) => {
                          const newLinks = [...inspirationLinks];
                          newLinks[idx] = e.target.value;
                          setInspirationLinks(newLinks);
                        }}
                        className="text-sm sm:text-base"
                      />
                      {inspirationLinks.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 flex-shrink-0"
                          onClick={() => setInspirationLinks(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 text-sm h-9 sm:h-10"
                    onClick={() => setInspirationLinks(prev => [...prev, ""])}
                  >
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span className="text-xs sm:text-sm">Add another link</span>
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 text-sm sm:text-base h-10 sm:h-11" onClick={() => setStep("platform")}>
                Back
              </Button>
              <Button className="flex-1 text-sm sm:text-base h-10 sm:h-11" onClick={() => setStep("review")}>
                Continue
              </Button>
            </div>
          </div>
        );

      case "review":
        return (
          <div className="space-y-4 sm:space-y-5 md:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold mb-1 sm:mb-2">Review & Generate</h2>
              <p className="text-sm sm:text-base text-muted-foreground">Review your selections and generate content</p>
            </div>

            <div className="space-y-3 sm:space-y-4">
              <Card className="p-3 sm:p-4">
                <h3 className="font-medium mb-1.5 sm:mb-2 text-sm sm:text-base">Topic</h3>
                <p className="text-sm sm:text-base text-muted-foreground">{customTopic || selectedTopic}</p>
              </Card>

              <Card className="p-3 sm:p-4">
                <h3 className="font-medium mb-1.5 sm:mb-2 text-sm sm:text-base">Platforms</h3>
                <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                  {selectedPlatforms.map(id => {
                    const platform = PLATFORMS.find(p => p.id === id);
                    if (!platform) return null;
                    return (
                      <Badge key={id} variant="secondary" className="flex items-center gap-1 sm:gap-1.5 py-1 sm:py-1.5 px-2 sm:px-3 text-xs sm:text-sm">
                        <platform.IconComponent className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span>{platform.name}</span>
                      </Badge>
                    );
                  })}
                </div>
              </Card>

              {contextText && (
                <Card className="p-3 sm:p-4">
                  <h3 className="font-medium mb-1.5 sm:mb-2 text-sm sm:text-base">Instructions</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">{contextText}</p>
                </Card>
              )}

              <div className="space-y-4">
                {/* Image Posts Slider */}
              <div>
                  <label className="text-xs sm:text-sm font-medium mb-2 block">
                    Image posts: {imagePostCount[0]}
                </label>
                <Slider
                    key={`image-slider-${imageSliderMax}`}
                    value={imagePostCount}
                    onValueChange={(value) => {
                      const newImageCount = Math.min(value[0], imageSliderMax);
                      const currentVideoCount = videoPostCount[0];
                      const total = newImageCount + currentVideoCount;
                      
                      // Auto-decrease video count if total exceeds 4
                      if (total > 4) {
                        const newVideoCount = Math.max(0, 4 - newImageCount);
                        setVideoPostCount([newVideoCount]);
                      }
                      
                      setImagePostCount([newImageCount]);
                    }}
                    min={0}
                    max={imageSliderMax}
                  step={1}
                  className="mb-2"
                    disabled={imageSliderMax === 0}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                    {Array.from({ length: Math.min(imageSliderMax, 4) + 1 }, (_, i) => (
                      <span key={i}>{i}</span>
                    ))}
                </div>
                  {usageData && (
                    <p className="text-xs text-gray-500 mt-1">
                      {usageData.remainingImages} remaining
                    </p>
                  )}
                </div>

                {/* Video Posts Slider */}
                <div>
                  <label className="text-xs sm:text-sm font-medium mb-2 block">
                    Video posts: {videoPostCount[0]}
                  </label>
                  <Slider
                    key={`video-slider-${videoSliderMax}`}
                    value={videoPostCount}
                    onValueChange={(value) => {
                      const newVideoCount = Math.min(value[0], videoSliderMax);
                      const currentImageCount = imagePostCount[0];
                      const total = currentImageCount + newVideoCount;
                      
                      // Auto-decrease image count if total exceeds 4
                      if (total > 4) {
                        const newImageCount = Math.max(0, 4 - newVideoCount);
                        setImagePostCount([newImageCount]);
                      }
                      
                      setVideoPostCount([newVideoCount]);
                    }}
                    min={0}
                    max={videoSliderMax}
                    step={1}
                    className="mb-2"
                    disabled={videoSliderMax === 0}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    {Array.from({ length: Math.min(videoSliderMax, 4) + 1 }, (_, i) => (
                      <span key={i}>{i}</span>
                    ))}
                  </div>
                  {usageData && (
                    <p className="text-xs text-gray-500 mt-1">
                      {usageData.remainingVideos} remaining
                    </p>
                  )}
                </div>

                {/* Total Posts Summary */}
                <div className="pt-2 border-t">
                  <p className="text-sm font-medium">
                    Total posts to generate: <span className="text-blue-600">{imagePostCount[0] + videoPostCount[0]}</span>
                    <span className="text-xs text-muted-foreground ml-2">(max 4 per generation)</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 text-sm sm:text-base h-10 sm:h-11" onClick={() => setStep("context")}>
                Back
              </Button>
              <Button 
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-sm sm:text-base h-10 sm:h-11" 
                onClick={handleGenerate}
                disabled={imagePostCount[0] + videoPostCount[0] === 0}
              >
                Generate
              </Button>
            </div>
          </div>
        );

      case "results":
        const isGenerating = generatedPosts.some(post => post.isGenerating);
        
        return (
          <div className="space-y-4 sm:space-y-5 md:space-y-6">
            <div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold mb-1 sm:mb-2">
                {isGenerating ? "Generating your content..." : "Your content is ready!"}
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground">
                {isGenerating ? "Content will appear as it's generated" : "Select a post to schedule or publish"}
              </p>
            </div>

            {isGenerating && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="text-muted-foreground line-clamp-1">{progressMessage || "Preparing..."}</span>
                  <span className="font-medium ml-2">{progressPercent}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-1.5 sm:h-2 overflow-hidden">
                  <div 
                    className="bg-primary h-full transition-all duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {progressMessage.includes("video") && (
                  <p className="text-[10px] sm:text-xs text-muted-foreground italic">
                    ⏱️ Video generation in progress - this may take a few minutes...
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {generatedPosts.map((post) => (
                <Card
                  key={post.id}
                  className={`overflow-hidden transition-all ${
                    post.isGenerating 
                      ? "opacity-60" 
                      : post.isFailed
                        ? "opacity-70 border-red-200"
                      : "cursor-pointer hover:border-primary group"
                  }`}
                  onClick={() => !post.isGenerating && !post.isFailed && handlePostClick(post)}
                >
                  <div className="relative">
                  {post.isFailed ? (
                    <div className="w-full aspect-square bg-red-50 flex flex-col items-center justify-center text-red-500">
                      <X className="w-10 h-10 mb-2" />
                      <span className="text-sm font-medium">Unable to Generate</span>
                      <span className="text-xs text-red-400 mt-1">Content generation failed</span>
                    </div>
                  ) : post.image ? (
                    post.type === "Video" ? (
                      <div className="w-full aspect-square bg-black">
                        <video
                          src={post.image}
                          controls
                          playsInline
                          muted
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            console.error("Video load error:", e);
                          }}
                        />
                      </div>
                    ) : (
                      <img
                        src={post.image}
                        alt={post.title}
                        className="w-full aspect-square object-cover"
                      />
                    )
                  ) : (
                    <div className="w-full aspect-square bg-muted flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  )}
                    
                    {/* Schedule/Posted Badges */}
                    {(() => {
                      const scheduleKey = `${post.generatedContentId}-${post.postIndex}`;
                      const schedule = postSchedules[scheduleKey];
                      
                      if (!schedule) return null;
                      
                      const status = schedule.status;
                      const platforms = schedule.postMetadata?.platforms || [];
                      
                      // Determine badge color and text
                      let badgeColor = 'bg-yellow-600';
                      let badgeText = 'Scheduled';
                      
                      if (status === 'posted') {
                        badgeColor = 'bg-green-600';
                        // Show which platforms were posted to
                        const postedPlatforms = schedule.postMetadata?.postingResults
                          ?.filter((r: any) => r.success)
                          .map((r: any) => r.platform.charAt(0).toUpperCase() + r.platform.slice(1)) || [];
                        
                        if (postedPlatforms.length === platforms.length) {
                          badgeText = 'Posted';
                        } else if (postedPlatforms.length > 0) {
                          badgeText = `Posted (${postedPlatforms.length}/${platforms.length})`;
                        } else {
                          badgeText = 'Posted';
                        }
                      } else if (status === 'failed') {
                        badgeColor = 'bg-red-600';
                        badgeText = 'Failed';
                      }
                      
                      return (
                        <div className={`absolute top-2 left-2 ${badgeColor} text-white text-xs font-semibold px-2 py-1 rounded-full z-10`}>
                          {badgeText}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="p-2.5 sm:p-3">
                    <p className="font-medium text-xs sm:text-sm line-clamp-2">{post.title}</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 line-clamp-1">
                      {post.isFailed ? "Generation failed for this content" : post.description}
                    </p>
                    {!post.isGenerating && !post.isFailed && (
                      <div className="flex gap-1.5 sm:gap-2 mt-2 sm:mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs sm:text-sm h-8 sm:h-9"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleScheduleClick(post);
                          }}
                        >
                          Schedule
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm h-8 sm:h-9"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePostNowClick(post);
                          }}
                        >
                          Post Now
                        </Button>
                      </div>
                    )}
                    {post.isGenerating && (
                      <div className="flex items-center justify-center mt-2 sm:mt-3 text-[10px] sm:text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        Generating...
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex justify-center">
              <Button 
                variant="outline" 
                className="w-full max-w-xs text-sm sm:text-base h-10 sm:h-11" 
                onClick={handleClose}
                disabled={isGenerating}
              >
                Done
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={open && !showPostDetail && !showScheduleDialog} onOpenChange={handleClose}>
        <DialogContent className="w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[70vw] xl:max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <VisuallyHidden>
            <DialogTitle>Generate Content</DialogTitle>
          </VisuallyHidden>
          <div className="py-2 sm:py-4 md:py-6">
            {renderStep()}
          </div>
        </DialogContent>
      </Dialog>

      <PostDetailDialog
        post={selectedPost ? {
          ...selectedPost,
          // Ensure generatedContentId is set (use state as fallback)
          generatedContentId: selectedPost.generatedContentId || generatedContentId,
          postIndex: selectedPost.postIndex,
          fullPlatformTexts: selectedPost.platformTexts, // Map platformTexts to fullPlatformTexts
        } : null}
        open={showPostDetail}
        onOpenChange={(open) => {
          setShowPostDetail(open);
          if (!open) setSelectedPost(null);
        }}
      />

      <ScheduleDialog
        post={selectedPost ? (() => {
          // Use state generatedContentId as fallback if post doesn't have it
          const finalGeneratedContentId = selectedPost.generatedContentId || generatedContentId;
          
          // Ensure platforms are always set with multiple fallbacks
          const finalPlatforms = selectedPost.requestedPlatforms || selectedPost.platforms || selectedPlatforms || ['twitter'];
          
          const postData = {
            ...selectedPost,
            fullPlatformTexts: selectedPost.platformTexts, // Map platformTexts to fullPlatformTexts
            generatedContentId: finalGeneratedContentId,
            postIndex: selectedPost.postIndex,
            requestedPlatforms: finalPlatforms,
            platforms: finalPlatforms,
          };
          console.log('📋 GenerateContentDialog - Passing to ScheduleDialog:', {
            'selectedPost.generatedContentId': selectedPost.generatedContentId,
            'state generatedContentId': generatedContentId,
            'final generatedContentId': finalGeneratedContentId,
            'selectedPost.requestedPlatforms': selectedPost.requestedPlatforms,
            'selectedPost.platforms': selectedPost.platforms,
            'selectedPlatforms state': selectedPlatforms,
            'final platforms': finalPlatforms,
            'selectedPost.postIndex': selectedPost.postIndex,
            'postData': postData,
          });
          return postData;
        })() : null}
        open={showScheduleDialog}
        onOpenChange={setShowScheduleDialog}
        // Pass generatedContentId directly as override prop to ensure it's always available
        // This handles the case where post.generatedContentId might be undefined during generation
        generatedContentIdOverride={generatedContentId}
        onScheduleComplete={() => {
          handleScheduleComplete();
          setShowScheduleDialog(false);
          onOpenChange(false);
          resetDialog();
          // Notify parent that dialog has closed (for onboarding tracking)
          onDialogClosed?.();
        }}
      />

      <AlertDialog open={showPostingDialog} onOpenChange={setShowPostingDialog}>
        <AlertDialogContent className="w-[90vw] sm:w-[85vw] md:max-w-md p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-lg sm:text-xl">
              {!postingComplete ? "Posting..." : "Posting Results"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {!postingComplete && (
                <div className="flex flex-col items-center justify-center py-4 sm:py-6">
                  <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 animate-spin text-primary mb-3 sm:mb-4" />
                  <p className="text-sm sm:text-base">Publishing your content to selected platforms...</p>
                </div>
              )}
              {postingComplete && (
                <div className="py-3 sm:py-4 space-y-2 sm:space-y-3">
                  {postingResults.length === 0 ? (
                    <p className="text-base sm:text-lg">No results available</p>
                  ) : (
                    <div className="space-y-2">
                      {postingResults.map((result, idx) => (
                        <div
                          key={idx}
                          className={`p-2.5 sm:p-3 rounded-lg border ${
                            result.success
                              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                              : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium capitalize text-sm sm:text-base">{result.platform}</span>
                            <Badge variant={result.success ? "default" : "destructive"} className="text-xs">
                              {result.success ? "✓ Posted" : "✗ Failed"}
                            </Badge>
                          </div>
                          {result.error && (
                            <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{result.error}</p>
                          )}
                          {result.needsOAuth1 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 w-full text-xs sm:text-sm h-8 sm:h-9"
                              onClick={async () => {
                                // Initiate OAuth1 redirect flow
                                try {
                                  const response = await oauth1Api.initiateOAuth1();
                                  const { authUrl, state, oauthTokenSecret } = response.data;
                                  
                                  // Store OAuth1 state
                                  localStorage.setItem('oauth1_state', state);
                                  localStorage.setItem('oauth1_token_secret', oauthTokenSecret);
                                  
                                  toast({
                                    title: "Redirecting...",
                                    description: "Authorizing video uploads for Twitter",
                                  });
                                  
                                  window.location.href = authUrl;
                                } catch (error) {
                                  toast({
                                    title: "Error",
                                    description: "Failed to start video authorization. Please try again.",
                                    variant: "destructive",
                                  });
                                }
                              }}
                            >
                              Authorize for Video
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {postingComplete && (
            <AlertDialogFooter>
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-sm sm:text-base h-10 sm:h-11"
                onClick={() => {
                  setShowPostingDialog(false);
                  setPostingResults([]);
                }}
              >
                Done
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showPostNowOverlap} onOpenChange={setShowPostNowOverlap}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Time Conflict</AlertDialogTitle>
            <AlertDialogDescription>
              There is already a post scheduled within 2 hours of the current time.
              <br />
              <br />
              Would you like to replace the existing post or schedule this post for a different time?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleScheduleInstead}>
              Schedule Instead
            </Button>
            <Button onClick={handleReplaceAndPost} className="bg-blue-600 hover:bg-blue-700">
              Replace & Post
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Note: Multi-Platform Authorization Dialog removed - using redirect-based OAuth */}
    </>
  );
};
