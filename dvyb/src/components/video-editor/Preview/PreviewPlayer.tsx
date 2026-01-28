"use client";

import { useVideoEditor } from "@/contexts/VideoEditorContext";
import { PlayerControls } from "./PlayerControls";
import { cn } from "@/lib/utils";
import { Sparkles, Play, Pause, Maximize2, Minimize2 } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";

export function PreviewPlayer() {
  const { state, dispatch, getSelectedClip } = useVideoEditor();
  const { aspectRatio, currentTime, isPlaying, tracks, isMuted, masterVolume } = state;
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lastVideoClipId = useRef<string | null>(null);
  const lastSrcRef = useRef<string | null>(null);
  const wasPlayingRef = useRef(false);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const lastSyncTimeRef = useRef<number>(0); // Track when we last synced to avoid constant seeking

  const selectedClip = getSelectedClip();

  // Get current video clip - memoized to prevent unnecessary recalculations
  const getCurrentVideoInfo = useCallback(() => {
    const videoTracks = tracks.filter((t) => t.type === "video" && t.visible);
    
    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const track = videoTracks[i];
      // Use <= for end time to include the exact end frame
      const currentClip = track.clips.find(
        (c) => currentTime >= c.startTime && currentTime <= c.startTime + c.duration
      );
      if (currentClip) {
        return {
          clip: currentClip,
          src: currentClip.src,
          thumbnail: currentClip.thumbnail,
          filters: currentClip.filters,
          transform: currentClip.transform,
        };
      }
    }
    return null;
  }, [tracks, currentTime]);

  // Get current captions
  const getCurrentCaption = useCallback(() => {
    const captionTrack = tracks.find((t) => t.type === "captions" && t.visible);
    if (!captionTrack) return null;
    
    return captionTrack.clips.find(
      (c) => currentTime >= c.startTime && currentTime < c.startTime + c.duration
    );
  }, [tracks, currentTime]);

  // Get all active audio clips
  const getActiveAudioClips = useCallback(() => {
    const activeClips: Array<{ clip: any; track: any }> = [];
    
    tracks.forEach(track => {
      if (!track.visible) return;
      if (track.type !== 'audio' && track.type !== 'music' && track.type !== 'voiceover') return;
      
      track.clips.forEach(clip => {
        if (currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) {
          activeClips.push({ clip, track });
        }
      });
    });
    
    return activeClips;
  }, [tracks, currentTime]);

  // Get active overlay clips (images, stickers, etc.)
  const getActiveOverlays = useCallback(() => {
    const overlays: Array<{ clip: any; track: any }> = [];
    
    tracks.forEach(track => {
      if (!track.visible) return;
      if (track.type !== 'overlay') return;
      
      track.clips.forEach(clip => {
        if (currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) {
          overlays.push({ clip, track });
        }
      });
    });
    
    return overlays;
  }, [tracks, currentTime]);

  const videoInfo = getCurrentVideoInfo();
  const currentCaption = getCurrentCaption();
  const activeAudioClips = getActiveAudioClips();
  const activeOverlays = getActiveOverlays();

  // Calculate transition effects for video clip
  // Returns { opacity, scale, blur, transform } for CSS
  const getTransitionEffects = useCallback((clip: any, clipRelativeTime: number) => {
    let opacity = 1;
    let scale = 1;
    let blur = 0;
    
    // Transition In effects
    if (clip.transitionInDuration > 0 && clipRelativeTime < clip.transitionInDuration) {
      const progress = clipRelativeTime / clip.transitionInDuration;
      
      switch (clip.transitionIn) {
        case 'fade':
        case 'dissolve':
          opacity = Math.min(opacity, progress);
          break;
        case 'zoom-in':
          opacity = Math.min(opacity, progress);
          scale = 0.5 + (progress * 0.5); // Start at 50%, end at 100%
          break;
        case 'zoom-out':
          opacity = Math.min(opacity, progress);
          scale = 1.5 - (progress * 0.5); // Start at 150%, end at 100%
          break;
        case 'blur':
          opacity = Math.min(opacity, progress);
          blur = (1 - progress) * 10; // Start at 10px blur, end at 0
          break;
      }
    }
    
    // Transition Out effects
    if (clip.transitionOutDuration > 0) {
      const timeFromEnd = clip.duration - clipRelativeTime;
      if (timeFromEnd < clip.transitionOutDuration) {
        const progress = timeFromEnd / clip.transitionOutDuration; // 1 -> 0 as we approach end
        
        switch (clip.transitionOut) {
          case 'fade':
          case 'dissolve':
            opacity = Math.min(opacity, progress);
            break;
          case 'zoom-in':
            opacity = Math.min(opacity, progress);
            scale = 1 + ((1 - progress) * 0.5); // End at 150%
            break;
          case 'zoom-out':
            opacity = Math.min(opacity, progress);
            scale = 1 - ((1 - progress) * 0.5); // End at 50%
            break;
          case 'blur':
            opacity = Math.min(opacity, progress);
            blur = Math.max(blur, (1 - progress) * 10); // End at 10px blur
            break;
        }
      }
    }
    
    return {
      opacity: Math.max(0, Math.min(1, opacity)),
      scale,
      blur,
    };
  }, []);

  // Calculate audio volume with fade in/out
  const getAudioVolume = useCallback((clip: any, clipRelativeTime: number) => {
    let volume = (clip.volume || 100) / 100;
    
    // Fade in
    if (clip.fadeIn > 0 && clipRelativeTime < clip.fadeIn) {
      volume *= clipRelativeTime / clip.fadeIn;
    }
    
    // Fade out
    const timeFromEnd = clip.duration - clipRelativeTime;
    if (clip.fadeOut > 0 && timeFromEnd < clip.fadeOut) {
      volume *= timeFromEnd / clip.fadeOut;
    }
    
    return Math.max(0, Math.min(1, volume));
  }, []);

  // Calculate video effects including transform and transitions
  const videoEffects = videoInfo?.clip ? (() => {
    const clipRelativeTime = currentTime - videoInfo.clip.startTime;
    const transitionEffects = getTransitionEffects(videoInfo.clip, clipRelativeTime);
    const transformOpacity = videoInfo.transform?.opacity ?? 1;
    const transformScale = videoInfo.transform?.scale ?? 1;
    
    return {
      opacity: transitionEffects.opacity * transformOpacity,
      scale: transitionEffects.scale * transformScale,
      blur: transitionEffects.blur,
    };
  })() : { opacity: 1, scale: 1, blur: 0 };

  // Handle video source changes — always keep ref and src in sync so remounts don't leave video black
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const newSrc = videoInfo?.src || null;
    const clipId = videoInfo?.clip?.id || null;

    // Source changed - load new video (or clip identity changed after e.g. split — ensure same URL is re-applied if element was remounted)
    const sourceOrClipChanged = newSrc !== lastSrcRef.current || clipId !== lastVideoClipId.current;
    if (sourceOrClipChanged) {
      lastSrcRef.current = newSrc;
      lastVideoClipId.current = clipId;
      
      // Cancel any pending play
      playPromiseRef.current = null;
      
      if (newSrc) {
        video.src = newSrc;
        video.load();
        
        // When video loads, seek to correct position
        const handleLoadedMetadata = () => {
          if (videoInfo?.clip) {
            const speed = videoInfo.clip.speed || 1;
            const clipRelativeTime = currentTime - videoInfo.clip.startTime;
            const sourceStart = videoInfo.clip.sourceStart || 0;
            // Account for speed when calculating position
            const expectedSourceTime = clipRelativeTime * speed;
            const videoTime = sourceStart + Math.max(0, Math.min(expectedSourceTime, (videoInfo.clip.sourceDuration || videoInfo.clip.duration * speed)));
            video.currentTime = Math.max(0, Math.min(videoTime, video.duration));
            lastSyncTimeRef.current = currentTime;
          }
          // Resume playing if was playing - use playPromiseRef to avoid race conditions
          if (isPlaying && video.paused) {
            playPromiseRef.current = video.play();
            playPromiseRef.current
              .then(() => { playPromiseRef.current = null; })
              .catch(() => { playPromiseRef.current = null; });
          }
        };
        
        video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
      } else {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }
  }, [videoInfo?.src, videoInfo?.clip?.id, videoInfo?.clip, currentTime, isPlaying]);

  // Sync video time when paused or when there's a significant time jump
  // IMPORTANT: When playing at non-1x speeds, let the video play naturally to avoid jitter
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoInfo?.clip || !videoInfo.src) return;
    
    const speed = videoInfo.clip.speed || 1;
    const clipRelativeTime = currentTime - videoInfo.clip.startTime;
    const sourceStart = videoInfo.clip.sourceStart || 0;
    
    // Calculate expected video position accounting for speed
    // At 2x speed, 1 second of timeline time = 2 seconds of source video
    const expectedSourceTime = clipRelativeTime * speed;
    const videoTime = sourceStart + Math.max(0, Math.min(expectedSourceTime, (videoInfo.clip.sourceDuration || videoInfo.clip.duration * speed)));
    
    // Calculate how far off we are
    const timeDiff = Math.abs(video.currentTime - videoTime);
    
    if (!isPlaying) {
      // When paused (scrubbing), sync precisely
      if (timeDiff > 0.05) {
        video.currentTime = videoTime;
        lastSyncTimeRef.current = currentTime;
      }
    } else {
      // When playing, only sync on BIG jumps (like skip to start/end)
      // Use a larger threshold to avoid constant seeking during normal playback
      // At higher speeds, the video advances faster so use even larger threshold
      const syncThreshold = Math.max(1.0, speed * 0.5);
      
      // Also check if there was a timeline jump (user clicked skip or scrubbed while playing)
      const timelineJump = Math.abs(currentTime - lastSyncTimeRef.current) > 0.5;
      
      if (timeDiff > syncThreshold && timelineJump) {
        video.currentTime = videoTime;
        lastSyncTimeRef.current = currentTime;
      }
    }
  }, [currentTime, isPlaying, videoInfo]);

  // Handle play/pause state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoInfo?.src) {
      return;
    }

    if (isPlaying) {
      const speed = videoInfo.clip.speed || 1;
      const clipRelativeTime = currentTime - videoInfo.clip.startTime;
      const sourceStart = videoInfo.clip.sourceStart || 0;
      // Account for speed when calculating expected position
      const expectedSourceTime = clipRelativeTime * speed;
      const videoTime = sourceStart + Math.max(0, Math.min(expectedSourceTime, (videoInfo.clip.sourceDuration || videoInfo.clip.duration * speed)));
      
      // Seek if significantly off (only at start of playback)
      if (Math.abs(video.currentTime - videoTime) > 0.2) {
        video.currentTime = videoTime;
      }
      
      // Track this sync point
      lastSyncTimeRef.current = currentTime;
      
      // Only try to play if video is paused and no pending play
      if (video.paused && !playPromiseRef.current) {
        playPromiseRef.current = video.play();
        playPromiseRef.current
          .then(() => {
            playPromiseRef.current = null;
          })
          .catch((err) => {
            playPromiseRef.current = null;
            // Ignore AbortError - it's expected when play is interrupted
            if (err.name !== 'AbortError') {
              console.warn("Video play failed:", err);
            }
          });
      }
      wasPlayingRef.current = true;
    } else {
      // Stopping playback - wait for any pending play to complete first
      if (playPromiseRef.current) {
        playPromiseRef.current.then(() => {
          if (!video.paused) {
            video.pause();
          }
        }).catch(() => {
          // Ignore errors when pausing after failed play
        });
        playPromiseRef.current = null;
      } else if (!video.paused) {
        video.pause();
      }
      wasPlayingRef.current = false;
    }
  }, [isPlaying, videoInfo, currentTime]);

  // Apply playback speed to video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoInfo?.clip) return;
    
    const speed = videoInfo.clip.speed || 1;
    if (video.playbackRate !== speed) {
      video.playbackRate = speed;
    }
  }, [videoInfo?.clip?.speed]);

  // Apply video volume with fades (for embedded audio in video)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoInfo?.clip) return;
    
    // Check global mute first, then clip mute
    if (isMuted || videoInfo.clip.muted) {
      video.volume = 0;
    } else {
      const clipRelativeTime = currentTime - videoInfo.clip.startTime;
      const clipVolume = getAudioVolume(videoInfo.clip, clipRelativeTime);
      // Apply master volume on top of clip volume
      const finalVolume = clipVolume * (masterVolume / 100);
      video.volume = Math.max(0, Math.min(1, finalVolume));
    }
  }, [currentTime, videoInfo?.clip, getAudioVolume, isMuted, masterVolume]);

  // Pause video when no current clip
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (!videoInfo) {
      video.pause();
      wasPlayingRef.current = false;
    }
  }, [videoInfo]);

  // Sync audio playback
  useEffect(() => {
    // Handle active audio clips
    activeAudioClips.forEach(({ clip, track }) => {
      if (!clip.src) return;
      
      const relativeTime = currentTime - clip.startTime;
      
      let audioElement = audioRefs.current.get(clip.id);
      const isNewOrNewSrc = !audioElement || (audioElement.src !== clip.src);
      if (!audioElement) {
        audioElement = new Audio(clip.src);
        audioElement.preload = 'auto';
        audioRefs.current.set(clip.id, audioElement);
      } else if (audioElement.src !== clip.src) {
        // Clip src changed (e.g. fresh presigned URL after draft restore) — use new URL
        audioElement.src = clip.src;
      }
      
      // Set volume with fade in/out support - check global mute first
      if (isMuted || clip.muted || track.muted) {
        audioElement.volume = 0;
      } else {
        const clipVolume = getAudioVolume(clip, relativeTime);
        const finalVolume = clipVolume * (masterVolume / 100);
        audioElement.volume = Math.max(0, Math.min(1, finalVolume));
      }
      
      // If audio isn't ready yet, set currentTime and play once metadata is loaded so playback starts at clip start time
      if (audioElement.readyState < 1 && isNewOrNewSrc) {
        const targetRelative = relativeTime;
        const shouldPlay = isPlaying;
        const onReady = () => {
          if (Math.abs(audioElement.currentTime - targetRelative) > 0.15) {
            audioElement.currentTime = targetRelative;
          }
          if (shouldPlay && audioElement.paused) {
            audioElement.play().catch(() => {});
          }
        };
        audioElement.addEventListener('loadedmetadata', onReady, { once: true });
        audioElement.addEventListener('canplay', onReady, { once: true });
      } else {
        // Already loaded: sync position and play/pause
        if (Math.abs(audioElement.currentTime - relativeTime) > 0.15) {
          audioElement.currentTime = relativeTime;
        }
        if (isPlaying && audioElement.paused) {
          audioElement.play().catch(() => {});
        } else if (!isPlaying && !audioElement.paused) {
          audioElement.pause();
        }
      }
    });
    
    // Pause audio elements that are no longer active
    const activeClipIds = new Set(activeAudioClips.map(({ clip }) => clip.id));
    audioRefs.current.forEach((audio, clipId) => {
      if (!activeClipIds.has(clipId) && !audio.paused) {
        audio.pause();
      }
    });
  }, [currentTime, isPlaying, activeAudioClips, getAudioVolume, isMuted, masterVolume]);

  // Cleanup audio elements
  useEffect(() => {
    return () => {
      audioRefs.current.forEach(audio => {
        audio.pause();
        audio.src = '';
      });
      audioRefs.current.clear();
    };
  }, []);

  const togglePlayPause = () => {
    dispatch({ type: "TOGGLE_PLAY" });
  };

  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Get aspect ratio CSS
  const getAspectRatioCSS = () => {
    switch (aspectRatio) {
      case "16:9": return "16 / 9";
      case "9:16": return "9 / 16";
      case "1:1": return "1 / 1";
      case "4:3": return "4 / 3";
      case "21:9": return "21 / 9";
      default: return "9 / 16";
    }
  };

  const getContainerClass = () => {
    switch (aspectRatio) {
      case "9:16": return "h-full w-auto";
      case "1:1": return "h-full w-auto";
      default: return "w-full h-auto";
    }
  };

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-background">
      {/* Preview Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Preview</span>
          <span className="text-xs text-muted-foreground/60 px-2 py-0.5 bg-muted/50 rounded">
            {aspectRatio}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="p-1.5 rounded hover:bg-secondary/50 transition-colors"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>

      {/* Preview Canvas */}
      <div className="flex-1 flex items-center justify-center p-4 bg-black/50 overflow-hidden">
        <div
          className={cn(
            "relative bg-black rounded-lg overflow-hidden shadow-2xl max-w-full max-h-full",
            getContainerClass()
          )}
          style={{
            aspectRatio: getAspectRatioCSS(),
          }}
        >
          {/* Video: always mounted so ref/source stay in sync after track updates (add audio, split, etc.) */}
          <div
            className="absolute inset-0"
            style={{
              visibility: videoInfo?.src ? 'visible' : 'hidden',
              filter: `blur(${videoEffects.blur}px)`,
              transform: `
                scale(${videoEffects.scale})
                rotate(${videoInfo?.transform?.rotation || 0}deg)
                translate(${videoInfo?.transform?.x || 0}px, ${videoInfo?.transform?.y || 0}px)
              `,
              opacity: videoInfo?.src ? videoEffects.opacity : 0,
              transition: 'opacity 50ms ease-out, transform 50ms ease-out, filter 50ms ease-out',
            }}
          >
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              preload="auto"
            />
          </div>
          {/* Placeholder when no video clip: thumbnail or empty state */}
          {!videoInfo?.src && videoInfo?.thumbnail && (
            <div
              className="absolute inset-0"
              style={{
                filter: videoInfo.filters ? `
                  brightness(${videoInfo.filters.brightness}%)
                  contrast(${videoInfo.filters.contrast}%)
                  saturate(${videoInfo.filters.saturation}%)
                  hue-rotate(${videoInfo.filters.hue}deg)
                ` : undefined,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={videoInfo.thumbnail}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            </div>
          )}
          {!videoInfo?.src && !videoInfo?.thumbnail && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-gradient-to-br from-zinc-900 to-zinc-800">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3">
                  <Sparkles className="h-8 w-8 text-white/30" />
                </div>
                <span className="text-sm text-white/50">No video at current time</span>
                <p className="text-xs text-white/30 mt-1">Move playhead to a clip</p>
              </div>
            </div>
          )}

          {/* Image/Video Overlays */}
          {activeOverlays.map(({ clip }) => {
            // Calculate position from transform.x and transform.y
            // x: 0 = center, negative = left, positive = right
            // y: 0 = center, negative = up, positive = down
            const xPercent = 50 + (clip.transform?.x || 0) / 5; // Scale down for percentage
            const yPercent = 50 + (clip.transform?.y || 0) / 5;
            
            // Build transform string with all effects
            const transformParts = [
              'translate(-50%, -50%)',
              `scale(${clip.transform?.scale || 1})`,
              `rotate(${clip.transform?.rotation || 0}deg)`,
              clip.flipHorizontal ? 'scaleX(-1)' : '',
              clip.flipVertical ? 'scaleY(-1)' : '',
            ].filter(Boolean).join(' ');
            
            // Build box shadow if enabled
            const boxShadow = clip.shadowEnabled
              ? `${clip.shadowOffsetX || 0}px ${clip.shadowOffsetY || 4}px ${clip.shadowBlur || 10}px ${clip.shadowColor || 'rgba(0,0,0,0.5)'}`
              : undefined;
            
            // Build filter string
            const filterParts = [];
            if (clip.filters?.brightness && clip.filters.brightness !== 100) {
              filterParts.push(`brightness(${clip.filters.brightness}%)`);
            }
            if (clip.filters?.contrast && clip.filters.contrast !== 100) {
              filterParts.push(`contrast(${clip.filters.contrast}%)`);
            }
            if (clip.filters?.saturation && clip.filters.saturation !== 100) {
              filterParts.push(`saturate(${clip.filters.saturation}%)`);
            }
            if (clip.filters?.hue && clip.filters.hue !== 0) {
              filterParts.push(`hue-rotate(${clip.filters.hue}deg)`);
            }
            const filterString = filterParts.length > 0 ? filterParts.join(' ') : undefined;
            
            return (
              <div
                key={clip.id}
                className="absolute pointer-events-none z-10"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  transform: transformParts,
                  opacity: clip.transform?.opacity ?? 1,
                  width: `${clip.size?.width || 30}%`,
                  filter: filterString,
                }}
              >
                {(clip.src || clip.thumbnail) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${clip.id}-${(clip.src || clip.thumbnail || "").slice(0, 80)}`}
                    src={clip.src || clip.thumbnail}
                    alt={clip.name}
                    className="w-full h-auto"
                    style={{
                      borderRadius: clip.cornerRadius || 0,
                      border: clip.borderWidth ? `${clip.borderWidth}px solid ${clip.borderColor || '#ffffff'}` : undefined,
                      boxShadow: boxShadow,
                      mixBlendMode: (clip.blendMode || 'normal') as React.CSSProperties['mixBlendMode'],
                    }}
                    draggable={false}
                  />
                )}
              </div>
            );
          })}

          {/* Play/Pause overlay */}
          <button
            onClick={togglePlayPause}
            className="absolute inset-0 flex items-center justify-center z-20 group"
          >
            <div className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center transition-all",
              "bg-black/40 group-hover:bg-black/60 group-hover:scale-110",
              isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-100"
            )}>
              {isPlaying ? (
                <Pause className="h-8 w-8 text-white" fill="white" />
              ) : (
                <Play className="h-8 w-8 text-white ml-1" fill="white" />
              )}
            </div>
          </button>

          {/* Caption overlay */}
          {currentCaption?.text && (
            <div
              className={cn(
                "absolute left-0 right-0 flex justify-center px-4 z-10 pointer-events-none",
                currentCaption.text.verticalAlign === "top" && "top-4",
                currentCaption.text.verticalAlign === "middle" && "top-1/2 -translate-y-1/2",
                currentCaption.text.verticalAlign === "bottom" && "bottom-16"
              )}
            >
              <span
                className="max-w-[90%] text-center"
                style={{
                  fontFamily: currentCaption.text.fontFamily,
                  fontSize: `${Math.min(currentCaption.text.fontSize / 2, 32)}px`,
                  fontWeight: currentCaption.text.fontWeight,
                  color: currentCaption.text.color,
                  backgroundColor: currentCaption.text.backgroundColor,
                  padding: currentCaption.text.backgroundColor ? "8px 16px" : undefined,
                  borderRadius: currentCaption.text.backgroundColor ? "8px" : undefined,
                  textShadow: currentCaption.text.shadow 
                    ? "2px 2px 4px rgba(0,0,0,0.8)" 
                    : undefined,
                  textAlign: currentCaption.text.textAlign,
                }}
              >
                {currentCaption.text.content}
              </span>
            </div>
          )}

          {/* Selected clip info */}
          {selectedClip && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded bg-primary/80 text-[10px] font-medium text-primary-foreground z-10 pointer-events-none">
              {(selectedClip.aiGenerated || selectedClip.aiModified) && (
                <Sparkles className="h-3 w-3" />
              )}
              {selectedClip.name}
            </div>
          )}

          {/* Playing indicator */}
          {isPlaying && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/80 text-[10px] font-medium text-white z-10 pointer-events-none animate-pulse">
              <div className="w-2 h-2 rounded-full bg-white" />
              Playing
            </div>
          )}
        </div>
      </div>

      {/* Player Controls */}
      <PlayerControls videoRef={videoRef} />
    </div>
  );
}
