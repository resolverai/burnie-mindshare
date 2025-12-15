"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Instagram, Twitter, Linkedin, Menu, Pencil, Check } from "lucide-react";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";
import { PostViewDialog } from "@/components/pages/PostViewDialog";
import { PricingModal } from "@/components/PricingModal";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AppSidebar } from "@/components/AppSidebar";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { contextApi, analyticsApi, socialConnectionsApi, authApi, accountApi } from "@/lib/api";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useToast } from "@/hooks/use-toast";
import { TikTokIcon } from "@/components/icons/TikTokIcon";
import { useOnboardingGuide } from "@/hooks/useOnboardingGuide";
import { getOAuthFlowState, clearOAuthFlowState } from "@/lib/oauthFlowState";
import { 
  trackHomeViewed, 
  trackGenerateContentClicked, 
  trackTopPostClicked,
  trackPlatformConnectClicked,
  trackOAuth2Started,
} from "@/lib/mixpanel";

interface PlatformMetrics {
  impressions?: number;
  reach?: number;
  views?: number;
  engagement?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  retweets?: number;
  replies?: number;
  reactions?: number;
  clicks?: number;
  followers?: number;
}

interface PlatformPost {
  id: number;
  mediaUrl?: string;
  imageUrl?: string; // For Twitter images
  videoUrl?: string;
  coverImageUrl?: string;
  caption?: string;
  tweetText?: string;
  postText?: string;
  mediaType?: string; // 'image' or 'video'
}

interface PlatformAnalytics {
  metrics: PlatformMetrics;
  topPosts: PlatformPost[];
}

