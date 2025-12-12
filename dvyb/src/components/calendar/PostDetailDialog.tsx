"use client";


import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ChevronRight, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Sparkles, RotateCcw, Music, Calendar as CalendarIcon,
  Type, Bold, Italic, Underline, Trash2, Plus, RotateCw, Smile, Sticker, X, Save, Loader2
} from "lucide-react";
import { CaptionEditDialog } from "./CaptionEditDialog";
import { ScheduleDialog } from "./ScheduleDialog";
import { accountApi, captionsApi, imageEditsApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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
}

interface PostDetailDialogProps {
  post: Post | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditDesignModeChange?: (isEditMode: boolean) => void;
  onScheduleComplete?: () => void;
}

type Platform = "instagram" | "linkedin" | "twitter";

export const PostDetailDialog = ({ post, open, onOpenChange, onEditDesignModeChange, onScheduleComplete }: PostDetailDialogProps) => {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("instagram");
  const [showCaptionEdit, setShowCaptionEdit] = useState(false);
  const [showEditDesign, setShowEditDesign] = useState(false);
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [regeneratedImageUrl, setRegeneratedImageUrl] = useState<string | null>(null); // For chat-based image regeneration
  const [caption, setCaption] = useState(post?.description || "");
  const [aiPrompt, setAiPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [editedCaptions, setEditedCaptions] = useState<Record<string, string>>({}); // User-edited captions
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const { toast } = useToast();

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
  const handleEditDesignToggle = (value: boolean) => {
    setShowEditDesign(value);
    // Only collapse sidebar on desktop
    if (window.innerWidth >= 1024) {
      onEditDesignModeChange?.(value);
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

      // Extract S3 key from regenerated image URL if present
      let regeneratedImageS3Key: string | null = null;
      if (regeneratedImageUrl) {
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

  // Reset Edit Design mode when dialog closes
  const handleDialogOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setShowEditDesign(false);
      onEditDesignModeChange?.(false);
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

  const handleSendPrompt = () => {
    if (!aiPrompt.trim()) return;
    
    // Add user message
    setChatMessages(prev => [...prev, { role: 'user', content: aiPrompt }]);
    
    // Simulate AI response
    setTimeout(() => {
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I'm updating the design for you now. Please hold on a moment while I make this change."
      }]);
    }, 500);
    
    setAiPrompt("");
  };

  const handleExamplePrompt = (prompt: string) => {
    setAiPrompt(prompt);
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
    // - veo3 models → 9:16 (aspect-[9/16])
    // Default to 9:16 if model is unknown
    const getVideoAspectRatio = () => {
      if (!isVideoContent) return 'aspect-square'; // Images are always 1:1
      
      const model = post.videoModel?.toLowerCase() || '';
      if (model.includes('kling')) {
        return 'aspect-square'; // 1:1 for kling
      }
      // Default to 9:16 for veo3 and other models
      return 'aspect-[9/16]';
    };
    
    const videoAspectClass = getVideoAspectRatio();

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
                  src={post.image} 
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
                  <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                )}
                <span className="font-semibold text-xs md:text-sm text-gray-900">
                  {platformConnections.instagram?.name || platformConnections.instagram?.username || 'instagram_account'}
                </span>
              </div>
              <MoreHorizontal className="w-4 h-4 md:w-5 md:h-5 text-gray-900" />
            </div>
            
            {/* Instagram Media - aspect ratio based on model */}
            <div className={`w-full ${isVideoContent ? videoAspectClass : 'aspect-square'}`}>
              {isVideoContent ? (
                <video 
                  src={post.image} 
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <img 
                  src={post.image} 
                  alt={post.title}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            
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
                <span className="font-semibold">{platformConnections.instagram?.name || platformConnections.instagram?.username || 'instagram_account'}</span> {getPlatformCaption('instagram')}
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
                <div className={`mt-3 rounded-xl md:rounded-2xl overflow-hidden ${isVideoContent ? videoAspectClass : 'aspect-square'}`}>
                  {isVideoContent ? (
                    <video 
                      src={post.image} 
                      controls
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img 
                      src={post.image} 
                      alt={post.title}
                      className="w-full h-full object-cover"
                    />
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
            <div className={`w-full ${isVideoContent ? videoAspectClass : 'aspect-square'}`}>
              {isVideoContent ? (
                <video 
                  src={post.image} 
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <img 
                  src={post.image} 
                  alt={post.title}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            
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
      {/* Hide PostDetailDialog when ScheduleDialog is open to prevent z-index conflicts */}
      <Dialog open={open && !showScheduleDialog} onOpenChange={handleDialogOpenChange}>
        <DialogContent className={`${
          showEditDesign 
            ? 'w-[95vw] md:w-[calc(100vw-8rem)] lg:w-[calc(100vw-10rem)] max-w-none ml-0 md:ml-6 lg:ml-6 mr-0 md:mr-6 lg:mr-6' 
            : 'w-[95vw] md:w-[calc(100vw-8rem)] lg:w-auto max-w-7xl ml-0 md:ml-6 lg:ml-0 mr-0 md:mr-6 lg:mr-0'
        } h-[90vh] p-0 gap-0 overflow-hidden z-[100]`}>
          {/* Desktop Layout - 3 Column (with chat panel on left when Edit Design ON) */}
          <div className="hidden lg:flex flex-row h-full overflow-hidden">
            {/* Left Side - AI Chat (Edit Design mode - desktop only) */}
            {showEditDesign && (
              <div className="lg:w-72 bg-background lg:border-r flex-col">
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
                            onClick={() => handleExamplePrompt("Make this into green colour")}
                          >
                            Make this into green colour
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Make a generated background")}
                          >
                            Make a generated background
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Change the text style")}
                          >
                            Change the text style
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Add brand logo")}
                          >
                            Add brand logo
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

                    {/* Example variations */}
                    {chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'assistant' && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Generated variations:</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[1, 2, 3, 4].map((i) => (
                            <div key={i} className={`aspect-square rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 p-3 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all`}>
                              <p className="text-white text-xs font-bold text-center leading-tight">
                                {post.title}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
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
            )}

            {/* Center - Platform Preview (desktop) */}
            <div className={`flex-1 bg-muted ${showEditDesign ? 'overflow-hidden' : 'overflow-y-auto'}`}>
              <div className={`h-full flex flex-col ${showEditDesign ? 'p-4 md:p-6 lg:p-6' : 'p-4 md:p-8 lg:p-8 min-h-full'}`}>
                {/* Platform Preview */}
                <div className={`flex items-center justify-center ${showEditDesign ? 'flex-1' : 'lg:flex-1'}`}>
                  {renderPlatformPreview()}
                </div>
                
                {/* Make Changes section - shown below image on mobile/tablet (non-Edit Design) */}
                <div className={`${showEditDesign ? 'hidden' : 'lg:hidden'} mt-6 bg-background rounded-lg p-4`}>
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Make Changes</h2>
                      <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 text-xs md:text-sm"
                      onClick={() => setShowCaptionEdit(true)}
                    >
                      <span className="mr-1 md:mr-2">📝</span>
                      Edit Caption
                    </Button>
                    <div className="flex-1 flex flex-col gap-1">
                      <Button 
                        variant={showEditDesign ? "default" : "outline"} 
                        className="w-full text-xs md:text-sm"
                        disabled={isVideo}
                        onClick={() => !isVideo && handleEditDesignToggle(!showEditDesign)}
                      >
                        <span className="mr-1 md:mr-2">🎨</span>
                        Edit Design
                      </Button>
                      {isVideo && <span className="text-[10px] text-muted-foreground text-center">Coming Soon</span>}
                    </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-xs md:text-sm font-medium mb-2">Posting on</h3>
                      <Button 
                        variant="outline" 
                        className="w-full justify-between text-xs md:text-sm hover:bg-accent"
                        onClick={handleOpenScheduleDialog}
                      >
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-3 h-3 md:w-4 md:h-4" />
                          <span>
                            {post.date && post.time ? `${post.date} ${post.time}` : 'Not Selected'}
                          </span>
                        </div>
                        <ChevronRight className="w-3 h-3 md:w-4 md:h-4" />
                      </Button>
                    </div>
                    
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs md:text-sm font-medium">Posts</h3>
                        <Button variant="ghost" size="sm" className="text-xs md:text-sm">
                          ⚙️ Manage
                        </Button>
                      </div>
                      
                      <div className="space-y-2">
                        {platformOptions.map((platform) => (
                          <Card
                            key={platform.id}
                            className={`p-2 md:p-3 cursor-pointer transition-colors ${
                              selectedPlatform === platform.id
                                ? "border-primary bg-primary/5"
                                : "hover:bg-muted/50"
                            }`}
                            onClick={() => setSelectedPlatform(platform.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg md:text-xl">{platform.icon}</span>
                                <span className="font-medium text-sm md:text-base">{platform.label}</span>
                              </div>
                              <div className="w-4 h-4 md:w-5 md:h-5 rounded-full border-2 border-primary flex items-center justify-center">
                                {selectedPlatform === platform.id && (
                                  <div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-primary" />
                                )}
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Right Side - Make Changes (Desktop Only) */}
            <div className="lg:w-80 bg-background lg:border-l p-6 overflow-y-auto">
              <div className="space-y-6">
                {showEditDesign ? (
                  /* Edit Design Mode - Show only Save button */
                  <div>
                    <h2 className="text-lg font-semibold mb-4">Edit Design</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Add text, emojis, and stickers to your image. Click Save Design when done.
                    </p>
                    <Button 
                      className="w-full mb-3"
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
                      <p className="text-xs text-muted-foreground text-center mb-3">
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
                ) : (
                  /* Normal Mode - Show full options */
                  <>
                    <div>
                      <h2 className="text-lg font-semibold mb-4">Make Changes</h2>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          className="flex-1 text-sm"
                          onClick={() => setShowCaptionEdit(true)}
                        >
                          <span className="mr-2">📝</span>
                          Edit Caption
                        </Button>
                        <div className="flex-1 flex flex-col gap-1">
                          <Button 
                            variant={showEditDesign ? "default" : "outline"} 
                            className="w-full text-sm"
                            disabled={isVideo}
                            onClick={() => !isVideo && handleEditDesignToggle(!showEditDesign)}
                          >
                            <span className="mr-2">🎨</span>
                            Edit Design
                          </Button>
                          {isVideo && <span className="text-[10px] text-muted-foreground text-center">Coming Soon</span>}
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-sm font-medium mb-2">Posting on</h3>
                      <Button 
                        variant="outline" 
                        className="w-full justify-between text-sm hover:bg-accent"
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
                        <h3 className="text-sm font-medium">Posts</h3>
                        <Button variant="ghost" size="sm" className="text-sm">
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
                              <div className="flex items-center gap-2">
                                <span className="text-xl">{platform.icon}</span>
                                <span className="font-medium text-base">{platform.label}</span>
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
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile/Tablet Layout - Single Column with Vertical Scroll */}
          <div className="flex lg:hidden flex-col h-full overflow-y-auto">
            {/* Image Preview at Top */}
            <div className="bg-muted p-4 md:p-8 pt-6 md:pt-8 pb-6 md:pb-8 flex items-start justify-center">
              <div className="w-full max-w-md">
                {renderPlatformPreview()}
              </div>
            </div>

            {/* AI Chat Panel (only when Edit Design is ON) */}
            {showEditDesign && (
              <div className="bg-background border-t">
                <div className="px-4 py-3 md:px-6 md:py-4 border-b">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                      <span className="font-semibold text-sm md:text-base">Ask Dvyb to Make Changes</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] md:text-xs px-1.5 md:px-2">BETA</Badge>
                  </div>
                </div>

                <div className="px-4 py-4 md:px-6 md:py-4">
                  <div className="space-y-3 md:space-y-4">
                    {chatMessages.length === 0 ? (
                      <div className="space-y-2 md:space-y-3">
                        <p className="text-xs md:text-sm text-muted-foreground">Try asking Dvyb to:</p>
                        <div className="space-y-2 md:space-y-2.5">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Make this into green colour")}
                          >
                            Make this into green colour
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Make a generated background")}
                          >
                            Make a generated background
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Change the text style")}
                          >
                            Change the text style
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Add brand logo")}
                          >
                            Add brand logo
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 md:space-y-4">
                        {chatMessages.map((message, index) => (
                          <div key={index} className={`${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                            <div className={`inline-block p-2.5 md:p-3 rounded-lg text-xs md:text-sm ${
                              message.role === 'user' 
                                ? 'bg-primary text-primary-foreground' 
                                : 'bg-muted'
                            }`}>
                              {message.content}
                            </div>
                          </div>
                        ))}

                        {chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'assistant' && (
                          <div className="space-y-2 md:space-y-3">
                            <p className="text-xs md:text-sm text-muted-foreground">Generated variations:</p>
                            <div className="grid grid-cols-2 gap-2 md:gap-3">
                              {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="aspect-square rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 p-2 md:p-3 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all">
                                  <p className="text-white text-[10px] md:text-xs font-bold text-center leading-tight">
                                    {post.title}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 mt-4 md:mt-5">
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
                      className="flex-1 text-xs md:text-sm min-h-[60px] md:min-h-[80px] max-h-[150px] resize-y rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      rows={2}
                    />
                    <Button className="self-end h-9 md:h-10" onClick={handleSendPrompt}>
                      <Send className="w-4 h-4 mr-2" />
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Make Changes Section */}
            <div className="bg-background border-t px-4 py-4 md:px-6 md:py-5">
              <div className="space-y-5 md:space-y-6">
                {showEditDesign ? (
                  /* Edit Design Mode - Show only Save button */
                  <div>
                    <h2 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Edit Design</h2>
                    <p className="text-xs md:text-sm text-muted-foreground mb-4">
                      Add text, emojis, and stickers to your image. Click Save Design when done.
                    </p>
                    <Button 
                      className="w-full mb-3"
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
                      <p className="text-xs text-muted-foreground text-center mb-3">
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
                ) : (
                  /* Normal Mode - Show full options */
                  <>
                    <div>
                      <h2 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Make Changes</h2>
                      <div className="flex gap-2 md:gap-3">
                        <Button 
                          variant="outline" 
                          className="flex-1 text-xs md:text-sm h-10 md:h-10"
                          onClick={() => setShowCaptionEdit(true)}
                        >
                          <span className="mr-1.5 md:mr-2">📝</span>
                          Edit Caption
                        </Button>
                        <div className="flex-1 flex flex-col gap-1">
                          <Button 
                            variant={showEditDesign ? "default" : "outline"} 
                            className="w-full text-xs md:text-sm h-10 md:h-10"
                            disabled={isVideo}
                            onClick={() => !isVideo && handleEditDesignToggle(!showEditDesign)}
                          >
                            <span className="mr-1.5 md:mr-2">🎨</span>
                            Edit Design
                          </Button>
                          {isVideo && <span className="text-[10px] text-muted-foreground text-center">Coming Soon</span>}
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-xs md:text-sm font-medium mb-2 md:mb-3">Posting on</h3>
                      <Button 
                        variant="outline" 
                        className="w-full justify-between text-xs md:text-sm h-11 md:h-12 px-3 md:px-4 hover:bg-accent"
                        onClick={handleOpenScheduleDialog}
                      >
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-4 h-4" />
                          <span>
                            {post.date && post.time ? `${post.date} ${post.time}` : 'Not Selected'}
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 md:w-4 md:h-4" />
                      </Button>
                    </div>
                    
                    <div>
                      <div className="flex items-center justify-between mb-3 md:mb-4">
                        <h3 className="text-xs md:text-sm font-medium">Posts</h3>
                        <Button variant="ghost" size="sm" className="text-xs md:text-sm h-8 md:h-9 px-2 md:px-3">
                          ⚙️ Manage
                        </Button>
                      </div>
                      
                      <div className="space-y-2 md:space-y-3">
                        {platformOptions.map((platform) => (
                          <Card
                            key={platform.id}
                            className={`p-3 md:p-3.5 cursor-pointer transition-colors ${
                              selectedPlatform === platform.id
                                ? "border-primary bg-primary/5"
                                : "hover:bg-muted/50"
                            }`}
                            onClick={() => setSelectedPlatform(platform.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2.5 md:gap-3">
                                <span className="text-xl md:text-xl">{platform.icon}</span>
                                <span className="font-medium text-sm md:text-base">{platform.label}</span>
                              </div>
                              <div className="w-5 h-5 md:w-5 md:h-5 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
                                {selectedPlatform === platform.id && (
                                  <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-primary" />
                                )}
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </>
  );
};
