"use client";

import React, { createContext, useContext, useReducer, ReactNode, useCallback } from "react";
import {
  VideoEditorState,
  VideoEditorAction,
  Track,
  Clip,
  Asset,
  TextPreset,
  generateId,
  createTrack,
  createClip,
  generateWaveformData,
  FILTER_PRESETS,
  TRANSITION_PRESETS,
  defaultTextProperties,
  LoadVideoContentPayload,
} from "@/types/video-editor";

// Initial empty state for editor
const createInitialState = (): VideoEditorState => ({
  projectId: generateId(),
  projectName: "Video Edit",
  projectDescription: "",
  aspectRatio: "9:16",
  
  // DVYB-specific
  generatedContentId: undefined,
  postIndex: undefined,
  videoUrl: undefined,
  
  // Timeline
  tracks: [
    createTrack({ id: "track-video", name: "Video", type: "video" }),
    createTrack({ id: "track-overlay", name: "Overlays", type: "overlay" }),
    createTrack({ id: "track-captions", name: "Captions", type: "captions" }),
    createTrack({ id: "track-voiceover", name: "Voiceover", type: "voiceover" }),
    createTrack({ id: "track-music", name: "Music", type: "music" }),
    createTrack({ id: "track-sfx", name: "Sound Effects", type: "audio" }),
  ],
  currentTime: 0,
  duration: 30,
  zoom: 50,
  isPlaying: false,
  isMuted: false,
  masterVolume: 100,
  
  // Selection
  selectedClipId: null,
  selectedTrackId: null,
  selectedClipIds: [],
  
  // Clipboard
  clipboardClips: [],
  
  // Tools
  activeTool: "select",
  snapEnabled: true,
  
  // Assets (empty initially, will be populated from DVYB content)
  mediaAssets: [],
  audioAssets: [],
  textPresets: createDefaultTextPresets(),
  effects: [],
  transitions: TRANSITION_PRESETS,
  filterPresets: FILTER_PRESETS,
  
  // UI
  showExportModal: false,
  showShareModal: false,
  showUploadModal: false,
  showAIPromptModal: false,
  aiPromptTarget: null,
  
  // History
  history: [],
  historyIndex: -1,
});

// Calculate timeline duration based on clips
function calculateTimelineDuration(tracks: Track[]): number {
  let maxEndTime = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const endTime = clip.startTime + clip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
  }
  // Return exact duration (minimum 0.5 seconds)
  return Math.max(0.5, maxEndTime);
}

// Get earliest clip start time (for skip to start functionality)
function getEarliestClipStartTime(tracks: Track[]): number {
  let minStartTime = Infinity;
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.startTime < minStartTime) {
        minStartTime = clip.startTime;
      }
    }
  }
  return minStartTime === Infinity ? 0 : minStartTime;
}

// Default text presets
function createDefaultTextPresets(): TextPreset[] {
  return [
    { 
      id: "text-1", 
      name: "Bold Title", 
      preview: "TITLE", 
      category: "Titles",
      style: { ...defaultTextProperties, fontSize: 72, fontWeight: 800, animation: "zoom" } 
    },
    { 
      id: "text-2", 
      name: "Subtitle", 
      preview: "Subtitle", 
      category: "Titles",
      style: { ...defaultTextProperties, fontSize: 36, fontWeight: 500, animation: "fade-in" } 
    },
    { 
      id: "text-3", 
      name: "Lower Third", 
      preview: "Name Here", 
      category: "Lower Thirds",
      style: { ...defaultTextProperties, fontSize: 24, fontWeight: 600, backgroundColor: "rgba(0,0,0,0.7)", textAlign: "left", verticalAlign: "bottom", animation: "slide-up" } 
    },
    { 
      id: "text-4", 
      name: "Caption", 
      preview: "Caption text", 
      category: "Captions",
      style: { ...defaultTextProperties, fontSize: 20, fontWeight: 400, backgroundColor: "rgba(0,0,0,0.6)", verticalAlign: "bottom" } 
    },
    { 
      id: "text-5", 
      name: "Neon Glow", 
      preview: "NEON", 
      category: "Effects",
      style: { ...defaultTextProperties, fontSize: 64, fontWeight: 700, color: "#00ff88", animation: "glow", shadow: true } 
    },
    { 
      id: "text-6", 
      name: "Call to Action", 
      preview: "Click Here!", 
      category: "CTA",
      style: { ...defaultTextProperties, fontSize: 40, fontWeight: 700, color: "#000000", backgroundColor: "#00ff88", animation: "bounce" } 
    },
  ];
}

