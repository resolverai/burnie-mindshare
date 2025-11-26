"use client";


import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Info, Loader2, Instagram, Facebook, Linkedin, Youtube } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { topicsApi, contextApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface TopicReviewProps {
  onComplete: () => void;
}

interface TopicWithExample {
  topic: string;
  example: {
    title: string;
    subtitle: string;
  };
}

export const TopicReview = ({ onComplete }: TopicReviewProps) => {
  const { accountId } = useAuth();
  const { toast } = useToast();
  const [crossPostFrequency, setCrossPostFrequency] = useState<"always" | "sometimes" | "never">("always");
  const [postsPerWeek, setPostsPerWeek] = useState(7);
  const [topics, setTopics] = useState<TopicWithExample[]>([]);
  const [mediaChannels, setMediaChannels] = useState<{ social: string[]; video: string[] }>({ social: [], video: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch topics and context on mount
  useEffect(() => {
    const fetchData = async () => {
      if (!accountId) return;

      try {
        setIsLoading(true);

        // Fetch topics with retry logic
        let fetchedTopics: TopicWithExample[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const topicsResponse = await topicsApi.getTopics();
          if (topicsResponse.success && topicsResponse.data?.generatedTopics) {
            fetchedTopics = topicsResponse.data.generatedTopics;
            
            // If topics found, break out of retry loop
            if (fetchedTopics.length > 0) {
              console.log(`✅ Loaded ${fetchedTopics.length} topics`);
              break;
            }
            
            // If empty on first attempt, wait and retry
            if (attempt === 0) {
              console.log('⏳ Topics empty on first load, retrying in 1.5s...');
              await new Promise(resolve => setTimeout(resolve, 1500));
            }
          }
        }
        
        setTopics(fetchedTopics);

        // Fetch context to get media channels
        const contextResponse = await contextApi.getContext();
        if (contextResponse.success && contextResponse.data) {
          if (contextResponse.data.mediaChannels) {
            setMediaChannels(contextResponse.data.mediaChannels);
          }
          if (contextResponse.data.crossPostFrequency) {
            setCrossPostFrequency(contextResponse.data.crossPostFrequency);
          }
          if (contextResponse.data.postsPerWeek) {
            setPostsPerWeek(contextResponse.data.postsPerWeek);
          }
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
        toast({
          title: "Failed to load data",
          description: "Using default values",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [accountId, toast]);

  const handleComplete = async () => {
    setIsSaving(true);
    try {
      // Save cross-post frequency and posts per week to backend
      await contextApi.updateContext({
        crossPostFrequency,
        postsPerWeek,
      });

      toast({
        title: "Settings Saved",
        description: "Your content preferences have been saved.",
      });

      onComplete();
    } catch (error: any) {
      console.error('Failed to save settings:', error);
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save your preferences. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Function to render channel icons based on selected media channels
  const renderChannelIcons = () => {
    // Only show social media channels in the Social Media section
    const socialChannels = mediaChannels.social || [];
    
    return socialChannels.map((channel) => {
      switch (channel) {
        case 'instagram':
          return (
            <div key={channel} className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 border-2 border-white flex items-center justify-center">
              <Instagram className="w-3 h-3 md:w-4 md:h-4 text-white" />
            </div>
          );
        case 'facebook':
          return (
            <div key={channel} className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center">
              <Facebook className="w-3 h-3 md:w-4 md:h-4 text-white" />
            </div>
          );
        case 'linkedin':
          return (
            <div key={channel} className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-blue-700 border-2 border-white flex items-center justify-center">
              <Linkedin className="w-3 h-3 md:w-4 md:h-4 text-white" />
            </div>
          );
        case 'twitter':
          return (
            <div key={channel} className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-black border-2 border-white flex items-center justify-center">
              <svg className="w-3 h-3 md:w-4 md:h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </div>
          );
        default:
          return null;
      }
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary" />
          <p className="text-base md:text-lg text-muted-foreground">Loading your topics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gradient-to-br from-background via-background to-muted">
      <div className="max-w-4xl mx-auto space-y-4 md:space-y-6 animate-fade-in">
        {/* Header with Logo */}
        <div className="flex flex-col md:flex-row items-center justify-center md:justify-start gap-4 md:gap-6 px-2">
          <div className="w-32 h-24 md:w-40 md:h-28 flex items-center justify-center flex-shrink-0">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          <div className="text-center md:text-left">
            <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground">
              Review topics for your first week
            </h1>
          </div>
        </div>

        <Card className="p-4 md:p-6 shadow-card">
          <div className="space-y-3 md:space-y-4">
            <p className="text-sm md:text-base text-foreground font-medium">
              Cross posting shares the same post across multiple platforms.
              <br />
              How often would you like us to cross post your content?
            </p>
            <div className="flex flex-wrap gap-2 md:gap-3">
              <Button
                variant={crossPostFrequency === "always" ? "default" : "outline"}
                onClick={() => setCrossPostFrequency("always")}
                className="flex-1 min-w-[80px] text-sm md:text-base"
              >
                Always
              </Button>
              <Button
                variant={crossPostFrequency === "sometimes" ? "default" : "outline"}
                onClick={() => setCrossPostFrequency("sometimes")}
                className="flex-1 min-w-[80px] text-sm md:text-base"
              >
                Sometimes
              </Button>
              <Button
                variant={crossPostFrequency === "never" ? "default" : "outline"}
                onClick={() => setCrossPostFrequency("never")}
                className="flex-1 min-w-[80px] text-sm md:text-base"
              >
                Never
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <Card className="p-4 md:p-6 shadow-card">
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg md:text-xl font-semibold text-foreground">Social Media</h2>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Cross posts</span>
                  <Info className="w-4 h-4" />
                </div>

                <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3 md:p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {renderChannelIcons()}
                    </div>
                    <span className="text-xs md:text-sm text-foreground font-medium">Posts / wk</span>
                  </div>
                  <div className="flex items-center gap-2 md:gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPostsPerWeek(Math.max(1, postsPerWeek - 1))}
                      className="h-8 w-8 p-0"
                    >
                      <Minus className="w-3 h-3 md:w-4 md:h-4" />
                    </Button>
                    <span className="text-lg md:text-xl font-semibold text-foreground w-6 md:w-8 text-center">
                      {postsPerWeek}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPostsPerWeek(postsPerWeek + 1)}
                      className="h-8 w-8 p-0"
                    >
                      <Plus className="w-3 h-3 md:w-4 md:h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-6 shadow-card">
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg md:text-xl font-semibold text-foreground">Topics</h2>
                <Button variant="ghost" size="sm" className="text-xs md:text-sm">
                  <Plus className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                  Add Topic
                </Button>
              </div>

              <div className="space-y-2 md:space-y-3 max-h-[300px] md:max-h-[400px] overflow-y-auto pr-1">
                {topics.map((topicObj, index) => (
                  <div
                    key={index}
                    className="p-3 md:p-4 bg-muted/20 rounded-lg border border-border/50 text-xs md:text-sm text-foreground hover:bg-muted/30 transition-colors"
                  >
                    {topicObj.topic}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        <div className="flex justify-center md:justify-end pt-4 px-2">
          <Button 
            onClick={handleComplete} 
            size="lg" 
            className="w-full md:w-auto md:min-w-[200px]"
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
