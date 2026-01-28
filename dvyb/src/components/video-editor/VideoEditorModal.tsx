"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VideoEditorProvider, useVideoEditor } from "@/contexts/VideoEditorContext";
import { EditorLayout } from "./EditorLayout";
import { Loader2 } from "lucide-react";
import { LoadVideoContentPayload, Asset, type AspectRatio } from "@/types/video-editor";
import { videoEditsApi, assetsApi, uploadApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface VideoEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoData?: {
    generatedContentId: number;
    postIndex: number;
    videoUrl: string;
    duration: number;
    clips: {
      url: string;
      duration: number;
      startTime: number;
    }[];
    voiceover?: {
      url?: string;
      duration?: number;
    };
    backgroundMusic?: {
      url?: string;
      duration?: number;
    };
  };
  onSave?: () => void;
}

/** Extract S3 key from a presigned URL or S3 URL (so we can request a fresh presigned URL). */
function extractS3KeyFromUrl(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    if (url.includes("?") || (url.includes("s3") && url.includes("amazonaws.com"))) {
      const u = new URL(url);
      const key = decodeURIComponent(u.pathname.replace(/^\//, ""));
      return key || null;
    }
    if (url.startsWith("http")) return null;
    return url;
  } catch {
    return null;
  }
}

/** True only for presigned S3 URLs (user-owned assets). Admin assets use open bucket URLs and must not be refreshed. */
function isPresignedS3Url(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return url.startsWith("http") && url.includes("X-Amz-");
}

/** True if the presigned URL is expired (or will expire in the next 60s). X-Amz-Date is UTC. */
function isPresignedUrlExpired(url: string): boolean {
  if (!url || typeof url !== "string" || !url.includes("X-Amz-")) return false;
  try {
    const u = new URL(url);
    const dateStr = u.searchParams.get("X-Amz-Date"); // e.g. 20260128T112101Z
    const expiresStr = u.searchParams.get("X-Amz-Expires"); // e.g. 3600
    if (!dateStr || !expiresStr) return true; // treat as expired if missing
    const expiresSeconds = parseInt(expiresStr, 10);
    if (isNaN(expiresSeconds)) return true;
    // Parse YYYYMMDDTHHmmssZ as UTC (Z = UTC)
    const y = parseInt(dateStr.slice(0, 4), 10);
    const m = parseInt(dateStr.slice(4, 6), 10) - 1;
    const d = parseInt(dateStr.slice(6, 8), 10);
    const h = parseInt(dateStr.slice(9, 11), 10);
    const min = parseInt(dateStr.slice(11, 13), 10);
    const s = parseInt(dateStr.slice(13, 15), 10);
    const expiryMs = Date.UTC(y, m, d, h, min, s) + expiresSeconds * 1000;
    const bufferMs = 60 * 1000; // refresh 60s before expiry
    return Date.now() >= expiryMs - bufferMs;
  } catch {
    return true;
  }
}

/** Refresh presigned URLs using draft data (same clips we just applied) and update state + localStorage. */
async function refreshPresignedUrlsFromDraft(
  draftData: { tracks: any[]; originalVideoUrl?: string; generatedContentId?: number; postIndex?: number; projectName?: string; aspectRatio?: string; duration?: number },
  dispatch: (action: any) => void,
  generatedContentId: number | undefined,
  postIndex: number | undefined,
  videoUrl: string | undefined,
  projectName: string,
  aspectRatio: string,
  duration: number
) {
  const keysToFetch = new Set<string>();
  for (const track of draftData.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.src && isPresignedS3Url(clip.src)) {
        const k = extractS3KeyFromUrl(clip.src);
        if (k) keysToFetch.add(k);
      }
      if (clip.thumbnail && isPresignedS3Url(clip.thumbnail)) {
        const k = extractS3KeyFromUrl(clip.thumbnail);
        if (k) keysToFetch.add(k);
      }
    }
  }
  if (draftData.originalVideoUrl && isPresignedS3Url(draftData.originalVideoUrl)) {
    const k = extractS3KeyFromUrl(draftData.originalVideoUrl);
    if (k) keysToFetch.add(k);
  }
  if (keysToFetch.size === 0) return;

  const keyToFreshUrl = new Map<string, string>();
  for (const key of keysToFetch) {
    try {
      const res = await uploadApi.getPresignedUrlFromKey(key);
      if (res?.success && res.presigned_url) keyToFreshUrl.set(key, res.presigned_url);
    } catch {
      /* keep original on failure */
    }
  }
  if (keyToFreshUrl.size === 0) return;

  if (draftData.originalVideoUrl && isPresignedS3Url(draftData.originalVideoUrl)) {
    const k = extractS3KeyFromUrl(draftData.originalVideoUrl);
    if (k && keyToFreshUrl.has(k)) dispatch({ type: "SET_VIDEO_URL", payload: keyToFreshUrl.get(k)! });
  }
  for (const track of draftData.tracks || []) {
    for (const clip of track.clips || []) {
      const updates: { src?: string; thumbnail?: string } = {};
      if (clip.src && isPresignedS3Url(clip.src)) {
        const k = extractS3KeyFromUrl(clip.src);
        if (k && keyToFreshUrl.has(k)) updates.src = keyToFreshUrl.get(k);
      }
      if (clip.thumbnail && isPresignedS3Url(clip.thumbnail)) {
        const k = extractS3KeyFromUrl(clip.thumbnail);
        if (k && keyToFreshUrl.has(k)) updates.thumbnail = keyToFreshUrl.get(k);
      }
      if (Object.keys(updates).length > 0) {
        dispatch({ type: "UPDATE_CLIP", payload: { id: clip.id, ...updates } });
      }
    }
  }

  const cid = draftData.generatedContentId ?? generatedContentId;
  const pidx = draftData.postIndex ?? postIndex;
  if (keyToFreshUrl.size > 0 && cid != null && pidx != null) {
    const storageKey = `video-edit-draft-${cid}-${pidx}`;
    const videoKey = draftData.originalVideoUrl ? extractS3KeyFromUrl(draftData.originalVideoUrl) : null;
    const freshVideoUrl = (videoKey && keyToFreshUrl.has(videoKey)) ? keyToFreshUrl.get(videoKey)! : draftData.originalVideoUrl;
    const updatedTracks = (draftData.tracks || []).map((track: any) => ({
      ...track,
      clips: (track.clips || []).map((clip: any) => {
        let src = clip.src;
        let thumbnail = clip.thumbnail;
        if (clip.src && isPresignedS3Url(clip.src)) {
          const k = extractS3KeyFromUrl(clip.src);
          if (k && keyToFreshUrl.has(k)) src = keyToFreshUrl.get(k);
        }
        if (clip.thumbnail && isPresignedS3Url(clip.thumbnail)) {
          const k = extractS3KeyFromUrl(clip.thumbnail);
          if (k && keyToFreshUrl.has(k)) thumbnail = keyToFreshUrl.get(k);
        }
        return { ...clip, src: src ?? clip.src, thumbnail: thumbnail ?? clip.thumbnail };
      }),
    }));
    const persisted = {
      savedAt: new Date().toISOString(),
      generatedContentId: cid,
      postIndex: pidx,
      originalVideoUrl: freshVideoUrl ?? videoUrl,
      projectName: draftData.projectName ?? projectName,
      aspectRatio: draftData.aspectRatio ?? aspectRatio,
      duration: draftData.duration ?? duration,
      tracks: updatedTracks,
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(persisted));
    } catch (e) {
      console.warn("Failed to persist draft with refreshed URLs:", e);
    }
  }
}

