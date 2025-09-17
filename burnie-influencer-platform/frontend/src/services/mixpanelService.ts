import mixpanel from 'mixpanel-browser';

class MixpanelService {
  private isInitialized = false;
  private projectToken: string;
  private eventQueue: Array<{eventName: string, properties: Record<string, any>}> = [];

  constructor() {
    this.projectToken = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN || '';
  }

  initialize(walletAddress?: string) {
    if (this.isInitialized || !this.projectToken) return;

    try {
      mixpanel.init(this.projectToken, {
        debug: process.env.NODE_ENV === 'development',
        track_pageview: false, // We'll handle page views manually
        persistence: 'localStorage',
        loaded: () => {
          // Only set initialized to true when Mixpanel is actually loaded
          this.isInitialized = true;
          console.log('✅ Mixpanel initialized successfully');
          
          // Identify user if wallet address is provided
          if (walletAddress) {
            this.identifyUser(walletAddress);
          }
          
          // Process any queued events
          this.processEventQueue();
        }
      });
    } catch (error) {
      console.error('❌ Mixpanel initialization failed:', error);
    }
  }

  identifyUser(walletAddress: string) {
    if (!this.isInitialized) return;

    try {
      const normalizedAddress = walletAddress.toLowerCase();
      
      mixpanel.identify(normalizedAddress);
      
      // Set user properties
      mixpanel.people.set({
        $wallet_address: normalizedAddress,
        $user_type: 'yapper',
        $signup_date: new Date().toISOString(),
        $total_content_purchased: 0,
        $total_spent_roast: 0,
        $total_spent_usdc: 0,
        $last_active: new Date().toISOString(),
        $twitter_connected: false,
        $referral_code: null
      });

      console.log('✅ User identified:', normalizedAddress);
    } catch (error) {
      console.error('❌ User identification failed:', error);
    }
  }

  private getDeviceType(): 'mobile' | 'desktop' {
    if (typeof window === 'undefined') return 'desktop';
    return window.innerWidth < 768 ? 'mobile' : 'desktop';
  }

  private processEventQueue() {
    console.log(`🔄 Processing ${this.eventQueue.length} queued events`);
    while (this.eventQueue.length > 0) {
      const { eventName, properties } = this.eventQueue.shift()!;
      this.track(eventName, properties);
    }
  }

  private track(eventName: string, properties: Record<string, any> = {}) {
    if (!this.isInitialized) {
      // Queue the event if Mixpanel isn't ready yet
      console.log(`⏳ Queuing event (Mixpanel not ready): ${eventName}`);
      this.eventQueue.push({ eventName, properties });
      return;
    }

    try {
      const eventProperties = {
        ...properties,
        deviceType: this.getDeviceType(),
        timestamp: new Date().toISOString()
      };

      mixpanel.track(eventName, eventProperties);
      console.log('📊 Mixpanel event tracked:', eventName, eventProperties);
    } catch (error) {
      console.error('❌ Mixpanel tracking failed:', error);
    }
  }

  // Authentication Events
  walletConnected(properties: {
    walletType: string;
    walletAddress: string;
    connectionMethod: 'manual' | 'auto';
    previousConnection: boolean;
    chainId: number;
  }) {
    this.track('walletConnected', properties);
  }

  userAuthenticated(properties: {
    authenticationMethod: string;
    signatureTime: number;
    isFirstTime: boolean;
    referralCode?: string;
  }) {
    this.track('userAuthenticated', properties);
  }

  marketplaceAccessGranted(properties: {
    accessMethod: 'direct_approval' | 'referral_code' | 'waitlist_approval';
    referralCode?: string;
    waitlistPosition?: number;
  }) {
    this.track('marketplaceAccessGranted', properties);
  }

  // Content Discovery Events (BiddingInterface)
  marketplaceViewed(properties: {
    screenName: 'Homepage' | 'Marketplace';
    userAuthenticated?: boolean;
  }) {
    this.track('marketplaceViewed', properties);
  }

