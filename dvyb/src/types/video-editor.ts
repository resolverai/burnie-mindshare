// Video Editor Types for DVYB
// Based on CapCut-like editor interface

// Track types
export type TrackType = "video" | "audio" | "music" | "voiceover" | "captions" | "overlay";

// Aspect ratio options
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "21:9";

// Asset types
export type AssetType = "video" | "image" | "audio" | "music" | "text" | "sticker" | "effect" | "voiceover" | "overlay";

// Blend modes for overlays
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion";

// Transition types
export type TransitionType = "none" | "fade" | "dissolve" | "wipe-left" | "wipe-right" | "wipe-up" | "wipe-down" | "zoom-in" | "zoom-out" | "slide-left" | "slide-right" | "blur";

// Filter preset types
export type FilterPreset = "none" | "vintage" | "cinematic" | "vibrant" | "noir" | "warm" | "cool" | "sepia" | "dramatic" | "soft" | "sharp";

// Base clip interface
export interface Clip {
  id: string;
  trackId: string;
  name: string;
  startTime: number; // Start position on timeline (in seconds)
  duration: number; // Duration of clip (in seconds)
  sourceStart: number; // Start position in source media
  sourceDuration: number; // Total duration of source media
  thumbnail?: string;
  type: TrackType;
  src?: string; // Source URL for media
  
  // AI-related properties
  prompt?: string; // AI prompt used to generate/modify this clip
  aiGenerated?: boolean;
  aiModified?: boolean;
  
  // Transform properties
  transform: ClipTransform;
  
  // Speed properties
  speed: number;
  
  // Audio properties (for audio/video clips)
  volume: number;
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
  
  // Volume automation points
  volumeAutomation: VolumePoint[];
  
  // Filter/color properties
  filters: ClipFilters;
  filterPreset: FilterPreset;
  
  // Transitions
  transitionIn: TransitionType;
  transitionOut: TransitionType;
  transitionInDuration: number;
  transitionOutDuration: number;
  
  // Keyframes for animation
  keyframes: Keyframe[];
  
  // Text properties (for caption clips)
  text?: TextProperties;
  
  // Image overlay properties
  blendMode?: BlendMode;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  cornerRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;

  // Optional position (e.g. for export payload; overlays use transform for placement)
  position?: { x: number; y: number };

  // Overlay size (width % of frame, optional height)
  size?: { width?: number; height?: number };

  // Music: trim to end when a specific video clip ends
  trimToClipEnd?: boolean;
  trimToVideoClipId?: string;
}

export interface ClipTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface ClipFilters {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  sharpen: number;
  vignette: number;
  grain: number;
  noise?: number;
  temperature?: number;
}

// Volume automation point
export interface VolumePoint {
  id: string;
  time: number; // Relative to clip start
  volume: number; // 0-100
}

// Text properties for captions
export interface TextProperties {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor?: string;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  animation: TextAnimation;
  shadow: boolean;
  outline: boolean;
  outlineColor?: string;
}

export type TextAnimation = "none" | "fade-in" | "fade-out" | "typewriter" | "slide-up" | "slide-down" | "bounce" | "zoom" | "glow";

// Keyframe for animation
export interface Keyframe {
  id: string;
  time: number;
  property: keyof ClipTransform | keyof ClipFilters | "volume";
  value: number;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "bounce";
}

// Track interface
export interface Track {
  id: string;
  name: string;
  type: TrackType;
  clips: Clip[];
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number; // Track height in pixels
  color: string; // Track color identifier
}

// Asset interface (for media library)
export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  thumbnail: string;
  duration?: number; // For video/audio assets
  src: string;
  tags?: string[];
  category?: string;
  aiGenerated?: boolean;
  waveformData?: number[]; // For audio visualization
  createdAt?: Date;
  /** If true, from admin/library; user cannot delete. If false or undefined, user-uploaded and can be deleted. */
  isAdminAsset?: boolean;
}

// Text preset interface
export interface TextPreset {
  id: string;
  name: string;
  preview: string;
  style: Omit<TextProperties, "content">;
  category: string;
}

// Effect/Transition interface
export interface Effect {
  id: string;
  name: string;
  type: "filter" | "transition" | "sticker" | "overlay";
  thumbnail: string;
  duration?: number;
  category: string;
  preview?: string; // CSS filter string for preview
}

// Transition preset
export interface TransitionPreset {
  id: string;
  name: string;
  type: TransitionType;
  defaultDuration: number;
  thumbnail: string;
  category: string;
}

// Filter preset definition
export interface FilterPresetDef {
  id: FilterPreset;
  name: string;
  thumbnail: string;
  filters: Partial<ClipFilters>;
  category: string;
}

