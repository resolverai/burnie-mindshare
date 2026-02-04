"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Filter, FileCheck, Loader2, Play } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { dvybApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { trackCalendarViewed, trackCalendarPostClicked, trackCalendarDateChanged } from "@/lib/mixpanel";

interface ScheduledPost {
  id: number;
  topic?: string;
  postDate: Date;
  postTime: string;
  contentType: string;
  platformText?: any; // { instagram: "text", twitter: "text", ... }
  mediaUrl?: string;
  status: string;
  platforms: string[]; // ['twitter', 'instagram', etc.]
  scheduleId: number; // ID from dvyb_schedules
}

export const CalendarView = () => {
  const { accountId } = useAuth();
  const { toast } = useToast();
  const [currentWeekStart, setCurrentWeekStart] = useState(getCurrentWeekMonday());
  const [weekDays, setWeekDays] = useState(generateWeekDays(getCurrentWeekMonday()));
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // URL cache: Map<S3 key, presigned URL>
  const [urlCache, setUrlCache] = useState<Map<string, string>>(new Map());

  // Mobile: Track which day index is currently being viewed (0-6)
  const [mobileDayIndex, setMobileDayIndex] = useState(() => {
    // Find today's index in the current week
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const initialDays = generateWeekDays(getCurrentWeekMonday());
    const todayIndex = initialDays.findIndex(day => day.date.getTime() === today.getTime());
    return todayIndex >= 0 ? todayIndex : 0;
  });

  // Extract S3 key from URL (handles both presigned URLs and direct S3 keys)
  const extractS3Key = (url: string): string => {
    if (!url) return '';
    
    try {
      // If it contains query parameters, extract the path before them
      if (url.includes('?')) {
        const urlObj = new URL(url);
        // Remove leading slash and decode
        return decodeURIComponent(urlObj.pathname.substring(1));
      }
      
      // If it's an S3 URL (https://bucket.s3.region.amazonaws.com/key)
      if (url.includes('s3') && url.includes('amazonaws.com')) {
        const urlObj = new URL(url);
        return decodeURIComponent(urlObj.pathname.substring(1));
      }
      
      // Otherwise, assume it's already an S3 key
      return url;
    } catch {
      // If URL parsing fails, return as-is
      return url;
    }
  };

  // Get fresh presigned URL with caching
  const getFreshPresignedUrl = async (s3KeyOrUrl: string): Promise<string> => {
    if (!s3KeyOrUrl) {
      console.warn('⚠️ getFreshPresignedUrl: Empty URL provided');
      return '';
    }
    
    const s3Key = extractS3Key(s3KeyOrUrl);
    console.log('🔑 Extracted S3 key:', s3Key.substring(0, 50) + '...');
    
    // Check cache first
    if (urlCache.has(s3Key)) {
      console.log('✅ Using cached presigned URL for:', s3Key.substring(0, 50) + '...');
      return urlCache.get(s3Key)!;
    }
    
    try {
      console.log('📡 Generating fresh presigned URL for:', s3Key.substring(0, 50) + '...');
      const response = await dvybApi.upload.getPresignedUrlFromKey(s3Key);
      
      if (response.success && response.presigned_url) {
        console.log('✅ Fresh presigned URL generated successfully');
        // Update cache
        setUrlCache(prev => new Map(prev).set(s3Key, response.presigned_url));
        return response.presigned_url;
      }
      
      // Fallback to original URL if presigned generation fails
      console.warn('⚠️ No presigned URL returned, using original URL');
      return s3KeyOrUrl;
    } catch (error) {
      console.error('❌ Failed to get presigned URL for', s3Key, error);
      return s3KeyOrUrl; // Fallback to original
    }
  };

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

  // Helper: Get posts for a specific day (sorted by time ascending)
  const getPostsForDay = (date: Date) => {
    const postsForDay = scheduledPosts.filter((post) => {
      const postDate = new Date(post.postDate);
      postDate.setHours(0, 0, 0, 0);
      return postDate.getTime() === date.getTime();
    });
    
    // Sort by time (ascending) - properly parse time with am/pm
    return postsForDay.sort((a, b) => {
      // Parse time like "7:00pm" or "6:15am"
      const parseTime = (timeStr: string): number => {
        const match = timeStr.match(/(\d+):(\d+)(am|pm)/i);
        if (!match) return 0;
        
        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const period = match[3].toLowerCase();
        
        // Convert to 24-hour format
        if (period === 'pm' && hours !== 12) {
          hours += 12;
        } else if (period === 'am' && hours === 12) {
          hours = 0;
        }
        
        return hours * 60 + minutes;
      };
      
      const minutesA = parseTime(a.postTime);
      const minutesB = parseTime(b.postTime);
      return minutesA - minutesB; // Ascending order (earliest first)
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

  // Update mobile day index when week changes (to show today if in current week)
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIndex = weekDays.findIndex(day => day.date.getTime() === today.getTime());
    
    // If today is in the current week, show it; otherwise show first day
    if (todayIndex >= 0) {
      setMobileDayIndex(todayIndex);
    } else {
      // Show first day of week if today is not in current week
      setMobileDayIndex(0);
    }
  }, [currentWeekStart]);

  // Track page view on mount
  useEffect(() => {
    trackCalendarViewed();
  }, []);

  // Fetch scheduled posts on mount
  useEffect(() => {
    const fetchScheduledPosts = async () => {
      if (!accountId) return;

      try {
        setIsLoading(true);
        
        // Fetch all schedules for this account
        const { postingApi } = await import('@/lib/api');
        const response = await postingApi.getSchedules(); // No contentId = get all schedules
        
        if (response.success && response.data) {
          // Filter pending schedules first
          const pendingSchedules = response.data.filter((schedule: any) => schedule.status === 'pending');
          
          // Transform schedule data to calendar format with fresh presigned URLs
          const transformed = await Promise.all(
            pendingSchedules.map(async (schedule: any) => {
              const scheduledDate = new Date(schedule.scheduledFor);
              const postMetadata = schedule.postMetadata || {};
              const content = postMetadata.content || {};
              const platformTexts = content.platformTexts || {};
              const platforms = postMetadata.platforms || [];
              
              // Format time as HH:MM AM/PM
              const hours = scheduledDate.getHours();
              const minutes = scheduledDate.getMinutes();
              const ampm = hours >= 12 ? 'pm' : 'am';
              const displayHours = hours % 12 || 12;
              const postTime = `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
              
              // Get first available caption from platformTexts
              const firstPlatform = platforms[0] || 'instagram';
              const topic = platformTexts[firstPlatform] || content.caption || 'Scheduled post';
              
              // Generate fresh presigned URL for media (with caching)
              let freshMediaUrl = content.mediaUrl;
              if (content.mediaUrl) {
                try {
                  freshMediaUrl = await getFreshPresignedUrl(content.mediaUrl);
                } catch (error) {
                  console.error('Failed to get presigned URL for schedule', schedule.id, error);
                  // Keep original URL as fallback
                }
              }
              
              return {
                id: schedule.id,
                scheduleId: schedule.id,
                topic: topic,
                postDate: scheduledDate,
                postTime: postTime,
                contentType: content.mediaType === 'video' ? 'Video' : 'Post',
                platformText: platformTexts,
                mediaUrl: freshMediaUrl, // Use fresh presigned URL
                status: schedule.status,
                platforms: platforms,
              } as ScheduledPost;
            })
          );
          
          setScheduledPosts(transformed);
          console.log(`✅ Loaded ${transformed.length} scheduled posts with fresh presigned URLs`);
        }
      } catch (error) {
        console.error("Failed to fetch scheduled posts:", error);
        toast({
          title: "Failed to load calendar",
          description: "Could not fetch scheduled posts",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchScheduledPosts();
  }, [accountId]);

  // Navigate to previous (day on mobile, week on tablet/desktop)
  const handlePreviousWeek = () => {
    // Check if mobile
    if (window.innerWidth < 768) {
      // Mobile: Move to previous day
      if (mobileDayIndex > 0) {
        setMobileDayIndex(mobileDayIndex - 1);
        trackCalendarDateChanged('week', weekDays[mobileDayIndex - 1].dateStr);
      } else {
        // If at first day of week, go to previous week's last day
        const newStart = new Date(currentWeekStart);
        newStart.setDate(newStart.getDate() - 7);
        setCurrentWeekStart(newStart);
        const newDays = generateWeekDays(newStart);
        setWeekDays(newDays);
        setMobileDayIndex(6); // Last day of week
        trackCalendarDateChanged('week', newDays[6].dateStr);
      }
    } else {
      // Tablet/Desktop: Move to previous week
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() - 7);
    setCurrentWeekStart(newStart);
    setWeekDays(generateWeekDays(newStart));
    trackCalendarDateChanged('week', newStart.toISOString().split('T')[0]);
    }
  };

  // Navigate to next (day on mobile, week on tablet/desktop)
  const handleNextWeek = () => {
    // Check if mobile
    if (window.innerWidth < 768) {
      // Mobile: Move to next day
      if (mobileDayIndex < 6) {
        setMobileDayIndex(mobileDayIndex + 1);
        trackCalendarDateChanged('week', weekDays[mobileDayIndex + 1].dateStr);
      } else {
        // If at last day of week, go to next week's first day
        const newStart = new Date(currentWeekStart);
        newStart.setDate(newStart.getDate() + 7);
        setCurrentWeekStart(newStart);
        const newDays = generateWeekDays(newStart);
        setWeekDays(newDays);
        setMobileDayIndex(0); // First day of week
        trackCalendarDateChanged('week', newDays[0].dateStr);
      }
    } else {
      // Tablet/Desktop: Move to next week
    const newStart = new Date(currentWeekStart);
    newStart.setDate(newStart.getDate() + 7);
    setCurrentWeekStart(newStart);
    setWeekDays(generateWeekDays(newStart));
    trackCalendarDateChanged('week', newStart.toISOString().split('T')[0]);
    }
  };

  // Navigate to today
  const handleToday = () => {
    const monday = getCurrentWeekMonday();
    setCurrentWeekStart(monday);
    const newDays = generateWeekDays(monday);
    setWeekDays(newDays);
    
    // Find today's index and set mobile view to it
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIndex = newDays.findIndex(day => day.date.getTime() === today.getTime());
    if (todayIndex >= 0) {
      setMobileDayIndex(todayIndex);
    }
  };

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-2 md:px-3 lg:px-4 py-3 md:py-4">
          {/* Mobile Header - Stacked Layout */}
          <div className="flex flex-col gap-3 md:hidden">
          <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-foreground">Calendar</h1>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={handlePreviousWeek}>
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleToday}>Today</Button>
                <Button variant="ghost" size="icon" onClick={handleNextWeek}>
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <div className="hidden flex items-center gap-2 overflow-x-auto">
              <Button variant="outline" size="sm" className="text-xs whitespace-nowrap">
                <CalendarIcon className="w-3 h-3 mr-1" />
                Week View
              </Button>
              <Button variant="outline" size="sm" className="text-xs whitespace-nowrap">
                <Filter className="w-3 h-3 mr-1" />
                Filters
              </Button>
              <Button variant="outline" size="sm" className="text-xs whitespace-nowrap">
                <FileCheck className="w-3 h-3 mr-1" />
                Select
              </Button>
              <Button size="sm" className="text-xs whitespace-nowrap">
                <Plus className="w-3 h-3 mr-1" />
                Create
              </Button>
            </div>
          </div>

          {/* Desktop Header - Original Layout */}
          <div className="hidden md:flex items-center justify-between">
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
            <div className="hidden flex items-center gap-2">
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

      {/* Gradient Banner */}
      <div className="bg-[hsl(var(--landing-accent-orange))] text-white">
        <div className="max-w-7xl mx-auto px-2 md:px-3 lg:px-4 py-3">
          {/* Mobile Banner */}
          <div className="md:hidden">
            <div className="flex items-start gap-2">
              <CalendarIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium mb-1">Customize your content</p>
                <p className="text-xs text-white/80 mb-2">
                  Control how Dvyb generates and publishes your content.
                </p>
                <Button variant="secondary" size="sm" className="text-xs h-7 bg-white/20 hover:bg-white/30 text-white border-white/30" disabled>
                  Go to Preferences →
                </Button>
              </div>
            </div>
          </div>

          {/* Desktop Banner */}
          <div className="hidden md:flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5" />
              <span className="font-medium">Customize your content</span>
              <span className="text-white/80">Control how Dvyb generates and publishes your content.</span>
            </div>
            <Button variant="secondary" size="sm" className="bg-white/20 hover:bg-white/30 text-white border-white/30 backdrop-blur-sm" disabled>
              Go to Content Preferences →
            </Button>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="max-w-7xl mx-auto px-2 md:px-3 lg:px-4 py-4 md:py-6">
        {/* Show generating message for first-time users */}
        {isFirstTime && isGenerating && (
          <div className="flex flex-col items-center justify-center py-12 md:py-20">
            <Loader2 className="w-10 h-10 md:w-12 md:h-12 animate-spin text-primary mb-3 md:mb-4" />
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2 text-center px-4">
              Generating Content for this Week
            </h2>
            <p className="text-sm md:text-base text-muted-foreground text-center">This will take a few moments...</p>
          </div>
        )}

        {/* Mobile View - Single Day View */}
        <div className="md:hidden">
          {(() => {
            const currentDay = weekDays[mobileDayIndex];
            const dayPosts = currentDay ? getPostsForDay(currentDay.date) : [];
            
            if (!currentDay) return null;
            
            return (
              <div className="space-y-4">
                {/* Day Header */}
                <div
                  className={`text-center p-3 rounded-lg text-base font-medium ${
                    currentDay.isToday
                      ? "bg-[hsl(var(--landing-accent-orange))] text-white font-semibold shadow-lg"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {currentDay.formatted}
                </div>

                {/* Day Content - Vertically Stacked Cards */}
                <div className="space-y-4">
                  {dayPosts.map((post) => {
                    // Get text content from first available platform
                    const platformText = post.platformText || {};
                    const platforms = post.platforms || [];
                    const firstPlatform = platforms[0] || 'instagram';
                    const textContent = platformText[firstPlatform] || post.topic || "Scheduled post";
                    
                    return (
                      <Card
                        key={post.id}
                        className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                      >
                        {post.mediaUrl && (
                          <div className="relative h-48">
                            {post.contentType === 'Video' ? (
                              <>
                                <video
                                  src={post.mediaUrl}
                                  className="w-full h-full object-cover"
                                  muted
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                  <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                    <Play className="w-6 h-6 text-gray-900 ml-0.5" fill="currentColor" />
                                  </div>
                                </div>
                              </>
                            ) : (
                              <img 
                                src={post.mediaUrl} 
                                alt={textContent}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                        )}
                        <div className="p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                              {platforms.includes("instagram") && (
                                <div className="w-4 h-4 rounded bg-[hsl(var(--landing-accent-orange))]" />
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
                            <span className="text-sm font-medium capitalize">{post.contentType}</span>
                            <span className="text-sm text-muted-foreground ml-auto">{post.postTime}</span>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-3">
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
                    <div className="text-center py-16 text-muted-foreground bg-muted/30 rounded-lg border-2 border-dashed">
                      <p className="text-sm font-medium mb-1">No posts scheduled</p>
                      <p className="text-xs text-muted-foreground/70">Swipe to view other days</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Tablet View - 4 Column Grid with Scrolling */}
        <div className="hidden md:block lg:hidden">
          <div className="grid grid-cols-4 gap-4">
            {weekDays.map((day) => {
              const dayPosts = getPostsForDay(day.date);
              return (
                <div key={day.formatted} className="space-y-3 min-w-0">
                  <div
                    className={`text-center p-2.5 rounded-lg text-sm ${
                      day.isToday
                        ? "bg-[hsl(var(--landing-accent-orange))] text-white font-semibold shadow-md"
                        : "text-muted-foreground bg-muted/50"
                    }`}
                  >
                    {day.formatted}
                  </div>

                  <div className="space-y-3">
                    {dayPosts.map((post) => {
                      // Get text content from first available platform
                      const platformText = post.platformText || {};
                      const platforms = post.platforms || [];
                      const firstPlatform = platforms[0] || 'instagram';
                      const textContent = platformText[firstPlatform] || post.topic || "Scheduled post";
                      
                      return (
                        <Card
                          key={post.id}
                          className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                        >
                          {post.mediaUrl && (
                            <div className="relative h-32">
                              {post.contentType === 'Video' ? (
                                <>
                                  <video
                                    src={post.mediaUrl}
                                    className="w-full h-full object-cover"
                                    muted
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                    <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                                      <Play className="w-5 h-5 text-gray-900 ml-0.5" fill="currentColor" />
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <img 
                                  src={post.mediaUrl} 
                                  alt={textContent}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                          )}
                          <div className="p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {platforms.includes("instagram") && (
                                  <div className="w-3.5 h-3.5 rounded bg-[hsl(var(--landing-accent-orange))]" />
                                )}
                                {platforms.includes("twitter") && (
                                  <div className="w-3.5 h-3.5 rounded bg-black" />
                                )}
                                {platforms.includes("facebook") && (
                                  <div className="w-3.5 h-3.5 rounded bg-blue-600" />
                                )}
                                {platforms.includes("linkedin") && (
                                  <div className="w-3.5 h-3.5 rounded bg-blue-700" />
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
                              className="w-full text-xs h-8"
                            >
                              Edit
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                    
                    {dayPosts.length === 0 && (
                      <div className="text-center py-10 text-muted-foreground text-sm bg-muted/30 rounded-lg border border-dashed">
                        No posts scheduled
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Desktop View - 7 Column Grid Layout */}
        <div className="hidden lg:grid lg:grid-cols-7 gap-5">
          {weekDays.map((day) => {
            const dayPosts = getPostsForDay(day.date);
            return (
              <div key={day.formatted} className="space-y-3">
                <div
                  className={`text-center p-2 rounded-lg ${
                    day.isToday
                      ? "bg-[hsl(var(--landing-accent-orange))] text-white font-semibold shadow-md"
                      : "text-muted-foreground"
                  }`}
                >
                  {day.formatted}
                </div>

                <div className="space-y-3">
                  {dayPosts.map((post) => {
                    // Get text content from first available platform
                    const platformText = post.platformText || {};
                    const platforms = post.platforms || [];
                    const firstPlatform = platforms[0] || 'instagram';
                    const textContent = platformText[firstPlatform] || post.topic || "Scheduled post";
                    
                    return (
                      <Card
                        key={post.id}
                        className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                      >
                        {post.mediaUrl && (
                          <div className="relative h-32">
                            {post.contentType === 'Video' ? (
                              <>
                                <video
                                  src={post.mediaUrl}
                                  className="w-full h-full object-cover"
                                  muted
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                  <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center">
                                    <Play className="w-4 h-4 text-gray-900 ml-0.5" fill="currentColor" />
                                  </div>
                                </div>
                              </>
                            ) : (
                            <img 
                              src={post.mediaUrl} 
                              alt={textContent}
                              className="w-full h-full object-cover"
                            />
                            )}
                          </div>
                        )}
                        <div className="p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              {platforms.includes("instagram") && (
                                <div className="w-4 h-4 rounded bg-[hsl(var(--landing-accent-orange))]" />
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
