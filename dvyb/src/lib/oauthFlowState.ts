/**
 * OAuth Flow State Management for Post Now and Schedule flows
 * 
 * This module handles saving and restoring OAuth flow state across page redirects.
 * When a user needs to authorize a platform, we save the current state,
 * redirect to OAuth, and resume the flow when they return.
 */

export interface OAuthFlowState {
  type: 'post_now' | 'schedule';
  source: 'generate_dialog' | 'schedule_dialog' | 'content_library';
  
  // Post data
  post: {
    id?: string;
    type: string;
    image: string;
    description: string;
    requestedPlatforms: string[];
    platforms: string[];
    platformTexts?: any;
    fullPlatformTexts?: any;
    postIndex?: number;
    generatedContentId?: number | null;
  };
  
  // Auth flow state
  platformsToAuth: string[];
  currentPlatformIndex: number;
  needsOAuth1: boolean;
  oauth1Completed: boolean;
  
  // For schedule flow
  scheduledDateTime?: string;
  selectedTime?: string;
  
  // For generate dialog
  generatedPosts?: any[];
  generatedContentId?: number | null;
  generationUuid?: string | null;
  
  // Timestamp for expiry
  timestamp: number;
}

const STORAGE_KEY = 'dvyb_oauth_post_flow';
const EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes

/**
 * Save OAuth flow state before redirecting
 */
export function saveOAuthFlowState(state: Omit<OAuthFlowState, 'timestamp'>): void {
  const stateWithTimestamp: OAuthFlowState = {
    ...state,
    timestamp: Date.now(),
  };
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stateWithTimestamp));
  console.log('💾 Saved OAuth flow state:', stateWithTimestamp);
}

/**
 * Get saved OAuth flow state (returns null if expired or not found)
 */
export function getOAuthFlowState(): OAuthFlowState | null {
  try {
    const stateStr = localStorage.getItem(STORAGE_KEY);
    if (!stateStr) return null;
    
    const state: OAuthFlowState = JSON.parse(stateStr);
    
    // Check expiry
    if (Date.now() - state.timestamp > EXPIRY_TIME) {
      console.log('⏰ OAuth flow state expired, clearing');
      clearOAuthFlowState();
      return null;
    }
    
    console.log('📖 Retrieved OAuth flow state:', state);
    return state;
  } catch (error) {
    console.error('Error parsing OAuth flow state:', error);
    clearOAuthFlowState();
    return null;
  }
}

/**
 * Clear OAuth flow state
 */
export function clearOAuthFlowState(): void {
  localStorage.removeItem(STORAGE_KEY);
  console.log('🗑️ Cleared OAuth flow state');
}

/**
 * Update OAuth flow state (partial update)
 */
export function updateOAuthFlowState(updates: Partial<OAuthFlowState>): void {
  const currentState = getOAuthFlowState();
  if (!currentState) return;
  
  const updatedState: OAuthFlowState = {
    ...currentState,
    ...updates,
    timestamp: Date.now(), // Refresh timestamp
  };
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedState));
  console.log('📝 Updated OAuth flow state:', updates);
}

/**
 * Check if there's a pending OAuth flow that needs to be resumed
 */
export function hasPendingOAuthFlow(): boolean {
  return getOAuthFlowState() !== null;
}

/**
 * Get the return URL for OAuth callbacks
 */
export function getOAuthReturnUrl(): string {
  const state = getOAuthFlowState();
  if (!state) return '/home';
  
  // Always return to home - the dialog will auto-open
  return '/home';
}

/**
 * Mark the current platform as authorized and get the next step
 */
export function advanceOAuthFlow(): { 
  nextPlatform: string | null; 
  needsOAuth1: boolean;
  allComplete: boolean;
} {
  const state = getOAuthFlowState();
  if (!state) {
    return { nextPlatform: null, needsOAuth1: false, allComplete: true };
  }
  
  const nextIndex = state.currentPlatformIndex + 1;
  
  // Check if there are more platforms
  if (nextIndex < state.platformsToAuth.length) {
    updateOAuthFlowState({ currentPlatformIndex: nextIndex });
    return { 
      nextPlatform: state.platformsToAuth[nextIndex], 
      needsOAuth1: false,
      allComplete: false,
    };
  }
  
  // All OAuth2 platforms done - check OAuth1
  if (state.needsOAuth1 && !state.oauth1Completed) {
    return { 
      nextPlatform: null, 
      needsOAuth1: true,
      allComplete: false,
    };
  }
  
  // All done
  return { nextPlatform: null, needsOAuth1: false, allComplete: true };
}

