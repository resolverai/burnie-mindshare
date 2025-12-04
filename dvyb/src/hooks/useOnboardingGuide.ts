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
      console.log('🔍 Onboarding Guide - Loading from localStorage:', stored);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('🔍 Onboarding Guide - Parsed progress:', parsed);
        setProgress({ ...defaultProgress, ...parsed });
      } else {
        console.log('🔍 Onboarding Guide - No stored progress found');
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
    console.log('🔍 Onboarding Guide - getCurrentHighlight called', {
      isLoaded,
      progress,
      auto_content_viewed: progress.auto_content_viewed,
      generate_content_explored: progress.generate_content_explored,
      content_library_visited: progress.content_library_visited,
      brand_kit_visited: progress.brand_kit_visited
    });
    
    if (!isLoaded) {
      console.log('🔍 Not loaded yet, returning null');
      return null;
    }
    
    // Step 1: After auto content viewed, highlight Generate Content button
    if (progress.auto_content_viewed && !progress.generate_content_explored) {
      console.log('🔍 Returning generate_button highlight');
      return 'generate_button';
    }
    
    // Step 2: After Generate Content explored, highlight Content Library
    if (progress.generate_content_explored && !progress.content_library_visited) {
      console.log('🔍 Returning content_library highlight');
      return 'content_library';
    }
    
    // Step 3: After Content Library visited, highlight Brand Kit
    if (progress.content_library_visited && !progress.brand_kit_visited) {
      console.log('🔍 Returning brand_kit highlight');
      return 'brand_kit';
    }
    
    console.log('🔍 No highlight to show');
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

