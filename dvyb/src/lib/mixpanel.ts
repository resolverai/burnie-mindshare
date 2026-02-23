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
    const userProperties: Record<string, any> = {};
    
    // Standard Mixpanel user properties
    if (properties.email) {
      userProperties.$email = properties.email;
    }
    if (properties.name) {
      userProperties.$name = properties.name;
    }
    
    // Custom properties
    if (properties.accountName) {
      userProperties.brand = properties.accountName; // Brand/company name
      // Also set as $name if name wasn't provided
      if (!properties.name) {
        userProperties.$name = properties.accountName;
      }
    }
    if (properties.planName) {
      userProperties.planName = properties.planName;
    }
    if (properties.createdAt) {
      userProperties.createdAt = properties.createdAt;
    }
    
    // Only call people.set if we have properties to set
    if (Object.keys(userProperties).length > 0) {
      mixpanel.people.set(userProperties);
    }
  }

  console.log('✅ Mixpanel user identified:', userId, properties);
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

export const trackWebsiteAnalysisStarted = (websiteUrl: string, extra?: { copy?: OnboardingCopyType }) => {
  trackEvent('Website Analysis Started', { websiteUrl, ...extra });
};

export const trackWebsiteAnalysisCompleted = (websiteUrl: string, durationMs: number, extra?: { copy?: OnboardingCopyType }) => {
  trackEvent('Website Analysis Completed', { websiteUrl, durationMs, ...extra });
};

// --- USER ACTIONS ---
export const trackSignInClicked = (
  method: 'google',
  source: 'landing_page' | 'login_page' | 'onboarding_modal',
  extra?: { copy?: OnboardingCopyType }
) => {
  trackEvent('Sign In Clicked', { method, source, ...extra });
};

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

// --- SUBSCRIPTION / PRICING EVENTS ---
export const trackPricingModalOpened = (reason: 'limit_exceeded' | 'user_initiated', quotaType?: 'image' | 'video' | 'both') => {
  trackEvent('Pricing Modal Opened', { reason, quotaType });
};

export const trackPlanUpgradeClicked = (data: {
  currentPlan: string;
  targetPlan: string;
  currentBillingCycle: string;
  targetBillingCycle: string;
  currentPrice: number;
  targetPrice: number;
}) => {
  trackEvent('Plan Upgrade Clicked', data);
};

export const trackPlanDowngradeClicked = (data: {
  currentPlan: string;
  targetPlan: string;
  currentBillingCycle: string;
  targetBillingCycle: string;
  currentPrice: number;
  targetPrice: number;
}) => {
  trackEvent('Plan Downgrade Clicked', data);
};

export const trackBillingCycleSwitchClicked = (data: {
  planName: string;
  fromCycle: 'monthly' | 'annual';
  toCycle: 'monthly' | 'annual';
  fromPrice: number;
  toPrice: number;
}) => {
  trackEvent('Billing Cycle Switch Clicked', data);
};

export const trackPlanChangeSuccess = (data: {
  action: 'upgrade' | 'downgrade' | 'switch_to_annual' | 'switch_to_monthly' | 'checkout';
  planName: string;
  billingCycle: string;
  price: number;
}) => {
  trackEvent('Plan Change Success', data);
};

export const trackPlanChangeFailed = (data: {
  action: 'upgrade' | 'downgrade' | 'switch_to_annual' | 'switch_to_monthly' | 'checkout';
  planName: string;
  billingCycle: string;
  error: string;
}) => {
  trackEvent('Plan Change Failed', data);
};

export const trackCheckoutStarted = (data: {
  planName: string;
  billingCycle: string;
  price: number;
  hasPromoCode: boolean;
}) => {
  trackEvent('Checkout Started', data);
};

// --- CAPTION EDITING ---
export const trackCaptionEdited = (platform: string, contentType: 'image' | 'video') => {
  trackEvent('Caption Edited', { platform, contentType });
};

// --- CONTENT ITEM ACTIONS (Edit/Download) ---
export const trackContentEditClicked = (data: {
  source: 'generate_dialog' | 'content_library';
  contentType: 'image' | 'video';
  contentId?: string | number;
  postIndex?: number;
}) => {
  trackEvent('Content Edit Clicked', data);
};

export const trackContentDownloadClicked = (data: {
  source: 'generate_dialog' | 'content_library';
  contentType: 'image' | 'video';
  contentId?: string | number;
  postIndex?: number;
}) => {
  trackEvent('Content Download Clicked', data);
};

// --- LANDING PAGE ---
export type OnboardingCopyType = 'A' | 'B';