// Helper to find clip in tracks
function findClipInTracks(tracks: Track[], clipId: string): { track: Track; clip: Clip; clipIndex: number } | null {
  for (const track of tracks) {
    const clipIndex = track.clips.findIndex(c => c.id === clipId);
    if (clipIndex !== -1) {
      return { track, clip: track.clips[clipIndex], clipIndex };
    }
  }
  return null;
}

// Create tracks and clips from DVYB video content
function loadVideoContent(state: VideoEditorState, payload: LoadVideoContentPayload): VideoEditorState {
  const { generatedContentId, postIndex, videoUrl, duration, clips, voiceover, backgroundMusic, aspectRatio } = payload;
  
  // Create video track with clips
  const videoTrack = createTrack({ id: "track-video", name: "Video", type: "video" });
  
  // Add video clips
  clips.forEach((clipData, index) => {
    const clip = createClip({
      id: generateId(),
      trackId: videoTrack.id,
      name: `Clip ${index + 1}`,
      type: "video",
      startTime: clipData.startTime,
      duration: clipData.duration,
      src: clipData.url,
      thumbnail: clipData.url, // Will be replaced with actual thumbnail
      aiGenerated: true,
      prompt: clipData.prompt, // Include the prompt that generated this clip
    });
    videoTrack.clips.push(clip);
  });
  
  // Create voiceover track
  const voiceoverTrack = createTrack({ id: "track-voiceover", name: "Voiceover", type: "voiceover" });
  if (voiceover?.url && voiceover?.duration) {
    const voiceoverClip = createClip({
      id: generateId(),
      trackId: voiceoverTrack.id,
      name: "Voiceover",
      type: "voiceover",
      startTime: 0,
      duration: voiceover.duration,
      src: voiceover.url,
      aiGenerated: true,
      volume: 100,
      prompt: voiceover.prompt, // Include the prompt that generated this voiceover
    });
    voiceoverTrack.clips.push(voiceoverClip);
  }
  
  // Create music track
  const musicTrack = createTrack({ id: "track-music", name: "Background Music", type: "music" });
  if (backgroundMusic?.url && backgroundMusic?.duration) {
    const musicClip = createClip({
      id: generateId(),
      trackId: musicTrack.id,
      name: "Background Music",
      type: "music",
      startTime: 0,
      duration: backgroundMusic.duration,
      src: backgroundMusic.url,
      volume: 30, // Lower volume for background music
      fadeIn: 1,
      fadeOut: 2,
    });
    musicTrack.clips.push(musicClip);
  }
  
  // Create other empty tracks
  const overlayTrack = createTrack({ id: "track-overlay", name: "Overlays", type: "overlay" });
  const captionsTrack = createTrack({ id: "track-captions", name: "Captions", type: "captions" });
  const sfxTrack = createTrack({ id: "track-sfx", name: "Sound Effects", type: "audio" });
  
  const allTracks = [videoTrack, overlayTrack, captionsTrack, voiceoverTrack, musicTrack, sfxTrack];
  
  // Calculate actual duration from clips (in case payload duration is wrong)
  const calculatedDuration = calculateTimelineDuration(allTracks);
  const actualDuration = Math.max(calculatedDuration, duration || 0);
  
  return {
    ...state,
    generatedContentId,
    postIndex,
    videoUrl,
    duration: actualDuration,
    aspectRatio: aspectRatio || "9:16",
    tracks: allTracks,
    currentTime: 0,
    isPlaying: false,
    selectedClipId: null,
    selectedTrackId: null,
    selectedClipIds: [],
  };
}

