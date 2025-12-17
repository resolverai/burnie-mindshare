'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, 
  Search, 
  CheckCircle,
  XCircle,
  Clock,
  Image as ImageIcon,
  Video,
  Play,
  ChevronDown,
  Eye,
  Sparkles,
  Filter,
  Type,
  Bold,
  Italic,
  Underline,
  Trash2,
  Plus,
  RotateCw,
  Smile,
  X,
  Save,
  Loader2,
  Send,
  Sticker,
} from 'lucide-react';
import Image from 'next/image';

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

// Color presets for quick selection
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

// Sticker emojis
const STICKERS = ['🎀', '🎗️', '🏷️', '📍', '📌', '💬', '💭', '🗯️', '👑', '🎭', '🎪', '🎨', '🖼️', '🎹', '🎺', '🥁', '🎻', '🪄', '✨', '💫'];

interface Account {
  id: number;
  accountName: string;
  primaryEmail: string;
  pendingApprovals: number;
}

interface ContentItem {
  id: number | string;
  generatedContentId: number;
  postIndex: number;
  contentType: 'image' | 'video';
  mediaUrl: string;
  originalMediaUrl: string;
  hasEditedImage?: boolean;
  imageEditStatus?: 'pending' | 'processing' | 'completed' | 'failed' | null;
  topic: string;
  platformTexts: Record<string, string>;
  originalPlatformTexts?: Record<string, string>;
  customCaptions?: Record<string, string>;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvalId?: number;
  approvedById?: string;
  notes?: string;
  approvedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  uuid: string;
  requestedPlatforms?: string[];
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface ContentDetailDialogProps {
  content: ContentItem | null;
  open: boolean;
  onClose: () => void;
  onApprove: (content: ContentItem, notes?: string) => void;
  onReject: (content: ContentItem, notes?: string) => void;
  onSaveCaptions: (content: ContentItem, captions: Record<string, string>) => void;
  onSaveDesign: (content: ContentItem, overlays: TextOverlay[], regeneratedImageS3Key?: string | null) => void;
  isProcessing: boolean;
  selectedAccountId: number | null;
}

// Reference width for font scaling
const REFERENCE_WIDTH = 450;

// Content Detail Dialog Component with Edit Design
function ContentDetailDialog({
  content,
  open,
  onClose,
  onApprove,
  onReject,
  onSaveCaptions,
  onSaveDesign,
  isProcessing,
  selectedAccountId,
}: ContentDetailDialogProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<'twitter' | 'instagram' | 'linkedin'>('twitter');
  const [editedCaptions, setEditedCaptions] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [showCaptionEdit, setShowCaptionEdit] = useState(false);
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  
  // Edit Design state
  const [showEditDesign, setShowEditDesign] = useState(false);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState<string>('Smileys');
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [resizeCounter, setResizeCounter] = useState(0);
  
  // AI Chat state
  const [aiPrompt, setAiPrompt] = useState('');
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  
  // Regeneration state
  const [regeneratedImageUrl, setRegeneratedImageUrl] = useState<string | null>(null);
  const [activeImageS3Key, setActiveImageS3Key] = useState<string | null>(null);
  const [editDesignBaseImageUrl, setEditDesignBaseImageUrl] = useState<string | null>(null); // Base image URL for Edit Design mode
  const [regenerations, setRegenerations] = useState<Array<{
    id: number;
    prompt: string;
    regeneratedImageUrl: string | null;
    regeneratedImageS3Key: string | null;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdAt: string;
  }>>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [pollingRegenId, setPollingRegenId] = useState<number | null>(null);
  
  // Refs for overlay interactions
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
  
  // Touch event handler refs
  const stableTouchMoveRef = useRef<((e: TouchEvent) => void) | null>(null);
  const stableTouchEndRef = useRef<(() => void) | null>(null);
  
  // Refs for interaction handlers (must be before early return)
  const handleInteractionMoveRef = useRef<(clientX: number, clientY: number) => void>(() => {});
  const stableMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  const stableMouseUpRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (content) {
      setEditedCaptions(content.platformTexts || {});
      setNotes('');
      setShowEditDesign(false);
      setTextOverlays([]);
      setSelectedOverlayId(null);
      setChatMessages([]);
      // Reset regeneration state
      setRegenerations([]);
      setRegeneratedImageUrl(null);
      setActiveImageS3Key(null);
      setEditDesignBaseImageUrl(null);
      setIsRegenerating(false);
      setPollingRegenId(null);
    }
  }, [content]);
  
  // Fetch regeneration history and existing overlays when Edit Design mode opens
  useEffect(() => {
    const fetchEditDesignData = async () => {
      if (!showEditDesign || !content || !selectedAccountId) return;
      
      // Fetch existing image edits (overlays)
      try {
        const editResponse = await fetch(
          `/api/admin/dvyb-automated-content/${selectedAccountId}/content/${content.generatedContentId}/${content.postIndex}`
        );
        const editResult = await editResponse.json();
        
        if (editResult.success && editResult.data) {
          // Load saved overlays as editable elements
          if (editResult.data.overlays && editResult.data.overlays.length > 0) {
            setTextOverlays(editResult.data.overlays);
            alert(`Previous edits loaded: ${editResult.data.overlays.length} text overlay(s) restored. You can modify or remove them.`);
          }
          
          // Use the originalImageUrl from dvyb_image_edits as the canvas
          // This is the ACTUAL original image (before any overlay processing)
          // If there's a regeneratedImageUrl in the edit, that was the base used for overlays
          if (editResult.data.regeneratedImageUrl) {
            // A regenerated image was used as base - show that
            setEditDesignBaseImageUrl(editResult.data.regeneratedImageUrl);
          } else if (editResult.data.originalImageUrl) {
            // Original image was used as base
            setEditDesignBaseImageUrl(editResult.data.originalImageUrl);
          } else {
            // Fallback to content.mediaUrl
            setEditDesignBaseImageUrl(null);
          }
          
          // Reset active selection - user starts with the saved base image
          setActiveImageS3Key(null);
          setRegeneratedImageUrl(null);
        }
      } catch (error) {
        console.error('Failed to fetch existing image edits:', error);
      }
      
      // Fetch regeneration history
      try {
        const response = await fetch(
          `/api/admin/dvyb-automated-content/${selectedAccountId}/regenerations/${content.generatedContentId}/${content.postIndex}`
        );
        const result = await response.json();
        
        if (result.success && result.data) {
          setRegenerations(result.data);
        }
      } catch (error) {
        console.error('Failed to fetch regenerations:', error);
      }
    };

    fetchEditDesignData();
  }, [showEditDesign, content, selectedAccountId]);

  // Poll for regeneration status when one is in progress
  useEffect(() => {
    if (!pollingRegenId || !selectedAccountId) return;
    
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/admin/dvyb-automated-content/${selectedAccountId}/regeneration-status/${pollingRegenId}`
        );
        const result = await response.json();
        
        if (result.success && result.data) {
          const { status, regeneratedImageUrl: imgUrl, regeneratedImageS3Key } = result.data;
          
          if (status === 'completed' && imgUrl) {
            // Update the regeneration in the list
            setRegenerations(prev => prev.map(r => 
              r.id === pollingRegenId 
                ? { ...r, status: 'completed', regeneratedImageUrl: imgUrl, regeneratedImageS3Key }
                : r
            ));
            
            // Set as active image
            setRegeneratedImageUrl(imgUrl);
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
              content: `❌ Sorry, the regeneration failed: ${result.data.errorMessage || 'Unknown error'}`
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
  }, [pollingRegenId, selectedAccountId]);

  // Reset overlays when Edit Design mode closes
  useEffect(() => {
    if (!showEditDesign) {
      setTextOverlays([]);
      setSelectedOverlayId(null);
      draggingIdRef.current = null;
      setImageLoaded(false);
      setResizeCounter(0);
    }
  }, [showEditDesign]);
  
  // Track image size changes
  useEffect(() => {
    if (!showEditDesign || !imageRef.current) return;

    const triggerRerender = () => setResizeCounter(c => c + 1);
    const resizeObserver = new ResizeObserver(triggerRerender);
    resizeObserver.observe(imageRef.current);
    window.addEventListener('resize', triggerRerender);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', triggerRerender);
    };
  }, [showEditDesign, imageLoaded]);

  if (!open || !content) return null;

  const platforms = ['twitter', 'instagram', 'linkedin'] as const;
  const isVideo = content.contentType === 'video';
  
  // Get selected overlay
  const selectedOverlay = textOverlays.find(o => o.id === selectedOverlayId);
  
  // Check if Save Design should be enabled
  const hasOverlays = textOverlays.length > 0;
  const hasRegeneratedImage = regeneratedImageUrl !== null;
  const canSaveDesign = hasOverlays || hasRegeneratedImage;
  
  // Get current image width for font scaling
  const getCurrentImageWidth = () => {
    if (imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      return rect.width > 0 ? rect.width : REFERENCE_WIDTH;
    }
    return REFERENCE_WIDTH;
  };

  // Add new text overlay
  const addTextOverlay = () => {
    const newOverlay: TextOverlay = {
      id: `overlay-${Date.now()}`,
      text: 'Your Text Here',
      x: 50,
      y: 50,
      width: 30,
      height: 10,
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

  // Add emoji/sticker as overlay
  const addEmojiOverlay = (emoji: string, isSticker: boolean = false) => {
    const newOverlay: TextOverlay = {
      id: `overlay-${Date.now()}`,
      text: emoji,
      x: 50,
      y: 50,
      width: isSticker ? 15 : 10,
      height: isSticker ? 15 : 10,
      rotation: 0,
      fontSize: isSticker ? 48 : 36,
      fontFamily: 'Inter',
      color: '#FFFFFF',
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

  // Get container rect for position calculations
  const getContainerRect = (eventTarget?: EventTarget | null): DOMRect | null => {
    if (eventTarget instanceof Element) {
      const wrapper = eventTarget.closest('.relative.inline-block');
      if (wrapper) {
        const img = wrapper.querySelector('img');
        if (img) {
          const rect = img.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return rect;
        }
      }
    }
    if (imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return rect;
    }
    if (imageWrapperRef.current) {
      const rect = imageWrapperRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return rect;
    }
    return null;
  };

  // Handle interaction move (drag, resize, rotate)
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
      const offset = dragOffsetRef.current;
      let newX = cursorXPercent - offset.x;
      let newY = cursorYPercent - offset.y;

      if (isNaN(newX) || !isFinite(newX)) newX = 50;
      if (isNaN(newY) || !isFinite(newY)) newY = 50;

      const overlay = textOverlays.find(o => o.id === currentId);
      if (overlay) {
        const halfWidth = overlay.width / 2;
        const halfHeight = overlay.height / 2;
        const clampedX = Math.max(halfWidth, Math.min(100 - halfWidth, newX));
        const clampedY = Math.max(halfHeight, Math.min(100 - halfHeight, newY));
        setTextOverlays(overlays => 
          overlays.map(o => o.id === currentId ? { ...o, x: clampedX, y: clampedY } : o)
        );
      }
    } else if (interactionModeRef.current === 'resize') {
      const handle = resizeHandleRef.current;
      if (!handle) return;

      const deltaX = cursorXPercent - initialMouse.x;
      const deltaY = cursorYPercent - initialMouse.y;

      let newWidth = initial.width;
      let newHeight = initial.height;
      let newX = initial.x;
      let newY = initial.y;

      if (handle.includes('e')) newWidth = Math.max(10, initial.width + deltaX);
      if (handle.includes('w')) {
        newWidth = Math.max(10, initial.width - deltaX);
        newX = initial.x + deltaX / 2;
      }
      if (handle.includes('s')) newHeight = Math.max(5, initial.height + deltaY);
      if (handle.includes('n')) {
        newHeight = Math.max(5, initial.height - deltaY);
        newY = initial.y + deltaY / 2;
      }

      // Constrain to bounds
      const halfWidth = newWidth / 2;
      const halfHeight = newHeight / 2;
      if (newX - halfWidth < 0) {
        if (handle.includes('w')) { newWidth = initial.x * 2; newX = newWidth / 2; }
        else newX = halfWidth;
      }
      if (newX + halfWidth > 100) {
        if (handle.includes('e')) { newWidth = (100 - initial.x) * 2; newX = 100 - newWidth / 2; }
        else newX = 100 - halfWidth;
      }
      if (newY - halfHeight < 0) {
        if (handle.includes('n')) { newHeight = initial.y * 2; newY = newHeight / 2; }
        else newY = halfHeight;
      }
      if (newY + halfHeight > 100) {
        if (handle.includes('s')) { newHeight = (100 - initial.y) * 2; newY = 100 - newHeight / 2; }
        else newY = 100 - halfHeight;
      }

      setTextOverlays(overlays => 
        overlays.map(o => o.id === currentId ? { 
          ...o, width: Math.max(10, newWidth), height: Math.max(5, newHeight), x: newX, y: newY,
        } : o)
      );
    } else if (interactionModeRef.current === 'rotate') {
      const centerX = initial.x;
      const centerY = initial.y;
      const angle = Math.atan2(cursorYPercent - centerY, cursorXPercent - centerX) * (180 / Math.PI);
      const initialAngle = Math.atan2(initialMouse.y - centerY, initialMouse.x - centerX) * (180 / Math.PI);
      let newRotation = initial.rotation + (angle - initialAngle);
      while (newRotation > 180) newRotation -= 360;
      while (newRotation < -180) newRotation += 360;
      setTextOverlays(overlays => 
        overlays.map(o => o.id === currentId ? { ...o, rotation: newRotation } : o)
      );
    }
  };

  // Update the interaction move ref
  handleInteractionMoveRef.current = handleInteractionMove;

  const endInteraction = () => {
    draggingIdRef.current = null;
    interactionModeRef.current = 'none';
    resizeHandleRef.current = null;
    initialOverlayStateRef.current = null;
    initialMousePosRef.current = null;
  };

  // Update the stable mouse handlers
  stableMouseMoveRef.current = (e: MouseEvent) => {
    handleInteractionMoveRef.current(e.clientX, e.clientY);
  };

  stableMouseUpRef.current = () => {
    endInteraction();
    document.removeEventListener('mousemove', stableMouseMoveRef.current);
    document.removeEventListener('mouseup', stableMouseUpRef.current);
  };

  // Start interaction (drag, resize, or rotate)
  const startInteraction = (
    e: React.MouseEvent | React.TouchEvent, 
    overlayId: string, 
    mode: InteractionMode,
    resizeHandle?: ResizeHandle
  ) => {
    e.stopPropagation();
    if (!('touches' in e)) e.preventDefault();
    
    const overlay = textOverlays.find(o => o.id === overlayId);
    const rect = getContainerRect(e.currentTarget);
    
    if (!overlay || !rect || rect.width === 0 || rect.height === 0) return;

    containerRectRef.current = rect;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const cursorXPercent = ((clientX - rect.left) / rect.width) * 100;
    const cursorYPercent = ((clientY - rect.top) / rect.height) * 100;

    initialOverlayStateRef.current = {
      x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height, rotation: overlay.rotation,
    };
    initialMousePosRef.current = { x: cursorXPercent, y: cursorYPercent };

    if (mode === 'drag') {
      dragOffsetRef.current = { x: cursorXPercent - overlay.x, y: cursorYPercent - overlay.y };
    }

    draggingIdRef.current = overlayId;
    interactionModeRef.current = mode;
    resizeHandleRef.current = resizeHandle || null;
    setSelectedOverlayId(overlayId);

    if ('touches' in e) {
      const touchMoveHandler = (touchEvent: TouchEvent) => {
        if (touchEvent.touches[0]) {
          touchEvent.preventDefault();
          handleInteractionMoveRef.current(touchEvent.touches[0].clientX, touchEvent.touches[0].clientY);
        }
      };
      
      const touchEndHandler = () => {
        endInteraction();
        if (stableTouchMoveRef.current) document.removeEventListener('touchmove', stableTouchMoveRef.current);
        if (stableTouchEndRef.current) document.removeEventListener('touchend', stableTouchEndRef.current);
        stableTouchMoveRef.current = null;
        stableTouchEndRef.current = null;
      };
      
      stableTouchMoveRef.current = touchMoveHandler;
      stableTouchEndRef.current = touchEndHandler;
      
      document.addEventListener('touchmove', touchMoveHandler, { passive: false });
      document.addEventListener('touchend', touchEndHandler);
    } else {
      document.addEventListener('mousemove', stableMouseMoveRef.current);
      document.addEventListener('mouseup', stableMouseUpRef.current);
    }
  };

  const handleSaveCaptions = async () => {
    setIsSavingCaption(true);
    await onSaveCaptions(content, editedCaptions);
    setIsSavingCaption(false);
    setShowCaptionEdit(false);
  };

  const handleSaveDesignClick = async () => {
    if (!canSaveDesign && !regeneratedImageUrl) return;
    setIsSavingDesign(true);
    await onSaveDesign(content, textOverlays, activeImageS3Key);
    setIsSavingDesign(false);
    setShowEditDesign(false);
  };

  // Handle Edit Design toggle - fetch existing overlays and original image
  const handleEditDesignToggle = async (value: boolean) => {
    setShowEditDesign(value);
    
    if (value && content && selectedAccountId) {
      // Set initial base image to absolute original from dvyb_generated_content
      const absoluteOriginal = content.originalMediaUrl || content.mediaUrl;
      setEditDesignBaseImageUrl(absoluteOriginal);
      
      // Entering Edit Design mode - fetch existing image edits
      try {
        const response = await fetch(
          `/api/admin/dvyb-automated-content/${selectedAccountId}/image-edit/${content.generatedContentId}/${content.postIndex}`
        );
        const result = await response.json();
        
        if (result.success && result.data) {
          // Load saved overlays as editable elements
          if (result.data.overlays && result.data.overlays.length > 0) {
            setTextOverlays(result.data.overlays);
          } else {
            setTextOverlays([]);
          }
          
          // Use the originalImageUrl from dvyb_image_edits as the canvas base
          // This is the image that was used for the last edit (before overlay processing)
          if (result.data.regeneratedImageUrl) {
            // A regenerated image was used as base for the last edit
            setEditDesignBaseImageUrl(result.data.regeneratedImageUrl);
          } else if (result.data.originalImageUrl) {
            // Original image was used as base
            setEditDesignBaseImageUrl(result.data.originalImageUrl);
          }
          // If no images in result, keep absoluteOriginal that was already set
          
          // Reset active selection - user starts with the saved base image
          setActiveImageS3Key(null);
          setRegeneratedImageUrl(null);
        } else {
          // No existing edits - keep absoluteOriginal as base, no overlays
          setTextOverlays([]);
        }
      } catch (error) {
        console.error('Failed to fetch existing image edits:', error);
        // Keep absoluteOriginal that was already set
        setTextOverlays([]);
      }
      
      // Fetch regeneration history
      try {
        const response = await fetch(
          `/api/admin/dvyb-automated-content/${selectedAccountId}/regenerations/${content.generatedContentId}/${content.postIndex}`
        );
        const result = await response.json();
        
        if (result.success && result.data) {
          setRegenerations(result.data.map((r: any) => ({
            id: r.id,
            prompt: r.prompt,
            regeneratedImageUrl: r.regeneratedImageUrl,
            regeneratedImageS3Key: r.regeneratedS3Key,
            status: 'completed',
            createdAt: r.createdAt,
          })));
        }
      } catch (error) {
        console.error('Failed to fetch regeneration history:', error);
      }
    } else if (!value) {
      // Exiting Edit Design mode - reset states
      setEditDesignBaseImageUrl(null);
      setTextOverlays([]);
      setSelectedOverlayId(null);
      setActiveImageS3Key(null);
      setRegeneratedImageUrl(null);
      setChatMessages([]);
      setRegenerations([]);
    }
  };

  const handleSendPrompt = async () => {
    if (!aiPrompt.trim() || !content || !selectedAccountId) return;
    
    const prompt = aiPrompt.trim();
    setAiPrompt("");
    
    // Add user message
    setChatMessages(prev => [...prev, { role: 'user', content: prompt }]);
    
    // Helper to extract S3 key from a URL (presigned or regular)
    const extractS3Key = (url: string): string => {
      if (!url) return '';
      // Remove query params first
      const baseUrl = url.split('?')[0];
      // Extract key from S3 URL patterns
      if (baseUrl.includes('.amazonaws.com/')) {
        return decodeURIComponent(baseUrl.split('.amazonaws.com/')[1] || '');
      } else if (baseUrl.includes('.cloudfront.net/')) {
        return decodeURIComponent(baseUrl.split('.cloudfront.net/')[1] || '');
      }
      // If it doesn't look like a URL, it might already be an S3 key
      if (!baseUrl.startsWith('http')) {
        return baseUrl;
      }
      return '';
    };
    
    // Get the source image S3 key - prefer activeImageS3Key if set (from regeneration)
    let sourceImageS3Key = '';
    if (activeImageS3Key) {
      sourceImageS3Key = extractS3Key(activeImageS3Key);
    } else if (content.originalMediaUrl) {
      sourceImageS3Key = extractS3Key(content.originalMediaUrl);
    } else if (content.mediaUrl) {
      sourceImageS3Key = extractS3Key(content.mediaUrl);
    }
    
    if (!sourceImageS3Key) {
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "Sorry, I couldn't find the source image to edit. Please try again."
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
      // Call admin API endpoint for regeneration
      const response = await fetch(
        `/api/admin/dvyb-automated-content/${selectedAccountId}/image-regenerate/${content.generatedContentId}/${content.postIndex}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            sourceImageS3Key,
          }),
        }
      );
      
      const result = await response.json();
      
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
    }
  };

  // Render text overlay toolbar
  const renderOverlayToolbar = () => (
    <div className="bg-white border-b border-gray-200 p-3 flex flex-wrap items-center gap-3 rounded-t-lg">
      {/* Add Text Button */}
      <Button size="sm" variant="outline" onClick={addTextOverlay} className="gap-1 text-xs text-gray-700">
        <Plus className="w-3 h-3" />
        <Type className="w-3 h-3" />
        <span>Add Text</span>
      </Button>

      {/* Emoji/Sticker Button */}
      <div className="relative">
        <Button
          size="sm"
          variant={showEmojiPicker ? "default" : "outline"}
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className={`gap-1 text-xs ${showEmojiPicker ? 'bg-purple-600 text-white' : 'text-gray-700'}`}
        >
          <Smile className="w-3 h-3" />
          <span>Emoji</span>
        </Button>

        {/* Emoji Picker Dropdown */}
        {showEmojiPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />
            <div className="absolute left-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 w-80">
              <div className="flex items-center justify-between p-2 border-b">
                <span className="text-sm font-medium text-gray-900">Emojis & Stickers</span>
                <Button size="sm" variant="ghost" onClick={() => setShowEmojiPicker(false)} className="w-6 h-6 p-0">
                  <X className="w-4 h-4 text-gray-600" />
                </Button>
              </div>
              {/* Stickers Section */}
              <div className="p-2 border-b">
                <div className="flex items-center gap-1 mb-2">
                  <Sticker className="w-4 h-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">Stickers</span>
                </div>
                <div className="grid grid-cols-10 gap-1">
                  {STICKERS.map((sticker, i) => (
                    <button key={i} onClick={() => addEmojiOverlay(sticker, true)} className="text-xl hover:bg-gray-100 rounded p-1 transition-colors">
                      {sticker}
                    </button>
                  ))}
                </div>
              </div>
              {/* Emoji Categories */}
              <div className="p-2">
                <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
                  {Object.keys(EMOJI_CATEGORIES).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setEmojiCategory(cat)}
                      className={`text-xs px-2 py-1 rounded whitespace-nowrap transition-colors ${
                        emojiCategory === cat ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-10 gap-1 max-h-[150px] overflow-y-auto">
                  {EMOJI_CATEGORIES[emojiCategory as keyof typeof EMOJI_CATEGORIES].map((emoji, i) => (
                    <button key={i} onClick={() => addEmojiOverlay(emoji, false)} className="text-xl hover:bg-gray-100 rounded p-1 transition-colors">
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Formatting options when overlay selected */}
      {selectedOverlay && (
        <>
          <div className="w-px h-6 bg-gray-200" />
          
          {/* Bold */}
          <Button
            size="sm"
            variant={selectedOverlay.isBold ? "default" : "outline"}
            onClick={() => updateOverlay(selectedOverlay.id, { isBold: !selectedOverlay.isBold })}
            className={`w-8 h-8 p-0 ${selectedOverlay.isBold ? 'bg-purple-600 text-white' : 'text-gray-700'}`}
          >
            <Bold className="w-4 h-4" />
          </Button>

          {/* Italic */}
          <Button
            size="sm"
            variant={selectedOverlay.isItalic ? "default" : "outline"}
            onClick={() => updateOverlay(selectedOverlay.id, { isItalic: !selectedOverlay.isItalic })}
            className={`w-8 h-8 p-0 ${selectedOverlay.isItalic ? 'bg-purple-600 text-white' : 'text-gray-700'}`}
          >
            <Italic className="w-4 h-4" />
          </Button>

          {/* Underline */}
          <Button
            size="sm"
            variant={selectedOverlay.isUnderline ? "default" : "outline"}
            onClick={() => updateOverlay(selectedOverlay.id, { isUnderline: !selectedOverlay.isUnderline })}
            className={`w-8 h-8 p-0 ${selectedOverlay.isUnderline ? 'bg-purple-600 text-white' : 'text-gray-700'}`}
          >
            <Underline className="w-4 h-4" />
          </Button>

          <div className="w-px h-6 bg-gray-200" />

          {/* Font Size */}
          <select
            value={selectedOverlay.fontSize}
            onChange={(e) => updateOverlay(selectedOverlay.id, { fontSize: parseInt(e.target.value) })}
            className="h-8 px-2 text-xs border border-gray-300 rounded-md bg-white text-gray-900"
          >
            {[12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72].map(size => (
              <option key={size} value={size}>{size}px</option>
            ))}
          </select>

          {/* Font Family */}
          <select
            value={selectedOverlay.fontFamily}
            onChange={(e) => updateOverlay(selectedOverlay.id, { fontFamily: e.target.value })}
            className="h-8 px-2 text-xs border border-gray-300 rounded-md bg-white max-w-[120px] text-gray-900"
          >
            {FONT_OPTIONS.map(font => (
              <option key={font.value} value={font.value}>{font.label}</option>
            ))}
          </select>

          <div className="w-px h-6 bg-gray-200" />

          {/* Color Picker */}
          <div className="flex items-center gap-1">
            {COLOR_PRESETS.map(color => (
              <button
                key={color}
                onClick={() => updateOverlay(selectedOverlay.id, { color })}
                className={`w-5 h-5 rounded border-2 transition-all ${
                  selectedOverlay.color === color ? 'border-purple-600 scale-110' : 'border-gray-300'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <input
              type="color"
              value={selectedOverlay.color}
              onChange={(e) => updateOverlay(selectedOverlay.id, { color: e.target.value })}
              className="w-6 h-6 cursor-pointer border rounded"
            />
          </div>
        </>
      )}
    </div>
  );

  // Render image with overlays
  const renderImageWithOverlays = () => {
    const currentWidth = getCurrentImageWidth();
    const scaleFactor = currentWidth / REFERENCE_WIDTH;
    
    return (
      <div className="flex flex-col w-full h-full">
        {renderOverlayToolbar()}
        
        <div className="relative flex-1 flex items-center justify-center bg-gray-100 rounded-b-lg overflow-hidden p-4">
          <div ref={imageWrapperRef} className="relative inline-block">
            <img 
              ref={imageRef}
              src={regeneratedImageUrl || editDesignBaseImageUrl || content.originalMediaUrl || content.mediaUrl} 
              alt={content.topic}
              className="max-w-full max-h-[calc(100vh-24rem)] object-contain select-none"
              draggable={false}
              onLoad={() => {
                setImageLoaded(true);
                setResizeCounter(c => c + 1);
              }}
              onClick={() => setSelectedOverlayId(null)}
            />
            
            {/* Text Overlays */}
            {textOverlays.map(overlay => {
              const isSelected = selectedOverlayId === overlay.id;
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
                      isSelected ? 'ring-2 ring-purple-600 ring-offset-1' : ''
                    }`}
                    style={{ backgroundColor: isSelected ? 'rgba(0,0,0,0.2)' : 'transparent' }}
                    onMouseDown={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.tagName !== 'INPUT' || document.activeElement !== target) {
                        startInteraction(e, overlay.id, 'drag');
                      }
                    }}
                    onTouchStart={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.tagName !== 'INPUT' || document.activeElement !== target) {
                        startInteraction(e, overlay.id, 'drag');
                      }
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedOverlayId(overlay.id);
                    }}
                  >
                    <input
                      type="text"
                      value={overlay.text}
                      onChange={(e) => updateOverlay(overlay.id, { text: e.target.value })}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.currentTarget.focus();
                        e.currentTarget.select();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => {
                        if (document.activeElement === e.currentTarget) e.stopPropagation();
                      }}
                      onTouchStart={(e) => {
                        if (document.activeElement === e.currentTarget) {
                          e.stopPropagation();
                          return;
                        }
                        const now = Date.now();
                        if (lastTapTargetRef.current === overlay.id && now - lastTapTimeRef.current < 300) {
                          e.stopPropagation();
                          e.currentTarget.focus();
                          e.currentTarget.select();
                          lastTapTimeRef.current = 0;
                          lastTapTargetRef.current = null;
                        } else {
                          lastTapTimeRef.current = now;
                          lastTapTargetRef.current = overlay.id;
                        }
                      }}
                      onFocus={() => setSelectedOverlayId(overlay.id)}
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

                  {/* Resize and control handles when selected */}
                  {isSelected && (
                    <>
                      {/* Corner handles */}
                      {(['nw', 'ne', 'se', 'sw'] as const).map(handle => (
                        <div
                          key={handle}
                          className={`absolute w-3 h-3 bg-purple-600 border-2 border-white rounded-sm ${
                            handle === 'nw' || handle === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
                          }`}
                          style={{
                            top: handle.includes('n') ? '-6px' : 'auto',
                            bottom: handle.includes('s') ? '-6px' : 'auto',
                            left: handle.includes('w') ? '-6px' : 'auto',
                            right: handle.includes('e') ? '-6px' : 'auto',
                          }}
                          onMouseDown={(e) => startInteraction(e, overlay.id, 'resize', handle)}
                          onTouchStart={(e) => startInteraction(e, overlay.id, 'resize', handle)}
                        />
                      ))}

                      {/* Edge handles */}
                      {(['n', 'e', 's', 'w'] as ResizeHandle[]).map(handle => (
                        <div
                          key={handle}
                          className={`absolute bg-purple-600 border border-white rounded-sm ${
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
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex flex-col items-center">
                        <div className="w-0.5 h-4 bg-purple-600" />
                        <div
                          className="w-5 h-5 bg-purple-600 rounded-full border-2 border-white cursor-grab flex items-center justify-center hover:scale-110 transition-transform"
                          onMouseDown={(e) => startInteraction(e, overlay.id, 'rotate')}
                          onTouchStart={(e) => startInteraction(e, overlay.id, 'rotate')}
                        >
                          <RotateCw className="w-3 h-3 text-white" />
                        </div>
                      </div>

                      {/* Delete button */}
                      <div
                        className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 rounded-full border-2 border-white cursor-pointer flex items-center justify-center hover:scale-110 transition-transform shadow-md"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteOverlay(overlay.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3 text-white" />
                      </div>

                      {/* Reset rotation button */}
                      {overlay.rotation !== 0 && (
                        <div
                          className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-purple-600 rounded-full border-2 border-white cursor-pointer flex items-center gap-1 hover:scale-105 transition-transform shadow-md text-[10px] text-white font-medium"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateOverlay(overlay.id, { rotation: 0 });
                          }}
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
          
          {/* Click to deselect */}
          {textOverlays.length > 0 && (
            <div className="absolute inset-0 -z-10" onClick={() => setSelectedOverlayId(null)} />
          )}
          
          {/* Helper text */}
          {textOverlays.length === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full text-sm text-gray-600">
              Click &quot;Add Text&quot; to add text overlays
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit Design Mode - 3-column layout
  if (showEditDesign) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-stretch z-50">
        <div className="w-full h-full flex">
          {/* Left Side - AI Chat */}
          <div className="w-72 bg-white border-r flex-shrink-0 flex flex-col">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  <span className="font-semibold text-gray-900">Ask Dvyb to Make Changes</span>
                </div>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">BETA</span>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 p-4 overflow-y-auto">
              {chatMessages.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">Try asking Dvyb to:</p>
                  <div className="space-y-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs h-auto py-2 text-gray-700 border-gray-200"
                      onClick={() => handleExamplePrompt("Add brand logo to this image")}
                    >
                      🏷️ Add Brand Logo
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs h-auto py-2 text-gray-700 border-gray-200"
                      onClick={() => handleExamplePrompt("Remove the brand logo from this image")}
                    >
                      ✂️ Remove Brand Logo
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs h-auto py-2 text-gray-700 border-gray-200"
                      onClick={() => handleExamplePrompt("Change the background to something more professional and modern")}
                    >
                      🎨 Change Background
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start text-xs h-auto py-2 text-gray-700 border-gray-200"
                      onClick={() => handleExamplePrompt("Replace the model/person with a different one while keeping the same pose and setting")}
                    >
                      👤 Replace with Different Model
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {chatMessages.map((message, index) => (
                    <div key={index} className={message.role === 'user' ? 'text-right' : 'text-left'}>
                      <div className={`inline-block p-3 rounded-lg text-sm ${
                        message.role === 'user' 
                          ? 'bg-purple-600 text-white' 
                          : 'bg-gray-100 text-gray-900'
                      }`}>
                        {message.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-gray-200 space-y-2">
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
                className="w-full text-sm min-h-[80px] resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
              />
              <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white" onClick={handleSendPrompt}>
                <Send className="w-4 h-4 mr-2" />
                Send
              </Button>
            </div>
          </div>

          {/* Center - Image Editor */}
          <div className="flex-1 bg-gray-50 overflow-hidden flex flex-col p-6">
            {renderImageWithOverlays()}
          </div>

          {/* Right Side - Controls */}
          <div className="w-80 bg-white border-l flex-shrink-0 flex flex-col h-full">
            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-2">Edit Design</h2>
                  <p className="text-sm text-gray-500">
                    Add text overlays or use AI to regenerate.
                  </p>
                </div>
                
                {/* Image Versions Gallery - Original + Regenerated - Vertical layout */}
                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Image Versions</h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Click an image to use it as your canvas
                  </p>
                  <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-1">
                    {/* Original Image - Always first - use originalMediaUrl (absolute original from dvyb_generated_content) */}
                    <div 
                      onClick={() => {
                        setRegeneratedImageUrl(null);
                        setActiveImageS3Key(null);
                        // Set base to the absolute original image from dvyb_generated_content
                        setEditDesignBaseImageUrl(content.originalMediaUrl || null);
                        // Keep existing overlays when switching to original
                      }}
                      className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                        !activeImageS3Key && !regeneratedImageUrl
                          ? 'border-purple-600 ring-2 ring-purple-300' 
                          : 'border-gray-200 hover:border-purple-400'
                      }`}
                    >
                      <div className="aspect-video w-full">
                        <img 
                          src={content.originalMediaUrl || content.mediaUrl} 
                          alt="Original"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                        <p className="text-xs text-white font-medium">📌 Original Image</p>
                      </div>
                      {!activeImageS3Key && !regeneratedImageUrl && (
                        <div className="absolute top-2 right-2 bg-purple-600 text-white rounded-full p-1">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    
                    {/* Processing placeholder - shown while regenerating */}
                    {isRegenerating && (
                      <div className="relative rounded-lg overflow-hidden border-2 border-dashed border-purple-400 bg-purple-50">
                        <div className="aspect-video w-full flex flex-col items-center justify-center gap-2">
                          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                          <p className="text-xs text-purple-700 font-medium">Generating...</p>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-purple-600/90 px-2 py-1">
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
                            ? 'border-purple-600 ring-2 ring-purple-300' 
                            : 'border-gray-200 hover:border-purple-400'
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
                          <div className="aspect-video w-full bg-gray-100 flex items-center justify-center">
                            {regen.status === 'processing' || regen.status === 'pending' ? (
                              <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                            ) : (
                              <span className="text-xs text-red-500">Failed</span>
                            )}
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                          <p className="text-xs text-white truncate">✨ {regen.prompt.slice(0, 25)}...</p>
                        </div>
                        {activeImageS3Key === regen.regeneratedImageS3Key && (
                          <div className="absolute top-2 right-2 bg-purple-600 text-white rounded-full p-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Processing status text - shown while regenerating */}
                {isRegenerating && (
                  <div className="bg-purple-50 rounded-lg p-3 flex items-center gap-3 border border-purple-200">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                    <div>
                      <p className="text-sm font-medium text-purple-900">Regenerating image...</p>
                      <p className="text-xs text-purple-600">This may take up to 30 seconds</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Fixed Save and Cancel buttons at bottom */}
            <div className="p-4 border-t border-gray-200 bg-white">
              <Button 
                className="w-full mb-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleSaveDesignClick}
                disabled={isSavingDesign || (!canSaveDesign && !regeneratedImageUrl)}
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
                className="w-full text-gray-700 border-gray-300"
                onClick={() => handleEditDesignToggle(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normal mode - review dialog
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Content Review</h2>
            <p className="text-sm text-gray-500">{content.topic}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              content.approvalStatus === 'pending' ? 'bg-amber-100 text-amber-800' :
              content.approvalStatus === 'approved' ? 'bg-green-100 text-green-800' :
              'bg-red-100 text-red-800'
            }`}>
              {content.approvalStatus.charAt(0).toUpperCase() + content.approvalStatus.slice(1)}
            </span>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <XCircle className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Media Preview */}
            <div className="space-y-4">
              <h3 className="font-medium text-gray-900 flex items-center gap-2">
                {isVideo ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                {isVideo ? 'Video' : 'Image'} Preview
              </h3>
              <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                {isVideo ? (
                  <video src={content.mediaUrl} controls className="w-full h-full object-contain" />
                ) : (
                  <Image src={content.mediaUrl} alt={content.topic} fill className="object-contain" unoptimized />
                )}
              </div>
              
              {/* Edit Design Button - only for images */}
              {!isVideo && (
                <Button
                  variant="outline"
                  className="w-full text-purple-600 border-purple-300 hover:bg-purple-50"
                  onClick={() => handleEditDesignToggle(true)}
                >
                  <span className="mr-2">🎨</span>
                  Edit Design
                </Button>
              )}
              
              <p className="text-xs text-gray-500">
                Created: {new Date(content.createdAt).toLocaleString()}
              </p>
            </div>

            {/* Captions & Actions */}
            <div className="space-y-4">
              {/* Platform Tabs */}
              <div className="flex gap-2">
                {platforms.map(platform => (
                  <button
                    key={platform}
                    onClick={() => setSelectedPlatform(platform)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedPlatform === platform
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {platform.charAt(0).toUpperCase() + platform.slice(1)}
                  </button>
                ))}
              </div>

              {/* Caption Display/Edit */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">Caption</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCaptionEdit(!showCaptionEdit)}
                    className="text-xs text-purple-600 border-purple-300 hover:bg-purple-50"
                  >
                    {showCaptionEdit ? 'Cancel' : 'Edit Caption'}
                  </Button>
                </div>
                
                {showCaptionEdit ? (
                  <div className="space-y-2">
                    <textarea
                      value={editedCaptions[selectedPlatform] || ''}
                      onChange={(e) => setEditedCaptions({
                        ...editedCaptions,
                        [selectedPlatform]: e.target.value
                      })}
                      className="w-full h-40 p-3 border border-gray-300 rounded-lg text-sm text-gray-900 resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder={`Enter ${selectedPlatform} caption...`}
                    />
                    <Button
                      onClick={handleSaveCaptions}
                      disabled={isSavingCaption}
                      className="bg-purple-600 hover:bg-purple-700 text-white"
                      size="sm"
                    >
                      {isSavingCaption ? 'Saving...' : 'Save Captions'}
                    </Button>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-lg min-h-[160px]">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                      {editedCaptions[selectedPlatform] || content.platformTexts[selectedPlatform] || 'No caption available'}
                    </p>
                  </div>
                )}
              </div>

              {/* Admin Notes */}
              {content.approvalStatus === 'pending' && (
                <div className="space-y-2">
                  <h3 className="font-medium text-gray-900">Admin Notes (Optional)</h3>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-20 p-3 border border-gray-300 rounded-lg text-sm text-gray-900 resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="Add notes about this approval/rejection..."
                  />
                </div>
              )}

              {/* Existing notes display */}
              {content.notes && (
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Previous Notes:</p>
                  <p className="text-sm text-gray-700">{content.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-200 flex items-center justify-between">
          <Button variant="outline" onClick={onClose} className="text-gray-700 border-gray-300">
            Close
          </Button>
          
          {content.approvalStatus === 'pending' && (
            <div className="flex gap-3">
              <Button
                onClick={() => onReject(content, notes)}
                disabled={isProcessing}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isProcessing ? 'Processing...' : 'Reject'}
              </Button>
              <Button
                onClick={() => onApprove(content, notes)}
                disabled={isProcessing}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {isProcessing ? 'Processing...' : 'Approve'}
              </Button>
            </div>
          )}
          
          {content.approvalStatus !== 'pending' && (
            <div className="text-sm text-gray-500">
              {content.approvalStatus === 'approved' ? (
                <span className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  Approved by {content.approvedById} on {content.approvedAt ? new Date(content.approvedAt).toLocaleString() : 'N/A'}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  Rejected by {content.approvedById} on {content.rejectedAt ? new Date(content.rejectedAt).toLocaleString() : 'N/A'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DvybAutomatedContentPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch accounts with auto content
  const fetchAccounts = async () => {
    try {
      setLoadingAccounts(true);
      const response = await fetch('/api/admin/dvyb-automated-content/accounts');
      const data = await response.json();
      if (data.success) {
        setAccounts(data.data);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoadingAccounts(false);
    }
  };

  // Fetch content for selected account
  const fetchContent = async (accountId: number) => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/admin/dvyb-automated-content/${accountId}?status=${statusFilter}`
      );
      const data = await response.json();
      if (data.success) {
        setContentItems(data.data);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching content:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (selectedAccountId) {
      fetchContent(selectedAccountId);
    }
  }, [selectedAccountId, statusFilter]);

  // Filter accounts based on search
  const filteredAccounts = accounts.filter(account =>
    account.accountName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.primaryEmail.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  const handleApprove = async (content: ContentItem, notes?: string) => {
    if (!content.approvalId) return;
    
    setIsProcessing(true);
    try {
      const response = await fetch(`/api/admin/dvyb-automated-content/${content.approvalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedById: 'admin', notes }),
      });
      const data = await response.json();
      if (data.success) {
        setShowDetailDialog(false);
        if (selectedAccountId) {
          fetchContent(selectedAccountId);
          fetchAccounts();
        }
      } else {
        alert(data.error || 'Failed to approve content');
      }
    } catch (error) {
      console.error('Error approving content:', error);
      alert('Failed to approve content');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (content: ContentItem, notes?: string) => {
    if (!content.approvalId) return;
    
    setIsProcessing(true);
    try {
      const response = await fetch(`/api/admin/dvyb-automated-content/${content.approvalId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedById: 'admin', notes }),
      });
      const data = await response.json();
      if (data.success) {
        setShowDetailDialog(false);
        if (selectedAccountId) {
          fetchContent(selectedAccountId);
          fetchAccounts();
        }
      } else {
        alert(data.error || 'Failed to reject content');
      }
    } catch (error) {
      console.error('Error rejecting content:', error);
      alert('Failed to reject content');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveCaptions = async (content: ContentItem, captions: Record<string, string>) => {
    if (!selectedAccountId) return;
    
    try {
      const response = await fetch(
        `/api/admin/dvyb-automated-content/${selectedAccountId}/captions/${content.generatedContentId}/${content.postIndex}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ captions }),
        }
      );
      const data = await response.json();
      if (data.success) {
        setContentItems(items =>
          items.map(item =>
            item.id === content.id ? { ...item, platformTexts: captions } : item
          )
        );
        alert('Captions saved successfully');
      } else {
        alert(data.error || 'Failed to save captions');
      }
    } catch (error) {
      console.error('Error saving captions:', error);
      alert('Failed to save captions');
    }
  };

  const handleSaveDesign = async (content: ContentItem, overlays: TextOverlay[], regeneratedImageS3Key?: string | null) => {
    if (!selectedAccountId) return;
    
    try {
      // Extract S3 key from media URL
      let originalImageS3Key = content.originalMediaUrl || '';
      if (!originalImageS3Key && content.mediaUrl) {
        const url = content.mediaUrl.split('?')[0];
        if (url.includes('.amazonaws.com/')) {
          originalImageS3Key = url.split('.amazonaws.com/')[1] || '';
        } else if (url.includes('.cloudfront.net/')) {
          originalImageS3Key = url.split('.cloudfront.net/')[1] || '';
        } else {
          originalImageS3Key = url;
        }
      }
      
      const response = await fetch(
        `/api/admin/dvyb-automated-content/${selectedAccountId}/image-edit/${content.generatedContentId}/${content.postIndex}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalImageUrl: originalImageS3Key,
            regeneratedImageUrl: regeneratedImageS3Key || null,
            overlays,
            referenceWidth: 450,
          }),
        }
      );
      const data = await response.json();
      if (data.success) {
        alert('Design saved! Processing in background. The image will update once processing completes.');
        // Close the dialog
        setShowDetailDialog(false);
        setSelectedContent(null);
        // Refresh content to show updated status
        if (selectedAccountId) {
          fetchContent(selectedAccountId);
        }
      } else {
        alert(data.error || 'Failed to save design');
      }
    } catch (error) {
      console.error('Error saving design:', error);
      alert('Failed to save design');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
                className="flex items-center gap-2 text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <h1 className="text-3xl font-bold text-gray-900">DVYB Automated Content</h1>
            </div>
          </div>

          {/* Account Selector */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Account
            </label>
            <div className="relative">
              <button
                onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-left flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
              >
                {selectedAccount ? (
                  <div>
                    <span className="font-medium text-gray-900">{selectedAccount.accountName}</span>
                    <span className="text-gray-500 ml-2">({selectedAccount.primaryEmail})</span>
                    {selectedAccount.pendingApprovals > 0 && (
                      <span className="ml-2 bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs">
                        {selectedAccount.pendingApprovals} pending
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-gray-500">
                    {loadingAccounts ? 'Loading accounts...' : 'Select an account to review content'}
                  </span>
                )}
                <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${showAccountDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showAccountDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-auto">
                  {/* Search */}
                  <div className="p-2 border-b border-gray-200 sticky top-0 bg-white">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search accounts..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-900"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>

                  {/* Account List */}
                  {filteredAccounts.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 text-sm">
                      {accounts.length === 0 ? 'No accounts with auto-generated content' : 'No matching accounts'}
                    </div>
                  ) : (
                    filteredAccounts.map(account => (
                      <button
                        key={account.id}
                        onClick={() => {
                          setSelectedAccountId(account.id);
                          setShowAccountDropdown(false);
                          setSearchTerm('');
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between ${
                          selectedAccountId === account.id ? 'bg-purple-50' : ''
                        }`}
                      >
                        <div>
                          <span className="font-medium text-gray-900">{account.accountName}</span>
                          <span className="text-gray-500 text-sm ml-2">{account.primaryEmail}</span>
                        </div>
                        {account.pendingApprovals > 0 && (
                          <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs">
                            {account.pendingApprovals} pending
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Stats Cards - Only show when account is selected */}
          {selectedAccountId && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-gray-400">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Content</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                  </div>
                  <Sparkles className="h-8 w-8 text-gray-400" />
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-amber-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Pending Review</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
                  </div>
                  <Clock className="h-8 w-8 text-amber-500" />
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Approved</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.approved}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-500" />
                </div>
              </div>
              <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Rejected</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.rejected}</p>
                  </div>
                  <XCircle className="h-8 w-8 text-red-500" />
                </div>
              </div>
            </div>
          )}

          {/* Filter Tabs */}
          {selectedAccountId && (
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-600 mr-4">Filter:</span>
                {(['pending', 'approved', 'rejected', 'all'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      statusFilter === status
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Content Grid */}
        {!selectedAccountId ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Sparkles className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Select an Account</h3>
            <p className="text-gray-500">Choose an account from the dropdown above to review its auto-generated content</p>
          </div>
        ) : loading ? (
          <div className="bg-white rounded-lg shadow flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
        ) : contentItems.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Sparkles className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Found</h3>
            <p className="text-gray-500">
              {statusFilter === 'all' 
                ? 'This account has no auto-generated content yet'
                : `No ${statusFilter} content for this account`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {contentItems.map(content => (
              <div
                key={content.id}
                onClick={() => {
                  setSelectedContent(content);
                  setShowDetailDialog(true);
                }}
                className="bg-white rounded-lg shadow overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
              >
                {/* Media Preview */}
                <div className="relative aspect-square bg-gray-100">
                  {content.contentType === 'video' ? (
                    <div className="relative w-full h-full">
                      <video src={content.mediaUrl} className="w-full h-full object-cover" muted />
                      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
                        <Play className="h-12 w-12 text-white" />
                      </div>
                    </div>
                  ) : (
                    <Image src={content.mediaUrl} alt={content.topic} fill className="object-cover" unoptimized />
                  )}
                  
                  {/* Content Type Badge */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      content.contentType === 'video' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                    }`}>
                      {content.contentType === 'video' ? (
                        <span className="flex items-center gap-1"><Video className="h-3 w-3" /> Video</span>
                      ) : (
                        <span className="flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Image</span>
                      )}
                    </span>
                    {/* Image Edit Status Badge */}
                    {content.imageEditStatus && (
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        content.imageEditStatus === 'completed' ? 'bg-cyan-100 text-cyan-800' :
                        content.imageEditStatus === 'pending' || content.imageEditStatus === 'processing' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {content.imageEditStatus === 'completed' ? '✨ Edited' :
                         content.imageEditStatus === 'pending' ? '⏳ Processing...' :
                         content.imageEditStatus === 'processing' ? '⏳ Processing...' :
                         '❌ Edit Failed'}
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div className="absolute top-2 right-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      content.approvalStatus === 'pending' ? 'bg-amber-100 text-amber-800' :
                      content.approvalStatus === 'approved' ? 'bg-green-100 text-green-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {content.approvalStatus === 'pending' && <Clock className="h-3 w-3 inline mr-1" />}
                      {content.approvalStatus === 'approved' && <CheckCircle className="h-3 w-3 inline mr-1" />}
                      {content.approvalStatus === 'rejected' && <XCircle className="h-3 w-3 inline mr-1" />}
                      {content.approvalStatus.charAt(0).toUpperCase() + content.approvalStatus.slice(1)}
                    </span>
                  </div>
                </div>

                {/* Card Footer */}
                <div className="p-3">
                  <p className="text-sm font-medium text-gray-900 truncate">{content.topic}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(content.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Eye className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-gray-500">Click to review</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content Detail Dialog */}
      <ContentDetailDialog
        content={selectedContent}
        open={showDetailDialog}
        onClose={() => {
          setShowDetailDialog(false);
          setSelectedContent(null);
        }}
        onApprove={handleApprove}
        onReject={handleReject}
        onSaveCaptions={handleSaveCaptions}
        onSaveDesign={handleSaveDesign}
        isProcessing={isProcessing}
        selectedAccountId={selectedAccountId}
      />
    </div>
  );
}