export const trackLandingPageViewed = (
  isAuthenticated: boolean,
  extra?: { copy?: OnboardingCopyType; hero_main_message?: string }
) => {
  trackEvent('Landing Page Viewed', { isAuthenticated, ...extra });
};

// --- COPY A / B ONBOARDING FLOW ---
export const trackOnboardingFlowStepViewed = (
  copy: OnboardingCopyType,
  step: string,
  extra?: Record<string, any>
) => {
  trackEvent('Onboarding Flow Step Viewed', { copy, step, ...extra });
};

export const trackOnboardingFlowCompleted = (
  copy: OnboardingCopyType,
  extra?: { source?: 'generate_dialog' | 'explore_more' }
) => {
  trackEvent('Onboarding Flow Completed', { copy, ...extra });
};

export const trackDiscoverScreenViewedFromOnboarding = (copy: OnboardingCopyType) => {
  trackEvent('Discover Screen Viewed From Onboarding', { copy });
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

// --- CONTENT STRATEGY / QUESTIONNAIRE ---
export const trackStrategyQuestionnaireStarted = () => {
  trackEvent('Strategy Questionnaire Started');
};

export const trackStrategyQuestionAnswered = (questionId: string, answer: any) => {
  trackEvent('Strategy Question Answered', { 
    questionId, 
    answer: typeof answer === 'object' ? JSON.stringify(answer) : answer,
  });
};

export const trackStrategyQuestionnaireCompleted = (preferences: Record<string, any>) => {
  trackEvent('Strategy Questionnaire Completed', {
    goal: preferences.goal,
    platforms: preferences.platforms,
    platformCount: preferences.platforms?.length || 0,
    postingFrequency: preferences.postingFrequency,
    biggestChallenge: preferences.biggestChallenge,
    hasFollowerData: Object.keys(preferences.platformFollowers || {}).length > 0,
  });
};

export const trackStrategyGenerated = (data: {
  itemCount: number;
  strategyMonth: string;
}) => {
  trackEvent('Content Strategy Generated', data);
};

// --- CALENDAR / STRATEGY VIEW ---
export const trackStrategyCalendarViewed = (month: string) => {
  trackEvent('Strategy Calendar Viewed', { month });
};

export const trackStrategyItemClicked = (data: {
  itemId: number;
  platform: string;
  contentType: string;
  date: string;
}) => {
  trackEvent('Strategy Item Clicked', data);
};

export const trackStrategyItemDeleted = (data: {
  itemId: number;
  platform: string;
  date: string;
}) => {
  trackEvent('Strategy Item Deleted', data);
};

export const trackStrategyMonthChanged = (data: {
  fromMonth: string;
  toMonth: string;
  direction: 'prev' | 'next';
}) => {
  trackEvent('Strategy Month Changed', data);
};

// --- CONTENT REVIEW (SWIPE/LIKE/REJECT) ---
export const trackContentAccepted = (data: {
  contentId?: number;
  postIndex: number;
  platform: string;
  contentType: 'image' | 'video';
  method: 'swipe' | 'click';
  source: 'generate_dialog' | 'post_detail_dialog' | 'content_library';
}) => {
  trackEvent('Content Accepted', data);
};

export const trackContentRejected = (data: {
  contentId?: number;
  postIndex: number;
  platform: string;
  contentType: 'image' | 'video';
  method: 'swipe' | 'click';
  source: 'generate_dialog' | 'post_detail_dialog' | 'content_library';
}) => {
  trackEvent('Content Rejected', data);
};

export const trackContentReviewCompleted = (data: {
  totalPosts: number;
  acceptedCount: number;
  rejectedCount: number;
  source: 'generate_dialog' | 'post_detail_dialog';
}) => {
  trackEvent('Content Review Completed', data);
};

// --- INSPIRATION SELECTION ---
export const trackInspirationPageViewed = (data: {
  industry: string;
  inspirationCount: number;
}) => {
  trackEvent('Inspiration Page Viewed', data);
};

export const trackInspirationSelected = (data: {
  inspirationId: number;
  platform: string;
  category: string;
}) => {
  trackEvent('Inspiration Selected', data);
};

// --- UNIFIED ONBOARDING MODAL ---
export const trackOnboardingProductsFetched = (data: { productCount: number; source: 'domain' | 'upload' }) => {
  trackEvent('Onboarding Products Fetched', data);
};

export const trackOnboardingProductChosen = (data: { productIds: number[]; count: number }) => {
  trackEvent('Onboarding Product Chosen', data);
};

export const trackOnboardingRelevantAdsFetched = (data: { adCount: number; websiteUrl?: string }) => {
  trackEvent('Onboarding Relevant Ads Fetched', data);
};

export const trackCreateAdFlowRelevantAdsFetched = (data: { adCount: number; hasProductImage?: boolean }) => {
  trackEvent('Create Ad Flow Relevant Ads Fetched', data);
};

export const trackOnboardingInspirationSelected = (data: { adIds: number[]; count: number }) => {
  trackEvent('Onboarding Inspiration Selected', data);
};

export const trackExploreMoreFeaturesClicked = (
  source: 'generate_dialog_onboarding' | 'pricing_modal',
  extra?: { copy?: OnboardingCopyType }
) => {
  trackEvent('Explore More Features Clicked', { source, ...extra });
};

export const trackStartNowClicked = (data: {
  planName: string;
  billingCycle: 'monthly' | 'annual';
  source: 'onboarding_pricing_modal' | 'pricing_page';
}) => {
  trackEvent('Start Now Clicked', data);
};

// --- SUBSCRIPTION PAGE ---
export const trackSubscriptionPageViewed = (data: {
  planName: string;
  billingCycle: 'monthly' | 'annual';
  isFreePlan: boolean;
  hasActiveSubscription: boolean;
}) => {
  trackEvent('Subscription Page Viewed', data);
};

export const trackCancelSubscriptionClicked = (data: {
  planName: string;
  billingCycle: 'monthly' | 'annual';
}) => {
  trackEvent('Cancel Subscription Clicked', data);
};

export const trackCancelSubscriptionConfirmed = (data: {
  planName: string;
  billingCycle: 'monthly' | 'annual';
}) => {
  trackEvent('Cancel Subscription Confirmed', data);
};

export const trackResumeSubscriptionClicked = (data: {
  planName: string;
  billingCycle: 'monthly' | 'annual';
}) => {
  trackEvent('Resume Subscription Clicked', data);
};

export const trackCancelBillingCycleSwitchClicked = (data: {
  planName: string;
  currentCycle: 'monthly' | 'annual';
  pendingCycle: 'monthly' | 'annual';
}) => {
  trackEvent('Cancel Billing Cycle Switch Clicked', data);
};

export const trackViewInvoiceClicked = (data: {
  amount: number;
  paymentType: string;
}) => {
  trackEvent('View Invoice Clicked', data);
};

export const trackChangePlanClicked = (data: {
  currentPlan: string;
  currentCycle: 'monthly' | 'annual';
  source: 'subscription_page' | 'pricing_modal' | 'upgrade_prompt';
}) => {
  trackEvent('Change Plan Clicked', data);
};

// ============================================
// FLOW 2: PRODUCT SHOT FLOW EVENTS
// ============================================

export const trackProductShotLandingViewed = () => {
  trackEvent('Product Shot Landing Viewed', { flow: 'product_shot' });
};

export const trackProductShotGetStartedClicked = () => {
  trackEvent('Product Shot Get Started Clicked', { flow: 'product_shot' });
};

export const trackProductShotUploadViewed = () => {
  trackEvent('Product Shot Upload Viewed', { flow: 'product_shot' });
};

export const trackProductShotUploaded = (data: {
  fileType: string;
  fileSizeMB: number;
}) => {
  trackEvent('Product Shot Uploaded', { flow: 'product_shot', ...data });
};

export const trackProductShotGenerationStarted = (data: {
  isAuthenticated: boolean;
  imageCount: number;
}) => {
  trackEvent('Product Shot Generation Started', { flow: 'product_shot', ...data });
};

export const trackProductShotGenerationCompleted = (data: {
  imageCount: number;
  durationMs?: number;
}) => {
  trackEvent('Product Shot Generation Completed', { flow: 'product_shot', ...data });
};

export const trackProductShotSignupClicked = () => {
  trackEvent('Product Shot Signup Clicked', { flow: 'product_shot' });
};

export const trackProductShotGenerateMoreClicked = (data: {
  imageCount: number;
  isPaidCustomer: boolean;
}) => {
  trackEvent('Product Shot Generate More Clicked', { flow: 'product_shot', ...data });
};

export const trackProductShotPricingShown = () => {
  trackEvent('Product Shot Pricing Shown', { flow: 'product_shot' });
};

export const trackProductShotFlowCompleted = (data: {
  totalImagesGenerated: number;
  signedUp: boolean;
}) => {
  trackEvent('Product Shot Flow Completed', { flow: 'product_shot', ...data });
};

// ============================================
// WANDERLUST APP - UNIFIED TRACKING
// ============================================

// --- DISCOVER ---
export const trackDiscoverViewed = () => {
  trackPageView('Discover');
};

export const trackDiscoverSearch = (searchTerm: string, resultsCount?: number) => {
  trackEvent('Discover Search', { searchTerm, resultsCount, resultsCountDefined: resultsCount !== undefined });
};

export const trackDiscoverFilterApplied = (filterName: string, filterValue: string) => {
  trackEvent('Discover Filter Applied', { filterName, filterValue });
};

export const trackDiscoverSortChanged = (sortBy: string) => {
  trackEvent('Discover Sort Changed', { sortBy });
};

export const trackDiscoverCreateMyOwnAdClicked = () => {
  trackEvent('Discover Create My Own Ad Clicked');
};

export const trackDiscoverAdCardClicked = (adId: number, brandName: string) => {
  trackEvent('Discover Ad Card Clicked', { adId, brandName });
};

export const trackCreateAdUsingTemplateClicked = (data: {
  source: 'discover_card' | 'ad_detail_modal';
  adId: number;
  brandName: string;
  isVideo: boolean;
}) => {
  trackEvent('Create Ad Using Template Clicked', data);
};

// --- BRANDS ---
export const trackBrandsViewed = () => {
  trackPageView('Brands');
};

export const trackBrandsSearch = (searchTerm: string, resultsCount?: number) => {
  trackEvent('Brands Search', { searchTerm, resultsCount, resultsCountDefined: resultsCount !== undefined });
};

export const trackBrandsFilterApplied = (filterName: string, filterValue: string) => {
  trackEvent('Brands Filter Applied', { filterName, filterValue });
};

export const trackBrandsTabSwitched = (tab: 'all' | 'following') => {
  trackEvent('Brands Tab Switched', { tab });
};

export const trackBrandsRequestBrandClicked = () => {
  trackEvent('Brands Request Brand Clicked');
};

export const trackBrandsFollowClicked = (brandId: number, brandName: string, isFollow: boolean) => {
  trackEvent('Brands Follow Clicked', { brandId, brandName, action: isFollow ? 'follow' : 'unfollow' });
};

// --- MY CONTENT ---
export const trackMyContentViewed = (tab: 'my-ads' | 'my-products' | 'saved-ads') => {
  trackPageView('My Content', { tab });
};

export const trackMyContentTabSwitched = (tab: 'my-ads' | 'my-products' | 'saved-ads') => {
  trackEvent('My Content Tab Switched', { tab });
};

export const trackMyContentSearch = (searchTerm: string, tab: string, resultsCount?: number) => {
  trackEvent('My Content Search', { searchTerm, tab, resultsCount, resultsCountDefined: resultsCount !== undefined });
};

export const trackMyContentFilterApplied = (filterName: string, filterValue: string, tab: string) => {
  trackEvent('My Content Filter Applied', { filterName, filterValue, tab });
};

export const trackMyContentCreateNewClicked = () => {
  trackEvent('My Content Create New Clicked');
};

export const trackMyContentAddProductClicked = () => {
  trackEvent('My Content Add Product Clicked');
};

// --- BRAND KIT ---
export const trackBrandKitTabSwitched = (tab: 'style' | 'source-materials') => {
  trackEvent('Brand Kit Tab Switched', { tab });
};

// --- SETTINGS ---
export const trackSettingsViewed = (tab?: string) => {
  trackPageView('Settings', { tab });
};

export const trackSettingsTabSwitched = (tab: string) => {
  trackEvent('Settings Tab Switched', { tab });
};

// --- THEME ---
export const trackThemeChanged = (theme: 'light' | 'dark') => {
  trackEvent('Theme Changed', { theme });
};

// --- UPGRADE ---
export const trackUpgradeButtonClicked = (source: 'sidebar' | 'mobile_header' | 'pricing_modal' | 'limits_modal' | 'trial_limit' | 'other') => {
  trackEvent('Upgrade Button Clicked', { source });
};

// --- LIMITS ---
export const trackLimitsReached = (context: string, quotaType?: 'image' | 'video' | 'both') => {
  trackEvent('Limits Reached', { context, quotaType });
};

// --- TUTORIAL ---
export const trackTutorialButtonClicked = (screen: string) => {
  trackEvent('Tutorial Button Clicked', { screen });
};

export default {
  init: initMixpanel,
  identify: identifyUser,
  reset: resetUser,
  track: trackEvent,
  setSuperProperties,
};