// Project interface for saving/loading
export interface Project {
  id: string;
  name: string;
  description?: string;
  aspectRatio: AspectRatio;
  tracks: Track[];
  duration: number;
  thumbnail?: string;
  createdAt: Date;
  updatedAt: Date;
  assets: Asset[];
}

// Video Editor state interface
export interface VideoEditorState {
  // Project info
  projectId: string;
  projectName: string;
  projectDescription: string;
  aspectRatio: AspectRatio;
  
  // DVYB-specific: Source content info
  generatedContentId?: number;
  postIndex?: number;
  videoUrl?: string;
  
  // Timeline state
  tracks: Track[];
  currentTime: number;
  duration: number;
  zoom: number; // 10-200, affects timeline scale
  isPlaying: boolean;
  isMuted: boolean; // Global mute for preview
  masterVolume: number; // 0-100, master volume for preview
  
  // Selection state
  selectedClipId: string | null;
  selectedTrackId: string | null;
  selectedClipIds: string[]; // For multi-select
  
  // Clipboard
  clipboardClips: Clip[];
  
  // Tool state
  activeTool: "select" | "cut" | "trim" | "text";
  snapEnabled: boolean;
  
  // Asset library
  mediaAssets: Asset[];
  audioAssets: Asset[];
  textPresets: TextPreset[];
  effects: Effect[];
  transitions: TransitionPreset[];
  filterPresets: FilterPresetDef[];
  
  // UI state
  showExportModal: boolean;
  showShareModal: boolean;
  showUploadModal: boolean;
  showAIPromptModal: boolean;
  aiPromptTarget: { clipId: string; type: "regenerate" | "modify" | "extend" } | null;
  
  // History for undo/redo
  history: VideoEditorState[];
  historyIndex: number;
}

// Video Editor action types
export type VideoEditorAction =
  | { type: "SET_PROJECT_NAME"; payload: string }
  | { type: "SET_PROJECT_DESCRIPTION"; payload: string }
  | { type: "SET_ASPECT_RATIO"; payload: AspectRatio }
  | { type: "SET_CURRENT_TIME"; payload: number }
  | { type: "SKIP_TO_START" }
  | { type: "SKIP_TO_END" }
  | { type: "SET_DURATION"; payload: number }
  | { type: "SET_ZOOM"; payload: number }
  | { type: "SET_PLAYING"; payload: boolean }
  | { type: "TOGGLE_PLAY" }
  | { type: "SET_MUTED"; payload: boolean }
  | { type: "SET_MASTER_VOLUME"; payload: number }
  | { type: "SELECT_CLIP"; payload: string | null }
  | { type: "SELECT_TRACK"; payload: string | null }
  | { type: "SELECT_MULTIPLE_CLIPS"; payload: string[] }
  | { type: "ADD_TO_SELECTION"; payload: string }
  | { type: "SET_ACTIVE_TOOL"; payload: VideoEditorState["activeTool"] }
  | { type: "TOGGLE_SNAP" }
  | { type: "ADD_TRACK"; payload: Track }
  | { type: "REMOVE_TRACK"; payload: string }
  | { type: "UPDATE_TRACK"; payload: Partial<Track> & { id: string } }
  | { type: "REORDER_TRACKS"; payload: { fromIndex: number; toIndex: number } }
  | { type: "TOGGLE_TRACK_MUTE"; payload: string }
  | { type: "TOGGLE_TRACK_LOCK"; payload: string }
  | { type: "TOGGLE_TRACK_VISIBILITY"; payload: string }
  | { type: "ADD_CLIP"; payload: { trackId: string; clip: Clip } }
  | { type: "REMOVE_CLIP"; payload: { trackId: string; clipId: string } }
  | { type: "UPDATE_CLIP"; payload: Partial<Clip> & { id: string } }
  | { type: "MOVE_CLIP"; payload: { clipId: string; newTrackId: string; newStartTime: number } }
  | { type: "SWAP_CLIPS"; payload: { clipIdA: string; clipIdB: string } }
  | { type: "RESIZE_CLIP"; payload: { clipId: string; newStartTime?: number; newDuration: number } }
  | { type: "SPLIT_CLIP"; payload: { clipId: string; splitTime: number } }
  | { type: "DUPLICATE_CLIP"; payload: string }
  | { type: "COPY_CLIPS"; payload: string[] }
  | { type: "PASTE_CLIPS"; payload: { trackId: string; startTime: number } }
  | { type: "SET_CLIP_TRANSITION"; payload: { clipId: string; position: "in" | "out"; transition: TransitionType; duration: number } }
  | { type: "SET_CLIP_SPEED"; payload: { clipId: string; speed: number } }
  | { type: "SET_CLIP_FILTER_PRESET"; payload: { clipId: string; preset: FilterPreset } }
  | { type: "ADD_VOLUME_POINT"; payload: { clipId: string; point: VolumePoint } }
  | { type: "UPDATE_VOLUME_POINT"; payload: { clipId: string; pointId: string; volume: number } }
  | { type: "REMOVE_VOLUME_POINT"; payload: { clipId: string; pointId: string } }
  | { type: "ADD_KEYFRAME"; payload: { clipId: string; keyframe: Keyframe } }
  | { type: "UPDATE_KEYFRAME"; payload: { clipId: string; keyframeId: string; value: number } }
  | { type: "REMOVE_KEYFRAME"; payload: { clipId: string; keyframeId: string } }
  | { type: "ADD_ASSET"; payload: Asset }
  | { type: "SET_ASSETS"; payload: { assets: Array<{ id: string; name: string; type: string; thumbnail?: string; duration?: number; src: string; tags?: string[]; category?: string; aiGenerated?: boolean; isAdminAsset?: boolean; [key: string]: any }> } }
  | { type: "REMOVE_ASSET"; payload: string }
  | { type: "UPDATE_ASSET"; payload: Partial<Asset> & { id: string } }
  | { type: "SHOW_EXPORT_MODAL"; payload: boolean }
  | { type: "SHOW_SHARE_MODAL"; payload: boolean }
  | { type: "SHOW_UPLOAD_MODAL"; payload: boolean }
  | { type: "SHOW_AI_PROMPT_MODAL"; payload: { clipId: string; type: "regenerate" | "modify" | "extend" } | null }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "LOAD_VIDEO_CONTENT"; payload: LoadVideoContentPayload }
  | { type: "SET_VIDEO_URL"; payload: string }
  | { type: "RESTORE_DRAFT"; payload: { tracks: Track[]; duration: number; aspectRatio: string; projectName?: string } }
  | { type: "MERGE_DRAFT_TRACKS"; payload: { draftTracks: any[]; duration?: number; projectName?: string } }
  | { type: "RESET_EDITOR" };

