'use client'

import React, { useState, useEffect, useRef } from 'react'
import { ChevronDownIcon, ChevronUpIcon, InformationCircleIcon } from '@heroicons/react/24/outline'

export interface AdvancedVideoOptions {
  // Duration System (Dual Mode)
  durationMode: 'video_duration' | 'clip_based'
  videoDuration?: number  // 10, 15, 20, 25
  clipDuration?: number   // 5, 8 seconds (Pixverse constraints)
  numberOfClips?: number  // 2-5 clips
  
  // Character Control (4-Tier System)
  characterControl: 'no_characters' | 'human_only' | 'web3' | 'unlimited'
  
  // Audio System
  audioSystem: 'individual_clips' | 'single_audio'
  enableVoiceover: boolean
  
  // Creative Control
  enableCrossfadeTransitions: boolean
  randomMode: 'all_regular' | 'all_prime' | 'true_random'
  
  // Model Options
  imageModel: 'nano-banana' | 'seedream'
  llmProvider: 'claude' | 'grok'
  clipGenerationModel: 'pixverse' | 'sora' | 'kling'
  
  // Brand Integration
  useBrandAesthetics: boolean
  includeProductImages: boolean
}

interface VideoOptionsProps {
  includeVideo: boolean
  videoDuration: number
  onVideoToggle: (includeVideo: boolean) => void
  onDurationChange: (duration: number) => void
  onAdvancedOptionsChange?: (options: AdvancedVideoOptions) => void
  disabled?: boolean
}

const VIDEO_DURATION_OPTIONS = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 20, label: '20 seconds' },
  { value: 25, label: '25 seconds' }
]

