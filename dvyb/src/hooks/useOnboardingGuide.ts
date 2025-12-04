"use client";

import { useState, useEffect, useCallback } from 'react';

export type OnboardingStep = 
  | 'auto_content_viewed'       // User has seen the auto-generated content dialog
  | 'generate_content_explored' // User has clicked Generate Content Now button
  | 'content_library_visited'   // User has visited Content Library
  | 'brand_kit_visited';        // User has visited Brand Kit

const STORAGE_KEY = 'dvyb_onboarding_guide_progress';

interface OnboardingProgress {
  auto_content_viewed: boolean;
  generate_content_explored: boolean;
  content_library_visited: boolean;
  brand_kit_visited: boolean;
}

const defaultProgress: OnboardingProgress = {
  auto_content_viewed: false,
  generate_content_explored: false,
  content_library_visited: false,
  brand_kit_visited: false,
};

export function useOnboardingGuide() {
  const [progress, setProgress] = useState<OnboardingProgress>(defaultProgress);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load progress from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setProgress({ ...defaultProgress, ...parsed });
      }
    } catch (error) {
      console.error('Error loading onboarding progress:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save progress to localStorage whenever it changes
  const saveProgress = useCallback((newProgress: OnboardingProgress) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProgress));
      setProgress(newProgress);
    } catch (error) {
      console.error('Error saving onboarding progress:', error);
    }
  }, []);

  // Mark a step as completed
  const completeStep = useCallback((step: OnboardingStep) => {
    setProgress(current => {
      if (current[step]) return current; // Already completed
      const newProgress = { ...current, [step]: true };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProgress));
      return newProgress;
    });
  }, []);

  // Check if a step is completed
  const isStepCompleted = useCallback((step: OnboardingStep): boolean => {
    return progress[step];
  }, [progress]);

  // Determine which ring to show based on progress
  const getCurrentHighlight = useCallback((): 'generate_button' | 'content_library' | 'brand_kit' | null => {
    if (!isLoaded) return null;
    
    // Step 1: After auto content viewed, highlight Generate Content button
    if (progress.auto_content_viewed && !progress.generate_content_explored) {
      return 'generate_button';
    }
    
    // Step 2: After Generate Content explored, highlight Content Library
    if (progress.generate_content_explored && !progress.content_library_visited) {
      return 'content_library';
    }
    
    // Step 3: After Content Library visited, highlight Brand Kit
    if (progress.content_library_visited && !progress.brand_kit_visited) {
      return 'brand_kit';
    }
    
    return null;
  }, [progress, isLoaded]);

  // Reset all progress (for testing)
  const resetProgress = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProgress(defaultProgress);
  }, []);

  return {
    progress,
    isLoaded,
    completeStep,
    isStepCompleted,
    getCurrentHighlight,
    resetProgress,
  };
}