// Payload for loading DVYB video content
export interface LoadVideoContentPayload {
  generatedContentId: number;
  postIndex: number;
  videoUrl: string;
  duration: number;
  clips: {
    url: string;
    duration: number;
    startTime: number;
    prompt?: string; // AI prompt that generated this clip
  }[];
  voiceover?: {
    url?: string;
    duration?: number;
    prompt?: string; // AI prompt for voiceover
  };
  backgroundMusic?: {
    url?: string;
    duration?: number;
  };
  aspectRatio?: AspectRatio;
}

// Helper function to generate unique IDs
export function generateId(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

// Helper function to format time as MM:SS:FF (minutes:seconds:frames)
export function formatTime(seconds: number, fps: number = 30): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * fps);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
}

// Helper function to format time as MM:SS
export function formatTimeSimple(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// Default clip values
export const defaultClipTransform: ClipTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

export const defaultClipFilters: ClipFilters = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  blur: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
};

export const defaultTextProperties: TextProperties = {
  content: "Text",
  fontFamily: "Inter",
  fontSize: 48,
  fontWeight: 600,
  color: "#ffffff",
  textAlign: "center",
  verticalAlign: "middle",
  animation: "none",
  shadow: true,
  outline: false,
};

// Filter preset definitions
export const FILTER_PRESETS: FilterPresetDef[] = [
  { id: "none", name: "None", thumbnail: "", filters: {}, category: "Basic" },
  { id: "vintage", name: "Vintage", thumbnail: "", filters: { saturation: 80, contrast: 110, hue: 15, vignette: 30 }, category: "Retro" },
  { id: "cinematic", name: "Cinematic", thumbnail: "", filters: { contrast: 120, saturation: 90, vignette: 20, sharpen: 10 }, category: "Film" },
  { id: "vibrant", name: "Vibrant", thumbnail: "", filters: { saturation: 140, contrast: 110, brightness: 105 }, category: "Color" },
  { id: "noir", name: "Noir", thumbnail: "", filters: { saturation: 0, contrast: 130, vignette: 40 }, category: "B&W" },
  { id: "warm", name: "Warm", thumbnail: "", filters: { hue: 20, saturation: 110, brightness: 105 }, category: "Color" },
  { id: "cool", name: "Cool", thumbnail: "", filters: { hue: -20, saturation: 90, brightness: 100 }, category: "Color" },
  { id: "sepia", name: "Sepia", thumbnail: "", filters: { saturation: 50, hue: 30, contrast: 105 }, category: "Retro" },
  { id: "dramatic", name: "Dramatic", thumbnail: "", filters: { contrast: 140, saturation: 80, vignette: 50, sharpen: 20 }, category: "Film" },
  { id: "soft", name: "Soft", thumbnail: "", filters: { contrast: 90, blur: 1, saturation: 95 }, category: "Basic" },
  { id: "sharp", name: "Sharp", thumbnail: "", filters: { sharpen: 40, contrast: 110 }, category: "Basic" },
];

