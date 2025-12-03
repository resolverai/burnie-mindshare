"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Instagram, Twitter, Linkedin, Menu, Pencil, Check } from "lucide-react";
import { GenerateContentDialog } from "@/components/onboarding/GenerateContentDialog";
import { PostViewDialog } from "@/components/pages/PostViewDialog";
import { UpgradeDialog } from "@/components/UpgradeDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { contextApi, analyticsApi, socialConnectionsApi, authApi, accountApi } from "@/lib/api";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { useToast } from "@/hooks/use-toast";
import { TikTokIcon } from "@/components/icons/TikTokIcon";

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
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [usageData, setUsageData] = useState<any>(null);
  const [onboardingJobId, setOnboardingJobId] = useState<string | null>(null);
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

  // Check for onboarding generation and auto-open dialog
  useEffect(() => {
    const storedJobId = localStorage.getItem('dvyb_onboarding_generation_job_id');
    if (storedJobId && !isLoading) {
      console.log('🎉 Onboarding generation detected, auto-opening dialog with job:', storedJobId);
      
      // Store in state for dialog
      setOnboardingJobId(storedJobId);
      
      // Clear the flag immediately to prevent re-opening
      localStorage.removeItem('dvyb_onboarding_generation_job_id');
      
      // Small delay to ensure home page is fully loaded
      setTimeout(() => {
        setShowGenerateDialog(true);
      }, 500);
    }
  }, [isLoading]);

  const handleViewChange = (view: string) => {
    setActiveView(view);
    if (view === "calendar") {
      router.push("/calendar");
    } else if (view === "brand-kit") {
      router.push("/brand-kit");
    } else if (view === "content-library") {
      router.push("/content-library");
    } else if (view === "brand-plan") {
      return; // Disabled
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

  // Handle Twitter OAuth connection
  const handleTwitterConnect = async () => {
    try {
      const response = await authApi.getTwitterLoginUrl();
      
      if (!response.success || !response.data.oauth_url) {
        throw new Error('Failed to get Twitter login URL');
      }

      // Open Twitter auth in a popup (same as /auth/twitter page)
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const authWindow = window.open(
        response.data.oauth_url,
        'twitter_oauth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
      );

      // Listen for messages from the OAuth callback
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === 'DVYB_TWITTER_AUTH_SUCCESS') {
          console.log('✅ Twitter reconnected successfully');
          
          toast({
            title: "Connected!",
            description: "Twitter connected successfully",
          });

          // Update connection status
          setConnectionStatus(prev => ({ ...prev, twitter: 'connected' }));

          // Refresh analytics
          fetchAnalytics();

          authWindow?.close();
          window.removeEventListener('message', handleMessage);
        } else if (event.data?.type === 'DVYB_TWITTER_AUTH_ERROR') {
          console.error('❌ Twitter auth error:', event.data.message);
          
          toast({
            title: "Connection Failed",
            description: event.data.message || 'Failed to connect Twitter',
            variant: "destructive",
          });

          authWindow?.close();
          window.removeEventListener('message', handleMessage);
        }
      };

      window.addEventListener('message', handleMessage);

      // Cleanup listener after 5 minutes
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
      }, 300000);
    } catch (error: any) {
      console.error('Twitter connection error:', error);
      toast({
        title: "Connection Failed",
        description: error.message || 'Failed to connect Twitter',
        variant: "destructive",
      });
    }
  };

  // Handle OAuth connection for platforms
  const handleConnect = async (platform: 'instagram' | 'linkedin' | 'tiktok') => {
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
        const authWindow = window.open(
          authUrlResponse.data.authUrl,
          `${platform}_oauth`,
          'width=600,height=700,scrollbars=yes'
        );

        // Listen for messages from the OAuth callback
        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === `${platform}_connected`) {
            toast({
              title: "Connected!",
              description: `${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully`,
            });

            // Update connection status
            setConnectionStatus(prev => ({ ...prev, [platform]: 'connected' }));

            // Refresh analytics
            fetchAnalytics();

            authWindow?.close();
            window.removeEventListener('message', handleMessage);
          }
        };

        window.addEventListener('message', handleMessage);

        // Cleanup listener after 5 minutes
        setTimeout(() => {
          window.removeEventListener('message', handleMessage);
        }, 300000);
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
                    Your current schedule includes 1 Instagram story focused on &quot;Join the AI roast revolution and meme your
                    way to the top!&quot; Connect your integrations to unlock post insights, impressions, and audience growth
                    trends.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-4 md:mt-6">
                <Button 
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm md:text-base"
                  onClick={async () => {
                    // Check usage limits first
                    try {
                      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/account/usage`, {
                        credentials: 'include',
                      });
                      const data = await response.json();
                      
                      if (data.success && data.data) {
                        setUsageData(data.data);
                        
                        if (data.data.limitExceeded && (data.data.remainingImages === 0 && data.data.remainingVideos === 0)) {
                          // No posts left at all - show upgrade dialog
                          // (Dialog will show different message if request already exists)
                          setShowUpgradeDialog(true);
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
                        Connect TikTok account to get insights
                      </p>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="gap-2 text-xs md:text-sm"
                        onClick={() => handleConnect('tiktok')}
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
            onOpenChange={(open) => {
              setShowGenerateDialog(open);
              // Clear onboarding job ID when dialog closes
              if (!open) {
                setOnboardingJobId(null);
              }
            }}
            initialJobId={onboardingJobId}
          />
          
          <UpgradeDialog 
            open={showUpgradeDialog} 
            onOpenChange={setShowUpgradeDialog}
            usageData={usageData}
          />
          
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