const CLIP_DURATION_OPTIONS = [
  { value: 5, label: '5 seconds' },
  { value: 8, label: '8 seconds' },
  { value: 4, label: '4 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 12, label: '12 seconds' }
]

// Model-specific valid durations
const MODEL_VALID_DURATIONS: Record<string, number[]> = {
  'pixverse': [5, 8],
  'sora': [4, 8, 12],
  'kling': [5, 10]
}

// Helper function to get valid durations for a model
const getValidDurationsForModel = (model: string): number[] => {
  return MODEL_VALID_DURATIONS[model] || [5, 8]
}

// Helper function to get closest valid duration for a model
const getClosestValidDuration = (currentDuration: number, model: string): number => {
  const validDurations = getValidDurationsForModel(model)
  if (validDurations.includes(currentDuration)) {
    return currentDuration
  }
  // Find closest valid duration
  return validDurations.reduce((prev, curr) => 
    Math.abs(curr - currentDuration) < Math.abs(prev - currentDuration) ? curr : prev
  )
}

const CHARACTER_CONTROL_OPTIONS = [
  { 
    value: 'no_characters', 
    label: '🚫 No Characters', 
    description: 'Pure product showcase - maintain existing characters for continuity, no new characters added'
  },
  { 
    value: 'human_only', 
    label: '👥 Human Only', 
    description: 'Only realistic human characters throughout the video'
  },
  { 
    value: 'web3', 
    label: '🚀 Web3 Memes', 
    description: 'Popular Web3/crypto meme characters (Pepe, Wojak, etc.)'
  },
  { 
    value: 'unlimited', 
    label: '🎨 Unlimited Creative', 
    description: 'Full creative freedom - any characters (food, animals, objects) in comic form'
  }
]

const AUDIO_SYSTEM_OPTIONS = [
  { 
    value: 'individual_clips', 
    label: '🎵 Individual Audio', 
    description: 'Separate audio track for each clip'
  },
  { 
    value: 'single_audio', 
    label: '🎼 Continuous Audio', 
    description: 'Single background music for entire video'
  }
]

const IMAGE_MODEL_OPTIONS = [
  { value: 'seedream', label: '🌟 Seedream', description: 'ByteDance Seedream (recommended)' },
  { value: 'nano-banana', label: '🍌 Nano Banana', description: 'Fal AI Nano Banana' }
]

const LLM_PROVIDER_OPTIONS = [
  { value: 'grok', label: '🤖 Grok', description: 'X.AI Grok (recommended)' },
  { value: 'claude', label: '🧠 Claude', description: 'Anthropic Claude' }
]

const CLIP_GENERATION_MODEL_OPTIONS = [
  { 
    value: 'pixverse', 
    label: '🎬 Pixverse', 
    description: 'Transition model (5 or 8s, 2 frames)',
    durations: '5 or 8 seconds',
    frameInfo: 'Uses 2 frames for transitions'
  },
  { 
    value: 'sora', 
    label: '🌟 Sora2', 
    description: 'Image-to-video (4/8/12s, 1 frame)',
    durations: '4, 8, or 12 seconds',
    frameInfo: 'Generates from single frame'
  },
  { 
    value: 'kling', 
    label: '⚡ Kling 2.5', 
    description: 'Image-to-video turbo (5/10s, 1 frame)',
    durations: '5 or 10 seconds',
    frameInfo: 'Generates from single frame'
  }
]

export default function VideoOptions({
  includeVideo,
  videoDuration,
  onVideoToggle,
  onDurationChange,
  onAdvancedOptionsChange,
  disabled = false
}: VideoOptionsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const initialSentRef = useRef(false)
  
  const [advancedOptions, setAdvancedOptions] = useState<AdvancedVideoOptions>({
    durationMode: 'video_duration' as const,
    videoDuration: videoDuration,
    clipDuration: 5,                        // ✅ Default: 5 seconds
    numberOfClips: 1,                       // ✅ Default: 1 clip (was 2)
    characterControl: 'no_characters' as const,      // ✅ Default: No Characters (was 'unlimited')
    audioSystem: 'single_audio' as const,            // ✅ Default: Continuous Audio (was 'individual_clips')
    enableVoiceover: false,                 // ✅ Default: Unchecked (already correct)
    enableCrossfadeTransitions: true,
    randomMode: 'all_regular' as const,              // ✅ Default: Unchecked randomize (was 'true_random')
    imageModel: 'nano-banana' as const,              // ✅ Default: Nano Banana (was 'seedream')
    llmProvider: 'grok' as const,                    // ✅ Default: Grok (already correct)
    clipGenerationModel: 'kling' as const,           // ✅ Default: Kling 2.5 Turbo
    useBrandAesthetics: false,              // ✅ Default: Unchecked (already correct)
    includeProductImages: false
  })

  // Sync videoDuration prop changes with internal state
  useEffect(() => {
    setAdvancedOptions(prev => {
      if (prev.videoDuration !== videoDuration) {
        const newOptions = {
          ...prev,
          videoDuration: videoDuration
        }
        // Call onAdvancedOptionsChange in a separate effect or timeout to avoid infinite loop
        setTimeout(() => onAdvancedOptionsChange?.(newOptions), 0)
        return newOptions
      }
      return prev
    })
  }, [videoDuration])

  // Send initial default options to parent on mount
  useEffect(() => {
    if (!initialSentRef.current) {
      // Send the initial advanced options to the parent component
      const initialOptions: AdvancedVideoOptions = {
        durationMode: 'video_duration' as const,
        videoDuration: videoDuration,
        clipDuration: 5,
        numberOfClips: 1,
        characterControl: 'no_characters' as const,
        audioSystem: 'single_audio' as const,
        enableVoiceover: false,
        enableCrossfadeTransitions: true,
        randomMode: 'all_regular' as const,
        imageModel: 'nano-banana' as const,
        llmProvider: 'grok' as const,
        clipGenerationModel: 'kling' as const,
        useBrandAesthetics: false,
        includeProductImages: false
      }
      onAdvancedOptionsChange?.(initialOptions)
      initialSentRef.current = true
    }
  }, [videoDuration, onAdvancedOptionsChange]) // Include videoDuration to sync initial value

  const updateAdvancedOption = <K extends keyof AdvancedVideoOptions>(
    key: K, 
    value: AdvancedVideoOptions[K]
  ) => {
    const newOptions = { ...advancedOptions, [key]: value }
    setAdvancedOptions(newOptions)
    onAdvancedOptionsChange?.(newOptions)
  }

  // Validate clip duration when model changes
  useEffect(() => {
    const currentModel = advancedOptions.clipGenerationModel
    const currentDuration = advancedOptions.clipDuration || 5
    const validDurations = getValidDurationsForModel(currentModel)
    
    // If current duration is not valid for this model, adjust it
    if (!validDurations.includes(currentDuration)) {
      const closestValid = getClosestValidDuration(currentDuration, currentModel)
      updateAdvancedOption('clipDuration', closestValid)
    }
  }, [advancedOptions.clipGenerationModel])

  const getFrameClipInfo = () => {
    if (advancedOptions.durationMode === 'clip_based' && advancedOptions.numberOfClips) {
      return {
        frames: advancedOptions.numberOfClips + 1,
        clips: advancedOptions.numberOfClips,
        duration: (advancedOptions.clipDuration || 5) * advancedOptions.numberOfClips
      }
    } else {
      const frames = Math.ceil(videoDuration / 5) + 1
      const clips = frames - 1
      return { frames, clips, duration: videoDuration }
    }
  }

  const { frames, clips, duration } = getFrameClipInfo()

  return (
    <div className="space-y-4 p-4 bg-gray-800/30 rounded-lg border border-gray-700/50">
      {/* Basic Video Toggle */}
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id="include-video"
          checked={includeVideo}
          onChange={(e) => onVideoToggle(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
        />
        <label htmlFor="include-video" className="text-sm font-medium text-gray-300">
          Generate Video
        </label>
      </div>
      
      {includeVideo && (
        <>
          {/* Basic Duration Selection */}
          {advancedOptions.durationMode === 'video_duration' && (
        <div className="space-y-2">
          <label htmlFor="video-duration" className="block text-sm font-medium text-gray-300">
            Video Duration
          </label>
          <select
            id="video-duration"
            value={videoDuration}
                onChange={(e) => {
                  const newDuration = parseInt(e.target.value)
                  onDurationChange(newDuration)
                  updateAdvancedOption('videoDuration', newDuration)
                }}
            disabled={disabled}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
          >
            {VIDEO_DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}
      
          {/* Advanced Options Toggle */}
          <div className="border-t border-gray-700/50 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              disabled={disabled}
              className="flex items-center space-x-2 text-sm font-medium text-gray-300 hover:text-orange-400 transition-colors"
            >
              {showAdvanced ? (
                <ChevronUpIcon className="h-4 w-4" />
              ) : (
                <ChevronDownIcon className="h-4 w-4" />
              )}
              <span>Advanced Video Options</span>
            </button>
          </div>

          {/* Advanced Options Panel */}
          {showAdvanced && (
            <div className="space-y-6 p-4 bg-gray-800/50 rounded-lg border border-gray-700/30">
              
              {/* Duration System */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-semibold text-gray-200">⏱️ Duration System</h4>
                  <div className="group relative">
                    <InformationCircleIcon className="h-4 w-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-64 z-10">
                      Choose between fixed video duration or clip-based duration control
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => updateAdvancedOption('durationMode', 'video_duration')}
                    disabled={disabled}
                    className={`px-3 py-2 text-sm rounded-md transition-colors ${
                      advancedOptions.durationMode === 'video_duration'
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    Video Duration
                  </button>
                  <button
                    type="button"
                    onClick={() => updateAdvancedOption('durationMode', 'clip_based')}
                    disabled={disabled}
                    className={`px-3 py-2 text-sm rounded-md transition-colors ${
                      advancedOptions.durationMode === 'clip_based'
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    Clip Based
                  </button>
                </div>

                {advancedOptions.durationMode === 'clip_based' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Clip Duration
                      </label>
                      <select
                        value={advancedOptions.clipDuration}
                        onChange={(e) => updateAdvancedOption('clipDuration', parseInt(e.target.value))}
                        disabled={disabled}
                        className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:ring-2 focus:ring-orange-500"
                      >
                        {CLIP_DURATION_OPTIONS
                          .filter(option => getValidDurationsForModel(advancedOptions.clipGenerationModel).includes(option.value))
                          .map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        {advancedOptions.clipGenerationModel === 'pixverse' && '✅ Valid: 5 or 8 seconds'}
                        {advancedOptions.clipGenerationModel === 'sora' && '✅ Valid: 4, 8, or 12 seconds'}
                        {advancedOptions.clipGenerationModel === 'kling' && '✅ Valid: 5 or 10 seconds'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Number of Clips
                      </label>
                      <select
                        value={advancedOptions.numberOfClips}
                        onChange={(e) => updateAdvancedOption('numberOfClips', parseInt(e.target.value))}
                        disabled={disabled}
                        className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:ring-2 focus:ring-orange-500"
                      >
                        {[1, 2, 3, 4, 5].map((num) => (
                          <option key={num} value={num}>
                            {num} clip{num !== 1 ? 's' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Character Control */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-semibold text-gray-200">🎭 Character Control</h4>
                  <div className="group relative">
                    <InformationCircleIcon className="h-4 w-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-64 z-10">
                      Control what types of characters appear in your video
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {CHARACTER_CONTROL_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-start space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="characterControl"
                        value={option.value}
                        checked={advancedOptions.characterControl === option.value}
                        onChange={(e) => updateAdvancedOption('characterControl', e.target.value as any)}
                        disabled={disabled}
                        className="mt-1 h-4 w-4 text-orange-600 bg-gray-700 border-gray-600 focus:ring-orange-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-300">{option.label}</div>
                        <div className="text-xs text-gray-500">{option.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Audio System */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-semibold text-gray-200">🎵 Audio System</h4>
                  <div className="group relative">
                    <InformationCircleIcon className="h-4 w-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-64 z-10">
                      Choose how audio is generated for your video
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {AUDIO_SYSTEM_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-start space-x-3 cursor-pointer">
                      <input
                        type="radio"
                        name="audioSystem"
                        value={option.value}
                        checked={advancedOptions.audioSystem === option.value}
                        onChange={(e) => updateAdvancedOption('audioSystem', e.target.value as any)}
                        disabled={disabled}
                        className="mt-1 h-4 w-4 text-orange-600 bg-gray-700 border-gray-600 focus:ring-orange-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-300">{option.label}</div>
                        <div className="text-xs text-gray-500">{option.description}</div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="enableVoiceover"
                    checked={advancedOptions.enableVoiceover}
                    onChange={(e) => updateAdvancedOption('enableVoiceover', e.target.checked)}
                    disabled={disabled}
                    className="h-4 w-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
                  />
                  <label htmlFor="enableVoiceover" className="text-sm text-gray-300">
                    🎤 Enable AI Voiceover (ElevenLabs TTS)
                  </label>
                </div>
              </div>

              {/* Creative Control */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-semibold text-gray-200">🎨 Creative Control</h4>
                  <div className="group relative">
                    <InformationCircleIcon className="h-4 w-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-64 z-10">
                      Advanced creative options for professional video quality
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="enableCrossfadeTransitions"
                      checked={advancedOptions.enableCrossfadeTransitions}
                      onChange={(e) => updateAdvancedOption('enableCrossfadeTransitions', e.target.checked)}
                      disabled={disabled}
                      className="h-4 w-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
                    />
                    <label htmlFor="enableCrossfadeTransitions" className="text-sm text-gray-300">
                      🎬 Crossfade Transitions (Professional Quality)
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="useBrandAesthetics"
                      checked={advancedOptions.useBrandAesthetics}
                      onChange={(e) => updateAdvancedOption('useBrandAesthetics', e.target.checked)}
                      disabled={disabled}
                      className="h-4 w-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
                    />
                    <label htmlFor="useBrandAesthetics" className="text-sm text-gray-300">
                      🏷️ Brand Aesthetics Integration
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="randomizeContent"
                      checked={advancedOptions.randomMode === 'true_random'}
                      onChange={(e) => updateAdvancedOption('randomMode', e.target.checked ? 'true_random' : 'all_regular')}
                      disabled={disabled}
                      className="h-4 w-4 text-orange-600 bg-gray-700 border-gray-600 rounded focus:ring-orange-500 focus:ring-2"
                    />
                    <label htmlFor="randomizeContent" className="text-sm text-gray-300">
                      🎲 Randomize Content
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 ml-6">
                    Add creative variation across clips for more dynamic videos
                  </p>
                </div>
              </div>

              {/* Model Options */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-semibold text-gray-200">🤖 AI Models</h4>
                  <div className="group relative">
                    <InformationCircleIcon className="h-4 w-4 text-gray-500 cursor-help" />
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none w-64 z-10">
                      Choose AI models for image generation, clip generation, and prompt creation
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      Image Model
                    </label>
                    <select
                      value={advancedOptions.imageModel}
                      onChange={(e) => updateAdvancedOption('imageModel', e.target.value as any)}
                      disabled={disabled}
                      className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:ring-2 focus:ring-orange-500"
                    >
                      {IMAGE_MODEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      LLM Provider
                    </label>
                    <select
                      value={advancedOptions.llmProvider}
                      onChange={(e) => updateAdvancedOption('llmProvider', e.target.value as any)}
                      disabled={disabled}
                      className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:ring-2 focus:ring-orange-500"
                    >
                      {LLM_PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Clip Generation Model
                  </label>
                  <select
                    value={advancedOptions.clipGenerationModel}
                    onChange={(e) => updateAdvancedOption('clipGenerationModel', e.target.value as any)}
                    disabled={disabled}
                    className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:ring-2 focus:ring-orange-500"
                  >
                    {CLIP_GENERATION_MODEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {CLIP_GENERATION_MODEL_OPTIONS.find(opt => opt.value === advancedOptions.clipGenerationModel)?.description}
                  </p>
                  <div className="flex items-center space-x-4 mt-1 text-xs text-gray-500">
                    <span>⏱️ {CLIP_GENERATION_MODEL_OPTIONS.find(opt => opt.value === advancedOptions.clipGenerationModel)?.durations}</span>
                    <span>🖼️ {CLIP_GENERATION_MODEL_OPTIONS.find(opt => opt.value === advancedOptions.clipGenerationModel)?.frameInfo}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Video Generation Info */}
        <div className="text-xs text-gray-400 bg-gray-800/20 p-3 rounded border border-gray-700/30">
            <p className="font-medium mb-1 text-gray-300">🎬 Video Generation Preview:</p>
          <ul className="space-y-1 text-gray-400">
              <li>• Duration: {duration} seconds ({frames} frames, {clips} clips)</li>
              <li>• Character Style: {CHARACTER_CONTROL_OPTIONS.find(opt => opt.value === advancedOptions.characterControl)?.label}</li>
              <li>• Audio: {AUDIO_SYSTEM_OPTIONS.find(opt => opt.value === advancedOptions.audioSystem)?.label}</li>
              <li>• Features: {advancedOptions.enableCrossfadeTransitions ? 'Crossfade Transitions' : 'Standard Cuts'}{advancedOptions.enableVoiceover ? ', AI Voiceover' : ''}</li>
              <li>• Variation: {advancedOptions.randomMode === 'true_random' ? 'Randomized content across clips' : 'Consistent style across clips'}</li>
              <li>• Models: {advancedOptions.imageModel} + {advancedOptions.llmProvider} + {CLIP_GENERATION_MODEL_OPTIONS.find(opt => opt.value === advancedOptions.clipGenerationModel)?.label.replace(/🎬|🌟|⚡/g, '').trim()}</li>
          </ul>
        </div>
        </>
      )}
    </div>
  )
}
