"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Filter, FileCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { dvybApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface GeneratedContent {
  id: number;
  topic?: string;
  postDate: Date;
  postTime: string;
  contentType: string;
  platformText?: any; // { instagram: "text", twitter: "text", ... }
  mediaUrl?: string;
  status: string;
}

export const CalendarView = () => {
  const { accountId } = useAuth();
  const { toast } = useToast();
  const [currentWeekStart, setCurrentWeekStart] = useState(getCurrentWeekMonday());
  const [weekDays, setWeekDays] = useState(generateWeekDays(getCurrentWeekMonday()));
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Helper: Get current week's Monday
  function getCurrentWeekMonday() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust if Sunday
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  // Helper: Generate week days from Monday
  function generateWeekDays(startDate: Date) {
    const days = [];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const isToday = date.getTime() === today.getTime();
      
      days.push({
        date: date,
        formatted: `${monthNames[date.getMonth()]} ${date.getDate()} ${dayNames[i]}`,
        isToday: isToday,
      });
    }
    
    return days;
  }

  // Helper: Get posts for a specific day
  const getPostsForDay = (date: Date) => {
    return generatedContent.filter((post) => {
      const postDate = new Date(post.postDate);
      postDate.setHours(0, 0, 0, 0);
      return postDate.getTime() === date.getTime();
    });
  };

  // Helper: Trigger content generation
  const triggerContentGeneration = async () => {
    if (!accountId) return;

    try {
      setIsGenerating(true);
      console.log("🎯 Triggering content generation for first-time user...");

      // Call the unified generation endpoint
      await dvybApi.generation.startGeneration({
        weekStart: currentWeekStart.toISOString(),
        weekEnd: new Date(currentWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      });

      console.log("✅ Content generation started");
      
      // Show success message
      toast({
        title: "Content Generation Started",
        description: "Your content is being generated. This may take a few moments.",
      });

    } catch (error: any) {
      console.error("Failed to trigger content generation:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to start content generation",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Fetch generated content on mount
  useEffect(() => {
    const fetchGeneratedContent = async () => {
      if (!accountId) return;

      try {
        setIsLoading(true);
        
        // Check if this is first time (flag set from onboarding)
        const isNewAccount = localStorage.getItem("dvyb_is_new_account");
        
        if (isNewAccount === "true") {
          setIsFirstTime(true);
          localStorage.removeItem("dvyb_is_new_account");
          
          // Trigger content generation for first-time users
          await triggerContentGeneration();
        } else {
          // Fetch existing generated content
          const response = await dvybApi.generation.getGeneratedContent();
          
          if (response.success && response.data) {
            setGeneratedContent(response.data);
            console.log(`✅ Loaded ${response.data.length} generated content items`);
          }
        }
      } catch (error) {
        console.error("Failed to fetch generated content:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchGeneratedContent();
  }, [accountId]);

  // Navigate to previous week
  const handlePreviousWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() - 7);
    setCurrentWeekStart(newStart);
    setWeekDays(generateWeekDays(newStart));
  };

  // Navigate to next week
  const handleNextWeek = () => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + 7);
    setCurrentWeekStart(newStart);
    setWeekDays(generateWeekDays(newStart));
  };

  // Navigate to current week
  const handleToday = () => {
    const monday = getCurrentWeekMonday();
    setCurrentWeekStart(monday);
    setWeekDays(generateWeekDays(monday));
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={handlePreviousWeek}>
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button variant="outline" onClick={handleToday}>Today</Button>
                <Button variant="ghost" size="icon" onClick={handleNextWeek}>
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline">
                Week View
              </Button>
              <Button variant="outline">
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
              <Button variant="outline">
                <FileCheck className="w-4 h-4 mr-2" />
                Select Files
              </Button>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create New
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Blue Banner */}
      <div className="bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5" />
              <span className="font-medium">Customize your content</span>
              <span className="text-primary-foreground/80">Control how Dvyb generates and publishes your content.</span>
            </div>
            <Button variant="secondary" size="sm">
              Go to Content Preferences →
            </Button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Show generating message for first-time users */}
        {isFirstTime && isGenerating && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
            <h2 className="text-2xl font-bold text-foreground mb-2">Generating Content for this Week</h2>
            <p className="text-muted-foreground">This will take a few moments...</p>
          </div>
        )}

        <div className="grid grid-cols-7 gap-4">
          {weekDays.map((day) => {
            const dayPosts = getPostsForDay(day.date);
            return (
              <div key={day.formatted} className="space-y-3">
                <div
                  className={`text-center p-2 rounded-lg ${
                    day.isToday
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  {day.formatted}
                </div>

                <div className="space-y-3">
                  {dayPosts.map((post) => {
                    // Get text content from first available platform
                    const platformText = post.platformText || {};
                    const textContent = platformText.instagram || platformText.twitter || platformText.facebook || platformText.linkedin || post.topic || "";
                    
                    // Get platforms from platformText keys
                    const platforms = Object.keys(platformText);
                    
                    return (
                      <Card
                        key={post.id}
                        className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                      >
                        {post.mediaUrl && (
                          <div className="h-32">
                            <img 
                              src={post.mediaUrl} 
                              alt={textContent}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <div className="p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              {platforms.includes("instagram") && (
                                <div className="w-4 h-4 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                              )}
                              {platforms.includes("twitter") && (
                                <div className="w-4 h-4 rounded bg-black" />
                              )}
                              {platforms.includes("facebook") && (
                                <div className="w-4 h-4 rounded bg-blue-600" />
                              )}
                              {platforms.includes("linkedin") && (
                                <div className="w-4 h-4 rounded bg-blue-700" />
                              )}
                            </div>
                            <span className="text-xs font-medium capitalize">{post.contentType}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{post.postTime}</span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {textContent}
                          </p>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full"
                          >
                            Edit
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                  
                  {dayPosts.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No posts scheduled
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