// Reducer function
function videoEditorReducer(state: VideoEditorState, action: VideoEditorAction): VideoEditorState {
  switch (action.type) {
    case "SET_PROJECT_NAME":
      return { ...state, projectName: action.payload };

    case "SET_PROJECT_DESCRIPTION":
      return { ...state, projectDescription: action.payload };

    case "SET_ASPECT_RATIO":
      return { ...state, aspectRatio: action.payload };

    case "SET_CURRENT_TIME":
      return { ...state, currentTime: Math.max(0, Math.min(action.payload, state.duration)) };

    case "SKIP_TO_START": {
      // Go to the earliest clip start time (not necessarily 0 if clips were trimmed)
      const earliestStart = getEarliestClipStartTime(state.tracks);
      return { ...state, currentTime: earliestStart, isPlaying: false };
    }

    case "SKIP_TO_END": {
      // Go to the end of the timeline
      return { ...state, currentTime: state.duration, isPlaying: false };
    }

    case "SET_DURATION":
      return { ...state, duration: action.payload };

    case "SET_ZOOM":
      return { ...state, zoom: Math.max(10, Math.min(200, action.payload)) };

    case "SET_PLAYING": {
      // If starting to play and we're at or near the end, restart from beginning
      const isStartingPlay = action.payload && !state.isPlaying;
      // Use tolerance for floating point comparison (within 0.1 seconds of end)
      const isAtEnd = state.currentTime >= state.duration - 0.1;
      
      if (isStartingPlay && isAtEnd) {
        const earliestStart = getEarliestClipStartTime(state.tracks);
        return { ...state, isPlaying: true, currentTime: earliestStart };
      }
      return { ...state, isPlaying: action.payload };
    }

    case "TOGGLE_PLAY": {
      // If starting to play and we're at or near the end, restart from beginning
      const isStartingPlay = !state.isPlaying;
      // Use tolerance for floating point comparison (within 0.1 seconds of end)
      const isAtEnd = state.currentTime >= state.duration - 0.1;
      
      if (isStartingPlay && isAtEnd) {
        const earliestStart = getEarliestClipStartTime(state.tracks);
        return { ...state, isPlaying: true, currentTime: earliestStart };
      }
      return { ...state, isPlaying: !state.isPlaying };
    }

    case "SET_MUTED":
      return { ...state, isMuted: action.payload };

    case "SET_MASTER_VOLUME":
      return { ...state, masterVolume: Math.max(0, Math.min(100, action.payload)) };

    case "SELECT_CLIP":
      return { 
        ...state, 
        selectedClipId: action.payload,
        selectedClipIds: action.payload ? [action.payload] : [],
      };

    case "SELECT_TRACK":
      return { ...state, selectedTrackId: action.payload };

    case "SELECT_MULTIPLE_CLIPS":
      return { ...state, selectedClipIds: action.payload, selectedClipId: action.payload[0] || null };

    case "ADD_TO_SELECTION":
      if (state.selectedClipIds.includes(action.payload)) {
        return state;
      }
      return { 
        ...state, 
        selectedClipIds: [...state.selectedClipIds, action.payload],
        selectedClipId: action.payload,
      };

    case "SET_ACTIVE_TOOL":
      return { ...state, activeTool: action.payload };

    case "TOGGLE_SNAP":
      return { ...state, snapEnabled: !state.snapEnabled };

    case "ADD_TRACK":
      return { ...state, tracks: [...state.tracks, action.payload] };

    case "REMOVE_TRACK":
      return {
        ...state,
        tracks: state.tracks.filter((t) => t.id !== action.payload),
        selectedTrackId: state.selectedTrackId === action.payload ? null : state.selectedTrackId,
      };

    case "UPDATE_TRACK":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.id ? { ...t, ...action.payload } : t
        ),
      };

    case "REORDER_TRACKS": {
      const { fromIndex, toIndex } = action.payload;
      const newTracks = [...state.tracks];
      const [removed] = newTracks.splice(fromIndex, 1);
      newTracks.splice(toIndex, 0, removed);
      return { ...state, tracks: newTracks };
    }

    case "TOGGLE_TRACK_MUTE":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload ? { ...t, muted: !t.muted } : t
        ),
      };

    case "TOGGLE_TRACK_LOCK":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload ? { ...t, locked: !t.locked } : t
        ),
      };

    case "TOGGLE_TRACK_VISIBILITY":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload ? { ...t, visible: !t.visible } : t
        ),
      };

    case "ADD_CLIP": {
      const updatedTracksForAdd = state.tracks.map((t) =>
        t.id === action.payload.trackId
          ? { ...t, clips: [...t.clips, action.payload.clip].sort((a, b) => a.startTime - b.startTime) }
          : t
      );
      // Recalculate timeline duration after adding clip
      const newDurationAfterAdd = calculateTimelineDuration(updatedTracksForAdd);
      return {
        ...state,
        tracks: updatedTracksForAdd,
        duration: newDurationAfterAdd,
      };
    }

    case "REMOVE_CLIP": {
      const updatedTracksForRemove = state.tracks.map((t) =>
        t.id === action.payload.trackId
          ? { ...t, clips: t.clips.filter((c) => c.id !== action.payload.clipId) }
          : t
      );
      // Recalculate timeline duration after removing clip
      const newDurationAfterRemove = calculateTimelineDuration(updatedTracksForRemove);
      return {
        ...state,
        tracks: updatedTracksForRemove,
        duration: Math.max(newDurationAfterRemove, 0.5), // Keep minimum duration
        selectedClipId: state.selectedClipId === action.payload.clipId ? null : state.selectedClipId,
        selectedClipIds: state.selectedClipIds.filter(id => id !== action.payload.clipId),
      };
    }

    case "UPDATE_CLIP": {
      const newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === action.payload.id ? { ...c, ...action.payload } : c
        ),
      }));
      const newDuration =
        "duration" in action.payload
          ? calculateTimelineDuration(newTracks)
          : state.duration;
      return {
        ...state,
        tracks: newTracks,
        duration: newDuration,
      };
    }

    case "MOVE_CLIP": {
      const { clipId, newTrackId, newStartTime } = action.payload;
      let movedClip: Clip | null = null;

      const tracksAfterRemove = state.tracks.map((t) => {
        const clipIndex = t.clips.findIndex((c) => c.id === clipId);
        if (clipIndex !== -1) {
          movedClip = { ...t.clips[clipIndex], trackId: newTrackId, startTime: newStartTime };
          return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
        }
        return t;
      });

      if (!movedClip) return state;

      const tracksAfterAdd = tracksAfterRemove.map((t) =>
        t.id === newTrackId 
          ? { ...t, clips: [...t.clips, movedClip!].sort((a, b) => a.startTime - b.startTime) } 
          : t
      );

      // Recalculate timeline duration after moving clip
      const newDurationAfterMove = calculateTimelineDuration(tracksAfterAdd);
      return { ...state, tracks: tracksAfterAdd, duration: newDurationAfterMove };
    }

    case "SWAP_CLIPS": {
      const { clipIdA, clipIdB } = action.payload;
      if (clipIdA === clipIdB) return state;
      const foundA = findClipInTracks(state.tracks, clipIdA);
      const foundB = findClipInTracks(state.tracks, clipIdB);
      if (!foundA || !foundB || foundA.track.id !== foundB.track.id || foundA.track.locked) return state;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== foundA.track.id) return t;
        return {
          ...t,
          clips: t.clips
            .map((c) => {
              if (c.id === clipIdA) return { ...c, startTime: foundB.clip.startTime };
              if (c.id === clipIdB) return { ...c, startTime: foundA.clip.startTime };
              return c;
            })
            .sort((a, b) => a.startTime - b.startTime),
        };
      });
      return { ...state, tracks: newTracks };
    }

    case "RESIZE_CLIP": {
      const { clipId, newStartTime, newDuration } = action.payload;
      
      const newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          
          // Calculate how much the start was trimmed
          const oldStartTime = c.startTime;
          const actualNewStartTime = newStartTime !== undefined ? newStartTime : c.startTime;
          const startTrimAmount = actualNewStartTime - oldStartTime;
          
          // Update sourceStart when trimming from the start
          // sourceStart tracks where in the source video this clip starts
          const newSourceStart = (c.sourceStart || 0) + startTrimAmount;
          
          return { 
            ...c, 
            startTime: actualNewStartTime,
            duration: newDuration,
            sourceStart: Math.max(0, newSourceStart),
          };
        }),
      }));
      
      // Recalculate timeline duration based on actual content
      const newDurationCalc = calculateTimelineDuration(newTracks);
      
      return {
        ...state,
        tracks: newTracks,
        duration: newDurationCalc,
      };
    }

    case "SPLIT_CLIP": {
      const { clipId, splitTime } = action.payload;
      const found = findClipInTracks(state.tracks, clipId);
      if (!found) return state;
      
      const { clip } = found;
      const relativeTime = splitTime - clip.startTime;
      
      if (relativeTime <= 0 || relativeTime >= clip.duration) return state;
      
      const clip1: Clip = {
        ...clip,
        duration: relativeTime,
      };
      
      const clip2: Clip = {
        ...clip,
        id: generateId(),
        startTime: splitTime,
        duration: clip.duration - relativeTime,
        sourceStart: clip.sourceStart + relativeTime,
        transitionIn: "none",
        transitionInDuration: 0,
      };
      
      return {
        ...state,
        tracks: state.tracks.map((t) => {
          if (t.id !== found.track.id) return t;
          const newClips = t.clips.filter((c) => c.id !== clipId);
          return {
            ...t,
            clips: [...newClips, clip1, clip2].sort((a, b) => a.startTime - b.startTime),
          };
        }),
      };
    }

    case "DUPLICATE_CLIP": {
      const found = findClipInTracks(state.tracks, action.payload);
      if (!found) return state;
      
      const { track, clip } = found;
      const newClip: Clip = {
        ...clip,
        id: generateId(),
        startTime: clip.startTime + clip.duration + 0.1,
      };
      
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === track.id
            ? { ...t, clips: [...t.clips, newClip].sort((a, b) => a.startTime - b.startTime) }
            : t
        ),
      };
    }

    case "COPY_CLIPS": {
      const clipsToCopy: Clip[] = [];
      state.tracks.forEach((track) => {
        track.clips.forEach((clip) => {
          if (action.payload.includes(clip.id)) {
            clipsToCopy.push({ ...clip });
          }
        });
      });
      return { ...state, clipboardClips: clipsToCopy };
    }

    case "PASTE_CLIPS": {
      if (state.clipboardClips.length === 0) return state;
      
      const { trackId, startTime } = action.payload;
      const minStartTime = Math.min(...state.clipboardClips.map((c) => c.startTime));
      
      const pastedClips = state.clipboardClips.map((clip) => ({
        ...clip,
        id: generateId(),
        trackId,
        startTime: startTime + (clip.startTime - minStartTime),
      }));
      
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === trackId
            ? { ...t, clips: [...t.clips, ...pastedClips].sort((a, b) => a.startTime - b.startTime) }
            : t
        ),
      };
    }

    case "SET_CLIP_TRANSITION":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== action.payload.clipId) return c;
            if (action.payload.position === "in") {
              return { ...c, transitionIn: action.payload.transition, transitionInDuration: action.payload.duration };
            }
            return { ...c, transitionOut: action.payload.transition, transitionOutDuration: action.payload.duration };
          }),
        })),
      };

    case "SET_CLIP_SPEED": {
      const { clipId, speed } = action.payload;
      const clampedSpeed = Math.max(0.1, Math.min(4, speed));
      
      // Update clips with new speed and calculate new duration
      const updatedTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          
          // Use sourceDuration if available, otherwise current duration at speed 1
          const baseSourceDuration = c.sourceDuration || (c.duration * (c.speed || 1));
          // New timeline duration = source duration / speed
          const newDuration = baseSourceDuration / clampedSpeed;
          
          return {
            ...c,
            speed: clampedSpeed,
            duration: newDuration,
            sourceDuration: baseSourceDuration, // Store source duration for future speed changes
          };
        }),
      }));
      
      // Recalculate total timeline duration
      const newTimelineDuration = calculateTimelineDuration(updatedTracks);
      
      return {
        ...state,
        tracks: updatedTracks,
        duration: newTimelineDuration,
      };
    }

    case "SET_CLIP_FILTER_PRESET":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.payload.clipId ? { ...c, filterPreset: action.payload.preset } : c
          ),
        })),
      };

    case "ADD_VOLUME_POINT":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.payload.clipId
              ? { ...c, volumeAutomation: [...c.volumeAutomation, action.payload.point].sort((a, b) => a.time - b.time) }
              : c
          ),
        })),
      };

    case "UPDATE_VOLUME_POINT":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.payload.clipId
              ? {
                  ...c,
                  volumeAutomation: c.volumeAutomation.map((p) =>
                    p.id === action.payload.pointId ? { ...p, volume: action.payload.volume } : p
                  ),
                }
              : c
          ),
        })),
      };

    case "REMOVE_VOLUME_POINT":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.payload.clipId
              ? { ...c, volumeAutomation: c.volumeAutomation.filter((p) => p.id !== action.payload.pointId) }
              : c
          ),
        })),
      };

    case "ADD_KEYFRAME":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.payload.clipId
              ? { ...c, keyframes: [...c.keyframes, action.payload.keyframe].sort((a, b) => a.time - b.time) }
              : c
          ),
        })),
      };

    case "UPDATE_KEYFRAME":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.payload.clipId
              ? {
                  ...c,
                  keyframes: c.keyframes.map((k) =>
                    k.id === action.payload.keyframeId ? { ...k, value: action.payload.value } : k
                  ),
                }
              : c
          ),
        })),
      };

    case "REMOVE_KEYFRAME":
      return {
        ...state,
        tracks: state.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === action.payload.clipId
              ? { ...c, keyframes: c.keyframes.filter((k) => k.id !== action.payload.keyframeId) }
              : c
          ),
        })),
      };

    case "ADD_ASSET":
      // Check if asset already exists to prevent duplicates
      if (action.payload.type === "video" || action.payload.type === "image") {
        const existsInMedia = state.mediaAssets.some(a => a.id === action.payload.id);
        if (existsInMedia) return state;
        return { ...state, mediaAssets: [...state.mediaAssets, action.payload] };
      }
      const existsInAudio = state.audioAssets.some(a => a.id === action.payload.id);
      if (existsInAudio) return state;
      return { ...state, audioAssets: [...state.audioAssets, action.payload] };

    case "SET_ASSETS": {
      const media: Asset[] = [];
      const audio: Asset[] = [];
      for (const a of action.payload.assets) {
        const asset: Asset = {
          id: a.id,
          name: a.name,
          type: a.type as Asset["type"],
          thumbnail: a.thumbnail ?? a.src,
          src: a.src,
          duration: a.duration,
          tags: a.tags ?? [],
          category: a.category,
          aiGenerated: a.aiGenerated ?? false,
          isAdminAsset: a.isAdminAsset ?? true,
        };
        if (a.type === "video" || a.type === "image") media.push(asset);
        else audio.push(asset);
      }
      return { ...state, mediaAssets: media, audioAssets: audio };
    }

    case "REMOVE_ASSET":
      return {
        ...state,
        mediaAssets: state.mediaAssets.filter((a) => a.id !== action.payload),
        audioAssets: state.audioAssets.filter((a) => a.id !== action.payload),
      };

    case "UPDATE_ASSET":
      return {
        ...state,
        mediaAssets: state.mediaAssets.map((a) => (a.id === action.payload.id ? { ...a, ...action.payload } : a)),
        audioAssets: state.audioAssets.map((a) => (a.id === action.payload.id ? { ...a, ...action.payload } : a)),
      };

    case "SHOW_EXPORT_MODAL":
      return { ...state, showExportModal: action.payload };

    case "SHOW_SHARE_MODAL":
      return { ...state, showShareModal: action.payload };

    case "SHOW_UPLOAD_MODAL":
      return { ...state, showUploadModal: action.payload };

    case "SHOW_AI_PROMPT_MODAL":
      return { ...state, showAIPromptModal: action.payload !== null, aiPromptTarget: action.payload };

    case "LOAD_VIDEO_CONTENT":
      return loadVideoContent(state, action.payload);

    case "SET_VIDEO_URL":
      return { ...state, videoUrl: action.payload };

    case "RESTORE_DRAFT": {
      // Restore saved draft state (tracks, clips, overlays, project name, etc.)
      const { tracks, duration, aspectRatio, projectName } = action.payload;

      // Recreate clips with proper defaults while preserving all saved properties (including src)
      const restoredTracks = tracks.map((track: any) => ({
        ...track,
        clips: (track.clips || []).map((clip: any) =>
          createClip({
            ...clip,
            id: clip.id,
            trackId: clip.trackId || track.id,
            name: clip.name,
            type: clip.type,
            startTime: clip.startTime,
            duration: clip.duration,
          })
        ),
      }));

      return {
        ...state,
        tracks: restoredTracks,
        duration: duration,
        aspectRatio: aspectRatio as import('@/types/video-editor').AspectRatio,
        ...(projectName != null && projectName !== "" ? { projectName } : {}),
      };
    }

    case "MERGE_DRAFT_TRACKS": {
      // Merge draft overlay, music, voiceover, captions, sound-effects tracks into current state
      // so user-added assets and edits (effects, volume, trim, etc.) are restored while keeping
      // fresh video URLs from LOAD_VIDEO_CONTENT.
      // Also merge video track: restore startTime/duration/order from draft but keep src/thumbnail from API.
      const { draftTracks, duration: draftDuration, projectName } = action.payload;
      const trackTypesToMerge = ["overlay", "music", "voiceover", "captions", "audio"] as const;

      const mergedTracks = state.tracks.map((track) => {
        // Video track: apply draft clip positions (startTime, duration) but keep current src/thumbnail.
        // Match by index because LOAD_VIDEO_CONTENT creates new clip ids on reopen.
        if (track.type === "video") {
          const draftTrack = (draftTracks as any[]).find((t: any) => t.type === "video");
          const draftClips = (draftTrack?.clips || []) as any[];
          if (!draftClips.length) return track;
          const mergedClips = track.clips.map((stateClip, i) => {
            const draftClip = draftClips[i];
            if (!draftClip) return stateClip;
            return {
              ...stateClip,
              startTime: draftClip.startTime,
              duration: draftClip.duration,
              sourceStart: draftClip.sourceStart ?? stateClip.sourceStart,
              sourceDuration: draftClip.sourceDuration ?? stateClip.sourceDuration,
            };
          });
          return { ...track, clips: mergedClips };
        }

        if (!trackTypesToMerge.includes(track.type)) return track;
        const draftTrack = (draftTracks as any[]).find((t: any) => t.type === track.type);
        if (!draftTrack || !draftTrack.clips?.length) return track;
        const sameClipCount = track.clips.length === (draftTrack.clips as any[]).length;
        const restoredClips = (draftTrack.clips as any[]).map((clip: any, i: number) => {
          const c = createClip({
            ...clip,
            id: clip.id,
            trackId: clip.trackId || draftTrack.id,
            name: clip.name,
            type: clip.type,
            startTime: clip.startTime,
            duration: clip.duration,
          });
          // Keep fresh API URL for music/audio when structure matches (avoids expired presigned URLs)
          const stateClip = track.clips[i];
          if (sameClipCount && stateClip?.src && (track.type === "music" || track.type === "audio")) {
            return { ...c, trackId: track.id, src: stateClip.src, thumbnail: stateClip.thumbnail ?? c.thumbnail };
          }
          return { ...c, trackId: track.id };
        });
        return {
          ...draftTrack,
          id: track.id,
          clips: restoredClips,
        };
      });

      const newDuration =
        draftDuration != null
          ? Math.max(state.duration, draftDuration)
          : Math.max(state.duration, calculateTimelineDuration(mergedTracks));

      return {
        ...state,
        tracks: mergedTracks,
        duration: newDuration,
        ...(projectName != null && projectName !== "" ? { projectName } : {}),
      };
    }

    case "RESET_EDITOR":
      return createInitialState();

    default:
      return state;
  }
}

