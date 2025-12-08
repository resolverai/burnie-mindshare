import mixpanel from 'mixpanel-browser';

// Initialize Mixpanel
const MIXPANEL_TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

let isInitialized = false;
let eventQueue: Array<{ eventName: string; properties: Record<string, any> }> = [];

const processEventQueue = () => {
  console.log(`🔄 Processing ${eventQueue.length} queued events`);
  while (eventQueue.length > 0) {
    const { eventName, properties } = eventQueue.shift()!;
    trackEvent(eventName, properties);
  }
};

export const initMixpanel = () => {
  if (!MIXPANEL_TOKEN) {
    console.warn('Mixpanel token not configured');
    return;
  }

  if (isInitialized) return;

  try {
    mixpanel.init(MIXPANEL_TOKEN, {
      debug: process.env.NODE_ENV === 'development',
      track_pageview: false, // We'll handle page views manually/explicitly
      persistence: 'localStorage',
      loaded: () => {
        // Only set initialized to true when Mixpanel is actually loaded
        isInitialized = true;
        console.log('✅ Mixpanel initialized successfully');
        
        // Process any queued events
        processEventQueue();
      }
    });
  } catch (error) {
    console.error('❌ Mixpanel initialization failed:', error);
  }
};

// Identify user (call after login)
export const identifyUser = (userId: string | number, properties?: {
  email?: string;
  name?: string;
  accountName?: string;
  planName?: string;
  createdAt?: string;
}) => {
  if (!isInitialized) return;

  mixpanel.identify(String(userId));

  if (properties) {
    mixpanel.people.set({
      $email: properties.email,
      $name: properties.name || properties.accountName,
      accountName: properties.accountName,
      planName: properties.planName,
      createdAt: properties.createdAt,
    });
  }

  console.log('✅ Mixpanel user identified:', userId);
};

// Reset user (call on logout)
export const resetUser = () => {
  if (!isInitialized) return;
  mixpanel.reset();
  console.log('✅ Mixpanel user reset');
};

// Set super properties (attached to all events)
export const setSuperProperties = (properties: Record<string, any>) => {
  if (!isInitialized) return;
  mixpanel.register(properties);
};

// Helper to get device type
const getDeviceType = (): 'mobile' | 'desktop' => {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < 768 ? 'mobile' : 'desktop';
};

// Track event
export const trackEvent = (eventName: string, properties?: Record<string, any>) => {
  const eventProperties = {
    ...properties,
    deviceType: getDeviceType(),
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
  };

  if (!isInitialized) {
    // Queue the event if Mixpanel isn't ready yet
    console.log(`⏳ Queuing event (Mixpanel not ready): ${eventName}`);
    eventQueue.push({ eventName, properties: eventProperties });
    return;
  }

  try {
    mixpanel.track(eventName, eventProperties);
    console.log('📊 Mixpanel event tracked:', eventName, eventProperties);
  } catch (error) {
    console.error('❌ Mixpanel tracking failed:', error);
  }
};

// ============================================
// PREDEFINED TRACKING FUNCTIONS
// ============================================

// --- PAGE VIEWS ---
export const trackPageView = (pageName: string, additionalProps?: Record<string, any>) => {
  trackEvent('Page Viewed', {
    page: pageName,
    path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    ...additionalProps,
  });
};

// --- HOME SCREEN ---
export const trackHomeViewed = () => {
  trackPageView('Home');
};

export const trackGenerateContentClicked = (source: 'home' | 'content_library') => {
  trackEvent('Generate Content Clicked', { source });
};

export const trackTopPostClicked = (platform: string, postId?: string) => {
  trackEvent('Top Post Clicked', { platform, postId });
};

// --- CONTENT LIBRARY ---
export const trackContentLibraryViewed = () => {
  trackPageView('Content Library');
};

export const trackContentItemClicked = (contentId: string | number, contentType: 'image' | 'video', status: string) => {
  trackEvent('Content Item Clicked', { contentId, contentType, status });
};

export const trackContentFiltered = (filterType: string, filterValue: string) => {
  trackEvent('Content Filtered', { filterType, filterValue });
};

// --- GENERATE CONTENT DIALOG ---
export const trackGenerateDialogOpened = (source: 'home' | 'content_library' | 'onboarding') => {
  trackEvent('Generate Dialog Opened', { source });
};

