"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, Play, X } from "lucide-react";
import dvybLogo from "@/assets/dvyb-logo.png";
import { inspirationsApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { trackInspirationPageViewed, trackInspirationSelected } from "@/lib/mixpanel";

interface InspirationVideo {
  id: number;
  platform: string;
  category: string;
  url: string;
  title: string | null;
}

// Extract video ID and username from URL based on platform
const getVideoInfo = (video: InspirationVideo) => {
  const url = video.url;
  let videoId = String(video.id);
  let username = video.title || video.category;
  
  if (video.platform === "tiktok") {
    // Extract TikTok video ID and username from URL
    const videoMatch = url.match(/video\/(\d+)/);
    if (videoMatch) videoId = videoMatch[1];
    const userMatch = url.match(/@([^\/]+)/);
    if (userMatch) username = userMatch[1];
  } else if (video.platform === "instagram") {
    // Extract Instagram post ID from URL
    const match = url.match(/\/(p|reel|reels)\/([^\/\?]+)/);
    if (match) videoId = match[2];
    username = "instagram";
  } else if (video.platform === "youtube") {
    // Extract YouTube channel/username from URL if available
    const channelMatch = url.match(/@([^\/\?]+)/);
    if (channelMatch) {
      username = channelMatch[1];
    } else {
      username = video.title || "youtube";
    }
    // Video ID will be extracted by extractYouTubeVideoId function
    videoId = String(video.id);
  } else if (video.platform === "twitter") {
    username = video.title || "twitter";
  }
  
  return { videoId, username };
};

// Extract YouTube video ID from various URL formats
const extractYouTubeVideoId = (url: string): string | null => {
  // Handle youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) return watchMatch[1];
  
  // Handle youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (shortMatch) return shortMatch[1];
  
  // Handle youtube.com/shorts/VIDEO_ID
  const shortsMatch = url.match(/\/shorts\/([^?&]+)/);
  if (shortsMatch) return shortsMatch[1];
  
  // Handle youtube.com/embed/VIDEO_ID
  const embedMatch = url.match(/\/embed\/([^?&]+)/);
  if (embedMatch) return embedMatch[1];
  
  return null;
};

// Get embed URL based on platform (matching prototype logic)
const getEmbedUrl = (video: InspirationVideo, autoplay = false) => {
  const { videoId } = getVideoInfo(video);
  
  if (video.platform === "tiktok") {
    return `https://www.tiktok.com/embed/v2/${videoId.split('-')[0]}`;
  } else if (video.platform === "instagram") {
    return `https://www.instagram.com/reel/${videoId}/embed${autoplay ? '/?autoplay=1' : '/'}`;
  } else if (video.platform === "youtube") {
    // Extract proper YouTube video ID
    const ytVideoId = extractYouTubeVideoId(video.url) || videoId;
    // Use proper embed parameters for better compatibility
    const params = new URLSearchParams({
      rel: '0',
      modestbranding: '1',
      enablejsapi: '1',
      ...(autoplay && { autoplay: '1' })
    });
    return `https://www.youtube.com/embed/${ytVideoId}?${params.toString()}`;
  }
  
  return video.url;
};

export default function InspirationSelectionPage() {
  const router = useRouter();
  const { toast } = useToast();
  
  const [detectedCategory, setDetectedCategory] = useState<string>("");
  const [inspirationVideos, setInspirationVideos] = useState<InspirationVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<InspirationVideo | null>(null);
  
  // Ref to prevent duplicate API calls (React Strict Mode runs effects twice)
  const hasFetchedRef = useRef(false);

  // Load analysis from localStorage and fetch inspirations
  useEffect(() => {
    // Prevent duplicate API calls
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    
    const loadInspirations = async () => {
      try {
        // Get analysis from localStorage
        const analysisStr = localStorage.getItem("dvyb_website_analysis");
        if (!analysisStr) {
          toast({
            title: "No analysis found",
            description: "Please analyze your website first",
            variant: "destructive",
          });
          router.push("/");
          return;
        }

        const analysis = JSON.parse(analysisStr);
        const detectedIndustry = analysis.industry || "General";
        setDetectedCategory(detectedIndustry);

        // Fetch matched inspirations from API
        const response = await inspirationsApi.matchInspirations(detectedIndustry, 6);
        
        if (response.success && response.data) {
          const videos = response.data.inspiration_videos || [];
          setInspirationVideos(videos);
          
          // Track page view with inspiration data
          trackInspirationPageViewed({
            industry: detectedIndustry,
            inspirationCount: videos.length,
          });
        }
      } catch (error: any) {
        console.error("Error loading inspirations:", error);
        toast({
          title: "Error",
          description: "Failed to load inspiration videos",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadInspirations();
  }, [router, toast]);

  const handleVideoPreview = (video: InspirationVideo) => {
    setSelectedVideo(video);
  };

  const handleUseVideo = () => {
    if (selectedVideo) {
      // Track inspiration selection
      trackInspirationSelected({
        inspirationId: selectedVideo.id,
        platform: selectedVideo.platform,
        category: selectedVideo.category,
      });
      
      // Store selected inspiration in localStorage
      localStorage.setItem("dvyb_selected_inspirations", JSON.stringify([selectedVideo]));
      
      // Navigate to login page - after login, user will be redirected to brand-profile
      // and analysis will be saved to context
      router.push("/auth/login");
    }
  };

  if (isLoading) {
    return (
      <div 
        className="min-h-screen flex flex-col p-6 relative"
        style={{
          backgroundImage: "url(/onboarding-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-4xl space-y-8 animate-fade-in">
            <div className="text-center space-y-4">
              <div className="w-48 h-32 mx-auto flex items-center justify-center">
                <Image src={dvybLogo} alt="Dvyb Logo" className="w-40 h-auto drop-shadow-lg" priority />
              </div>
              <h1 className="text-4xl md:text-5xl font-heading font-semibold text-foreground leading-tight tracking-tight">
                Turn any inspiration into your own branded content
              </h1>
            </div>
            
            {/* Loading state in glassmorphic card */}
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 shadow-2xl max-w-xl mx-auto">
              <div className="flex items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-foreground font-medium text-lg">Loading inspirations...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen flex flex-col p-6 relative"
      style={{
        backgroundImage: "url(/onboarding-bg.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-4xl space-y-8 animate-fade-in">
          <div className="text-center space-y-4">
            <div className="w-48 h-32 mx-auto flex items-center justify-center">
              <Image src={dvybLogo} alt="Dvyb Logo" className="w-40 h-auto drop-shadow-lg" priority />
            </div>
            <h1 className="text-4xl md:text-5xl font-heading font-semibold text-foreground leading-tight tracking-tight">
              Turn any inspiration into your own branded content
            </h1>
          </div>

          <div className="space-y-8">
            {/* Detected Category - glassmorphic card */}
            <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 shadow-2xl max-w-xl mx-auto">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-foreground font-medium text-lg">
                    Detected: {detectedCategory}
                  </span>
                  <span className="text-foreground font-bold text-xl">100%</span>
                </div>
                <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>

            {/* Inspiration Videos Grid */}
            {inspirationVideos.length > 0 ? (
              <div className="space-y-4 animate-fade-in">
                <h2 className="text-2xl font-heading font-semibold text-foreground text-center">
                  Choose an inspiration video
                </h2>
                <p className="text-foreground/70 text-center">
                  Click to preview, then select your style
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {inspirationVideos.map((video) => (
                      <button
                        key={video.id}
                        onClick={() => handleVideoPreview(video)}
                        className="group relative aspect-[9/16] bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl overflow-hidden hover:border-primary/50 hover:scale-[1.02] transition-all duration-300 shadow-lg"
                      >
                        <iframe
                          src={getEmbedUrl(video)}
                          className="w-full h-full pointer-events-none"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors duration-300" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="bg-white/90 rounded-full p-4 shadow-lg group-hover:scale-110 transition-transform duration-300">
                            <Play className="w-8 h-8 text-primary fill-primary" />
                          </div>
                        </div>
                        <div className="absolute bottom-3 left-3 right-3">
                          <span className="text-white text-xs font-medium px-2 py-0.5 bg-black/50 rounded-full capitalize">
                            {video.platform}
                          </span>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-fade-in">
                <h2 className="text-2xl font-heading font-semibold text-foreground text-center">
                  No inspiration videos available
                </h2>
                <p className="text-foreground/70 text-center">
                  We couldn&apos;t find matching inspirations for your industry.
                </p>
                <div className="flex justify-center">
                  <Button
                    onClick={() => router.push("/onboarding/analysis-details")}
                    className="btn-gradient-cta font-semibold"
                    size="lg"
                  >
                    Continue
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Video Preview Modal - exactly matching prototype */}
      <Dialog open={!!selectedVideo} onOpenChange={(open) => !open && setSelectedVideo(null)}>
        <DialogContent className="max-w-md p-0 bg-black border-none overflow-hidden">
          <button 
            onClick={() => setSelectedVideo(null)}
            className="absolute top-4 right-4 z-20 bg-black/50 rounded-full p-2 hover:bg-black/70 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
          
          {selectedVideo && (
            <div className="relative">
              <div className={`w-full ${selectedVideo.platform === 'instagram' ? 'aspect-[4/5]' : 'aspect-[9/16]'}`}>
                {/* For Instagram, show embed with overlay since it redirects on click */}
                {selectedVideo.platform === 'instagram' ? (
                  <div className="relative w-full h-full">
                    <iframe
                      src={getEmbedUrl(selectedVideo, false)}
                      className="w-full h-full pointer-events-none"
                      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                    {/* Overlay with play button to watch on Instagram */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <button
                        onClick={() => window.open(selectedVideo.url, '_blank')}
                        className="bg-white/90 hover:bg-white rounded-full p-4 shadow-lg hover:scale-110 transition-transform duration-300"
                      >
                        <Play className="w-10 h-10 text-primary fill-primary" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <iframe
                    src={getEmbedUrl(selectedVideo, true)}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-white text-xs font-medium px-2 py-0.5 bg-white/20 rounded-full capitalize">
                    {selectedVideo.platform}
                  </span>
                </div>
                {selectedVideo.platform === 'instagram' && (
                  <p className="text-white/70 text-xs text-center mb-2">
                    Click play to watch on Instagram
                  </p>
                )}
                <Button 
                  onClick={handleUseVideo}
                  className="w-full btn-gradient-cta font-semibold"
                  size="lg"
                >
                  Use This Style
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
