"use client";


import { useState, useEffect, useRef } from "react";
import { X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ChevronRight, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Sparkles, RotateCcw, Music, Calendar as CalendarIcon,
  Type, Bold, Italic, Underline, Trash2, Plus, RotateCw, Smile, Sticker, X, Save, Loader2, XCircle
} from "lucide-react";
import { CaptionEditDialog } from "./CaptionEditDialog";
import { ScheduleDialog } from "./ScheduleDialog";
import { accountApi, captionsApi, imageEditsApi, imageRegenerationApi, contentLibraryApi, postingApi, oauth1Api, authApi, socialConnectionsApi } from "@/lib/api";
import { getWebsiteDomainDisplay } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { saveOAuthFlowState } from "@/lib/oauthFlowState";
import { VideoEditorModal } from "@/components/video-editor/VideoEditorModal";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Text Overlay Interface
interface TextOverlay {
  id: string;
  text: string;
  x: number; // percentage position (center)
  y: number; // percentage position (center)
  width: number; // percentage width
  height: number; // percentage height
  rotation: number; // degrees
  fontSize: number; // base font size
  fontFamily: string;
  color: string;
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
}

// Interaction mode for overlay
type InteractionMode = 'none' | 'drag' | 'resize' | 'rotate';
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

// Available fonts for text overlays
const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Impact', label: 'Impact' },
  { value: 'Comic Sans MS', label: 'Comic Sans' },
  { value: 'Verdana', label: 'Verdana' },
];

// Color presets for quick selection (reduced to 4 for toolbar space)
const COLOR_PRESETS = ['#FFFFFF', '#000000', '#FF0000', '#FFFF00'];

// Emoji categories for quick selection
const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇', '🤔'],
  'Gestures': ['👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '👊', '✊', '🤟', '💪', '🙏', '👋', '🤙', '💅'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💕', '💖', '💗', '💘', '💝', '💞', '❣️'],
  'Symbols': ['⭐', '🌟', '✨', '💫', '🔥', '💥', '💯', '✅', '❌', '⚡', '💡', '🎯', '🏆', '🎉', '🎊'],
  'Nature': ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '🍀', '🌿', '🍃', '🌴', '🌈', '☀️', '🌙', '⛅', '🌊'],
  'Food': ['🍕', '🍔', '🍟', '🌮', '🍦', '🍩', '🍪', '🎂', '🍰', '☕', '🍷', '🍾', '🥤', '🍿', '🥗'],
  'Objects': ['📱', '💻', '📷', '🎬', '🎵', '🎸', '🎤', '🎧', '📚', '✏️', '💼', '🛒', '💰', '💎', '🎁'],
};

// Sticker emojis (larger decorative elements)
const STICKERS = ['🎀', '🎗️', '🏷️', '📍', '📌', '💬', '💭', '🗯️', '👑', '🎭', '🎪', '🎨', '🖼️', '🎹', '🎺', '🥁', '🎻', '🪄', '✨', '💫'];

interface Post {
  id: string;
  generatedContentId?: number; // For scheduling
  postIndex?: number; // For scheduling
  contentId?: number; // Alias for generatedContentId (from ContentLibrary)
  date: string;
  time: string;
  type: "Post" | "Story";
  platforms: string[];
  title: string;
  description: string; // Truncated for UI display
  fullPlatformTexts?: any; // Full platform texts for posting
  image: string;
  originalMediaUrl?: string; // Original S3 key for image edits
  requestedPlatforms?: string[];
  videoModel?: string | null; // Model used for video generation (kling = 1:1, veo3 = 9:16)
  status?: string; // Content status (pending-review, selected, not-selected, scheduled, etc.)
}

interface PostDetailDialogProps {
  post: Post | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditDesignModeChange?: (isEditMode: boolean) => void;
  onScheduleComplete?: () => void;
  // For pending review functionality
  pendingReviewItems?: Post[];
  onAcceptReject?: (accepted: boolean, post: Post) => void;
  onAllReviewed?: () => void;
}

type Platform = "instagram" | "linkedin" | "twitter";