// Helper function to get actual video duration from URL
async function getVideoDuration(videoUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      const duration = video.duration;
      video.src = ''; // Clean up
      resolve(duration);
    };
    
    video.onerror = () => {
      video.src = ''; // Clean up
      reject(new Error('Failed to load video metadata'));
    };
    
    // Set timeout for slow loading videos
    const timeout = setTimeout(() => {
      video.src = '';
      reject(new Error('Timeout loading video metadata'));
    }, 10000);
    
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      const duration = video.duration;
      video.src = '';
      resolve(duration);
    };
    
    video.src = videoUrl;
  });
}

function VideoEditorContent({ 
  onClose, 
  videoData,
  onSave,
}: { 
  onClose: () => void;
  videoData?: VideoEditorModalProps["videoData"];
  onSave?: () => void;
}) {
  const { dispatch, state } = useVideoEditor();
  // Start as true so draft loading waits for initial content load to complete
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const assetsLoadedRef = useRef(false);
  const contentLoadedRef = useRef(false);
  const videoDataIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  // Track if initial content has finished loading (for draft restoration)
  const initialLoadCompleteRef = useRef(false);
  // After restoring draft, refresh expired presigned S3 URLs for clips (overlay, music, etc.)
  const urlsRefreshedForDraftRef = useRef(false);

  // Handle case when no videoData is provided - stop loading
  useEffect(() => {
    if (!videoData) {
      setIsLoading(false);
    }
  }, [videoData]);

  // Load video content and assets when modal opens - only once per unique video.
  // Must await loadVideoContent first so clips/tracks are applied before SET_ASSETS;
  // otherwise a race can leave the preview/timeline without clip sources.
  useEffect(() => {
    if (!videoData) return;

    const videoId = `${videoData.generatedContentId}-${videoData.postIndex}`;
    if (videoDataIdRef.current === videoId && contentLoadedRef.current) return;

    videoDataIdRef.current = videoId;
    contentLoadedRef.current = true;

    (async () => {
      await loadVideoContent();
      if (!assetsLoadedRef.current) {
        assetsLoadedRef.current = true;
        await loadAssets();
      }
    })();
  }, [videoData?.generatedContentId, videoData?.postIndex]);

  // Load assets from backend (admin assets + user's own assets; presigned URLs for user assets)
  const loadAssets = useCallback(async () => {
    try {
      console.log('Loading assets from backend...');
      const response = await assetsApi.getAssets();
      if (response.success && response.assets && response.assets.length > 0) {
        console.log(`Found ${response.assets.length} assets`);
        dispatch({ type: "SET_ASSETS", payload: { assets: response.assets } });
      } else {
        dispatch({ type: "SET_ASSETS", payload: { assets: [] } });
      }
    } catch (error: any) {
      console.error('Failed to load assets:', error);
      dispatch({ type: "SET_ASSETS", payload: { assets: [] } });
    }
  }, [dispatch]);

  const loadVideoContent = async () => {
    if (!videoData) return;
    
    // Prevent duplicate API calls using ref (state updates are async)
    if (isLoadingRef.current) {
      console.log('Already loading, skipping duplicate call');
      return;
    }
    
    isLoadingRef.current = true;
    console.log('Loading video content for:', videoData.generatedContentId, videoData.postIndex);
    setIsLoading(true);
    try {
      // Load video metadata from backend
      const response = await videoEditsApi.loadVideoContent(
        videoData.generatedContentId,
        videoData.postIndex
      );
      
      if (response.success && response.videoData) {
        const vd = response.videoData;
        const hasZeroDuration = !vd.duration || vd.clips?.some((c: { duration?: number }) => !c?.duration);
        let duration = vd.duration || 0;
        let clips = vd.clips || [];

        if (hasZeroDuration && vd.videoUrl && clips.length > 0) {
          try {
            const actualDuration = await getVideoDuration(vd.videoUrl);
            console.log('Detected video duration (API response had 0):', actualDuration);
            duration = actualDuration;
            const perClip = clips.length === 1 ? actualDuration : actualDuration / clips.length;
            let runningStart = 0;
            clips = clips.map((clip: { url: string; duration: number; startTime: number }, i: number) => {
              const clipDuration = clip.duration && clip.duration > 0 ? clip.duration : perClip;
              const startTime = runningStart;
              runningStart += clipDuration;
              return { ...clip, duration: clipDuration, startTime };
            });
          } catch (err) {
            console.warn('Could not detect video duration for zero-duration clips:', err);
          }
        }

        const payload: LoadVideoContentPayload = {
          generatedContentId: vd.generatedContentId,
          postIndex: vd.postIndex,
          videoUrl: vd.videoUrl,
          duration,
          clips,
          voiceover: vd.voiceover,
          backgroundMusic: vd.backgroundMusic,
          aspectRatio: (vd.aspectRatio || '9:16') as AspectRatio,
        };
        dispatch({ type: "LOAD_VIDEO_CONTENT", payload });
      } else {
        // Fallback: Detect actual video duration from the video file
        let actualDuration = videoData.duration;
        try {
          actualDuration = await getVideoDuration(videoData.videoUrl);
          console.log('Detected video duration:', actualDuration);
        } catch (err) {
          console.warn('Could not detect video duration, using provided value:', err);
        }
        
        // Update clips to use actual duration if there's a single clip covering the full video
        const updatedClips = videoData.clips.map((clip, index) => {
          // If it's the only clip or covers the full video, use actual duration
          if (videoData.clips.length === 1 || 
              (clip.startTime === 0 && clip.duration >= videoData.duration - 0.5)) {
            return {
              ...clip,
              duration: actualDuration,
            };
          }
          return clip;
        });
        
        const payload: LoadVideoContentPayload = {
          generatedContentId: videoData.generatedContentId,
          postIndex: videoData.postIndex,
          videoUrl: videoData.videoUrl,
          duration: actualDuration,
          clips: updatedClips,
          voiceover: videoData.voiceover,
          backgroundMusic: videoData.backgroundMusic,
          aspectRatio: '9:16',
        };
        dispatch({ type: "LOAD_VIDEO_CONTENT", payload });
      }
    } catch (error: any) {
      console.error('Failed to load video content:', error);
      toast({
        title: "Error",
        description: "Failed to load video content. Using provided data.",
        variant: "destructive",
      });
      
      // Fallback: Still try to detect actual video duration
      let actualDuration = videoData.duration;
      try {
        actualDuration = await getVideoDuration(videoData.videoUrl);
      } catch (err) {
        console.warn('Could not detect video duration:', err);
      }
      
      const updatedClips = videoData.clips.map((clip) => {
        if (videoData.clips.length === 1 || 
            (clip.startTime === 0 && clip.duration >= videoData.duration - 0.5)) {
          return { ...clip, duration: actualDuration };
        }
        return clip;
      });
      
      const payload: LoadVideoContentPayload = {
        generatedContentId: videoData.generatedContentId,
        postIndex: videoData.postIndex,
        videoUrl: videoData.videoUrl,
        duration: actualDuration,
        clips: updatedClips,
        voiceover: videoData.voiceover,
        backgroundMusic: videoData.backgroundMusic,
        aspectRatio: '9:16',
      };
      dispatch({ type: "LOAD_VIDEO_CONTENT", payload });
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
      initialLoadCompleteRef.current = true;
    }
  };

  // Save to localStorage as draft (no backend call)
  const handleSave = () => {
    if (!videoData) return;
    
    setIsSaving(true);
    try {
      // Create localStorage key based on content ID and post index
      const storageKey = `video-edit-draft-${videoData.generatedContentId}-${videoData.postIndex}`;
      
      // Serialize editor state for localStorage - save ALL clip properties
      const draftData = {
        savedAt: new Date().toISOString(),
        generatedContentId: videoData.generatedContentId,
        postIndex: videoData.postIndex,
        originalVideoUrl: state.videoUrl || videoData.videoUrl,
        projectName: state.projectName,
        aspectRatio: state.aspectRatio,
        duration: state.duration,
        tracks: state.tracks.map(track => ({
          id: track.id,
          name: track.name,
          type: track.type,
          muted: track.muted,
          locked: track.locked,
          visible: track.visible,
          height: track.height,
          color: track.color,
          clips: track.clips.map(clip => ({
            // Core identification
            id: clip.id,
            trackId: clip.trackId,
            name: clip.name,
            type: clip.type,
            // Timing
            startTime: clip.startTime,
            duration: clip.duration,
            sourceStart: clip.sourceStart,
            sourceDuration: clip.sourceDuration,
            // Media source
            src: clip.src || '',
            thumbnail: clip.thumbnail,
            // Transform
            transform: clip.transform,
            // Audio properties
            volume: clip.volume,
            fadeIn: clip.fadeIn,
            fadeOut: clip.fadeOut,
            muted: clip.muted,
            volumeAutomation: clip.volumeAutomation || [],
            // Visual effects / Filters
            filters: clip.filters,
            filterPreset: clip.filterPreset,
            // Transitions
            transitionIn: clip.transitionIn,
            transitionOut: clip.transitionOut,
            transitionInDuration: clip.transitionInDuration,
            transitionOutDuration: clip.transitionOutDuration,
            // Text/Captions
            text: clip.text,
            // Overlay/Image specific
            blendMode: clip.blendMode,
            flipHorizontal: clip.flipHorizontal,
            flipVertical: clip.flipVertical,
            cornerRadius: clip.cornerRadius,
            borderWidth: clip.borderWidth,
            borderColor: clip.borderColor,
            shadowEnabled: clip.shadowEnabled,
            shadowColor: clip.shadowColor,
            shadowBlur: clip.shadowBlur,
            shadowOffsetX: clip.shadowOffsetX,
            shadowOffsetY: clip.shadowOffsetY,
            // Playback
            speed: clip.speed,
            // Keyframes for animation
            keyframes: clip.keyframes || [],
            // AI-related
            prompt: clip.prompt,
            aiGenerated: clip.aiGenerated,
            aiModified: clip.aiModified,
            // Music: trim to video clip end
            trimToClipEnd: clip.trimToClipEnd,
            trimToVideoClipId: clip.trimToVideoClipId,
          })),
        })),
      };
      
      console.log('Saving draft with tracks:', draftData.tracks.map(t => ({
        id: t.id,
        name: t.name,
        clipCount: t.clips.length,
        clips: t.clips.map(c => ({ id: c.id, name: c.name, type: c.type }))
      })));
      
      localStorage.setItem(storageKey, JSON.stringify(draftData));
      
      toast({
        title: "Draft Saved",
        description: "Your edits have been saved locally. Click Export when ready to process.",
      });
    } catch (error: any) {
      console.error('Failed to save draft:', error);
      toast({
        title: "Error",
        description: "Failed to save draft. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };
  
  // Load draft from localStorage after initial content is loaded
  const draftLoadedRef = useRef(false);
  
  useEffect(() => {
    // Only try to load draft once initial content is fully loaded and we haven't loaded draft yet
    // Check initialLoadCompleteRef to ensure LOAD_VIDEO_CONTENT has completed
    if (!videoData || isLoading || !initialLoadCompleteRef.current || draftLoadedRef.current) return;
    
    const storageKey = `video-edit-draft-${videoData.generatedContentId}-${videoData.postIndex}`;
    const savedDraft = localStorage.getItem(storageKey);
    
    if (savedDraft) {
      try {
        const draftData = JSON.parse(savedDraft);
        // Check if draft is recent (within 24 hours)
        const savedAt = new Date(draftData.savedAt);
        const hoursSinceSave = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceSave < 24 && draftData.tracks) {
          // Count total clips in the draft
          const totalDraftClips = draftData.tracks.reduce(
            (sum: number, track: any) => sum + (track.clips?.length || 0), 
            0
          );
          
          // Count total clips in current state (from LOAD_VIDEO_CONTENT)
          const totalCurrentClips = state.tracks.reduce(
            (sum, track) => sum + track.clips.length, 
            0
          );
          
          console.log('Draft check - Draft clips:', totalDraftClips, 'Current clips:', totalCurrentClips);
          console.log('Draft tracks:', draftData.tracks.map((t: any) => ({ 
            id: t.id, 
            name: t.name, 
            clipCount: t.clips?.length || 0,
            clips: t.clips?.map((c: any) => ({ name: c.name, type: c.type }))
          })));
          
          // Prefer fresh video/overlay URLs from API; merge draft for music, voiceover, captions, sfx.
          const currentVideoClipsWithSrc = state.tracks
            .filter((t) => t.type === "video" || t.type === "overlay")
            .reduce((sum, t) => sum + t.clips.filter((c) => (c.src || "").trim().length > 0).length, 0);

          if (totalDraftClips > 0 && currentVideoClipsWithSrc === 0) {
            draftLoadedRef.current = true;
            urlsRefreshedForDraftRef.current = true; // refresh runs inline below using draftData
            dispatch({
              type: "RESTORE_DRAFT",
              payload: {
                tracks: draftData.tracks,
                duration: draftData.duration,
                aspectRatio: draftData.aspectRatio,
                projectName: draftData.projectName,
              },
            });
            toast({
              title: "Draft Restored",
              description: `Your edits from ${savedAt.toLocaleString()} have been restored (${totalDraftClips} clips).`,
            });
            refreshPresignedUrlsFromDraft(draftData, dispatch, state.generatedContentId, state.postIndex, state.videoUrl, state.projectName, state.aspectRatio, state.duration);
          } else if (totalDraftClips > 0 && currentVideoClipsWithSrc > 0) {
            draftLoadedRef.current = true;
            urlsRefreshedForDraftRef.current = true;
            dispatch({
              type: "MERGE_DRAFT_TRACKS",
              payload: {
                draftTracks: draftData.tracks,
                duration: draftData.duration,
                projectName: draftData.projectName,
              },
            });
            toast({
              title: "Draft Restored",
              description: `Overlays, background music, voiceover, captions and sound effects from ${savedAt.toLocaleString()} have been restored.`,
            });
            refreshPresignedUrlsFromDraft(draftData, dispatch, state.generatedContentId, state.postIndex, state.videoUrl, state.projectName, state.aspectRatio, state.duration);
          } else {
            draftLoadedRef.current = true;
          }
        }
      } catch (e) {
        console.warn('Failed to parse draft:', e);
      }
    }
    // Only depend on stable values - run once after loading completes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoData?.generatedContentId, videoData?.postIndex, isLoading]);

  // After draft restore: refresh expired presigned S3 URLs and persist updated draft to localStorage
  useEffect(() => {
    if (!draftLoadedRef.current || urlsRefreshedForDraftRef.current || !state.tracks.length) return;

    let cancelled = false;
    urlsRefreshedForDraftRef.current = true;

    (async () => {
      // Collect S3 keys for all presigned URLs so preview always has valid URLs after draft restore.
      // Refresh all presigned URLs (not only expired) so overlays and music work regardless of timezone/expiry edge cases.
      const keysToFetch = new Set<string>();
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (clip.src && isPresignedS3Url(clip.src)) {
            const k = extractS3KeyFromUrl(clip.src);
            if (k) keysToFetch.add(k);
          }
          if (clip.thumbnail && isPresignedS3Url(clip.thumbnail)) {
            const k = extractS3KeyFromUrl(clip.thumbnail);
            if (k) keysToFetch.add(k);
          }
        }
      }
      if (state.videoUrl && isPresignedS3Url(state.videoUrl)) {
        const k = extractS3KeyFromUrl(state.videoUrl);
        if (k) keysToFetch.add(k);
      }

      const keyToFreshUrl = new Map<string, string>();
      for (const key of keysToFetch) {
        if (cancelled) return;
        try {
          const res = await uploadApi.getPresignedUrlFromKey(key);
          if (res?.success && res.presigned_url) keyToFreshUrl.set(key, res.presigned_url);
        } catch {
          // keep original URL on failure
        }
      }

      if (cancelled) return;

      // Update context state with fresh URLs
      if (state.videoUrl && isPresignedS3Url(state.videoUrl)) {
        const k = extractS3KeyFromUrl(state.videoUrl);
        if (k && keyToFreshUrl.has(k)) {
          dispatch({ type: "SET_VIDEO_URL", payload: keyToFreshUrl.get(k)! });
        }
      }
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          const updates: { src?: string; thumbnail?: string } = {};
          if (clip.src && isPresignedS3Url(clip.src)) {
            const k = extractS3KeyFromUrl(clip.src);
            if (k && keyToFreshUrl.has(k)) updates.src = keyToFreshUrl.get(k);
          }
          if (clip.thumbnail && isPresignedS3Url(clip.thumbnail)) {
            const k = extractS3KeyFromUrl(clip.thumbnail);
            if (k && keyToFreshUrl.has(k)) updates.thumbnail = keyToFreshUrl.get(k);
          }
          if (Object.keys(updates).length > 0) {
            dispatch({
              type: "UPDATE_CLIP",
              payload: { id: clip.id, ...updates },
            });
          }
        }
      }

      // Persist updated draft to localStorage so stored URLs stay valid
      if (keyToFreshUrl.size > 0 && state.generatedContentId != null && state.postIndex != null) {
        const storageKey = `video-edit-draft-${state.generatedContentId}-${state.postIndex}`;
        const videoKey = state.videoUrl ? extractS3KeyFromUrl(state.videoUrl) : null;
        const freshVideoUrl = (videoKey && keyToFreshUrl.has(videoKey)) ? keyToFreshUrl.get(videoKey)! : state.videoUrl;
        const updatedTracks = state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            let src = clip.src;
            let thumbnail = clip.thumbnail;
            if (clip.src && isPresignedS3Url(clip.src)) {
              const k = extractS3KeyFromUrl(clip.src);
              if (k && keyToFreshUrl.has(k)) src = keyToFreshUrl.get(k);
            }
            if (clip.thumbnail && isPresignedS3Url(clip.thumbnail)) {
              const k = extractS3KeyFromUrl(clip.thumbnail!);
              if (k && keyToFreshUrl.has(k)) thumbnail = keyToFreshUrl.get(k);
            }
            return { ...clip, src: src ?? clip.src, thumbnail: thumbnail ?? clip.thumbnail };
          }),
        }));
        const draftData = {
          savedAt: new Date().toISOString(),
          generatedContentId: state.generatedContentId,
          postIndex: state.postIndex,
          originalVideoUrl: freshVideoUrl ?? state.videoUrl,
          projectName: state.projectName,
          aspectRatio: state.aspectRatio,
          duration: state.duration,
          tracks: updatedTracks,
        };
        try {
          localStorage.setItem(storageKey, JSON.stringify(draftData));
        } catch (e) {
          console.warn("Failed to persist draft with refreshed URLs:", e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.tracks, state.videoUrl, state.generatedContentId, state.postIndex, state.projectName, state.aspectRatio, state.duration, dispatch]);

  // Clear draft and reload from fresh
  const handleClearDraft = () => {
    if (!videoData) return;
    
    const storageKey = `video-edit-draft-${videoData.generatedContentId}-${videoData.postIndex}`;
    localStorage.removeItem(storageKey);
    
    // Reset all refs so content can be reloaded
    draftLoadedRef.current = false;
    contentLoadedRef.current = false;
    initialLoadCompleteRef.current = false;
    isLoadingRef.current = false;
    
    toast({
      title: "Draft Cleared",
      description: "Reloading original video content...",
    });
    
    // Reload content from backend
    loadVideoContent();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading video content...</p>
        </div>
      </div>
    );
  }

  return (
    <EditorLayout onClose={onClose} onSave={handleSave} onClearDraft={handleClearDraft} refreshAssets={loadAssets} />
  );
}

export function VideoEditorModal({ 
  open, 
  onOpenChange, 
  videoData,
  onSave,
}: VideoEditorModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-[100vw] w-[100vw] h-[100vh] max-h-[100vh] p-0 gap-0 border-0 rounded-none !z-[200]"
        hideCloseButton
      >
        <VideoEditorProvider>
          <VideoEditorContent 
            onClose={() => onOpenChange(false)} 
            videoData={videoData}
            onSave={onSave}
          />
        </VideoEditorProvider>
      </DialogContent>
    </Dialog>
  );
}