// Context type
interface VideoEditorContextType {
  state: VideoEditorState;
  dispatch: React.Dispatch<VideoEditorAction>;
  // Helper functions
  getSelectedClip: () => Clip | null;
  getSelectedTrack: () => Track | null;
  getClipById: (clipId: string) => Clip | null;
  getTrackById: (trackId: string) => Track | null;
  getTrackForClip: (clipId: string) => Track | null;
}

// Create context
const VideoEditorContext = createContext<VideoEditorContextType | null>(null);

// Provider component
export function VideoEditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(videoEditorReducer, createInitialState());

  // Helper functions
  const getSelectedClip = useCallback((): Clip | null => {
    if (!state.selectedClipId) return null;
    for (const track of state.tracks) {
      const clip = track.clips.find((c) => c.id === state.selectedClipId);
      if (clip) return clip;
    }
    return null;
  }, [state.selectedClipId, state.tracks]);

  const getSelectedTrack = useCallback((): Track | null => {
    if (!state.selectedTrackId) return null;
    return state.tracks.find((t) => t.id === state.selectedTrackId) || null;
  }, [state.selectedTrackId, state.tracks]);

  const getClipById = useCallback((clipId: string): Clip | null => {
    for (const track of state.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }, [state.tracks]);

  const getTrackById = useCallback((trackId: string): Track | null => {
    return state.tracks.find((t) => t.id === trackId) || null;
  }, [state.tracks]);

  const getTrackForClip = useCallback((clipId: string): Track | null => {
    for (const track of state.tracks) {
      if (track.clips.some((c) => c.id === clipId)) {
        return track;
      }
    }
    return null;
  }, [state.tracks]);

  return (
    <VideoEditorContext.Provider
      value={{
        state,
        dispatch,
        getSelectedClip,
        getSelectedTrack,
        getClipById,
        getTrackById,
        getTrackForClip,
      }}
    >
      {children}
    </VideoEditorContext.Provider>
  );
}

// Custom hook to use the video editor context
export function useVideoEditor() {
  const context = useContext(VideoEditorContext);
  if (!context) {
    throw new Error("useVideoEditor must be used within a VideoEditorProvider");
  }
  return context;
}