export const PostDetailDialog = ({ 
  post, 
  open, 
  onOpenChange, 
  onEditDesignModeChange, 
  onScheduleComplete,
  pendingReviewItems = [],
  onAcceptReject,
  onAllReviewed,
}: PostDetailDialogProps) => {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("instagram");
  const [showCaptionEdit, setShowCaptionEdit] = useState(false);
  const [showEditDesign, setShowEditDesign] = useState(false);
  const [showVideoEditor, setShowVideoEditor] = useState(false);
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [regeneratedImageUrl, setRegeneratedImageUrl] = useState<string | null>(null); // For chat-based image regeneration
  const [activeImageS3Key, setActiveImageS3Key] = useState<string | null>(null); // Current image S3 key for regeneration
  const [editDesignBaseImageUrl, setEditDesignBaseImageUrl] = useState<string | null>(null); // Base image URL for Edit Design mode (original or regenerated)
  const [refreshedOriginalUrl, setRefreshedOriginalUrl] = useState<string | null>(null); // Fresh presigned URL for the absolute original image
  const [regenerations, setRegenerations] = useState<Array<{
    id: number;
    prompt: string;
    regeneratedImageUrl: string | null;
    regeneratedImageS3Key: string | null;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdAt: string;
  }>>([]); // Regeneration history
  const [isRegenerating, setIsRegenerating] = useState(false); // Whether regeneration is in progress
  const [pollingRegenId, setPollingRegenId] = useState<number | null>(null); // ID of regeneration being polled
  const [caption, setCaption] = useState(post?.description || "");
  const [aiPrompt, setAiPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [editedCaptions, setEditedCaptions] = useState<Record<string, string>>({}); // User-edited captions
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isAcceptingRejecting, setIsAcceptingRejecting] = useState(false);
  
  // Swipe gesture state for pending review
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isAnimatingOut, setIsAnimatingOut] = useState<'left' | 'right' | null>(null);
  const [animatingOutPost, setAnimatingOutPost] = useState<any>(null); // Track which post is animating
  
  // Post Now state
  const [showPostingDialog, setShowPostingDialog] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [postingComplete, setPostingComplete] = useState(false);
  const [postingResults, setPostingResults] = useState<any[]>([]);
  const [needsOAuth1, setNeedsOAuth1] = useState(false);
  
  const { toast } = useToast();
  
  // Check if current post is pending review
  const isPendingReview = post?.status === 'pending-review';
  
  // Handle accept (like) action for pending review content
  const handleAccept = async (fromSwipe: boolean = false) => {
    if (!post || isAcceptingRejecting) return;
    
    const contentId = post.generatedContentId || post.contentId;
    if (!contentId || post.postIndex === undefined) {
      console.error('Missing contentId or postIndex for accept');
      return;
    }
    
    // Store the post being animated and start animation
    if (fromSwipe) {
      setAnimatingOutPost(post);
      setIsAnimatingOut('right');
    }
    
    setIsAcceptingRejecting(true);
    
    try {
      await contentLibraryApi.acceptContent(contentId, post.postIndex);
      
      // Wait for animation to complete
      await new Promise(resolve => setTimeout(resolve, fromSwipe ? 350 : 0));
      
      toast({
        title: "Content Accepted",
        description: "This content has been added to your Selected items.",
      });
      
      // Notify parent of accept - this will trigger re-render with next item
      // Animation state will be reset by useEffect when post changes
      onAcceptReject?.(true, post);
      
      // Check if there are more pending items
      const remainingItems = pendingReviewItems.filter(item => item.id !== post.id);
      if (remainingItems.length === 0) {
        // All items reviewed
        onAllReviewed?.();
        onOpenChange(false);
      }
    } catch (error) {
      console.error('Failed to accept content:', error);
      setIsAnimatingOut(null);
      setAnimatingOutPost(null);
      setSwipeOffset(0);
      toast({
        title: "Error",
        description: "Failed to accept content. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAcceptingRejecting(false);
    }
  };
  
  // Handle reject action for pending review content
  const handleReject = async (fromSwipe: boolean = false) => {
    if (!post || isAcceptingRejecting) return;
    
    const contentId = post.generatedContentId || post.contentId;
    if (!contentId || post.postIndex === undefined) {
      console.error('Missing contentId or postIndex for reject');
      return;
    }
    
    // Store the post being animated and start animation
    if (fromSwipe) {
      setAnimatingOutPost(post);
      setIsAnimatingOut('left');
    }
    
    setIsAcceptingRejecting(true);
    
    try {
      await contentLibraryApi.rejectContent(contentId, post.postIndex);
      
      // Wait for animation to complete
      await new Promise(resolve => setTimeout(resolve, fromSwipe ? 350 : 0));
      
      toast({
        title: "Content Rejected",
        description: "This content has been moved to Not Selected.",
      });
      
      // Notify parent of reject - this will trigger re-render with next item
      // Animation state will be reset by useEffect when post changes
      onAcceptReject?.(false, post);
      
      // Check if there are more pending items
      const remainingItems = pendingReviewItems.filter(item => item.id !== post.id);
      if (remainingItems.length === 0) {
        // All items reviewed
        onAllReviewed?.();
        onOpenChange(false);
      }
    } catch (error) {
      console.error('Failed to reject content:', error);
      setIsAnimatingOut(null);
      setAnimatingOutPost(null);
      setSwipeOffset(0);
      toast({
        title: "Error",
        description: "Failed to reject content. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAcceptingRejecting(false);
    }
  };
  
  // Touch swipe handlers for pending review (mobile)
  const minSwipeDistance = 80;
  
  const onTouchStart = (e: React.TouchEvent) => {
    if (!isPendingReview || isAcceptingRejecting) return;
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };
  
  const onTouchMove = (e: React.TouchEvent) => {
    if (!isPendingReview || isAcceptingRejecting || !touchStart) return;
    const currentX = e.targetTouches[0].clientX;
    setTouchEnd(currentX);
    // Calculate offset for tilt effect
    const offset = currentX - touchStart;
    setSwipeOffset(offset);
  };
  
  const onTouchEnd = () => {
    if (!touchStart || !touchEnd || !isPendingReview) {
      setSwipeOffset(0);
      return;
    }
    
    const distance = touchEnd - touchStart;
    const isRightSwipe = distance > minSwipeDistance; // Accept
    const isLeftSwipe = distance < -minSwipeDistance; // Reject
    
    if (isRightSwipe) {
      handleAccept(true);
    } else if (isLeftSwipe) {
      handleReject(true);
    } else {
      // Not enough swipe distance, reset
      setSwipeOffset(0);
    }
    
    // Reset touch state
    setTouchStart(null);
    setTouchEnd(null);
  };
  
  // Calculate style for swipe animation
  const getSwipeStyle = () => {
    if (isAnimatingOut === 'right') {
      return {
        transform: 'translateX(150%) rotate(30deg)',
        opacity: 0,
        transition: 'all 0.3s ease-out',
      };
    }
    if (isAnimatingOut === 'left') {
      return {
        transform: 'translateX(-150%) rotate(-30deg)',
        opacity: 0,
        transition: 'all 0.3s ease-out',
      };
    }
    if (swipeOffset !== 0) {
      const rotation = swipeOffset * 0.1; // Subtle rotation
      const maxRotation = 15;
      const clampedRotation = Math.max(-maxRotation, Math.min(maxRotation, rotation));
      return {
        transform: `translateX(${swipeOffset}px) rotate(${clampedRotation}deg)`,
        transition: 'none',
      };
    }
    return {
      transform: 'translateX(0) rotate(0)',
      transition: 'transform 0.2s ease-out',
    };
  };

  // Handle Post Now click - validates OAuth2/OAuth1 and posts content
  const handlePostNowClick = async () => {
    if (!post) return;
    
    console.log('🎬 PostDetailDialog handlePostNowClick START:', {
      'post.type': post.type,
      'post.requestedPlatforms': post.requestedPlatforms,
      'post.platforms': post.platforms,
      'post.image': post.image?.substring(0, 50) + '...',
    });
    
    // Use platforms from post data (saved during generation)
    let platforms = post.requestedPlatforms || post.platforms;
    
    // Safeguard: If still empty, default to twitter
    if (!platforms || platforms.length === 0) {
      platforms = ['twitter'];
      console.warn('⚠️ No platforms found in handlePostNowClick, using default:', platforms);
    }
    
    // Determine if this is a video post
    const isVideoPost = post.image && (post.image.includes('video') || post.image.includes('.mp4'));
    
    try {
      // Validate OAuth2 tokens
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
        const needsOAuth1ForVideo = platforms.includes('twitter') && isVideoPost;
        
        // Save flow state before redirecting
        saveOAuthFlowState({
          type: 'post_now',
          source: 'content_library',
          post: {
            id: post.id,
            type: isVideoPost ? 'Video' : 'Post',
            image: post.image,
            description: post.description,
            requestedPlatforms: platforms,
            platforms: platforms,
            platformTexts: {},
            fullPlatformTexts: post.fullPlatformTexts,
            postIndex: post.postIndex,
            generatedContentId: post.generatedContentId || post.contentId,
          },
          platformsToAuth: platformsNeedingAuth,
          currentPlatformIndex: 0,
          needsOAuth1: needsOAuth1ForVideo,
          oauth1Completed: false,
          generatedPosts: [],
          generatedContentId: post.generatedContentId || post.contentId || null,
          generationUuid: null,
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
      if (platforms.includes('twitter') && isVideoPost) {
        console.log('📹 Twitter video detected - checking OAuth1 status');
        const oauth1Status = await oauth1Api.getOAuth1Status();
        console.log('🔍 OAuth1 status:', oauth1Status.data);
        
        // Check if OAuth1 token is valid
        if (!oauth1Status.data.oauth1Valid) {
          console.log('⚠️ OAuth1 not valid - initiating redirect OAuth1 flow');
          
          // Save flow state for OAuth1
          saveOAuthFlowState({
            type: 'post_now',
            source: 'content_library',
            post: {
              id: post.id,
              type: 'Video',
              image: post.image,
              description: post.description,
              requestedPlatforms: platforms,
              platforms: platforms,
              platformTexts: {},
              fullPlatformTexts: post.fullPlatformTexts,
              postIndex: post.postIndex,
              generatedContentId: post.generatedContentId || post.contentId,
            },
            platformsToAuth: [], // OAuth2 already done
            currentPlatformIndex: 0,
            needsOAuth1: true,
            oauth1Completed: false,
            generatedPosts: [],
            generatedContentId: post.generatedContentId || post.contentId || null,
            generationUuid: null,
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
      await startPosting();
    } catch (error: any) {
      console.error('Error in Post Now flow:', error);
      toast({
        title: "Connection Failed",
        description: "Couldn't connect to your accounts. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Start posting content
  const startPosting = async () => {
    if (!post) return;
    
    console.log('📤 PostDetailDialog startPosting called with:', {
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
      const mediaUrl = post.image;
      const isVideoPost = post.image && (post.image.includes('video') || post.image.includes('.mp4'));
      const mediaType = isVideoPost ? 'video' : 'image';
      
      // Use platforms from post data
      let platforms = post.requestedPlatforms || post.platforms;
      
      if (!platforms || platforms.length === 0) {
        platforms = ['twitter'];
        console.warn('⚠️ No platforms found, using default:', platforms);
      }
      
      console.log('🚀 Start Posting - Post data:', {
        'post.requestedPlatforms': post.requestedPlatforms,
        'final platforms': platforms,
        'platforms length': platforms?.length,
      });

      // Get the caption for posting (use edited caption if available, or platform-specific)
      const captionToUse = editedCaptions[selectedPlatform] || 
                          (post.fullPlatformTexts?.[selectedPlatform]) || 
                          caption || 
                          post.description || 
                          post.title;

      // Call posting API
      const response = await postingApi.postNow({
        platforms: platforms,
        content: {
          caption: captionToUse,
          platformTexts: post.fullPlatformTexts || {},
          mediaUrl: mediaUrl,
          mediaType: mediaType,
          generatedContentId: post.generatedContentId || post.contentId,
          postIndex: post.postIndex,
        },
      });

      setPostingResults(response.data.results);
      setPostingComplete(true);

      // Check if any platform needs OAuth1
      const needsOAuth1Result = response.data.results.some((r: any) => r.needsOAuth1);
      if (needsOAuth1Result) {
        setNeedsOAuth1(true);
        toast({
          title: "Video Authorization Required",
          description: "Twitter requires separate authorization for video uploads.",
          variant: "default",
        });
      } else {
        const successCount = response.data.results.filter((r: any) => r.success).length;
        
        if (successCount > 0) {
          toast({
            title: "Posted Successfully! 🎉",
            description: `Your content was posted to ${successCount} platform(s).`,
          });
        }
      }
    } catch (error: any) {
      console.error('Error posting:', error);
      setPostingComplete(true);
      setPostingResults([{
        platform: 'all',
        success: false,
        error: error.message || 'Failed to post content'
      }]);
      toast({
        title: "Posting Failed",
        description: error.message || "Failed to post content. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsPosting(false);
    }
  };

  // Handle body overflow and animation when dialog opens/closes
  useEffect(() => {
    if (open && !showScheduleDialog) {
      document.body.style.overflow = 'hidden';
      const timeout = setTimeout(() => setIsVisible(true), 10);
      return () => clearTimeout(timeout);
    } else {
      setIsVisible(false);
      const timeout = setTimeout(() => {
        if (!showScheduleDialog) {
          document.body.style.overflow = 'unset';
        }
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [open, showScheduleDialog]);

  // Text overlay states
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState<string>('Smileys');
  const draggingIdRef = useRef<string | null>(null);
  const interactionModeRef = useRef<InteractionMode>('none');
  const resizeHandleRef = useRef<ResizeHandle | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const initialOverlayStateRef = useRef<{ x: number; y: number; width: number; height: number; rotation: number } | null>(null);
  const initialMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  // Double-tap detection for mobile
  const lastTapTimeRef = useRef<number>(0);
  const lastTapTargetRef = useRef<string | null>(null);
  
  // Reference width for font scaling (font sizes are set relative to this width)
  // Using typical desktop image width so fonts appear at set size on desktop
  // and scale down more aggressively on mobile
  const REFERENCE_WIDTH = 450; // pixels - base width for font size calculations
  
  // Get current image width directly from DOM for accurate scaling
  const getCurrentImageWidth = () => {
    if (imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      return rect.width > 0 ? rect.width : REFERENCE_WIDTH;
    }
    return REFERENCE_WIDTH;
  };

  // Get selected overlay
  const selectedOverlay = textOverlays.find(o => o.id === selectedOverlayId);

  // Check if Save Design button should be enabled
  // Enabled when: (a) image has been regenerated OR (b) overlays have been added
  const hasOverlays = textOverlays.length > 0;
  const hasRegeneratedImage = regeneratedImageUrl !== null && regeneratedImageUrl !== post?.image;
  const canSaveDesign = hasOverlays || hasRegeneratedImage;

  // Add new text overlay
  const addTextOverlay = () => {
    const newOverlay: TextOverlay = {
      id: `overlay-${Date.now()}`,
      text: 'Your Text Here',
      x: 50,
      y: 50,
      width: 30, // percentage of container width
      height: 10, // percentage of container height
      rotation: 0,
      fontSize: 24,
      fontFamily: 'Inter',
      color: '#FFFFFF',
      isBold: false,
      isItalic: false,
      isUnderline: false,
    };
    setTextOverlays([...textOverlays, newOverlay]);
    setSelectedOverlayId(newOverlay.id);
  };

  // Add emoji/sticker as a new overlay
  const addEmojiOverlay = (emoji: string, isSticker: boolean = false) => {
    const newOverlay: TextOverlay = {
      id: `overlay-${Date.now()}`,
      text: emoji,
      x: 50,
      y: 50,
      width: isSticker ? 15 : 10, // Stickers are larger
      height: isSticker ? 15 : 10,
      rotation: 0,
      fontSize: isSticker ? 48 : 36, // Larger font for emoji/stickers
      fontFamily: 'Inter',
      color: '#FFFFFF', // Doesn't affect emoji color
      isBold: false,
      isItalic: false,
      isUnderline: false,
    };
    setTextOverlays([...textOverlays, newOverlay]);
    setSelectedOverlayId(newOverlay.id);
    setShowEmojiPicker(false);
  };

  // Update overlay
  const updateOverlay = (id: string, updates: Partial<TextOverlay>) => {
    setTextOverlays(overlays => 
      overlays.map(o => o.id === id ? { ...o, ...updates } : o)
    );
  };

  // Delete overlay
  const deleteOverlay = (id: string) => {
    setTextOverlays(overlays => overlays.filter(o => o.id !== id));
    if (selectedOverlayId === id) {
      setSelectedOverlayId(null);
    }
  };

  // Get the bounding rect for position calculations
  const getContainerRect = (eventTarget?: EventTarget | null): DOMRect | null => {
    // First, try to find the image from the event target's parent hierarchy
    if (eventTarget instanceof Element) {
      // Find the closest image wrapper (parent with relative class)
      const wrapper = eventTarget.closest('.relative.inline-block');
      if (wrapper) {
        const img = wrapper.querySelector('img');
        if (img) {
          const rect = img.getBoundingClientRect();
          console.log('📐 Found image via event target:', rect);
          if (rect.width > 0 && rect.height > 0) {
            return rect;
          }
        }
      }
    }

    // Fallback: Use refs
    if (imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      console.log('📐 Image ref rect:', rect, 'naturalWidth:', imageRef.current.naturalWidth, 'complete:', imageRef.current.complete);
      if (rect.width > 0 && rect.height > 0) {
        return rect;
      }
    }
    
    if (imageWrapperRef.current) {
      const rect = imageWrapperRef.current.getBoundingClientRect();
      console.log('📐 Wrapper ref rect:', rect);
      if (rect.width > 0 && rect.height > 0) {
        return rect;
      }
    }
    
    console.log('📐 No valid rect found');
    return null;
  };

  // Handle mouse/touch move during interaction (drag, resize, rotate)
  const handleInteractionMove = (clientX: number, clientY: number) => {
    if (!draggingIdRef.current || interactionModeRef.current === 'none') return;
    
    const rect = containerRectRef.current;
    const initial = initialOverlayStateRef.current;
    const initialMouse = initialMousePosRef.current;
    
    if (!rect || rect.width === 0 || rect.height === 0 || !initial || !initialMouse) return;
    
    const cursorXPercent = ((clientX - rect.left) / rect.width) * 100;
    const cursorYPercent = ((clientY - rect.top) / rect.height) * 100;
    const currentId = draggingIdRef.current;

    if (interactionModeRef.current === 'drag') {
      // Dragging - move the overlay
      const offset = dragOffsetRef.current;
      let newX = cursorXPercent - offset.x;
      let newY = cursorYPercent - offset.y;

      if (isNaN(newX) || !isFinite(newX)) newX = 50;
      if (isNaN(newY) || !isFinite(newY)) newY = 50;

      // Get current overlay dimensions to constrain within bounds
      const overlay = textOverlays.find(o => o.id === currentId);
      if (overlay) {
        const halfWidth = overlay.width / 2;
        const halfHeight = overlay.height / 2;
        
        // Clamp so the entire box stays within the image (0-100%)
        const clampedX = Math.max(halfWidth, Math.min(100 - halfWidth, newX));
        const clampedY = Math.max(halfHeight, Math.min(100 - halfHeight, newY));

        setTextOverlays(overlays => 
          overlays.map(o => o.id === currentId ? { ...o, x: clampedX, y: clampedY } : o)
        );
      }
    } else if (interactionModeRef.current === 'resize') {
      // Resizing - change width/height based on handle
      const handle = resizeHandleRef.current;
      if (!handle) return;

      const deltaX = cursorXPercent - initialMouse.x;
      const deltaY = cursorYPercent - initialMouse.y;

      let newWidth = initial.width;
      let newHeight = initial.height;
      let newX = initial.x;
      let newY = initial.y;

      // Apply resize based on which handle is being dragged
      if (handle.includes('e')) {
        newWidth = Math.max(10, initial.width + deltaX);
      }
      if (handle.includes('w')) {
        newWidth = Math.max(10, initial.width - deltaX);
        newX = initial.x + deltaX / 2;
      }
      if (handle.includes('s')) {
        newHeight = Math.max(5, initial.height + deltaY);
      }
      if (handle.includes('n')) {
        newHeight = Math.max(5, initial.height - deltaY);
        newY = initial.y + deltaY / 2;
      }

      // Constrain so the entire box stays within image bounds (0-100%)
      const halfWidth = newWidth / 2;
      const halfHeight = newHeight / 2;
      
      // Check if box would exceed bounds and limit accordingly
      // Left edge: newX - halfWidth >= 0
      // Right edge: newX + halfWidth <= 100
      // Top edge: newY - halfHeight >= 0
      // Bottom edge: newY + halfHeight <= 100
      
      if (newX - halfWidth < 0) {
        if (handle.includes('w')) {
          // Resizing from west, limit width
          newWidth = initial.x * 2;
          newX = newWidth / 2;
        } else {
          newX = halfWidth;
        }
      }
      if (newX + halfWidth > 100) {
        if (handle.includes('e')) {
          // Resizing from east, limit width
          newWidth = (100 - initial.x) * 2;
          newX = 100 - newWidth / 2;
        } else {
          newX = 100 - halfWidth;
        }
      }
      if (newY - halfHeight < 0) {
        if (handle.includes('n')) {
          // Resizing from north, limit height
          newHeight = initial.y * 2;
          newY = newHeight / 2;
        } else {
          newY = halfHeight;
        }
      }
      if (newY + halfHeight > 100) {
        if (handle.includes('s')) {
          // Resizing from south, limit height
          newHeight = (100 - initial.y) * 2;
          newY = 100 - newHeight / 2;
        } else {
          newY = 100 - halfHeight;
        }
      }

      // Update size
      setTextOverlays(overlays => 
        overlays.map(o => o.id === currentId ? { 
          ...o, 
          width: Math.max(10, newWidth), 
          height: Math.max(5, newHeight),
          x: newX,
          y: newY,
        } : o)
      );
    } else if (interactionModeRef.current === 'rotate') {
      // Rotating - calculate angle from center
      const centerX = initial.x;
      const centerY = initial.y;
      
      // Calculate angle from center to current mouse position
      const angle = Math.atan2(cursorYPercent - centerY, cursorXPercent - centerX) * (180 / Math.PI);
      // Calculate initial angle
      const initialAngle = Math.atan2(initialMouse.y - centerY, initialMouse.x - centerX) * (180 / Math.PI);
      
      let newRotation = initial.rotation + (angle - initialAngle);
      // Normalize to -180 to 180
      while (newRotation > 180) newRotation -= 360;
      while (newRotation < -180) newRotation += 360;

      setTextOverlays(overlays => 
        overlays.map(o => o.id === currentId ? { ...o, rotation: newRotation } : o)
      );
    }
  };

  // Stable ref for the interaction handler
  const handleInteractionMoveRef = useRef(handleInteractionMove);
  handleInteractionMoveRef.current = handleInteractionMove;

  // End interaction
  const endInteraction = () => {
    draggingIdRef.current = null;
    interactionModeRef.current = 'none';
    resizeHandleRef.current = null;
    initialOverlayStateRef.current = null;
    initialMousePosRef.current = null;
  };

  // Stable mouse event handlers
  const stableMouseMove = useRef((e: MouseEvent) => {
    handleInteractionMoveRef.current(e.clientX, e.clientY);
  });

  const stableMouseUp = useRef(() => {
    endInteraction();
    document.removeEventListener('mousemove', stableMouseMove.current);
    document.removeEventListener('mouseup', stableMouseUp.current);
  });

  // Touch event handler refs - will be assigned in startInteraction
  const stableTouchMoveRef = useRef<((e: TouchEvent) => void) | null>(null);
  const stableTouchEndRef = useRef<(() => void) | null>(null);

  // Start interaction (drag, resize, or rotate)
  const startInteraction = (
    e: React.MouseEvent | React.TouchEvent, 
    overlayId: string, 
    mode: InteractionMode,
    resizeHandle?: ResizeHandle
  ) => {
    e.stopPropagation();
    // Only preventDefault for mouse events - touch events are passive
    if (!('touches' in e)) {
      e.preventDefault();
    }
    
    const overlay = textOverlays.find(o => o.id === overlayId);
    const rect = getContainerRect(e.currentTarget);
    
    if (!overlay || !rect || rect.width === 0 || rect.height === 0) return;

    containerRectRef.current = rect;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const cursorXPercent = ((clientX - rect.left) / rect.width) * 100;
    const cursorYPercent = ((clientY - rect.top) / rect.height) * 100;

    // Store initial state
    initialOverlayStateRef.current = {
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height,
      rotation: overlay.rotation,
    };
    initialMousePosRef.current = { x: cursorXPercent, y: cursorYPercent };

    // For dragging, store the offset
    if (mode === 'drag') {
      dragOffsetRef.current = {
        x: cursorXPercent - overlay.x,
        y: cursorYPercent - overlay.y,
      };
    }

    draggingIdRef.current = overlayId;
    interactionModeRef.current = mode;
    resizeHandleRef.current = resizeHandle || null;
    setSelectedOverlayId(overlayId);

    // Attach event listeners
    if ('touches' in e) {
      // Create fresh touch handlers that capture current state
      const touchMoveHandler = (touchEvent: TouchEvent) => {
        if (touchEvent.touches[0]) {
          touchEvent.preventDefault();
          handleInteractionMoveRef.current(touchEvent.touches[0].clientX, touchEvent.touches[0].clientY);
        }
      };
      
      const touchEndHandler = () => {
        endInteraction();
        if (stableTouchMoveRef.current) {
          document.removeEventListener('touchmove', stableTouchMoveRef.current);
        }
        if (stableTouchEndRef.current) {
          document.removeEventListener('touchend', stableTouchEndRef.current);
        }
        stableTouchMoveRef.current = null;
        stableTouchEndRef.current = null;
      };
      
      // Store refs for cleanup
      stableTouchMoveRef.current = touchMoveHandler;
      stableTouchEndRef.current = touchEndHandler;
      
      document.addEventListener('touchmove', touchMoveHandler, { passive: false });
      document.addEventListener('touchend', touchEndHandler);
    } else {
      document.addEventListener('mousemove', stableMouseMove.current);
      document.addEventListener('mouseup', stableMouseUp.current);
    }
  };

  // Reset overlays when dialog closes or Edit Design mode changes
  useEffect(() => {
    if (!showEditDesign) {
      setTextOverlays([]);
      setSelectedOverlayId(null);
      draggingIdRef.current = null;
      setImageLoaded(false);
      setResizeCounter(0);
    }
  }, [showEditDesign]);

  // Force re-render counter for resize updates
  const [resizeCounter, setResizeCounter] = useState(0);
  
  // Track image size changes to trigger re-renders
  useEffect(() => {
    if (!showEditDesign || !imageRef.current) return;

    const triggerRerender = () => {
      setResizeCounter(c => c + 1);
    };

    // Use ResizeObserver to detect size changes
    const resizeObserver = new ResizeObserver(triggerRerender);
    resizeObserver.observe(imageRef.current);

    // Also listen for window resize
    window.addEventListener('resize', triggerRerender);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', triggerRerender);
    };
  }, [showEditDesign, imageLoaded]);
  

  // Get the available platforms for this post
  const availablePlatforms = post?.requestedPlatforms || post?.platforms || ['instagram', 'twitter', 'linkedin'];

  // Set default selected platform based on requested platforms when dialog opens
  useEffect(() => {
    if (open && post) {
      const platforms = post.requestedPlatforms || post.platforms || [];
      if (platforms.length > 0) {
        // Set to first requested platform
        const firstPlatform = platforms[0].toLowerCase() as Platform;
        if (['instagram', 'twitter', 'linkedin'].includes(firstPlatform)) {
          setSelectedPlatform(firstPlatform);
          console.log('📱 Set default platform to:', firstPlatform);
        }
      }
    }
  }, [open, post]);

  // Reset animation state when post changes (after accept/reject)
  useEffect(() => {
    // When post changes, ensure no animation state is lingering
    setIsAnimatingOut(null);
    setAnimatingOutPost(null);
    setSwipeOffset(0);
  }, [post?.id]);

  // Fetch edited captions when dialog opens
  useEffect(() => {
    const fetchEditedCaptions = async () => {
      if (!open || !post?.generatedContentId || post?.postIndex === undefined) return;
      
      try {
        const response = await captionsApi.getCaptions(
          post.generatedContentId,
          post.postIndex
        );
        
        if (response.success && response.data?.captions) {
          setEditedCaptions(response.data.captions);
          console.log('📝 Loaded edited captions:', response.data.captions);
        }
      } catch (error) {
        console.error('Failed to fetch edited captions:', error);
      }
    };

    fetchEditedCaptions();
  }, [open, post?.generatedContentId, post?.postIndex]);

  // Fetch regeneration history when dialog opens in Edit Design mode
  useEffect(() => {
    const fetchRegenerations = async () => {
      if (!open || !showEditDesign || !post?.generatedContentId || post?.postIndex === undefined) return;
      
      try {
        const response = await imageRegenerationApi.getRegenerations(
          post.generatedContentId,
          post.postIndex
        );
        
        if (response.success && response.data) {
          setRegenerations(response.data.map(r => ({
            id: r.id,
            prompt: r.prompt,
            regeneratedImageUrl: r.regeneratedImageUrl,
            regeneratedImageS3Key: r.regeneratedImageS3Key,
            status: r.status,
            createdAt: r.createdAt,
          })));
        }
      } catch (error) {
        console.error('Failed to fetch regenerations:', error);
      }
    };

    fetchRegenerations();
  }, [open, showEditDesign, post?.generatedContentId, post?.postIndex]);

  // Poll for regeneration status when one is in progress
  useEffect(() => {
    if (!pollingRegenId) return;
    
    const pollInterval = setInterval(async () => {
      try {
        const response = await imageRegenerationApi.getStatus(pollingRegenId);
        
        if (response.success && response.data) {
          const { status, regeneratedImageUrl, regeneratedImageS3Key } = response.data;
          
          if (status === 'completed' && regeneratedImageUrl) {
            // Update the regeneration in the list
            setRegenerations(prev => prev.map(r => 
              r.id === pollingRegenId 
                ? { ...r, status: 'completed', regeneratedImageUrl, regeneratedImageS3Key }
                : r
            ));
            
            // Set as active image
            setRegeneratedImageUrl(regeneratedImageUrl);
            if (regeneratedImageS3Key) {
              setActiveImageS3Key(regeneratedImageS3Key);
            }
            
            // Add success message
            setChatMessages(prev => [...prev, { 
              role: 'assistant', 
              content: "✅ Your image has been regenerated! You can see it on the right panel and continue editing."
            }]);
            
            // Stop polling
            setPollingRegenId(null);
            setIsRegenerating(false);
          } else if (status === 'failed') {
            // Update status
            setRegenerations(prev => prev.map(r => 
              r.id === pollingRegenId 
                ? { ...r, status: 'failed' }
                : r
            ));
            
            // Add failure message
            setChatMessages(prev => [...prev, { 
              role: 'assistant', 
              content: `❌ Sorry, the regeneration failed: ${response.data.errorMessage || 'Unknown error'}`
            }]);
            
            // Stop polling
            setPollingRegenId(null);
            setIsRegenerating(false);
          }
          // If still processing, continue polling
        }
      } catch (error) {
        console.error('Error polling regeneration status:', error);
      }
    }, 2000); // Poll every 2 seconds
    
    return () => clearInterval(pollInterval);
  }, [pollingRegenId]);

  // Helper function to get platform-specific caption (prioritize edited captions)
  const getPlatformCaption = (platform: Platform): string => {
    // First check if user has edited this platform's caption
    if (editedCaptions[platform]) {
      return editedCaptions[platform];
    }
    // Then check for system-generated platform text
    if (post?.fullPlatformTexts && post.fullPlatformTexts[platform]) {
      return post.fullPlatformTexts[platform];
    }
    // Fallback to description if platform-specific text not available
    return post?.description || "";
  };
  const [platformConnections, setPlatformConnections] = useState<{
    twitter?: { handle: string; name?: string; profileImageUrl?: string };
    instagram?: { username: string; name?: string; profilePicture?: string };
    linkedin?: { name: string; picture?: string };
  }>({});

  // Fetch platform connections on mount
  useEffect(() => {
    const fetchConnections = async () => {
      try {
        const [twitterRes, instagramRes, linkedinRes] = await Promise.all([
          accountApi.getTwitterConnection().catch(() => null),
          accountApi.getInstagramConnection().catch(() => null),
          accountApi.getLinkedInConnection().catch(() => null),
        ]);

        const connections: any = {};

        // Twitter
        if (twitterRes?.data) {
          connections.twitter = { 
            handle: twitterRes.data.twitterHandle || 'account',
            name: twitterRes.data.name,
            profileImageUrl: twitterRes.data.profileImageUrl
          };
        }
        
        // Instagram - use name from profileData (preferred) or username
        if (instagramRes?.data) {
          connections.instagram = { 
            username: instagramRes.data.username || 
                     instagramRes.data.profileData?.username || 
                     'instagram_account',
            name: instagramRes.data.profileData?.name,
            profilePicture: instagramRes.data.profileData?.profile_picture_url
          };
        }

        // LinkedIn - use name from connection, prefer profileData.name
        if (linkedinRes?.data) {
          connections.linkedin = { 
            name: linkedinRes.data.profileData?.name || 
                 linkedinRes.data.name || 
                 linkedinRes.data.email || 
                 'Professional Account',
            picture: linkedinRes.data.profileData?.picture
          };
        }

        setPlatformConnections(connections);
      } catch (error) {
        console.error('Failed to fetch platform connections:', error);
      }
    };

    if (open) {
      fetchConnections();
    }
  }, [open]);

  // Notify parent when Edit Design mode changes (desktop only)
  const handleEditDesignToggle = async (value: boolean) => {
    setShowEditDesign(value);
    // Only collapse sidebar on desktop
    if (window.innerWidth >= 1024) {
      onEditDesignModeChange?.(value);
    }
    
    // When entering Edit Design mode, fetch existing overlays from dvyb_image_edits
    if (value && post?.generatedContentId && post?.postIndex !== undefined) {
      // Default to the absolute original from dvyb_generated_content
      let absoluteOriginal = post.originalMediaUrl || post.image;
      
      // Extract S3 key from presigned URL to refresh it
      const extractS3Key = (url: string): string => {
        if (!url) return '';
        const baseUrl = url.split('?')[0];
        if (baseUrl.includes('.amazonaws.com/')) {
          return decodeURIComponent(baseUrl.split('.amazonaws.com/')[1] || '');
        } else if (baseUrl.includes('.cloudfront.net/')) {
          return decodeURIComponent(baseUrl.split('.cloudfront.net/')[1] || '');
        }
        if (!baseUrl.startsWith('http')) return baseUrl;
        return '';
      };
      
      // Refresh the original image URL to get a fresh presigned URL
      const originalS3Key = extractS3Key(absoluteOriginal);
      if (originalS3Key) {
        try {
          const refreshResult = await imageEditsApi.refreshUrl(originalS3Key);
          if (refreshResult.success && refreshResult.data?.presignedUrl) {
            absoluteOriginal = refreshResult.data.presignedUrl;
          }
        } catch (error) {
          console.error('Failed to refresh original image URL:', error);
        }
      }
      
      // Store the refreshed original URL for later use (clicking Original Image thumbnail)
      setRefreshedOriginalUrl(absoluteOriginal);
      setEditDesignBaseImageUrl(absoluteOriginal);
      
      try {
        const result = await imageEditsApi.getImageEdit(post.generatedContentId, post.postIndex);
        if (result.success && result.data) {
          // Load saved overlays as editable elements
          if (result.data.overlays && result.data.overlays.length > 0) {
            setTextOverlays(result.data.overlays);
            toast({
              title: "Previous edits loaded",
              description: `${result.data.overlays.length} text overlay(s) restored. You can modify or remove them.`,
            });
          } else {
            setTextOverlays([]);
          }
          
          // Use the image from dvyb_image_edits as the canvas (these are fresh presigned URLs)
          // Priority: regeneratedImageUrl > originalImageUrl > absoluteOriginal
          if (result.data.regeneratedImageUrl) {
            // A regenerated image was used as base - show that
            setEditDesignBaseImageUrl(result.data.regeneratedImageUrl);
          } else if (result.data.originalImageUrl) {
            // Original image was used as base
            setEditDesignBaseImageUrl(result.data.originalImageUrl);
          }
          // If neither, keep the refreshed absoluteOriginal that was already set
          
          // Reset active selection - user starts with the saved base image
          setActiveImageS3Key(null);
          setRegeneratedImageUrl(null);
        } else {
          // No existing edits, keep refreshed absoluteOriginal that was already set
          setTextOverlays([]);
        }
      } catch (error) {
        console.error('Failed to fetch existing image edits:', error);
        // Continue without loading - keep absoluteOriginal, user can start fresh
        setTextOverlays([]);
      }
    } else if (!value) {
      // Exiting Edit Design mode - reset base image and refreshed URL
      setEditDesignBaseImageUrl(null);
      setRefreshedOriginalUrl(null);
    }
  };

  // Save design (text overlays, emojis, stickers) to backend
  const handleSaveDesign = async () => {
    if (!post?.generatedContentId || !canSaveDesign) {
      toast({
        title: "Nothing to save",
        description: "Add some text, emojis, or regenerate the image first.",
        variant: "default",
      });
      return;
    }

    setIsSavingDesign(true);
    try {
      // Get the original image URL (S3 key) - extract from presigned URL if needed
      let originalImageS3Key = post.originalMediaUrl || '';
      if (!originalImageS3Key && post.image) {
        // Extract S3 key from presigned URL (format: https://bucket.s3.region.amazonaws.com/key?...)
        const url = post.image.split('?')[0];
        if (url.includes('.amazonaws.com/')) {
          originalImageS3Key = url.split('.amazonaws.com/')[1] || '';
        } else if (url.includes('.cloudfront.net/')) {
          originalImageS3Key = url.split('.cloudfront.net/')[1] || '';
        } else {
          originalImageS3Key = url;
        }
      }

      // Use activeImageS3Key if set (from regeneration), otherwise extract from URL
      let regeneratedImageS3Key: string | null = activeImageS3Key;
      if (!regeneratedImageS3Key && regeneratedImageUrl) {
        const url = regeneratedImageUrl.split('?')[0];
        if (url.includes('.amazonaws.com/')) {
          regeneratedImageS3Key = url.split('.amazonaws.com/')[1] || null;
        } else if (url.includes('.cloudfront.net/')) {
          regeneratedImageS3Key = url.split('.cloudfront.net/')[1] || null;
        } else {
          regeneratedImageS3Key = url;
        }
      }
      
      const result = await imageEditsApi.saveImageEdit({
        generatedContentId: post.generatedContentId,
        postIndex: post.postIndex || 0,
        originalImageUrl: originalImageS3Key,
        regeneratedImageUrl: regeneratedImageS3Key,
        overlays: textOverlays,
        referenceWidth: 450,
      });

      if (result.success) {
        toast({
          title: "Design saved!",
          description: "Your design is being processed. It will be ready shortly.",
        });
        // Exit edit design mode
        handleEditDesignToggle(false);
      } else {
        throw new Error(result.error || 'Failed to save design');
      }
    } catch (error: any) {
      console.error('Error saving design:', error);
      toast({
        title: "Failed to save design",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingDesign(false);
    }
  };

  // Handle close with animation
  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onOpenChange(false);
      setShowEditDesign(false);
      onEditDesignModeChange?.(false);
    }, 300);
  };

  // Reset Edit Design mode when dialog closes
  const handleDialogOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      handleClose();
    } else {
      onOpenChange(isOpen);
    }
  };

  if (!post) return null;

  // Check if this post is a video (used for disabling Edit Design for videos)
  const isVideo = post.image && (post.image.includes('video') || post.image.includes('.mp4'));

  const handleSaveCaption = async (newCaption: string) => {
    // Save to local state immediately for responsive UI
    setCaption(newCaption);
    
    // Update the edited captions map
    setEditedCaptions(prev => ({
      ...prev,
      [selectedPlatform]: newCaption,
    }));

    // Save to database if we have the required IDs
    if (post.generatedContentId && post.postIndex !== undefined) {
      setIsSavingCaption(true);
      try {
        await captionsApi.saveCaption({
          generatedContentId: post.generatedContentId,
          postIndex: post.postIndex,
          platform: selectedPlatform,
          caption: newCaption,
        });
        
        toast({
          title: "Caption Saved",
          description: `Your ${selectedPlatform} caption has been updated.`,
        });
      } catch (error) {
        console.error('Failed to save caption:', error);
        toast({
          title: "Couldn't Save Caption",
          description: "Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsSavingCaption(false);
      }
    }
  };

  const handleOpenScheduleDialog = () => {
    // Just open schedule dialog - don't close PostDetailDialog
    setShowScheduleDialog(true);
  };

  const handleScheduleDialogClose = (scheduleWasCreated?: boolean) => {
    setShowScheduleDialog(false);
    
    // If scheduling was successful, close PostDetailDialog and refresh
    if (scheduleWasCreated) {
      // Close PostDetailDialog completely
      onOpenChange(false);
      
      // Trigger parent refresh
      if (onScheduleComplete) {
        onScheduleComplete();
      }
    }
    // If user cancelled (scheduleWasCreated is false/undefined), do nothing
    // PostDetailDialog stays open in the background
  };

  const handleSendPrompt = async () => {
    if (!aiPrompt.trim() || !post) return;
    
    const prompt = aiPrompt.trim();
    setAiPrompt("");
    
    // Add user message
    setChatMessages(prev => [...prev, { role: 'user', content: prompt }]);
    
    // Get the source image S3 key
    // Priority: activeImageS3Key (if regenerated) > originalMediaUrl > extract from post.image
    let sourceImageS3Key = activeImageS3Key || post.originalMediaUrl || '';
    if (!sourceImageS3Key && post.image) {
      // Extract S3 key from presigned URL
      const url = post.image.split('?')[0];
      if (url.includes('.amazonaws.com/')) {
        sourceImageS3Key = url.split('.amazonaws.com/')[1] || '';
      } else if (url.includes('.cloudfront.net/')) {
        sourceImageS3Key = url.split('.cloudfront.net/')[1] || '';
      } else {
        sourceImageS3Key = url;
      }
    }
    
    if (!sourceImageS3Key) {
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "Sorry, I couldn't find the source image to edit. Please try again."
      }]);
      return;
    }
    
    const contentId = post.generatedContentId || post.contentId;
    if (!contentId || post.postIndex === undefined) {
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "Sorry, I couldn't identify the content. Please try again."
      }]);
      return;
    }
    
    // Add processing message
    setChatMessages(prev => [...prev, { 
      role: 'assistant', 
      content: "🎨 I'm regenerating the image for you. This may take a moment..."
    }]);
    
    setIsRegenerating(true);
    
    try {
      // Call regeneration API
      const result = await imageRegenerationApi.regenerate({
        generatedContentId: contentId,
        postIndex: post.postIndex,
        prompt,
        sourceImageS3Key,
      });
      
      if (result.success && result.data) {
        // Start polling for the result
        setPollingRegenId(result.data.id);
        
        // Add to regenerations list as pending
        setRegenerations(prev => [{
          id: result.data.id,
          prompt,
          regeneratedImageUrl: null,
          regeneratedImageS3Key: null,
          status: 'processing',
          createdAt: new Date().toISOString(),
        }, ...prev]);
      } else {
        setChatMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `❌ Sorry, I couldn't start the regeneration: ${result.error || 'Unknown error'}`
        }]);
        setIsRegenerating(false);
      }
    } catch (error: any) {
      console.error('Error triggering regeneration:', error);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `❌ Sorry, there was an error: ${error.message || 'Please try again.'}`
      }]);
      setIsRegenerating(false);
    }
  };

  const handleExamplePrompt = (prompt: string) => {
    setAiPrompt(prompt);
  };
  
  // Handle clicking on a regenerated image thumbnail
  const handleSelectRegeneration = (regen: typeof regenerations[0]) => {
    if (regen.status === 'completed' && regen.regeneratedImageUrl && regen.regeneratedImageS3Key) {
      setRegeneratedImageUrl(regen.regeneratedImageUrl);
      setActiveImageS3Key(regen.regeneratedImageS3Key);
      setEditDesignBaseImageUrl(regen.regeneratedImageUrl);
      // Keep existing overlays when switching images - they maintain their positions
      toast({
        title: "Image Selected",
        description: "This image is now your active canvas. Overlays preserved.",
      });
    }
  };

  const allPlatformOptions: { id: Platform; label: string; icon: string }[] = [
    { id: "instagram", label: "Instagram", icon: "🟣" },
    { id: "linkedin", label: "LinkedIn", icon: "🔷" },
    { id: "twitter", label: "X / Twitter", icon: "⚫" },
  ];

  // Filter platforms based on requestedPlatforms or platforms array
  // Only show platforms that were actually requested for this content
  const platformOptions = availablePlatforms.length > 0
    ? allPlatformOptions.filter(option => 
        availablePlatforms.map((p: string) => p.toLowerCase()).includes(option.id)
      )
    : allPlatformOptions;

  const renderPlatformPreview = () => {
    const isVideoContent = post.image && (post.image.includes('video') || post.image.includes('.mp4'));
    
    // Determine video aspect ratio based on model:
    // - kling models → 1:1 (aspect-square)
    // - veo3 models → 9:16 (portrait)
    // Default to 9:16 if model is unknown
    const isPortraitVideo = () => {
      if (!isVideoContent) return false;
      const model = post.videoModel?.toLowerCase() || '';
      // Kling is 1:1, everything else (veo3, etc.) is 9:16
      return !model.includes('kling');
    };
    
    const isPortrait = isPortraitVideo();
    
    // Helper function to render video with proper aspect ratio handling
    const renderVideo = () => {
      if (isPortrait) {
        // Portrait video (9:16) - constrain height, width adjusts to maintain aspect ratio
        // This makes it look like a mobile phone preview without black bars
        return (
          <div className="w-full flex justify-center">
            <div className="max-h-[65vh] aspect-[9/16]">
              <video 
                src={post.image} 
                controls
                playsInline
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
          </div>
        );
      } else {
        // Square video (1:1) - standard aspect-square with object-cover
        return (
          <div className="w-full aspect-square">
            <video 
              src={post.image} 
              controls
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
        );
      }
    };

    // In Edit Design mode, show only the image without platform chrome
    if (showEditDesign) {
      return (
        <div className="flex flex-col w-full h-full">
          {/* Text Overlay Toolbar */}
          <div className="bg-background border-b border-border p-2 md:p-3 flex flex-wrap items-center gap-2 md:gap-3 rounded-t-lg">
            {/* Add Text Button */}
            <Button
              size="sm"
              variant="outline"
              onClick={addTextOverlay}
              className="gap-1 text-xs md:text-sm"
            >
              <Plus className="w-3 h-3 md:w-4 md:h-4" />
              <Type className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline">Add Text</span>
            </Button>

            {/* Emoji/Sticker Button */}
            <div className="relative">
              <Button
                size="sm"
                variant={showEmojiPicker ? "default" : "outline"}
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="gap-1 text-xs md:text-sm"
              >
                <Smile className="w-3 h-3 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Emoji</span>
              </Button>

              {/* Emoji Picker Dropdown - Responsive */}
              {showEmojiPicker && (
                <>
                  {/* Backdrop for mobile */}
                  <div 
                    className="fixed inset-0 bg-black/20 z-40 md:hidden"
                    onClick={() => setShowEmojiPicker(false)}
                  />
                  
                  {/* Picker - Full width on mobile, dropdown on desktop */}
                  <div className="fixed left-2 right-2 bottom-2 md:absolute md:left-0 md:right-auto md:bottom-auto md:top-full md:mt-2 bg-background border border-border rounded-lg shadow-lg z-50 md:w-[320px]">
                    {/* Header with close button */}
                    <div className="flex items-center justify-between p-2 border-b">
                      <span className="text-sm font-medium">Emojis & Stickers</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowEmojiPicker(false)}
                        className="w-6 h-6 p-0"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Stickers Section */}
                    <div className="p-2 border-b">
                      <div className="flex items-center gap-1 mb-2">
                        <Sticker className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">Stickers</span>
                      </div>
                      <div className="grid grid-cols-8 md:grid-cols-10 gap-1">
                        {STICKERS.map((sticker, i) => (
                          <button
                            key={i}
                            onClick={() => addEmojiOverlay(sticker, true)}
                            className="text-2xl md:text-xl hover:bg-muted rounded p-1.5 md:p-1 transition-colors"
                          >
                            {sticker}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Emoji Categories */}
                    <div className="p-2">
                      {/* Category Tabs */}
                      <div className="flex gap-1 mb-2 overflow-x-auto pb-1 -mx-1 px-1">
                        {Object.keys(EMOJI_CATEGORIES).map(cat => (
                          <button
                            key={cat}
                            onClick={() => setEmojiCategory(cat)}
                            className={`text-xs px-2 py-1.5 md:py-1 rounded whitespace-nowrap transition-colors ${
                              emojiCategory === cat 
                                ? 'bg-primary text-primary-foreground' 
                                : 'bg-muted hover:bg-muted/80'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      {/* Emojis Grid */}
                      <div className="grid grid-cols-8 md:grid-cols-10 gap-1 max-h-[180px] md:max-h-[150px] overflow-y-auto">
                        {EMOJI_CATEGORIES[emojiCategory as keyof typeof EMOJI_CATEGORIES].map((emoji, i) => (
                          <button
                            key={i}
                            onClick={() => addEmojiOverlay(emoji, false)}
                            className="text-2xl md:text-xl hover:bg-muted rounded p-1.5 md:p-1 transition-colors"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Divider */}
            {selectedOverlay && <div className="w-px h-6 bg-border" />}

            {/* Formatting options (only show when overlay is selected) */}
            {selectedOverlay && (
              <>
                {/* Bold */}
                <Button
                  size="sm"
                  variant={selectedOverlay.isBold ? "default" : "outline"}
                  onClick={() => updateOverlay(selectedOverlay.id, { isBold: !selectedOverlay.isBold })}
                  className="w-8 h-8 p-0"
                >
                  <Bold className="w-4 h-4" />
                </Button>

                {/* Italic */}
                <Button
                  size="sm"
                  variant={selectedOverlay.isItalic ? "default" : "outline"}
                  onClick={() => updateOverlay(selectedOverlay.id, { isItalic: !selectedOverlay.isItalic })}
                  className="w-8 h-8 p-0"
                >
                  <Italic className="w-4 h-4" />
                </Button>

                {/* Underline */}
                <Button
                  size="sm"
                  variant={selectedOverlay.isUnderline ? "default" : "outline"}
                  onClick={() => updateOverlay(selectedOverlay.id, { isUnderline: !selectedOverlay.isUnderline })}
                  className="w-8 h-8 p-0"
                >
                  <Underline className="w-4 h-4" />
                </Button>

                <div className="w-px h-6 bg-border hidden sm:block" />

                {/* Font Size */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground hidden md:inline">Size:</span>
                  <select
                    value={selectedOverlay.fontSize}
                    onChange={(e) => updateOverlay(selectedOverlay.id, { fontSize: parseInt(e.target.value) })}
                    className="h-8 px-2 text-xs border rounded-md bg-background"
                  >
                    {[12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72].map(size => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </div>

                {/* Font Family */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground hidden md:inline">Font:</span>
                  <select
                    value={selectedOverlay.fontFamily}
                    onChange={(e) => updateOverlay(selectedOverlay.id, { fontFamily: e.target.value })}
                    className="h-8 px-2 text-xs border rounded-md bg-background max-w-[100px] md:max-w-[140px]"
                  >
                    {FONT_OPTIONS.map(font => (
                      <option key={font.value} value={font.value}>{font.label}</option>
                    ))}
                  </select>
                </div>

                <div className="w-px h-6 bg-border hidden sm:block" />

                {/* Color Picker */}
                <div className="flex items-center gap-1">
                  <div className="flex gap-0.5">
                    {COLOR_PRESETS.map(color => (
                      <button
                        key={color}
                        onClick={() => updateOverlay(selectedOverlay.id, { color })}
                        className={`w-5 h-5 rounded border-2 transition-all ${
                          selectedOverlay.color === color ? 'border-primary scale-110' : 'border-gray-300'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={selectedOverlay.color}
                    onChange={(e) => updateOverlay(selectedOverlay.id, { color: e.target.value })}
                    className="w-6 h-6 cursor-pointer border rounded"
                    title="Custom color"
                  />
                </div>

                </>
            )}
          </div>

          {/* Image with Overlays */}
          <div 
            className="relative flex-1 flex items-center justify-center bg-muted/50 rounded-b-lg overflow-hidden"
          >
            {isVideoContent ? (
              <video 
                src={post.image} 
                controls
                playsInline
                className="max-w-full max-h-[calc(100vh-18rem)] object-contain"
              />
            ) : (
              <div 
                ref={imageWrapperRef}
                className="relative inline-block"
              >
                <img 
                  ref={imageRef}
                  src={regeneratedImageUrl || editDesignBaseImageUrl || post.image} 
                  alt={post.title}
                  className="max-w-full max-h-[calc(100vh-18rem)] object-contain select-none"
                  draggable={false}
                  onLoad={() => {
                    setImageLoaded(true);
                    setResizeCounter(c => c + 1); // Trigger re-render with new size
                  }}
                  onClick={() => setSelectedOverlayId(null)}
                />
                
                {/* Text Overlays - positioned relative to image */}
                {textOverlays.map(overlay => {
                  const isSelected = selectedOverlayId === overlay.id;
                  const currentWidth = getCurrentImageWidth();
                  const scaleFactor = currentWidth / REFERENCE_WIDTH;
                  const scaledFontSize = Math.round(overlay.fontSize * scaleFactor);
                  
                  return (
                    <div
                      key={overlay.id}
                      className={`absolute select-none ${isSelected ? 'z-20' : 'z-10'}`}
                      style={{
                        left: `${overlay.x}%`,
                        top: `${overlay.y}%`,
                        width: `${overlay.width}%`,
                        height: `${overlay.height}%`,
                        transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`,
                      }}
                    >
                      {/* Main draggable overlay box */}
                      <div
                        className={`w-full h-full cursor-move flex items-center justify-center rounded ${
                          isSelected ? 'ring-2 ring-primary ring-offset-1' : ''
                        }`}
                        style={{
                          backgroundColor: isSelected ? 'rgba(0,0,0,0.2)' : 'transparent',
                        }}
                        onMouseDown={(e) => {
                          // Start drag unless clicking on a focused input
                          const target = e.target as HTMLElement;
                          const isInputFocused = target.tagName === 'INPUT' && document.activeElement === target;
                          if (!isInputFocused) {
                            startInteraction(e, overlay.id, 'drag');
                          }
                        }}
                        onTouchStart={(e) => {
                          // Start drag unless touching a focused input
                          const target = e.target as HTMLElement;
                          const isInputFocused = target.tagName === 'INPUT' && document.activeElement === target;
                          if (!isInputFocused) {
                            startInteraction(e, overlay.id, 'drag');
                          }
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedOverlayId(overlay.id);
                        }}
                      >
                        {/* Text input - double click/tap to edit */}
                        <input
                          type="text"
                          value={overlay.text}
                          onChange={(e) => updateOverlay(overlay.id, { text: e.target.value })}
                          onDoubleClick={(e) => {
                            // Double click to focus and edit (desktop)
                            e.stopPropagation();
                            e.currentTarget.focus();
                            e.currentTarget.select();
                          }}
                          onClick={(e) => {
                            const isFocused = document.activeElement === e.currentTarget;
                            if (isFocused) {
                              e.stopPropagation();
                            } else {
                              e.stopPropagation();
                              setSelectedOverlayId(overlay.id);
                            }
                          }}
                          onMouseDown={(e) => {
                            const isFocused = document.activeElement === e.currentTarget;
                            if (isFocused) {
                              e.stopPropagation();
                            }
                          }}
                          onTouchStart={(e) => {
                            const isFocused = document.activeElement === e.currentTarget;
                            if (isFocused) {
                              e.stopPropagation();
                              return;
                            }
                            
                            // Manual double-tap detection for mobile
                            const now = Date.now();
                            const DOUBLE_TAP_DELAY = 300; // ms
                            
                            if (lastTapTargetRef.current === overlay.id && 
                                now - lastTapTimeRef.current < DOUBLE_TAP_DELAY) {
                              // Double tap detected - focus the input
                              e.stopPropagation();
                              e.currentTarget.focus();
                              e.currentTarget.select();
                              lastTapTimeRef.current = 0;
                              lastTapTargetRef.current = null;
                            } else {
                              // First tap - record it
                              lastTapTimeRef.current = now;
                              lastTapTargetRef.current = overlay.id;
                              // Let parent handle for potential drag
                            }
                          }}
                          onTouchEnd={(e) => {
                            // Prevent click event after touch on mobile
                            const isFocused = document.activeElement === e.currentTarget;
                            if (!isFocused) {
                              e.preventDefault();
                            }
                          }}
                          onFocus={() => {
                            setSelectedOverlayId(overlay.id);
                          }}
                          className="bg-transparent border-none outline-none text-center w-full px-1 cursor-text"
                          style={{
                            fontSize: `${scaledFontSize}px`,
                            fontFamily: overlay.fontFamily,
                            color: overlay.color,
                            fontWeight: overlay.isBold ? 'bold' : 'normal',
                            fontStyle: overlay.isItalic ? 'italic' : 'normal',
                            textDecoration: overlay.isUnderline ? 'underline' : 'none',
                            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
                          }}
                        />
                      </div>

                      {/* Resize handles (only show when selected) */}
                      {isSelected && (
                        <>
                          {/* Corner handles */}
                          <div
                            className="absolute w-3 h-3 bg-primary border-2 border-white rounded-sm cursor-nwse-resize"
                            style={{ top: '-6px', left: '-6px' }}
                            onMouseDown={(e) => startInteraction(e, overlay.id, 'resize', 'nw')}
                            onTouchStart={(e) => startInteraction(e, overlay.id, 'resize', 'nw')}
                          />
                          <div
                            className="absolute w-3 h-3 bg-primary border-2 border-white rounded-sm cursor-nesw-resize"
                            style={{ top: '-6px', right: '-6px' }}
                            onMouseDown={(e) => startInteraction(e, overlay.id, 'resize', 'ne')}
                            onTouchStart={(e) => startInteraction(e, overlay.id, 'resize', 'ne')}
                          />
                          <div
                            className="absolute w-3 h-3 bg-primary border-2 border-white rounded-sm cursor-nwse-resize"
                            style={{ bottom: '-6px', right: '-6px' }}
                            onMouseDown={(e) => startInteraction(e, overlay.id, 'resize', 'se')}
                            onTouchStart={(e) => startInteraction(e, overlay.id, 'resize', 'se')}
                          />
                          <div
                            className="absolute w-3 h-3 bg-primary border-2 border-white rounded-sm cursor-nesw-resize"
                            style={{ bottom: '-6px', left: '-6px' }}
                            onMouseDown={(e) => startInteraction(e, overlay.id, 'resize', 'sw')}
                            onTouchStart={(e) => startInteraction(e, overlay.id, 'resize', 'sw')}
                          />

                          {/* Edge handles */}
                          {(['n', 'e', 's', 'w'] as ResizeHandle[]).map(handle => (
                            <div
                              key={handle}
                              className={`absolute bg-primary border border-white rounded-sm ${
                                handle === 'n' || handle === 's' 
                                  ? 'w-6 h-2 cursor-ns-resize left-1/2 -translate-x-1/2' 
                                  : 'h-6 w-2 cursor-ew-resize top-1/2 -translate-y-1/2'
                              }`}
                              style={{
                                top: handle === 'n' ? '-5px' : handle === 's' ? 'auto' : undefined,
                                bottom: handle === 's' ? '-5px' : undefined,
                                left: handle === 'w' ? '-5px' : undefined,
                                right: handle === 'e' ? '-5px' : undefined,
                              }}
                              onMouseDown={(e) => startInteraction(e, overlay.id, 'resize', handle)}
                              onTouchStart={(e) => startInteraction(e, overlay.id, 'resize', handle)}
                            />
                          ))}

                          {/* Rotation handle */}
                          <div
                            className="absolute -top-8 left-1/2 -translate-x-1/2 flex flex-col items-center"
                          >
                            {/* Connection line */}
                            <div className="w-0.5 h-4 bg-primary" />
                            {/* Rotation circle */}
                            <div
                              className="w-5 h-5 bg-primary rounded-full border-2 border-white cursor-grab flex items-center justify-center hover:scale-110 transition-transform"
                              onMouseDown={(e) => startInteraction(e, overlay.id, 'rotate')}
                              onTouchStart={(e) => startInteraction(e, overlay.id, 'rotate')}
                              title="Rotate"
                            >
                              <RotateCw className="w-3 h-3 text-white" />
                            </div>
                          </div>

                          {/* Delete button - top right outside the box */}
                          <div
                            className="absolute -top-3 -right-3 w-6 h-6 bg-destructive rounded-full border-2 border-white cursor-pointer flex items-center justify-center hover:scale-110 transition-transform shadow-md"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteOverlay(overlay.id);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3 text-white" />
                          </div>

                          {/* Reset rotation button - only show if rotated */}
                          {overlay.rotation !== 0 && (
                            <div
                              className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-primary rounded-full border-2 border-white cursor-pointer flex items-center gap-1 hover:scale-105 transition-transform shadow-md text-[10px] text-white font-medium"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateOverlay(overlay.id, { rotation: 0 });
                              }}
                              title="Reset rotation"
                            >
                              <RotateCw className="w-2.5 h-2.5" />
                              {Math.round(overlay.rotation)}°
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Click to deselect */}
            {textOverlays.length > 0 && (
              <div 
                className="absolute inset-0 -z-10"
                onClick={() => setSelectedOverlayId(null)}
              />
            )}
          </div>

          {/* Helper text */}
          {textOverlays.length === 0 && !isVideoContent && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-background/80 backdrop-blur-sm px-4 py-2 rounded-full text-sm text-muted-foreground">
              Click "Add Text" to add text overlays
            </div>
          )}
        </div>
      );
    }
    
    switch (selectedPlatform) {
      case "instagram":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg w-full max-w-sm md:max-w-md mx-auto">
            {/* Instagram Header */}
            <div className="flex items-center justify-between p-2 md:p-3 border-b">
              <div className="flex items-center gap-2">
                {platformConnections.instagram?.profilePicture ? (
                  <img 
                    src={platformConnections.instagram.profilePicture} 
                    alt="Profile"
                    className="w-6 h-6 md:w-8 md:h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-[hsl(var(--landing-accent-orange))]" />
                )}
                <span className="font-semibold text-xs md:text-sm text-gray-900">
                  {platformConnections.instagram?.name || platformConnections.instagram?.username || getWebsiteDomainDisplay('instagram_account')}
                </span>
              </div>
              <MoreHorizontal className="w-4 h-4 md:w-5 md:h-5 text-gray-900" />
            </div>
            
            {/* Instagram Media - aspect ratio based on model */}
            {isVideoContent ? (
              renderVideo()
            ) : (
              <div className="w-full aspect-square">
                <img 
                  src={post.image} 
                  alt={post.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            
            {/* Instagram Actions */}
            <div className="p-2 md:p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 md:gap-4">
                  <Heart className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                  <MessageCircle className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                  <Send className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                </div>
                <Bookmark className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
              </div>
              <div className="font-semibold text-xs md:text-sm text-gray-900 mb-1">50,024 likes</div>
              <div className="text-xs md:text-sm text-gray-900 line-clamp-3">
                <span className="font-semibold">{platformConnections.instagram?.name || platformConnections.instagram?.username || getWebsiteDomainDisplay('instagram_account')}</span> {getPlatformCaption('instagram')}
              </div>
            </div>
          </div>
        );
      
      case "twitter":
        return (
          <div className="bg-white rounded-2xl overflow-hidden shadow-lg w-full max-w-sm md:max-w-xl mx-auto border border-gray-200">
            {/* Twitter Header */}
            <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4">
              {platformConnections.twitter?.profileImageUrl ? (
                <img 
                  src={platformConnections.twitter.profileImageUrl} 
                  alt="Profile"
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full flex-shrink-0 object-cover"
                />
              ) : (
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gray-300 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 md:gap-2 flex-wrap">
                  <span className="font-bold text-sm md:text-base text-gray-900">
                    {platformConnections.twitter?.name || platformConnections.twitter?.handle || 'Twitter Account'}
                  </span>
                  {platformConnections.twitter?.handle && (
                    <span className="text-gray-500 text-sm md:text-base">
                      @{platformConnections.twitter.handle}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-gray-900 text-sm md:text-lg leading-snug">
                  {getPlatformCaption('twitter')}
                </div>
                <div className="mt-3 rounded-xl md:rounded-2xl overflow-hidden">
                  {isVideoContent ? (
                    renderVideo()
                  ) : (
                    <div className="w-full aspect-square">
                      <img 
                        src={post.image} 
                        alt={post.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mt-3 text-gray-500">
                  <MessageCircle className="w-4 h-4 md:w-5 md:h-5" />
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <Heart className="w-4 h-4 md:w-5 md:h-5" />
                  <Bookmark className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
            </div>
          </div>
        );
      
      case "linkedin":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg w-full max-w-sm md:max-w-xl mx-auto border border-gray-200">
            {/* LinkedIn Header */}
            <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4">
              {platformConnections.linkedin?.picture ? (
                <img 
                  src={platformConnections.linkedin.picture} 
                  alt="Profile"
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full flex-shrink-0 object-cover"
                />
              ) : (
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-600 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm md:text-base text-gray-900">
                  {platformConnections.linkedin?.name || 'LinkedIn Account'}
                </div>
                <div className="text-xs md:text-sm text-gray-500">Professional • 1h</div>
              </div>
            </div>
            
            {/* LinkedIn Content */}
            <div className="px-3 md:px-4 pb-3">
              <div className="text-sm md:text-base text-gray-900 mb-3">
                {getPlatformCaption('linkedin')}
              </div>
            </div>
            
            {/* LinkedIn Media - aspect ratio based on model */}
            {isVideoContent ? (
              renderVideo()
            ) : (
              <div className="w-full aspect-square">
                <img 
                  src={post.image} 
                  alt={post.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            
            {/* LinkedIn Actions */}
            <div className="flex items-center justify-around p-2 border-t">
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                👍 Like
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                💬 Comment
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                🔄 Repost
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                📤 Send
              </Button>
            </div>
          </div>
        );
      
    }
  };

  return (
    <>
      {/* Full Screen Modal - Hide when ScheduleDialog or VideoEditor is open to prevent z-index conflicts */}
      {open && !showScheduleDialog && !showVideoEditor && (
        <>
          {/* Backdrop */}
          <div 
            className={`fixed inset-0 z-[100] bg-black/50 transition-opacity duration-300 ${
              isVisible ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={handleClose}
          />
          
          {/* Modal Content */}
          <div 
            className={`fixed inset-0 z-[101] overflow-y-auto transition-transform duration-300 ease-out ${
              isVisible ? 'translate-y-0' : 'translate-y-full'
            }`}
          >
            <div className="min-h-screen bg-background">
              {/* Close Button */}
              <button
                onClick={handleClose}
                className="fixed top-4 right-4 md:top-6 md:right-6 z-[102] p-2.5 rounded-full bg-muted hover:bg-muted/80 transition-colors border border-border"
                aria-label="Close"
              >
                <XIcon className="h-5 w-5 text-foreground" />
              </button>

              {/* Desktop Layout - Centered with balanced columns */}
              <div className="hidden lg:flex flex-col h-screen overflow-hidden">
                {/* Centered Container */}
                <div className={`flex-1 flex ${showEditDesign ? 'flex-row' : 'items-center justify-center'} overflow-hidden`}>
                  {/* Edit Design: 3-column layout */}
                  {showEditDesign ? (
                    <>
                      {/* Left Side - AI Chat (Edit Design mode - desktop only) */}
                      <div className="w-72 bg-background border-r flex-shrink-0 flex flex-col">
                {/* Header */}
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      <span className="font-semibold">Ask Dvyb to Make Changes</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">BETA</Badge>
                  </div>
                </div>

                {/* Chat Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4">
                    {chatMessages.length === 0 ? (
                      <div className="space-y-2 md:space-y-3">
                        <p className="text-xs md:text-sm text-muted-foreground">Try asking Dvyb to:</p>
                        <div className="space-y-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Add brand logo to this image")}
                          >
                            🏷️ Add Brand Logo
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Remove the brand logo from this image")}
                          >
                            ✂️ Remove Brand Logo
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Change the background to something more professional and modern")}
                          >
                            🎨 Change Background
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Replace the model/person with a different one while keeping the same pose and setting")}
                          >
                            👤 Replace with Different Model
                          </Button>
                        </div>
                      </div>
                    ) : (
                      chatMessages.map((message, index) => (
                        <div key={index} className={`${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                          <div className={`inline-block p-3 rounded-lg text-sm ${
                            message.role === 'user' 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-muted'
                          }`}>
                            {message.content}
                          </div>
                        </div>
                      ))
                    )}

                  </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="p-3 md:p-4 border-t space-y-2">
                  <div className="hidden flex gap-2">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs md:text-sm">
                      <Sparkles className="w-3 h-3 md:w-4 md:h-4" />
                      Tools
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1 text-xs md:text-sm">
                      <RotateCcw className="w-3 h-3 md:w-4 md:h-4" />
                      Revert
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <textarea
                      placeholder="Ask Dvyb to change something..."
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendPrompt();
                        }
                      }}
                      className="flex-1 text-sm min-h-[80px] max-h-[200px] resize-y rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      rows={3}
                    />
                    <Button className="self-end" onClick={handleSendPrompt}>
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </Button>
                  </div>
                </div>
              </div>

                      {/* Center - Platform Preview (Edit Design mode) */}
                      <div className="flex-1 bg-muted overflow-hidden">
                        <div className="h-full flex flex-col p-6">
                          <div className="flex items-center justify-center flex-1">
                            {renderPlatformPreview()}
                          </div>
                        </div>
                      </div>

                      {/* Right Side - Edit Design Controls */}
                      <div className="hidden md:flex w-80 bg-background border-l flex-shrink-0 flex-col h-full">
                        {/* Scrollable content area */}
                        <div className="flex-1 overflow-y-auto p-6">
                          <div className="space-y-4">
                          <div>
                              <h2 className="text-lg font-semibold mb-2">Edit Design</h2>
                              <p className="text-sm text-muted-foreground">
                                Add text overlays or use AI to regenerate.
                              </p>
                            </div>
                            
                            {/* Image Versions Gallery - Original + Regenerated - Vertical layout */}
                            <div>
                              <h3 className="text-sm font-medium mb-2">Image Versions</h3>
                              <p className="text-xs text-muted-foreground mb-3">
                                Click an image to use it as your canvas
                              </p>
                              <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-1">
                                {/* Original Image - Always first - use refreshed original URL */}
                                <div 
                                  onClick={() => {
                                    // Use the refreshed original URL (or fallback)
                                    const absoluteOriginal = refreshedOriginalUrl || post.originalMediaUrl || post.image;
                                    setRegeneratedImageUrl(null);
                                    setActiveImageS3Key(null);
                                    setEditDesignBaseImageUrl(absoluteOriginal);
                                    // Keep existing overlays when switching to original
                                  }}
                                  className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                    !activeImageS3Key && !regeneratedImageUrl
                                      ? 'border-primary ring-2 ring-primary/30' 
                                      : 'border-border hover:border-primary/50'
                                  }`}
                                >
                                  <div className="aspect-video w-full">
                                    <img 
                                      src={refreshedOriginalUrl || post.originalMediaUrl || post.image} 
                                      alt="Original"
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                                    <p className="text-xs text-white font-medium">📌 Original Image</p>
                                  </div>
                                  {!activeImageS3Key && !regeneratedImageUrl && (
                                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                                
                                {/* Processing placeholder - shown while regenerating */}
                                {isRegenerating && (
                                  <div className="relative rounded-lg overflow-hidden border-2 border-dashed border-primary/50 bg-primary/5">
                                    <div className="aspect-video w-full flex flex-col items-center justify-center gap-2">
                                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                      <p className="text-xs text-primary font-medium">Generating...</p>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 bg-primary/90 px-2 py-1">
                                      <p className="text-xs text-white font-medium">✨ New image in progress</p>
                                    </div>
                                  </div>
                                )}
                                
                                {/* Regenerated Images */}
                                {regenerations.map((regen) => (
                                  <div 
                                    key={regen.id}
                                    onClick={() => handleSelectRegeneration(regen)}
                                    className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                      activeImageS3Key === regen.regeneratedImageS3Key 
                                        ? 'border-primary ring-2 ring-primary/30' 
                                        : 'border-border hover:border-primary/50'
                                    }`}
                                  >
                                    {regen.status === 'completed' && regen.regeneratedImageUrl ? (
                                      <div className="aspect-video w-full">
                                        <img 
                                          src={regen.regeneratedImageUrl} 
                                          alt={regen.prompt}
                                          className="w-full h-full object-cover"
                                        />
                                      </div>
                                    ) : (
                                      <div className="aspect-video w-full bg-muted flex items-center justify-center">
                                        {regen.status === 'processing' || regen.status === 'pending' ? (
                                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                        ) : (
                                          <span className="text-xs text-destructive">Failed</span>
                                        )}
                                      </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                                      <p className="text-xs text-white truncate">✨ {regen.prompt.slice(0, 25)}...</p>
                                    </div>
                                    {activeImageS3Key === regen.regeneratedImageS3Key && (
                                      <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                            
                            {/* Processing indicator */}
                            {isRegenerating && (
                              <div className="bg-muted rounded-lg p-3 flex items-center gap-3">
                                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                                <div>
                                  <p className="text-sm font-medium">Regenerating...</p>
                                  <p className="text-xs text-muted-foreground">This may take a moment</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Fixed Save and Cancel buttons at bottom */}
                        <div className="p-4 border-t bg-background">
                            <Button 
                            className="w-full mb-2"
                              onClick={handleSaveDesign}
                              disabled={isSavingDesign || !canSaveDesign}
                            >
                              {isSavingDesign ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <Save className="w-4 h-4 mr-2" />
                                  Save Design
                                </>
                              )}
                            </Button>
                            <Button 
                              variant="outline"
                              className="w-full"
                              onClick={() => handleEditDesignToggle(false)}
                            >
                              Cancel
                          </Button>
                        </div>
                      </div>
                      
                      {/* Mobile/Tablet - Bottom drawer for Image Versions */}
                      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg z-50">
                        <div className="p-4">
                          {/* Image Versions - Horizontal scroll */}
                          <div className="mb-3">
                            <h3 className="text-xs font-medium mb-2">Image Versions</h3>
                            <div className="flex gap-2 overflow-x-auto pb-2">
                              {/* Original Image */}
                              <div 
                                onClick={() => {
                                  // Use the refreshed original URL (or fallback)
                                  const absoluteOriginal = refreshedOriginalUrl || post.originalMediaUrl || post.image;
                                  setRegeneratedImageUrl(null);
                                  setActiveImageS3Key(null);
                                  setEditDesignBaseImageUrl(absoluteOriginal);
                                }}
                                className={`relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-2 ${
                                  !activeImageS3Key && !regeneratedImageUrl
                                    ? 'border-primary ring-2 ring-primary/30' 
                                    : 'border-border'
                                }`}
                              >
                                <img 
                                  src={refreshedOriginalUrl || post.originalMediaUrl || post.image} 
                                  alt="Original"
                                  className="w-full h-full object-cover"
                                />
                                {!activeImageS3Key && !regeneratedImageUrl && (
                                  <div className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground rounded-full p-0.5">
                                    <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                              
                              {/* Regenerated Images */}
                              {regenerations.map((regen) => (
                                <div 
                                  key={regen.id}
                                  onClick={() => handleSelectRegeneration(regen)}
                                  className={`relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-2 ${
                                    activeImageS3Key === regen.regeneratedImageS3Key 
                                      ? 'border-primary ring-2 ring-primary/30' 
                                      : 'border-border'
                                  }`}
                                >
                                  {regen.status === 'completed' && regen.regeneratedImageUrl ? (
                                    <img 
                                      src={regen.regeneratedImageUrl} 
                                      alt={regen.prompt}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-muted flex items-center justify-center">
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    </div>
                                  )}
                                  {activeImageS3Key === regen.regeneratedImageS3Key && (
                                    <div className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground rounded-full p-0.5">
                                      <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                          
                          {/* Action buttons */}
                          <div className="flex gap-2">
                            <Button 
                              variant="outline"
                              className="flex-1"
                              onClick={() => handleEditDesignToggle(false)}
                            >
                              Cancel
                            </Button>
                            <Button 
                              className="flex-1"
                              onClick={handleSaveDesign}
                              disabled={isSavingDesign || !canSaveDesign}
                            >
                              {isSavingDesign ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Save className="w-4 h-4 mr-1" /> Save</>}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* Normal Mode - Centered two-column layout */
                    <div className="w-full max-w-5xl mx-auto px-8 py-12">
                      <div className="grid grid-cols-5 gap-12">
                        {/* Left - Platform Preview */}
                        <div className="col-span-3 flex items-start justify-center">
                          {renderPlatformPreview()}
                        </div>

                        {/* Right - Make Changes */}
                        <div className="col-span-2">
                          <div className="bg-background rounded-xl border shadow-sm p-6 space-y-6">
                            <div>
                              <h2 className="text-xl font-semibold mb-4">Make Changes</h2>
                              <div className="flex gap-3">
                                <Button 
                                  variant="outline" 
                                  className="flex-1"
                                  onClick={() => setShowCaptionEdit(true)}
                                >
                                  <span className="mr-2">📝</span>
                                  Edit Caption
                                </Button>
                                <div className="flex-1 flex flex-col gap-1">
                                  <Button 
                                    variant="outline" 
                                    className="w-full"
                                    onClick={() => {
                                      if (isVideo) {
                                        // Close PostDetailDialog and open video editor
                                        onOpenChange(false);
                                        // Small delay to ensure dialog closes before opening video editor
                                        setTimeout(() => {
                                          setShowVideoEditor(true);
                                        }, 100);
                                      } else {
                                        handleEditDesignToggle(!showEditDesign);
                                      }
                                    }}
                                  >
                                    <span className="mr-2">{isVideo ? '🎬' : '🎨'}</span>
                                    {isVideo ? 'Edit Video' : 'Edit Design'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                            
                            <div>
                              <h3 className="text-sm font-medium mb-3">Posting on</h3>
                              <Button 
                                variant="outline" 
                                className="w-full justify-between hover:bg-accent"
                                onClick={handleOpenScheduleDialog}
                              >
                                <div className="flex items-center gap-2">
                                  <CalendarIcon className="w-4 h-4" />
                                  <span>
                                    {post.date && post.time ? `${post.date} ${post.time}` : 'Not Selected'}
                                  </span>
                                </div>
                                <ChevronRight className="w-4 h-4" />
                              </Button>
                            </div>
                            
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-medium">Platforms</h3>
                                <Button variant="ghost" size="sm" className="text-sm h-8">
                                  ⚙️ Manage
                                </Button>
                              </div>
                              
                              <div className="space-y-2">
                                {platformOptions.map((platform) => (
                                  <Card
                                    key={platform.id}
                                    className={`p-3 cursor-pointer transition-colors ${
                                      selectedPlatform === platform.id
                                        ? "border-primary bg-primary/5"
                                        : "hover:bg-muted/50"
                                    }`}
                                    onClick={() => setSelectedPlatform(platform.id)}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <span className="text-xl">{platform.icon}</span>
                                        <span className="font-medium">{platform.label}</span>
                                      </div>
                                      <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center">
                                        {selectedPlatform === platform.id && (
                                          <div className="w-3 h-3 rounded-full bg-primary" />
                                        )}
                                      </div>
                                    </div>
                                  </Card>
                                ))}
                              </div>
                            </div>
                            
                            {/* Post Now Button */}
                            <div>
                              <Button 
                                className="w-full btn-gradient-cta"
                                onClick={handlePostNowClick}
                                disabled={isPosting}
                              >
                                {isPosting ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Posting...
                                  </>
                                ) : (
                                  <>
                                    <Send className="w-4 h-4 mr-2" />
                                    Post Now
                                  </>
                                )}
                              </Button>
                            </div>
                            
                            {/* Accept/Reject buttons for Pending Review content */}
                            {isPendingReview && (
                              <div>
                                <h3 className="text-sm font-medium mb-3">Review Content</h3>
                                <div className="flex items-center justify-center gap-4">
                                  <button
                                    className="w-12 h-12 rounded-full border-2 border-red-300 bg-white hover:bg-red-50 flex items-center justify-center transition-colors disabled:opacity-50"
                                    onClick={() => handleReject(false)}
                                    disabled={isAcceptingRejecting}
                                  >
                                    {isAcceptingRejecting ? (
                                      <Loader2 className="w-5 h-5 text-red-500 animate-spin" />
                                    ) : (
                                      <XCircle className="w-6 h-6 text-red-500" />
                                    )}
                                  </button>
                                  <button
                                    className="w-12 h-12 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors disabled:opacity-50"
                                    onClick={() => handleAccept(false)}
                                    disabled={isAcceptingRejecting}
                                  >
                                    {isAcceptingRejecting ? (
                                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                                    ) : (
                                      <Heart className="w-6 h-6 text-white" />
                                    )}
                                  </button>
                                </div>
                                {pendingReviewItems.length > 1 && (
                                  <p className="text-xs text-muted-foreground text-center mt-2">
                                    {pendingReviewItems.length} pending
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

          {/* Mobile/Tablet Layout - Single Column with Vertical Scroll */}
          <div className="flex lg:hidden flex-col min-h-screen overflow-y-auto pb-6">
            {/* Image Preview at Top - with swipe support for pending review */}
            <div className="bg-muted p-4 md:p-8 pt-6 md:pt-8 pb-4 md:pb-6 flex flex-col items-center justify-center relative">
              {/* Swipe indicators - only show during active swipe */}
              {isPendingReview && swipeOffset !== 0 && (
                <>
                  {/* LIKE indicator */}
                  <div 
                    className="absolute top-1/2 right-4 -translate-y-1/2 z-10 px-4 py-2 border-4 border-emerald-500 rounded-lg font-bold text-emerald-500 text-xl rotate-12 pointer-events-none transition-opacity"
                    style={{ opacity: Math.max(0, swipeOffset / 100) }}
                  >
                    LIKE
                  </div>
                  {/* NOPE indicator */}
                  <div 
                    className="absolute top-1/2 left-4 -translate-y-1/2 z-10 px-4 py-2 border-4 border-red-500 rounded-lg font-bold text-red-500 text-xl -rotate-12 pointer-events-none transition-opacity"
                    style={{ opacity: Math.max(0, -swipeOffset / 100) }}
                  >
                    NOPE
                  </div>
                </>
              )}
              <div 
                className="w-full max-w-md"
                style={isPendingReview ? getSwipeStyle() : undefined}
                onTouchStart={isPendingReview ? onTouchStart : undefined}
                onTouchMove={isPendingReview ? onTouchMove : undefined}
                onTouchEnd={isPendingReview ? onTouchEnd : undefined}
              >
                {renderPlatformPreview()}
              </div>
              {/* Swipe hint for pending review - shown below the preview */}
              {isPendingReview && !swipeOffset && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  Swipe right to like, left to reject
                </p>
              )}
            </div>
            
            {/* Make Changes section - shown below image (non-Edit Design) */}
            {!showEditDesign && (
              <div className="bg-background px-4 py-6 md:px-6">
                <div className="max-w-md mx-auto space-y-5">
                  {/* Accept/Reject buttons for Pending Review content - Mobile/Tablet (above Make Changes) */}
                  {isPendingReview && (
                    <div className="flex items-center justify-center gap-6">
                      <button
                        className="w-14 h-14 rounded-full border-2 border-red-300 bg-white hover:bg-red-50 flex items-center justify-center transition-colors disabled:opacity-50"
                        onClick={() => handleReject(false)}
                        disabled={isAcceptingRejecting}
                      >
                        {isAcceptingRejecting ? (
                          <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
                        ) : (
                          <XCircle className="w-7 h-7 text-red-500" />
                        )}
                      </button>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          {pendingReviewItems.length} pending
                        </p>
                      </div>
                      <button
                        className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors disabled:opacity-50"
                        onClick={() => handleAccept(false)}
                        disabled={isAcceptingRejecting}
                      >
                        {isAcceptingRejecting ? (
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                        ) : (
                          <Heart className="w-7 h-7 text-white" />
                        )}
                      </button>
                    </div>
                  )}
                  
                  <div>
                    <h2 className="text-lg font-semibold mb-4">Make Changes</h2>
                    <div className="flex gap-3">
                      <Button 
                        variant="outline" 
                        className="flex-1"
                        onClick={() => setShowCaptionEdit(true)}
                      >
                        <span className="mr-2">📝</span>
                        Edit Caption
                      </Button>
                      <div className="flex-1 flex flex-col gap-1">
                        <Button 
                          variant="outline" 
                          className="w-full"
                          onClick={() => {
                            if (isVideo) {
                              // Close PostDetailDialog and open video editor
                              onOpenChange(false);
                              // Small delay to ensure dialog closes before opening video editor
                              setTimeout(() => {
                                setShowVideoEditor(true);
                              }, 100);
                            } else {
                              handleEditDesignToggle(!showEditDesign);
                            }
                          }}
                        >
                          <span className="mr-2">{isVideo ? '🎬' : '🎨'}</span>
                          {isVideo ? 'Edit Video' : 'Edit Design'}
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-sm font-medium mb-3">Posting on</h3>
                    <Button 
                      variant="outline" 
                      className="w-full justify-between hover:bg-accent"
                      onClick={handleOpenScheduleDialog}
                    >
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4" />
                        <span>
                          {post.date && post.time ? `${post.date} ${post.time}` : 'Not Selected'}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium">Platforms</h3>
                      <Button variant="ghost" size="sm" className="text-sm h-8">
                        ⚙️ Manage
                      </Button>
                    </div>
                    
                    <div className="space-y-2">
                      {platformOptions.map((platform) => (
                        <Card
                          key={platform.id}
                          className={`p-3 cursor-pointer transition-colors ${
                            selectedPlatform === platform.id
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/50"
                          }`}
                          onClick={() => setSelectedPlatform(platform.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-xl">{platform.icon}</span>
                              <span className="font-medium">{platform.label}</span>
                            </div>
                            <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center">
                              {selectedPlatform === platform.id && (
                                <div className="w-3 h-3 rounded-full bg-primary" />
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                  
                  {/* Post Now Button - Mobile/Tablet */}
                  <div>
                    <Button 
                      className="w-full btn-gradient-cta"
                      onClick={handlePostNowClick}
                      disabled={isPosting}
                    >
                      {isPosting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Posting...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4 mr-2" />
                          Post Now
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Edit Design Mode - Mobile */}
            {showEditDesign && (
              <div className="bg-background px-4 py-6 md:px-6">
                <div className="max-w-md mx-auto space-y-5">
                  {/* AI Chat Panel */}
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-sm">Ask Dvyb to Make Changes</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">BETA</Badge>
                    </div>

                    <div className="space-y-3">
                      {chatMessages.length === 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">Try asking Dvyb to:</p>
                          <div className="flex flex-wrap gap-2">
                            {["Make green", "Change text style", "Add logo"].map((prompt) => (
                              <Button 
                                key={prompt}
                                variant="outline" 
                                size="sm" 
                                className="text-xs h-7"
                                onClick={() => handleExamplePrompt(prompt)}
                              >
                                {prompt}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {chatMessages.map((message, index) => (
                            <div key={index} className={`${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                              <div className={`inline-block p-2 rounded-lg text-xs ${
                                message.role === 'user' 
                                  ? 'bg-primary text-primary-foreground' 
                                  : 'bg-muted'
                              }`}>
                                {message.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 mt-3">
                      <Input
                        placeholder="Ask Dvyb..."
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendPrompt()}
                        className="text-sm h-9"
                      />
                      <Button size="sm" onClick={handleSendPrompt} className="h-9 px-3">
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Save/Cancel buttons */}
                  <div>
                    <Button 
                      className="w-full mb-2"
                      onClick={handleSaveDesign}
                      disabled={isSavingDesign || !canSaveDesign}
                    >
                      {isSavingDesign ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          Save Design
                        </>
                      )}
                    </Button>
                    {!canSaveDesign && (
                      <p className="text-xs text-muted-foreground text-center mb-2">
                        Add text or emojis to enable saving
                      </p>
                    )}
                    <Button 
                      variant="outline"
                      className="w-full"
                      onClick={() => handleEditDesignToggle(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
            </div>
          </div>
        </>
      )}

      <CaptionEditDialog
        open={showCaptionEdit}
        onOpenChange={setShowCaptionEdit}
        initialCaption={getPlatformCaption(selectedPlatform)}
        onSave={handleSaveCaption}
        platform={selectedPlatform}
      />

      {/* Schedule Dialog */}
      {post && showScheduleDialog && (
        <ScheduleDialog
          open={showScheduleDialog}
          onOpenChange={(open) => {
            if (!open) {
              // User clicked outside or pressed ESC - treat as cancel
              handleScheduleDialogClose(false);
            }
          }}
          post={{
            ...post,
            generatedContentId: (post as any).contentId || post.generatedContentId, // Map contentId to generatedContentId
            postIndex: (post as any).postIndex,
            fullPlatformTexts: (post as any).fullPlatformTexts, // Pass full texts for posting
            editedCaptions, // Pass user-edited captions
          }}
          onScheduleComplete={() => {
            // Scheduling was successful - close both dialogs
            handleScheduleDialogClose(true);
          }}
        />
      )}

      {/* Posting Results Dialog */}
      <AlertDialog open={showPostingDialog} onOpenChange={setShowPostingDialog}>
        <AlertDialogContent className="w-[90vw] sm:w-[85vw] md:max-w-md p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-lg sm:text-xl">
              {!postingComplete ? "Posting..." : "Posting Results"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {!postingComplete && (
                <div className="flex flex-col items-center justify-center py-4 sm:py-6">
                  <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 animate-spin text-emerald-500 mb-3 sm:mb-4" />
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
                                  
                                  // Save flow state
                                  saveOAuthFlowState({
                                    type: 'post_now',
                                    source: 'content_library',
                                    post: post ? {
                                      id: post.id,
                                      type: post.image?.includes('video') || post.image?.includes('.mp4') ? 'Video' : 'Post',
                                      image: post.image,
                                      description: post.description,
                                      requestedPlatforms: post.requestedPlatforms || post.platforms,
                                      platforms: post.platforms,
                                      platformTexts: {},
                                      fullPlatformTexts: post.fullPlatformTexts,
                                      postIndex: post.postIndex,
                                      generatedContentId: post.generatedContentId || post.contentId,
                                    } : undefined,
                                    platformsToAuth: [],
                                    currentPlatformIndex: 0,
                                    needsOAuth1: true,
                                    oauth1Completed: false,
                                    generatedPosts: [],
                                    generatedContentId: post?.generatedContentId || post?.contentId || null,
                                    generationUuid: null,
                                  });
                                  
                                  window.location.href = authUrl;
                                } catch (error) {
                                  console.error('Failed to initiate OAuth1:', error);
                                  toast({
                                    title: "Authorization Failed",
                                    description: "Couldn't start video authorization. Please try again.",
                                    variant: "destructive",
                                  });
                                }
                              }}
                            >
                              Authorize Video Upload
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
            <AlertDialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                onClick={() => {
                  setShowPostingDialog(false);
                  // If posting was successful, close the PostDetailDialog too
                  const successCount = postingResults.filter((r: any) => r.success).length;
                  if (successCount > 0) {
                    onOpenChange(false);
                    if (onScheduleComplete) {
                      onScheduleComplete();
                    }
                  }
                }}
                className="w-full sm:w-auto btn-gradient-cta"
              >
                Done
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Video Editor Modal - Rendered outside PostDetailDialog for proper z-index */}
      {showVideoEditor && (
        <VideoEditorModal
          open={showVideoEditor}
          onOpenChange={(open) => {
            setShowVideoEditor(open);
            // If video editor closes and PostDetailDialog was open, keep it closed
            // User can reopen PostDetailDialog if needed
          }}
          videoData={isVideo && post ? {
            generatedContentId: post.generatedContentId || post.contentId || 0,
            postIndex: post.postIndex || 0,
            videoUrl: post.image,
            duration: 30, // Will be updated from metadata
            clips: [{
              url: post.image,
              duration: 30,
              startTime: 0,
            }],
            // TODO: Load voiceover and background music from metadata
          } : undefined}
          onSave={() => {
            // Refresh the post data after save
            if (onScheduleComplete) {
              onScheduleComplete();
            }
            // Close video editor
            setShowVideoEditor(false);
          }}
        />
      )}
    </>
  );
};