export const trackGenerateDialogClosed = (step: string, reason: 'completed' | 'cancelled' | 'error') => {
  trackEvent('Generate Dialog Closed', { step, reason });
};

export const trackGenerateStepCompleted = (step: string, data?: Record<string, any>) => {
  trackEvent('Generate Step Completed', { step, ...data });
};

export const trackTopicSelected = (topic: string, isCustom: boolean) => {
  trackEvent('Topic Selected', { topic, isCustom });
};

export const trackPlatformsSelected = (platforms: string[]) => {
  trackEvent('Platforms Selected', { 
    platforms, 
    platformCount: platforms.length,
    hasTwitter: platforms.includes('twitter'),
    hasInstagram: platforms.includes('instagram'),
    hasLinkedin: platforms.includes('linkedin'),
    hasTiktok: platforms.includes('tiktok'),
  });
};

export const trackPostCountSelected = (count: number, imageCount: number, videoCount: number) => {
  trackEvent('Post Count Selected', { count, imageCount, videoCount });
};

export const trackGenerateStarted = (config: {
  topic: string;
  platforms: string[];
  postCount: number;
  imageCount: number;
  videoCount: number;
}) => {
  trackEvent('Content Generation Started', config);
};

export const trackGenerateCompleted = (config: {
  topic: string;
  platforms: string[];
  postCount: number;
  imageCount: number;
  videoCount: number;
  durationMs: number;
}) => {
  trackEvent('Content Generation Completed', config);
};

export const trackGenerateFailed = (error: string, step?: string) => {
  trackEvent('Content Generation Failed', { error, step });
};

// --- SCHEDULE DIALOG ---
export const trackScheduleDialogOpened = (source: 'content_library' | 'generate_dialog' | 'calendar', contentType?: string) => {
  trackEvent('Schedule Dialog Opened', { source, contentType });
};

export const trackScheduleDialogClosed = (reason: 'scheduled' | 'cancelled') => {
  trackEvent('Schedule Dialog Closed', { reason });
};

export const trackScheduleSubmitted = (data: {
  platform: string;
  contentType: 'image' | 'video';
  scheduledFor: string;
}) => {
  trackEvent('Schedule Submitted', data);
};

export const trackScheduleSuccess = (data: {
  platform: string;
  contentType: 'image' | 'video';
  scheduledFor: string;
}) => {
  trackEvent('Post Scheduled', data);
};

export const trackScheduleFailed = (error: string, platform?: string) => {
  trackEvent('Schedule Failed', { error, platform });
};

// --- POST NOW ---
export const trackPostNowClicked = (platform: string, contentType: 'image' | 'video') => {
  trackEvent('Post Now Clicked', { platform, contentType });
};

export const trackPostNowSuccess = (platform: string, contentType: 'image' | 'video') => {
  trackEvent('Post Now Success', { platform, contentType });
};

export const trackPostNowFailed = (error: string, platform: string, contentType: 'image' | 'video') => {
  trackEvent('Post Now Failed', { error, platform, contentType });
};

// --- OAUTH ---
export const trackOAuth2Started = (platform: string, flow: 'connect' | 'post_now' | 'schedule') => {
  trackEvent('OAuth2 Started', { platform, flow });
};

export const trackOAuth2Success = (platform: string, flow: 'connect' | 'post_now' | 'schedule') => {
  trackEvent('OAuth2 Success', { platform, flow });
};

export const trackOAuth2Failed = (platform: string, error: string, flow: 'connect' | 'post_now' | 'schedule') => {
  trackEvent('OAuth2 Failed', { platform, error, flow });
};

export const trackOAuth1Started = (flow: 'connect' | 'post_now' | 'schedule') => {
  trackEvent('OAuth1 Started', { platform: 'twitter', contentType: 'video', flow });
};

export const trackOAuth1Success = (flow: 'connect' | 'post_now' | 'schedule') => {
  trackEvent('OAuth1 Success', { platform: 'twitter', contentType: 'video', flow });
};

export const trackOAuth1Failed = (error: string, flow: 'connect' | 'post_now' | 'schedule') => {
  trackEvent('OAuth1 Failed', { platform: 'twitter', contentType: 'video', error, flow });
};

// --- PLATFORM CONNECTIONS (Home screen) ---
export const trackPlatformConnectClicked = (platform: string) => {
  trackEvent('Platform Connect Clicked', { platform });
};

export const trackPlatformConnected = (platform: string) => {
  trackEvent('Platform Connected', { platform });
};