  contentItemViewed(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    campaignId: number;
    contentPrice: number;
    contentMindshare: number;
    contentQuality: number;
    campaignTitle: string;
    platformSource: string;
    projectName: string;
    screenName: 'Homepage' | 'Marketplace';
    marketplaceType?: 'authenticated' | 'unauthenticated';
    userAuthenticated?: boolean;
  }) {
    this.track('contentItemViewed', properties);
  }

  contentSearchPerformed(properties: {
    searchQuery: string;
    resultsCount: number;
    searchTime: number;
    screenName: 'Homepage' | 'Marketplace';
    marketplaceType?: 'authenticated' | 'unauthenticated';
    userAuthenticated?: boolean;
  }) {
    this.track('contentSearchPerformed', properties);
  }

  contentFilterApplied(properties: {
    filterType: 'platform' | 'project' | 'postType';
    filterValue: string;
    resultsCount: number;
    previousFilterValue: string;
    screenName: 'Homepage' | 'Marketplace';
    marketplaceType?: 'authenticated' | 'unauthenticated';
    userAuthenticated?: boolean;
  }) {
    this.track('contentFilterApplied', properties);
  }

  // Dashboard Events
  analyticsDashboardViewed(properties: {
    screenName: 'AnalyticsDashboard';
  }) {
    this.track('analyticsDashboardViewed', properties);
  }

  // Purchase Flow Events (PurchaseContentModal)
  purchaseModalOpened(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    contentPrice: number;
    campaignId: number;
    modalSource: 'marketplace' | 'homepage' | 'myContent';
    userBalance: number;
    userUSDCBalance: number;
    screenName: 'PurchaseContentModal';
    userAuthenticated?: boolean;
  }) {
    this.track('purchaseModalOpened', properties);
  }

  // Combined event for content item click (replaces contentItemViewed + purchaseModalOpened)
  contentItemClicked(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    campaignId: number;
    contentPrice: number;
    contentMindshare: number;
    contentQuality: number;
    campaignTitle: string;
    platformSource: string;
    projectName: string;
    screenName: 'Homepage' | 'Marketplace';
    marketplaceType: 'authenticated' | 'unauthenticated';
    userROASTBalance: number;
    userUSDCBalance: number;
    userAuthenticated?: boolean;
  }) {
    this.track('contentItemClicked', properties);
  }

  currencyToggleClicked(properties: {
    contentId: number;
    selectedCurrency: 'ROAST' | 'USDC';
    roastPrice: number;
    usdcPrice: number;
    conversionRate: number;
    screenName: 'PurchaseContentModal';
  }) {
    this.track('currencyToggleClicked', properties);
  }

  purchaseInitiated(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    selectedCurrency: 'ROAST' | 'USDC';
    purchasePrice: number;
    campaignId: number;
    userBalance: number;
    purchaseMethod: string;
    screenName: 'PurchaseContentModal';
  }) {
    this.track('purchaseInitiated', properties);
  }

  purchaseCompleted(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    purchasePrice: number;
    selectedCurrency: 'ROAST' | 'USDC';
    campaignId: number;
    transactionHash: string;
    purchaseTime: number;
    userTotalPurchases: number;
    userTotalSpent: number;
    screenName: 'PurchaseContentModal';
  }) {
    this.track('purchaseCompleted', properties);

    // Update user properties
    if (this.isInitialized) {
      const increment = properties.selectedCurrency === 'ROAST' ? 
        { $total_spent_roast: properties.purchasePrice } : 
        { $total_spent_usdc: properties.purchasePrice };

      mixpanel.people.increment({
        $total_content_purchased: 1,
        ...increment,
        $last_active: new Date().toISOString()
      });
    }
  }

  purchaseFailed(properties: {
    contentId: number;
    failureReason: string;
    errorMessage: string;
    selectedCurrency: 'ROAST' | 'USDC';
    retryAttempted: boolean;
    screenName: 'PurchaseContentModal';
  }) {
    this.track('purchaseFailed', properties);
  }

  purchaseCancelled(properties: {
    contentId: number;
    cancellationStage: string;
    timeInFlow: number;
    selectedCurrency: 'ROAST' | 'USDC';
    screenName: 'PurchaseContentModal';
  }) {
    this.track('purchaseCancelled', properties);
  }

  chooseYapperContentGenerated(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    campaignId: number;
    generationTime: number;
    generatedContentLength: number;
    screenName: 'PurchaseContentModal';
  }) {
    this.track('chooseYapperContentGenerated', properties);
  }

  myVoiceContentGenerated(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    campaignId: number;
    generationTime: number;
    generatedContentLength: number;
    screenName: 'PurchaseContentModal';
  }) {
    this.track('myVoiceContentGenerated', properties);
  }

  // Content Management Events (YapperMyContent)
  myContentViewed(properties: {
    screenName: 'YapperMyContent';
  }) {
    this.track('myContentViewed', properties);
  }

  contentPreviewOpened(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    campaignId: number;
    acquisitionType: 'bid' | 'purchase';
    purchasePrice: number;
    currency: 'ROAST' | 'USDC';
    screenName: 'YapperMyContent';
  }) {
    this.track('contentPreviewOpened', properties);
  }

  contentDownloaded(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    downloadFormat: 'image' | 'text' | 'both';
    campaignId: number;
    screenName: 'YapperMyContent';
  }) {
    this.track('contentDownloaded', properties);
  }

  myContentSearchPerformed(properties: {
    searchQuery: string;
    resultsCount: number;
    searchTime: number;
    screenName: 'YapperMyContent';
  }) {
    this.track('myContentSearchPerformed', properties);
  }

  myContentFilterApplied(properties: {
    filterType: 'platform' | 'project' | 'postType';
    filterValue: string;
    resultsCount: number;
    screenName: 'YapperMyContent';
  }) {
    this.track('myContentFilterApplied', properties);
  }

  // Twitter Integration Events (TweetPreviewModal)
  tweetPreviewOpened(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    previewSource: 'myContent' | 'marketplace';
    contentPrice: number;
    acquisitionType: 'bid' | 'purchase';
    currency: 'ROAST' | 'USDC';
    screenName: 'TweetPreviewModal';
  }) {
    this.track('tweetPreviewOpened', properties);
  }

  twitterConnectClicked(properties: {
    contentId: number;
    connectSource: string;
    screenName: 'TweetPreviewModal';
  }) {
    this.track('twitterConnectClicked', properties);
  }

  twitterConnected(properties: {
    twitterUsername: string;
    connectTime: number;
    connectSource: string;
    screenName: 'TweetPreviewModal';
  }) {
    this.track('twitterConnected', properties);

    // Update user properties
    if (this.isInitialized) {
      mixpanel.people.set({
        $twitter_connected: true,
        $twitter_username: properties.twitterUsername,
        $last_active: new Date().toISOString()
      });
    }
  }

  tweetPosted(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    tweetUrl: string;
    postTime?: number;
    tweetLength?: number;
    hasImage?: boolean;
    hasThread?: boolean;
    postingMethod?: 'direct' | 'manual';
    screenName: 'TweetPreviewModal' | 'PurchaseContentModal';
  }) {
    this.track('tweetPosted', properties);
  }

  tweetPostFailed(properties: {
    contentId: number;
    failureReason?: string;
    errorMessage: string;
    retryAttempted?: boolean;
    postingMethod?: 'direct' | 'manual';
    screenName: 'TweetPreviewModal' | 'PurchaseContentModal';
  }) {
    this.track('tweetPostFailed', properties);
  }

  tweetContentCopied(properties: {
    contentId: number;
    contentType: 'text' | 'visual';
    copyFormat: 'text_only' | 'with_image_url';
    screenName: 'TweetPreviewModal';
  }) {
    this.track('tweetContentCopied', properties);
  }

  postingMethodToggled(properties: {
    contentId: number;
    selectedMethod: 'twitter' | 'manual';
    previousMethod: 'twitter' | 'manual';
    screenName: 'TweetPreviewModal';
  }) {
    this.track('postingMethodToggled', properties);
  }

  voiceToneSelected(properties: {
    contentId: number;
    selectedTone: 'auto' | 'custom' | 'mystyle';
    previousTone: 'auto' | 'custom' | 'mystyle';
    screenName: 'PurchaseContentModal';
  }) {
    this.track('voiceToneSelected', properties);
  }

  walletDisconnected(properties: {
    disconnectSource: 'headerBar' | 'sidebar';
    currentPage: string;
    deviceType: 'mobile' | 'desktop' | 'tablet';
    screenName: 'HeaderBar' | 'Sidebar';
  }) {
    this.track('walletDisconnected', properties);
  }

  walletConnectClicked(properties: {
    connectSource: 'headerBar' | 'purchaseModal' | 'dashboard';
    currentPage: string;
    deviceType: 'mobile' | 'desktop' | 'tablet';
    screenName: 'HeaderBar' | 'PurchaseContentModal' | 'Dashboard';
    contentId?: number; // Optional, only for purchase modal
  }) {
    this.track('walletConnectClicked', properties);
  }

  // Navigation Events

  mobileBottomNavClicked(properties: {
    destinationPage: string;
    currentPage: string;
    userAuthenticated: boolean;
    deviceType: 'mobile';
  }) {
    this.track('mobileBottomNavClicked', properties);
  }

  referralCodeCopied(properties: {
    referralCode: string;
    copySource: string;
    copySuccess: boolean;
    deviceType: 'mobile' | 'desktop';
  }) {
    this.track('referralCodeCopied', properties);
  }

  // Error Events
  errorOccurred(properties: {
    errorType: string;
    errorMessage: string;
    errorPage: string;
    userAuthenticated: boolean;
    errorSeverity: 'low' | 'medium' | 'high';
    deviceType: 'mobile' | 'desktop';
  }) {
    this.track('errorOccurred', properties);
  }

  apiError(properties: {
    apiEndpoint: string;
    errorCode: number;
    errorMessage: string;
    retryAttempted: boolean;
    requestType: string;
    deviceType: 'mobile' | 'desktop';
  }) {
    this.track('apiError', properties);
  }

  // Text Editing Events
  tweetEditStarted(properties: {
    contentId: number;
    postType: string;
    editType: 'main_tweet' | 'thread_item';
    screenName: string;
  }) {
    this.track('tweetEditStarted', properties);
  }

  tweetEditSaved(properties: {
    contentId: number;
    postType: string;
    editType: 'main_tweet' | 'thread_item';
    characterCount: number;
    maxLength: number;
    threadLength?: number;
    screenName: string;
  }) {
    this.track('tweetEditSaved', properties);
  }

  tweetEditCancelled(properties: {
    contentId: number;
    postType: string;
    editType: 'main_tweet' | 'thread_item';
    screenName: string;
  }) {
    this.track('tweetEditCancelled', properties);
  }

  threadItemAdded(properties: {
    contentId: number;
    postType: string;
    threadLength: number;
    screenName: string;
  }) {
    this.track('threadItemAdded', properties);
  }

  threadItemRemoved(properties: {
    contentId: number;
    postType: string;
    threadLength: number;
    screenName: string;
  }) {
    this.track('threadItemRemoved', properties);
  }
}

// Create singleton instance
const mixpanelService = new MixpanelService();

export default mixpanelService;