// Transition presets - simplified for clear UI
export const TRANSITION_PRESETS: TransitionPreset[] = [
  { id: "fade", name: "Fade", type: "fade", defaultDuration: 0.5, thumbnail: "", category: "Basic" },
  { id: "dissolve", name: "Dissolve", type: "dissolve", defaultDuration: 0.8, thumbnail: "", category: "Basic" },
  { id: "zoom-in", name: "Zoom In", type: "zoom-in", defaultDuration: 0.6, thumbnail: "", category: "Zoom" },
  { id: "zoom-out", name: "Zoom Out", type: "zoom-out", defaultDuration: 0.6, thumbnail: "", category: "Zoom" },
  { id: "blur", name: "Blur", type: "blur", defaultDuration: 0.5, thumbnail: "", category: "Effect" },
];

// Blend modes for overlays - simplified common options
export const BLEND_MODES: { id: BlendMode; name: string; description: string }[] = [
  { id: "normal", name: "Normal", description: "Standard blending" },
  { id: "multiply", name: "Multiply", description: "Darkens the image" },
  { id: "screen", name: "Screen", description: "Lightens the image" },
  { id: "overlay", name: "Overlay", description: "Increases contrast" },
  { id: "soft-light", name: "Soft Light", description: "Subtle contrast" },
  { id: "difference", name: "Difference", description: "Inverts colors" },
];

// Create a new clip with defaults
export function createClip(
  partial: Partial<Clip> & { id: string; trackId: string; name: string; type: TrackType; startTime: number; duration: number }
): Clip {
  return {
    sourceStart: 0,
    sourceDuration: partial.duration,
    transform: defaultClipTransform,
    speed: 1,
    volume: 100,
    fadeIn: 0,
    fadeOut: 0,
    muted: false,
    volumeAutomation: [],
    filters: defaultClipFilters,
    filterPreset: "none",
    transitionIn: "none",
    transitionOut: "none",
    transitionInDuration: 0,
    transitionOutDuration: 0,
    keyframes: [],
    aiGenerated: false,
    aiModified: false,
    // Image overlay defaults
    blendMode: "normal",
    flipHorizontal: false,
    flipVertical: false,
    cornerRadius: 0,
    borderWidth: 0,
    borderColor: "#ffffff",
    shadowEnabled: false,
    shadowColor: "rgba(0,0,0,0.5)",
    shadowBlur: 10,
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    ...partial,
  };
}

// Create a new track with defaults
export function createTrack(
  partial: Partial<Track> & { id: string; name: string; type: TrackType }
): Track {
  const colors: Record<TrackType, string> = {
    video: "#10b981",
    audio: "#3b82f6",
    music: "#8b5cf6",
    voiceover: "#f97316",
    captions: "#eab308",
    overlay: "#ec4899",
  };
  
  return {
    clips: [],
    muted: false,
    locked: false,
    visible: true,
    height: partial.type === "video" || partial.type === "overlay" ? 80 : 50,
    color: colors[partial.type],
    ...partial,
  };
}

// Calculate snap points for timeline
export function calculateSnapPoints(tracks: Track[], excludeClipId?: string): number[] {
  const points: Set<number> = new Set([0]);
  
  tracks.forEach(track => {
    track.clips.forEach(clip => {
      if (clip.id !== excludeClipId) {
        points.add(clip.startTime);
        points.add(clip.startTime + clip.duration);
      }
    });
  });
  
  return Array.from(points).sort((a, b) => a - b);
}

// Find nearest snap point
export function findNearestSnapPoint(time: number, snapPoints: number[], threshold: number = 0.1): number | null {
  for (const point of snapPoints) {
    if (Math.abs(time - point) <= threshold) {
      return point;
    }
  }
  return null;
}

// Generate mock waveform data
export function generateWaveformData(length: number = 100): number[] {
  const data: number[] = [];
  for (let i = 0; i < length; i++) {
    const base = Math.sin(i * 0.1) * 0.3;
    const noise = Math.random() * 0.5;
    const peak = Math.random() > 0.9 ? Math.random() * 0.3 : 0;
    data.push(Math.abs(base + noise + peak));
  }
  return data;
}