export const Home = () => {
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [quotaType, setQuotaType] = useState<'image' | 'video' | 'both'>('both');
  const [showInactiveAccountDialog, setShowInactiveAccountDialog] = useState(false);
  const [usageData, setUsageData] = useState<any>(null);
  const [canSkipPricingModal, setCanSkipPricingModal] = useState(false);
  const [activeView, setActiveView] = useState("home");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [accountName, setAccountName] = useState("User");
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempAccountName, setTempAccountName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDays, setSelectedDays] = useState<"7" | "30">("30");
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<"instagram" | "twitter" | "linkedin" | "tiktok">("instagram");
  const [showPostView, setShowPostView] = useState(false);
  
  const [instagramData, setInstagramData] = useState<PlatformAnalytics | null>(null);
  const [twitterData, setTwitterData] = useState<PlatformAnalytics | null>(null);
  const [tiktokData, setTiktokData] = useState<PlatformAnalytics | null>(null);
  const [linkedinData, setLinkedinData] = useState<PlatformAnalytics | null>(null);
  const [growthMetrics, setGrowthMetrics] = useState<any>(null);

  // Connection status for each platform
  const [connectionStatus, setConnectionStatus] = useState<{
    instagram: 'connected' | 'expired' | 'not_connected';
    linkedin: 'connected' | 'expired' | 'not_connected';
    tiktok: 'connected' | 'expired' | 'not_connected';
    twitter: 'connected' | 'expired' | 'not_connected';
  }>({
    instagram: 'not_connected',
    linkedin: 'not_connected',
    tiktok: 'not_connected',
    twitter: 'not_connected',
  });
  
  const router = useRouter();
  const { accountId } = useAuth();
  const { toast } = useToast();
  
  // Onboarding guide for new users
  const { completeStep, getCurrentHighlight } = useOnboardingGuide();
  const currentHighlight = getCurrentHighlight();

  // Handle name update
  const handleSaveName = async () => {
    if (!tempAccountName.trim() || tempAccountName === accountName) {
      setIsEditingName(false);
      return;
    }

    try {
      // Update accountName in dvyb_context table
      const response = await contextApi.updateContext({
        accountName: tempAccountName.trim(),
      });

      if (response.success) {
        setAccountName(tempAccountName.trim());
        toast({
          title: "Name updated",
          description: "Your account name has been updated successfully.",
        });
      }
    } catch (error) {
      console.error("Failed to update account name:", error);
      toast({
        title: "Error",
        description: "Failed to update account name. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsEditingName(false);
    }
  };

  // NOTE: Auto-showing of GenerateContentDialog for onboarding has been moved to Content Library
  // The onboarding flow now takes users to Content Library first to see auto-generated content

  // Track if we've already processed OAuth on this mount (prevents double-processing in React Strict Mode)
  const oauthProcessedRef = useRef(false);

  // Check for OAuth success and pending flows (from redirect flow callbacks)
  useEffect(() => {
    // Prevent double-processing in React Strict Mode
    if (oauthProcessedRef.current) {
      console.log('🔄 [Home] OAuth already processed, skipping...');
      return;
    }
    
    // Check for OAuth success flag first
    const oauthSuccessStr = localStorage.getItem('dvyb_oauth_success');
    const flowState = getOAuthFlowState();
    
    console.log('🔍 [Home] Checking OAuth state:', { 
      hasOAuthSuccess: !!oauthSuccessStr, 
      hasFlowState: !!flowState,
      flowSource: flowState?.source 
    });
    
    if (!oauthSuccessStr) {
      // No OAuth success - don't clear flow state here, let the dialog handle it
      // Only clear if user explicitly cancelled (no recent OAuth activity)
      return;
    }
    
    // Mark as processed to prevent double-processing
    oauthProcessedRef.current = true;
    
    // Parse success data for toast
    let oauthSuccess: any = null;
    try {
      oauthSuccess = JSON.parse(oauthSuccessStr);
    } catch (e) {
      console.error('Error parsing OAuth success:', e);
      localStorage.removeItem('dvyb_oauth_success');
      return;
    }
    
    // Show toast for successful connection (if recent)
    if (Date.now() - oauthSuccess.timestamp < 30000) {
      toast({
        title: "Connected!",
        description: oauthSuccess.message || `${oauthSuccess.platform} connected successfully`,
      });
      
      if (oauthSuccess.platform) {
        setConnectionStatus(prev => ({ ...prev, [oauthSuccess.platform]: 'connected' }));
      }
    }
    
    // Clean up success flag
    localStorage.removeItem('dvyb_oauth_success');
    
    // Check if this is part of a post/schedule flow that needs to resume
    if (flowState && (flowState.source === 'home' || flowState.source === 'generate_dialog' || flowState.source === 'schedule_dialog')) {
      console.log('🔄 [Home] Pending OAuth flow detected, opening GenerateContentDialog...', flowState);
      
      // Open dialog after a short delay for better UX
      setTimeout(() => {
        setShowGenerateDialog(true);
      }, 300);
    } else {
      // No pending flow - just a regular platform connection
      console.log('✅ [Home] OAuth success without pending flow - just refreshing analytics');
      fetchAnalytics();
    }
  }, []);

  // Track page view
  useEffect(() => {
    trackHomeViewed();
  }, []);

  // Check connection statuses
  useEffect(() => {
    const checkConnections = async () => {
      if (!accountId) return;

      try {
        // Check all platform connections (including Twitter, Instagram, LinkedIn, TikTok)
        const socialResponse = await socialConnectionsApi.getAllConnectionStatuses();
        
        if (socialResponse.success) {
          setConnectionStatus({
            instagram: socialResponse.data.instagram || 'not_connected',
            linkedin: socialResponse.data.linkedin || 'not_connected',
            tiktok: socialResponse.data.tiktok || 'not_connected',
            twitter: socialResponse.data.twitter || 'not_connected',
          });
        }
      } catch (error) {
        console.error("Failed to check connection statuses:", error);
      }
    };

    checkConnections();
  }, [accountId]);

  useEffect(() => {
    const fetchAccountData = async () => {
      if (!accountId) {
        setIsLoading(false);
        return;
      }

      try {
        // Fetch from context API to get accountName from dvyb_context
        const response = await contextApi.getContext();
        if (response.success && response.data?.accountName) {
          setAccountName(response.data.accountName);
        }
      } catch (error) {
        console.error("Failed to fetch account data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAccountData();
  }, [accountId]);

  useEffect(() => {
    fetchAnalytics();
  }, [accountId, selectedDays]);

  // NOTE: Onboarding generation check is now handled in the PRIORITY CHECK useEffect above
  // This prevents race conditions with OAuth flow checks

  const handleViewChange = (view: string) => {
    setActiveView(view);
    if (view === "calendar") {
      router.push("/calendar");
    } else if (view === "brand-kit") {
      router.push("/brand-kit");
    } else if (view === "content-library") {
      router.push("/content-library");
    } else if (view === "subscription") {
      router.push("/subscription/manage");
    } else if (view === "brand-plan") {
      return; // Disabled
    }
  };

  // Handle clicks on highlighted onboarding items
  const handleOnboardingHighlightClick = (item: string) => {
    if (item === 'content_library') {
      completeStep('content_library_visited');
    } else if (item === 'brand_kit') {
      completeStep('brand_kit_visited');
    }
  };

  const formatNumber = (num: number = 0): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const getGrowthPercentage = (platform: string, metric: string): string => {
    if (!growthMetrics || !growthMetrics[platform] || !growthMetrics[platform][metric]) {
      return '+0%';
    }
    return growthMetrics[platform][metric];
  };

  // Handle Twitter OAuth connection (redirect flow)
  const handleTwitterConnect = async () => {
    // Track platform connect click
    trackPlatformConnectClicked('twitter');
    trackOAuth2Started('twitter', 'connect');
    
    try {
      const response = await authApi.getTwitterLoginUrl();
      
      if (!response.success || !response.data.oauth_url) {
        throw new Error('Failed to get Twitter login URL');
      }

      // Store return URL so callback knows where to redirect back
      localStorage.setItem('dvyb_oauth_return_url', '/home');
      localStorage.setItem('dvyb_oauth_platform', 'twitter');

      // Redirect to Twitter OAuth
      console.log('🚀 Redirecting to Twitter OAuth...');
      window.location.href = response.data.oauth_url;
    } catch (error: any) {
      console.error('Twitter connection error:', error);
      toast({
        title: "Connection Failed",
        description: error.message || 'Failed to connect Twitter',
        variant: "destructive",
      });
    }
  };

  // Handle OAuth connection for platforms (redirect flow)
  const handleConnect = async (platform: 'instagram' | 'linkedin' | 'tiktok') => {
    // Track platform connect click
    trackPlatformConnectClicked(platform);
    trackOAuth2Started(platform, 'connect');
    
    try {
      let authUrlResponse;

      switch (platform) {
        case 'instagram':
          authUrlResponse = await socialConnectionsApi.getInstagramAuthUrl();
          break;
        case 'linkedin':
          authUrlResponse = await socialConnectionsApi.getLinkedInAuthUrl();
          break;
        case 'tiktok':
          authUrlResponse = await socialConnectionsApi.getTikTokAuthUrl();
          break;
      }

      if (authUrlResponse.success && authUrlResponse.data.authUrl) {
        // Store return URL so callback knows where to redirect back
        localStorage.setItem('dvyb_oauth_return_url', '/home');
        localStorage.setItem('dvyb_oauth_platform', platform);

        // Redirect to OAuth
        console.log(`🚀 Redirecting to ${platform} OAuth...`);
        window.location.href = authUrlResponse.data.authUrl;
      } else {
        throw new Error(`Failed to get ${platform} auth URL`);
      }
    } catch (error: any) {
      console.error(`${platform} connection error:`, error);
      toast({
        title: "Connection Failed",
        description: error.message || `Failed to connect ${platform}`,
        variant: "destructive",
      });
    }
  };

  const fetchAnalytics = async () => {
    if (!accountId) return;

    const days = selectedDays === "7" ? 7 : 30;

    try {
      const [instagram, twitter, tiktok, linkedin, growth] = await Promise.all([
        analyticsApi.getInstagramAnalytics(days),
        analyticsApi.getTwitterAnalytics(days),
        analyticsApi.getTikTokAnalytics(days),
        analyticsApi.getLinkedInAnalytics(days),
        analyticsApi.getGrowthMetrics(days),
      ]);

      if (instagram.success) setInstagramData(instagram.data);
      if (twitter.success) setTwitterData(twitter.data);
      if (tiktok.success) setTiktokData(tiktok.data);
      if (linkedin.success) setLinkedinData(linkedin.data);
      if (growth.success) setGrowthMetrics(growth.data);
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar 
          activeView={activeView} 
          onViewChange={handleViewChange}
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={() => setIsMobileMenuOpen(false)}
          onboardingHighlight={currentHighlight === 'content_library' || currentHighlight === 'brand_kit' ? currentHighlight : null}
          onHighlightClick={handleOnboardingHighlightClick}
        />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar 
        activeView={activeView} 
        onViewChange={handleViewChange}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
        onboardingHighlight={currentHighlight === 'content_library' || currentHighlight === 'brand_kit' ? currentHighlight : null}
        onHighlightClick={handleOnboardingHighlightClick}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header with Hamburger */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background">
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-6 h-6 text-foreground" />
          </button>
          
          <div className="flex items-center gap-2">
            <Image src={dvybLogo} alt="Dvyb Logo" width={80} height={32} className="object-contain" priority />
          </div>
          
          {/* Empty div for spacing */}
          <div className="w-10" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {/* Header with Logo - Desktop only */}
          <div className="hidden md:flex mb-4 md:mb-6 items-center justify-between">
            <div className="w-24 h-16 md:w-32 md:h-20 flex items-center">
              <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
            </div>
          </div>

          <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
            {/* Welcome Section */}
            <div className="bg-card rounded-lg p-4 md:p-6 shadow-sm border border-border">
              <div className="flex flex-col md:flex-row items-start gap-4">
                <div className="text-3xl md:text-4xl">🏖️</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 md:mb-3">
                    <h1 className="text-xl md:text-2xl font-semibold text-foreground">
                      Welcome back, {isEditingName ? (
                        <input
                          type="text"
                          value={tempAccountName}
                          onChange={(e) => setTempAccountName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveName();
                            }
                          }}
                          onBlur={handleSaveName}
                          className="inline-block border-b-2 border-primary focus:outline-none bg-transparent px-1"
                          autoFocus
                        />
                      ) : accountName}
                    </h1>
                    {!isEditingName && (
                      <button
                        onClick={() => {
                          setTempAccountName(accountName);
                          setIsEditingName(true);
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                    Connect your integrations to unlock post insights, impressions, and audience growth trends.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-4 md:mt-6">
                <Button 
                  className={`gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm md:text-base ${
                    currentHighlight === 'generate_button' ? 'onboarding-pulse-ring' : ''
                  }`}
                  onClick={async () => {
                    // Track event
                    trackGenerateContentClicked('home');
                    
                    // Mark onboarding step as explored
                    completeStep('generate_content_explored');
                    
                    // Check account status and usage limits
                    try {
                      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/usage`, {
                        credentials: 'include',
                        headers: {
                          ...(() => {
                            const accountId = localStorage.getItem('dvyb_account_id');
                            return accountId ? { 'X-DVYB-Account-ID': accountId } : {};
                          })(),
                        },
                      });
                      const data = await response.json();
                      
                      if (data.success && data.data) {
                        setUsageData(data.data);
                        
                        // First check if account is active
                        if (data.data.isAccountActive === false) {
                          // Account is not active - show inactive account dialog
                          setShowInactiveAccountDialog(true);
                          return;
                        }
                        
                        // Check quota limits
                        const noImagesLeft = data.data.remainingImages === 0;
                        const noVideosLeft = data.data.remainingVideos === 0;
                        
                        if (noImagesLeft && noVideosLeft) {
                          // BOTH quotas exhausted - must upgrade, cannot skip
                          setQuotaType('both');
                          setCanSkipPricingModal(false);
                          setShowPricingModal(true);
                        } else if (noImagesLeft && !noVideosLeft) {
                          // Only image quota exhausted - can skip and generate videos
                          setQuotaType('image');
                          setCanSkipPricingModal(true);
                          setShowPricingModal(true);
                        } else if (noVideosLeft && !noImagesLeft) {
                          // Only video quota exhausted - can skip and generate images
                          setQuotaType('video');
                          setCanSkipPricingModal(true);
                          setShowPricingModal(true);
                        } else {
                          // Has some posts remaining - proceed with generation
                          setShowGenerateDialog(true);
                        }
                      }
                    } catch (error) {
                      console.error('Failed to check usage:', error);
                      // Proceed anyway on error
                      setShowGenerateDialog(true);
                    }
                  }}
                >
              <Sparkles className="w-4 h-4" />
              Generate content now
            </Button>
          </div>
        </div>

        {/* Instagram Performance */}
        <div>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 md:mb-6 gap-3">
            <div className="flex items-center gap-2">
                  <Instagram className="w-5 h-5 md:w-6 md:h-6 text-pink-600" />
                  <h2 className="text-lg md:text-xl font-semibold text-foreground">Instagram Performance</h2>
            </div>
            <div className="flex gap-2">
                  <Button
                    variant={selectedDays === "7" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("7")}
                    className="text-xs md:text-sm"
                  >
                Last 7 Days
              </Button>
                  <Button
                    variant={selectedDays === "30" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("30")}
                    className="text-xs md:text-sm"
                  >
                Last 30 Days
              </Button>
            </div>
          </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
            {/* Impressions Card */}
                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Impressions</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('instagram', 'impressions')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {instagramData && instagramData.metrics.impressions ? (
                      <div className="text-3xl md:text-4xl font-semibold text-foreground">
                        {formatNumber(instagramData.metrics.impressions)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>

            {/* Engagement Card */}
                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Engagement</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('instagram', 'engagement')}
                </Badge>
              </div>
                  {connectionStatus.instagram !== 'connected' ? (
                    <div className="h-24 md:h-32 bg-card rounded flex flex-col items-center justify-center border border-border">
                      <Instagram className="w-8 h-8 md:w-10 md:h-10 mb-2 text-pink-600" />
                      <p className="text-xs md:text-sm text-center text-muted-foreground px-4 mb-3">
                        Connect Instagram account to get insights
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-2 text-xs md:text-sm"
                        onClick={() => handleConnect('instagram')}
                      >
                        <span>🔗</span>
                        Connect Instagram
                      </Button>
                    </div>
                  ) : (
                    <div className={`h-24 md:h-32 rounded flex items-center justify-center ${
                      connectionStatus.instagram === 'connected' && instagramData && (instagramData.metrics.likes || instagramData.metrics.comments)
                        ? 'bg-card border border-border'
                        : 'bg-muted'
                    }`}>
                      {connectionStatus.instagram === 'connected' && instagramData && (instagramData.metrics.likes || instagramData.metrics.comments) ? (
                        <div className="flex items-center gap-4 md:gap-8">
                <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">❤️</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(instagramData.metrics.likes)}
                            </span>
                </div>
                <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">💬</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(instagramData.metrics.comments)}
                            </span>
                </div>
              </div>
                      ) : (
                        <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                      )}
                    </div>
                  )}
            </Card>

            {/* Followers Card */}
                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Followers</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('instagram', 'followers')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {instagramData && instagramData.metrics.followers ? (
                      <div className="text-3xl md:text-5xl font-semibold text-foreground">
                        {formatNumber(instagramData.metrics.followers)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>
          </div>

          {/* Top 5 Performing Posts */}
          <div>
                <h3 className="text-base md:text-lg font-semibold text-foreground mb-3 md:mb-4">
                  Top 5 performing posts
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
                  {instagramData && instagramData.topPosts.length > 0 ? (
                    instagramData.topPosts.slice(0, 5).map((post, idx) => (
                      <Card 
                        key={post.id} 
                        className="overflow-hidden border border-border cursor-pointer hover:border-primary transition-colors"
                        onClick={() => {
                          setSelectedPost(post);
                          setSelectedPlatform("instagram");
                          setShowPostView(true);
                        }}
                      >
                        <div className="relative aspect-square">
                          {post.mediaType === 'video' ? (
                            <>
                              <video
                                src={post.mediaUrl}
                                className="aspect-square object-cover w-full h-full"
                                muted
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <svg className="w-6 h-6 text-gray-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/>
                                  </svg>
                                </div>
                              </div>
                            </>
                          ) : (
                            <img
                              src={post.mediaUrl || "/placeholder.jpg"}
                              alt={`Top performing post ${idx + 1}`}
                              className="aspect-square object-cover w-full h-full"
                            />
                          )}
                        </div>
                      </Card>
                    ))
                  ) : (
                    Array(5)
                      .fill(0)
                      .map((_, idx) => (
                        <Card
                          key={idx}
                          className="overflow-hidden border border-border aspect-square flex items-center justify-center bg-muted"
                        >
                          <div className="text-xs md:text-sm text-muted-foreground text-center p-2">No Content</div>
                        </Card>
                      ))
                  )}
            </div>
          </div>
        </div>

        {/* Twitter Performance */}
        <div>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 md:mb-6 gap-3">
            <div className="flex items-center gap-2">
                  <Twitter className="w-5 h-5 md:w-6 md:h-6 text-black dark:text-white" />
                  <h2 className="text-lg md:text-xl font-semibold text-foreground">Twitter Performance</h2>
            </div>
            <div className="flex gap-2">
                  <Button
                    variant={selectedDays === "7" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("7")}
                    className="text-xs md:text-sm"
                  >
                Last 7 Days
              </Button>
                  <Button
                    variant={selectedDays === "30" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("30")}
                    className="text-xs md:text-sm"
                  >
                Last 30 Days
              </Button>
            </div>
          </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Impressions</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('twitter', 'impressions')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {twitterData && twitterData.metrics.impressions ? (
                      <div className="text-3xl md:text-4xl font-semibold text-foreground">
                        {formatNumber(twitterData.metrics.impressions)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>

                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Engagement</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('twitter', 'engagement')}
                </Badge>
              </div>
                  {connectionStatus.twitter !== 'connected' ? (
                    <div className="h-24 md:h-32 bg-card rounded flex flex-col items-center justify-center border border-border">
                      <Twitter className="w-8 h-8 md:w-10 md:h-10 mb-2 text-black dark:text-white" />
                      <p className="text-xs md:text-sm text-center text-muted-foreground px-4 mb-3">
                  Connect Twitter account to get insights
                </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-2 text-xs md:text-sm"
                        onClick={handleTwitterConnect}
                      >
                  <span>🔗</span>
                  Connect Twitter
                </Button>
              </div>
                  ) : (
                    <div className={`h-24 md:h-32 rounded flex items-center justify-center ${
                      connectionStatus.twitter === 'connected' && twitterData && (twitterData.metrics.likes || twitterData.metrics.retweets)
                        ? 'bg-card border border-border'
                        : 'bg-muted'
                    }`}>
                      {connectionStatus.twitter === 'connected' && twitterData && (twitterData.metrics.likes || twitterData.metrics.retweets) ? (
                        <div className="flex items-center gap-4 md:gap-8">
                          <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">❤️</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(twitterData.metrics.likes)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">🔄</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(twitterData.metrics.retweets)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                      )}
                    </div>
                  )}
            </Card>

                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Followers</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('twitter', 'followers')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {twitterData && twitterData.metrics.followers ? (
                      <div className="text-3xl md:text-5xl font-semibold text-foreground">
                        {formatNumber(twitterData.metrics.followers)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>
          </div>

          <div>
                <h3 className="text-base md:text-lg font-semibold text-foreground mb-3 md:mb-4">
                  Top 5 performing posts
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
                  {twitterData && twitterData.topPosts.length > 0 ? (
                    twitterData.topPosts.slice(0, 5).map((post, idx) => (
                      <Card 
                        key={post.id} 
                        className="overflow-hidden border border-border cursor-pointer hover:border-primary transition-colors"
                        onClick={() => {
                          setSelectedPost(post);
                          setSelectedPlatform("twitter");
                          setShowPostView(true);
                        }}
                      >
                        <div className="relative aspect-square">
                          {post.videoUrl ? (
                            <>
                              <video
                                src={post.videoUrl}
                                className="aspect-square object-cover w-full h-full"
                                muted
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <svg className="w-6 h-6 text-gray-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/>
                                  </svg>
                                </div>
                              </div>
                            </>
                          ) : (
                            <img
                              src={post.imageUrl || "/placeholder.jpg"}
                              alt={`Top performing post ${idx + 1}`}
                              className="aspect-square object-cover w-full h-full"
                            />
                          )}
                        </div>
                      </Card>
                    ))
                  ) : (
                    Array(5)
                      .fill(0)
                      .map((_, idx) => (
                        <Card
                          key={idx}
                          className="overflow-hidden border border-border aspect-square flex items-center justify-center bg-muted"
                        >
                          <div className="text-xs md:text-sm text-muted-foreground text-center p-2">No Content</div>
                        </Card>
                      ))
                  )}
            </div>
          </div>
        </div>

        {/* TikTok Performance */}
        <div>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 md:mb-6 gap-3">
            <div className="flex items-center gap-2">
                  <TikTokIcon className="w-5 h-5 md:w-6 md:h-6 text-black dark:text-white" />
                  <h2 className="text-lg md:text-xl font-semibold text-foreground">TikTok Performance</h2>
            </div>
            <div className="flex gap-2">
                  <Button
                    variant={selectedDays === "7" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("7")}
                    className="text-xs md:text-sm"
                  >
                Last 7 Days
              </Button>
                  <Button
                    variant={selectedDays === "30" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("30")}
                    className="text-xs md:text-sm"
                  >
                Last 30 Days
              </Button>
            </div>
          </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Views</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('tiktok', 'views')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {tiktokData && tiktokData.metrics.views ? (
                      <div className="text-3xl md:text-4xl font-semibold text-foreground">
                        {formatNumber(tiktokData.metrics.views)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>

                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Engagement</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('tiktok', 'engagement')}
                </Badge>
              </div>
                  {connectionStatus.tiktok !== 'connected' ? (
                    <div className="h-24 md:h-32 bg-card rounded flex flex-col items-center justify-center border border-border">
                      <TikTokIcon className="w-8 h-8 md:w-10 md:h-10 mb-2 text-black dark:text-white" />
                      <p className="text-xs md:text-sm text-center text-muted-foreground px-4 mb-3">
                        TikTok integration coming soon
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-2 text-xs md:text-sm opacity-50 cursor-not-allowed"
                        disabled
                      >
                  <span>🔗</span>
                  Connect TikTok
                </Button>
              </div>
                  ) : (
                    <div className={`h-24 md:h-32 rounded flex items-center justify-center ${
                      connectionStatus.tiktok === 'connected' && tiktokData && (tiktokData.metrics.likes || tiktokData.metrics.comments)
                        ? 'bg-card border border-border'
                        : 'bg-muted'
                    }`}>
                      {connectionStatus.tiktok === 'connected' && tiktokData && (tiktokData.metrics.likes || tiktokData.metrics.comments) ? (
                        <div className="flex items-center gap-4 md:gap-8">
                          <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">❤️</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(tiktokData.metrics.likes)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">💬</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(tiktokData.metrics.comments)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                      )}
                    </div>
                  )}
            </Card>

                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Followers</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('tiktok', 'followers')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {tiktokData && tiktokData.metrics.followers ? (
                      <div className="text-3xl md:text-5xl font-semibold text-foreground">
                        {formatNumber(tiktokData.metrics.followers)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>
          </div>

          <div>
                <h3 className="text-base md:text-lg font-semibold text-foreground mb-3 md:mb-4">
                  Top 5 performing videos
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
                  {tiktokData && tiktokData.topPosts.length > 0 ? (
                    tiktokData.topPosts.slice(0, 5).map((post, idx) => (
                      <Card 
                        key={post.id} 
                        className="overflow-hidden border border-border cursor-pointer hover:border-primary transition-colors"
                        onClick={() => {
                          setSelectedPost(post);
                          setSelectedPlatform("tiktok");
                          setShowPostView(true);
                        }}
                      >
                        <div className="relative aspect-square">
                          {post.videoUrl ? (
                            <>
                              <video
                                src={post.videoUrl}
                                poster={post.coverImageUrl}
                                className="aspect-square object-cover w-full h-full"
                                muted
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <svg className="w-6 h-6 text-gray-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/>
                                  </svg>
                                </div>
                              </div>
                            </>
                          ) : (
                            <img
                              src={post.coverImageUrl || "/placeholder.jpg"}
                              alt={`Top performing video ${idx + 1}`}
                              className="aspect-square object-cover w-full h-full"
                            />
                          )}
                        </div>
                      </Card>
                    ))
                  ) : (
                    Array(5)
                      .fill(0)
                      .map((_, idx) => (
                        <Card
                          key={idx}
                          className="overflow-hidden border border-border aspect-square flex items-center justify-center bg-muted"
                        >
                          <div className="text-xs md:text-sm text-muted-foreground text-center p-2">No Content</div>
                        </Card>
                      ))
                  )}
            </div>
          </div>
        </div>

        {/* LinkedIn Performance */}
        <div>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-4 md:mb-6 gap-3">
            <div className="flex items-center gap-2">
                  <Linkedin className="w-5 h-5 md:w-6 md:h-6 text-blue-700" />
                  <h2 className="text-lg md:text-xl font-semibold text-foreground">LinkedIn Performance</h2>
            </div>
            <div className="flex gap-2">
                  <Button
                    variant={selectedDays === "7" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("7")}
                    className="text-xs md:text-sm"
                  >
                Last 7 Days
              </Button>
                  <Button
                    variant={selectedDays === "30" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedDays("30")}
                    className="text-xs md:text-sm"
                  >
                Last 30 Days
              </Button>
            </div>
          </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Impressions</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('linkedin', 'impressions')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {linkedinData && linkedinData.metrics.impressions ? (
                      <div className="text-3xl md:text-4xl font-semibold text-foreground">
                        {formatNumber(linkedinData.metrics.impressions)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>

                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Engagement</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('linkedin', 'engagement')}
                </Badge>
              </div>
                  {connectionStatus.linkedin !== 'connected' ? (
                    <div className="h-24 md:h-32 bg-card rounded flex flex-col items-center justify-center border border-border">
                      <Linkedin className="w-8 h-8 md:w-10 md:h-10 mb-2 text-blue-700" />
                      <p className="text-xs md:text-sm text-center text-muted-foreground px-4 mb-3">
                  Connect LinkedIn account to get insights
                </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-2 text-xs md:text-sm"
                        onClick={() => handleConnect('linkedin')}
                      >
                  <span>🔗</span>
                  Connect LinkedIn
                </Button>
              </div>
                  ) : (
                    <div className={`h-24 md:h-32 rounded flex items-center justify-center ${
                      connectionStatus.linkedin === 'connected' && linkedinData && (linkedinData.metrics.reactions || linkedinData.metrics.comments)
                        ? 'bg-card border border-border'
                        : 'bg-muted'
                    }`}>
                      {connectionStatus.linkedin === 'connected' && linkedinData && (linkedinData.metrics.reactions || linkedinData.metrics.comments) ? (
                        <div className="flex items-center gap-4 md:gap-8">
                          <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">👍</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(linkedinData.metrics.reactions)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xl md:text-2xl">💬</span>
                            <span className="text-xl md:text-2xl font-semibold text-foreground">
                              {formatNumber(linkedinData.metrics.comments)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                      )}
                    </div>
                  )}
            </Card>

                <Card className="p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs md:text-sm font-medium text-muted-foreground">Followers</h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-0 text-xs">
                      {getGrowthPercentage('linkedin', 'followers')}
                </Badge>
              </div>
                  <div className="h-24 md:h-32 bg-muted rounded flex items-center justify-center">
                    {linkedinData && linkedinData.metrics.followers ? (
                      <div className="text-3xl md:text-5xl font-semibold text-foreground">
                        {formatNumber(linkedinData.metrics.followers)}
                      </div>
                    ) : (
                      <div className="text-sm md:text-base text-muted-foreground">No Data Available</div>
                    )}
              </div>
            </Card>
          </div>

          <div>
                <h3 className="text-base md:text-lg font-semibold text-foreground mb-3 md:mb-4">
                  Top 5 performing posts
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
                  {linkedinData && linkedinData.topPosts.length > 0 ? (
                    linkedinData.topPosts.slice(0, 5).map((post, idx) => (
                      <Card 
                        key={post.id} 
                        className="overflow-hidden border border-border cursor-pointer hover:border-primary transition-colors"
                        onClick={() => {
                          setSelectedPost(post);
                          setSelectedPlatform("linkedin");
                          setShowPostView(true);
                        }}
                      >
                        <div className="relative aspect-square">
                          {post.mediaType === 'video' ? (
                            <>
                              <video
                                src={post.mediaUrl}
                                className="aspect-square object-cover w-full h-full"
                                muted
                              />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <svg className="w-6 h-6 text-gray-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/>
                                  </svg>
                                </div>
                              </div>
                            </>
                          ) : (
                            <img
                              src={post.mediaUrl || "/placeholder.jpg"}
                              alt={`Top performing post ${idx + 1}`}
                              className="aspect-square object-cover w-full h-full"
                            />
                          )}
                        </div>
                      </Card>
                    ))
                  ) : (
                    Array(5)
                      .fill(0)
                      .map((_, idx) => (
                        <Card
                          key={idx}
                          className="overflow-hidden border border-border aspect-square flex items-center justify-center bg-muted"
                        >
                          <div className="text-xs md:text-sm text-muted-foreground text-center p-2">No Content</div>
                        </Card>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Chat Widget - Hidden for now, will be used in future */}
          <div className="hidden fixed bottom-6 right-6 flex items-center gap-3 bg-card border border-border rounded-full px-4 py-3 shadow-lg">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white text-sm font-semibold">
              M
            </div>
            <p className="text-sm text-foreground">Hey Melbin Integrating your social...</p>
            <span className="text-xs text-muted-foreground">Joe • 1m</span>
          </div>

          <GenerateContentDialog 
            open={showGenerateDialog} 
            onOpenChange={setShowGenerateDialog}
            parentPage="home"
          />

          {/* Full-screen Pricing Modal */}
          <PricingModal
            open={showPricingModal}
            onClose={() => {
              setShowPricingModal(false);
              // If user can skip (only one quota exhausted), proceed to generate
              if (canSkipPricingModal) {
                setShowGenerateDialog(true);
              }
            }}
            currentPlanInfo={usageData ? {
              planName: usageData.planName || 'Free Trial',
              planId: usageData.planId || null,
              monthlyPrice: usageData.monthlyPrice || 0,
              annualPrice: usageData.annualPrice || 0,
              billingCycle: usageData.billingCycle || 'monthly',
              isFreeTrialPlan: usageData.isFreeTrialPlan || false,
            } : null}
            quotaType={quotaType}
            isAuthenticated={true}
            canSkip={canSkipPricingModal}
            reason="quota_exhausted"
          />

          {/* Inactive Account Dialog */}
          <AlertDialog open={showInactiveAccountDialog} onOpenChange={setShowInactiveAccountDialog}>
            <AlertDialogContent className="w-[90vw] sm:w-[85vw] md:max-w-md p-4 sm:p-6">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-center text-lg sm:text-xl">
                  Account Not Active
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="text-center space-y-3 sm:space-y-4 pt-3 sm:pt-4">
                    <p className="text-sm sm:text-base text-muted-foreground">
                      Your account is currently not active. Content generation is temporarily unavailable.
                    </p>
                    <p className="text-sm sm:text-base text-muted-foreground">
                      Please reach out to our support team to reactivate your account.
                    </p>
                    <div className="bg-blue-50 dark:bg-blue-950 p-3 sm:p-4 rounded-lg mt-3 sm:mt-4">
                      <p className="text-xs sm:text-sm text-muted-foreground mb-1">Contact Support:</p>
                      <a 
                        href="mailto:social@dvyb.ai" 
                        className="text-blue-600 hover:text-blue-700 font-medium text-base sm:text-lg break-all"
                      >
                        social@dvyb.ai
                      </a>
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="justify-center pt-2 sm:pt-4">
                <Button 
                  onClick={() => setShowInactiveAccountDialog(false)}
                  className="w-full sm:w-auto min-w-[120px]"
                >
                  Close
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          
          <PostViewDialog
            post={selectedPost}
            platform={selectedPlatform}
            open={showPostView}
            onOpenChange={setShowPostView}
          />
        </div>
      </main>
    </div>
  );
};