export const trackPlatformDisconnected = (platform: string) => {
  trackEvent('Platform Disconnected', { platform });
};

// --- BRAND KIT ---
export const trackBrandKitViewed = () => {
  trackPageView('Brand Kit');
};

export const trackBrandKitTabViewed = (tab: string) => {
  trackEvent('Brand Kit Tab Viewed', { tab });
};

export const trackBrandKitSaved = (tab: string, fieldsUpdated?: string[]) => {
  trackEvent('Brand Kit Saved', { tab, fieldsUpdated, fieldCount: fieldsUpdated?.length });
};

// --- CALENDAR ---
export const trackCalendarViewed = () => {
  trackPageView('Calendar');
};

export const trackCalendarPostClicked = (postId: string, platform: string, date: string) => {
  trackEvent('Calendar Post Clicked', { postId, platform, date });
};

export const trackCalendarDateChanged = (view: 'month' | 'week', date: string) => {
  trackEvent('Calendar Date Changed', { view, date });
};

// --- ONBOARDING ---
export const trackOnboardingStarted = () => {
  trackEvent('Onboarding Started');
};

export const trackOnboardingStepCompleted = (step: string, data?: Record<string, any>) => {
  trackEvent('Onboarding Step Completed', { step, ...data });
};

export const trackOnboardingCompleted = () => {
  trackEvent('Onboarding Completed');
};

export const trackWebsiteAnalysisStarted = (url: string) => {
  trackEvent('Website Analysis Started', { url });
};

export const trackWebsiteAnalysisCompleted = (url: string, durationMs: number) => {
  trackEvent('Website Analysis Completed', { url, durationMs });
};

// --- USER ACTIONS ---
export const trackSignIn = (method: 'google') => {
  trackEvent('Sign In', { method });
};

export const trackSignOut = () => {
  trackEvent('Sign Out');
};

export const trackUpgradeDialogShown = (reason: 'limits_exhausted' | 'feature_locked') => {
  trackEvent('Upgrade Dialog Shown', { reason });
};

export const trackUpgradeRequestSubmitted = () => {
  trackEvent('Upgrade Request Submitted');
};

// --- CAPTION EDITING ---
export const trackCaptionEdited = (platform: string, contentType: 'image' | 'video') => {
  trackEvent('Caption Edited', { platform, contentType });
};

// --- LANDING PAGE ---
export const trackLandingPageViewed = (isAuthenticated: boolean) => {
  trackEvent('Landing Page Viewed', { isAuthenticated });
};

// --- ANALYSIS DETAILS PAGE ---
export const trackAnalysisDetailsViewed = (isAuthenticated: boolean) => {
  trackEvent('Analysis Details Viewed', { isAuthenticated });
};

export const trackAnalysisDetailsContinue = (isAuthenticated: boolean) => {
  trackEvent('Analysis Details Continue Clicked', { isAuthenticated });
};

// --- BRAND PROFILE PAGE ---
export const trackBrandProfileViewed = () => {
  trackPageView('Brand Profile');
};

export const trackBrandProfileProceedClicked = () => {
  trackEvent('Brand Profile Proceed Clicked');
};

export const trackAutoContentGenerationStarted = (config: {
  topic: string;
  platforms: string[];
  imageCount: number;
  videoCount: number;
}) => {
  trackEvent('Auto Content Generation Started', config);
};

// --- CONTENT GENERATION (additions) ---
export const trackAutoGenerateDialogOpened = () => {
  trackEvent('Auto Generate Dialog Opened', { source: 'onboarding' });
};

export const trackScheduleButtonClicked = (platform: string, contentType: 'image' | 'video') => {
  trackEvent('Schedule Button Clicked', { platform, contentType });
};

// --- CONTENT LIBRARY SEARCH ---
export const trackContentSearched = (searchQuery: string, resultsCount: number) => {
  trackEvent('Content Searched', { 
    searchQuery, 
    resultsCount,
    hasResults: resultsCount > 0,
  });
};

// --- BRAND KIT (additions) ---
export const trackBrandKitSaveAllClicked = (fieldsUpdated: string[]) => {
  trackEvent('Brand Kit Save All Clicked', { 
    fieldsUpdated, 
    fieldCount: fieldsUpdated.length,
  });
};

export default {
  init: initMixpanel,
  identify: identifyUser,
  reset: resetUser,
  track: trackEvent,
  setSuperProperties,
};

