"use client";


import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Clock, Loader2, Play } from "lucide-react";
import { format } from "date-fns";
import { postingApi, authApi, socialConnectionsApi, oauth1Api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  onScheduleComplete: () => void;
}

// Mock scheduled posts
const scheduledPosts = [
  { date: new Date(2024, 10, 13), time: "15:00", title: "Turn humor into your fastest growth hack" },
  { date: new Date(2024, 10, 14), time: "15:00", title: "Create viral AI-made videos" },
  { date: new Date(2024, 10, 15), time: "12:00", title: "Decentralized content" },
  { date: new Date(2024, 10, 16), time: "09:00", title: "Power to creators" },
];

export const ScheduleDialog = ({ open, onOpenChange, post, onScheduleComplete }: ScheduleDialogProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState("12:00");
  const [showOverlapDialog, setShowOverlapDialog] = useState(false);
  const [conflictingPost, setConflictingPost] = useState<any>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authPlatforms, setAuthPlatforms] = useState<string[]>([]);
  const [currentAuthIndex, setCurrentAuthIndex] = useState(0);
  const [needsOAuth1, setNeedsOAuth1] = useState(false);
  const [isVideoPost, setIsVideoPost] = useState(false);
  const [capturedPost, setCapturedPost] = useState<any>(null); // Capture post data when scheduling starts
  const { toast } = useToast();

  // Reset captured post when dialog closes
  useEffect(() => {
    if (!open) {
      setCapturedPost(null);
    }
  }, [open]);

  // Get current date/time in user's timezone
  const getCurrentDateTime = () => {
    return new Date();
  };

  // Check if selected date/time is in the past
  const isDateTimeInPast = (date: Date, time: string): boolean => {
    const [hours, minutes] = time.split(":").map(Number);
    const scheduledDateTime = new Date(date);
    scheduledDateTime.setHours(hours, minutes, 0, 0);
    return scheduledDateTime <= getCurrentDateTime();
  };

  // Get minimum time for today
  const getMinTime = (): string => {
    if (!selectedDate) return "00:00";
    
    const today = new Date();
    const isToday = selectedDate.toDateString() === today.toDateString();
    
    if (isToday) {
      // For today, minimum time is current time + 5 minutes
      const minDate = new Date(today.getTime() + 5 * 60 * 1000);
      const hours = minDate.getHours().toString().padStart(2, '0');
      const minutes = minDate.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    
    return "00:00";
  };

  const checkForOverlap = (date: Date, time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const scheduledDateTime = new Date(date);
    scheduledDateTime.setHours(hours, minutes, 0, 0);

    for (const scheduled of scheduledPosts) {
      const [schedHours, schedMinutes] = scheduled.time.split(":").map(Number);
      const existingDateTime = new Date(scheduled.date);
      existingDateTime.setHours(schedHours, schedMinutes, 0, 0);

      const diffInMinutes = Math.abs((scheduledDateTime.getTime() - existingDateTime.getTime()) / (1000 * 60));

      if (diffInMinutes < 120) {
        return scheduled;
      }
    }
    return null;
  };

  const handleSchedule = async () => {
    if (!selectedDate || !post) return;

    // Validate date/time is not in the past
    if (isDateTimeInPast(selectedDate, selectedTime)) {
      toast({
        title: "Invalid Schedule Time",
        description: "Cannot schedule posts in the past. Please select a future date and time.",
        variant: "destructive",
      });
      return;
    }

    // Capture post data at the start of scheduling to ensure it doesn't change during OAuth flows
    const postSnapshot = { ...post };
    setCapturedPost(postSnapshot);
    
    console.log('📸 ScheduleDialog - Captured post snapshot:', {
      'generatedContentId': postSnapshot.generatedContentId,
      'postIndex': postSnapshot.postIndex,
    });

    setIsScheduling(true);

    try {
      // Get platforms with multiple fallbacks to ensure never empty
      let platforms = postSnapshot.requestedPlatforms || postSnapshot.platforms || [];
      
      // Extra safeguard: If still empty, use default
      if (!platforms || platforms.length === 0) {
        platforms = ['twitter']; // Default fallback
        console.warn('⚠️ No platforms found in ScheduleDialog handleSchedule, using default:', platforms);
      }
      
      console.log('📅 ScheduleDialog handleSchedule - Platforms:', {
        'post.requestedPlatforms': post.requestedPlatforms,
        'post.platforms': post.platforms,
        'final platforms': platforms,
        'platforms length': platforms?.length,
      });
      
      // Detect video by checking the media URL
      const isVideo = post.image && (post.image.includes('video') || post.image.includes('.mp4'));
      setIsVideoPost(isVideo);
      
      // Validate OAuth2 tokens for all platforms
      const validation = await postingApi.validateTokens({
        platforms,
        requireOAuth1ForTwitterVideo: false, // Check OAuth2 first
      });

      console.log('🔍 ScheduleDialog - Token validation result:', validation.data);

      // Check if any platforms need OAuth2 reauth
      const platformsNeedingAuth = validation.data.platforms
        .filter((p: any) => p.requiresReauth || !p.connected)
        .map((p: any) => p.platform);

      if (platformsNeedingAuth.length > 0) {
        // Show auth dialog and initiate OAuth2 flow
        console.log('🔐 ScheduleDialog - Platforms needing OAuth2:', platformsNeedingAuth);
        setAuthPlatforms(platformsNeedingAuth);
        setCurrentAuthIndex(0);
        setShowAuthDialog(true);
        setIsScheduling(false);
        return;
      }

      console.log('✅ ScheduleDialog - All OAuth2 tokens valid');
      
      // For Twitter video posts, also check OAuth1
      if (isVideo && platforms.includes('twitter')) {
        console.log('🎬 ScheduleDialog - Video post for Twitter, checking OAuth1...');
        const oauth1Status = await oauth1Api.getOAuth1Status();
        
        if (!oauth1Status.data.oauth1Valid) {
          console.log('🔐 ScheduleDialog - OAuth1 needed for Twitter video');
          setNeedsOAuth1(true);
          setIsScheduling(false);
          // Trigger OAuth1 flow
          await initiateOAuth1Flow();
          return;
        }
        console.log('✅ ScheduleDialog - OAuth1 valid for Twitter video');
      }
      
      // All authorizations complete, proceed with scheduling
      await performSchedule();
    } catch (error: any) {
      console.error('Error scheduling:', error);
      toast({
        title: "Couldn't Schedule Post",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setIsScheduling(false);
    }
  };
  
  const initiateOAuth1Flow = async () => {
    try {
      const response = await oauth1Api.initiateOAuth1();
      
      if (response.data?.authUrl) {
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        
        const popup = window.open(
          response.data.authUrl,
          'twitter_oauth1',
          `width=${width},height=${height},left=${left},top=${top}`
        );
        
        // Listen for OAuth1 completion
        const handleMessage = async (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          
          if (event.data.type === 'oauth1_success' || event.data.type === 'twitter_oauth1_connected') {
            window.removeEventListener('message', handleMessage);
            popup?.close();
            
            setNeedsOAuth1(false);
            
            toast({
              title: "Video Authorization Complete",
              description: "You can now schedule video posts to Twitter!",
            });
            
            // Now proceed with scheduling
            setIsScheduling(true);
            await performSchedule();
          } else if (event.data.type === 'oauth1_error') {
            window.removeEventListener('message', handleMessage);
            popup?.close();
            
            toast({
              title: "Video Authorization Failed",
              description: "Couldn't complete video authorization for Twitter. Please try again.",
              variant: "destructive",
            });
          }
        };
        
        window.addEventListener('message', handleMessage);
        
        toast({
          title: "Video Authorization Required",
          description: "Twitter requires separate authorization for video uploads. Please complete in the popup.",
        });
      }
    } catch (error: any) {
      console.error('OAuth1 initiation error:', error);
      toast({
        title: "Authorization Failed",
        description: "Unable to start video authorization. Please try again.",
        variant: "destructive",
      });
    }
  };

  const performSchedule = async () => {
    // Use captured post data (snapshot from when scheduling started) to ensure consistency
    const postToSchedule = capturedPost || post;
    
    if (!selectedDate || !postToSchedule) return;

    try {
      // Combine date and time
      const [hours, minutes] = selectedTime.split(":").map(Number);
      const scheduledDateTime = new Date(selectedDate);
      scheduledDateTime.setHours(hours, minutes, 0, 0);

      // Validate future date
      if (scheduledDateTime <= new Date()) {
        toast({
          title: "Invalid Date",
          description: "Please select a future date and time",
          variant: "destructive",
        });
        setIsScheduling(false);
        return;
      }

      // Get platforms with multiple fallbacks to ensure never empty
      let platforms = postToSchedule.requestedPlatforms || postToSchedule.platforms || [];
      
      // Extra safeguard: If still empty, use default
      if (!platforms || platforms.length === 0) {
        platforms = ['twitter']; // Default fallback
        console.warn('⚠️ No platforms found in ScheduleDialog performSchedule, using default:', platforms);
      }
      
      console.log('📅 ScheduleDialog performSchedule - Using captured post:', {
        'postToSchedule.generatedContentId': postToSchedule.generatedContentId,
        'postToSchedule.postIndex': postToSchedule.postIndex,
        'postToSchedule.requestedPlatforms': postToSchedule.requestedPlatforms,
        'postToSchedule.platforms': postToSchedule.platforms,
        'final platforms': platforms,
      });
      
      const mediaUrl = postToSchedule.image; // S3 URL
      
      // Robust video detection - check multiple indicators
      const detectMediaType = (url: string | undefined): 'image' | 'video' => {
        if (!url) return 'image';
        
        const urlLower = url.toLowerCase();
        
        // Check file extension
        if (urlLower.includes('.mp4') || urlLower.includes('.mov') || 
            urlLower.includes('.avi') || urlLower.includes('.webm') ||
            urlLower.includes('.mkv')) {
          return 'video';
        }
        
        // Check if URL contains 'video' keyword
        if (urlLower.includes('video') || urlLower.includes('stitched_video')) {
          return 'video';
        }
        
        // Check post.type if available
        if ((postToSchedule as any).type === 'Video') {
          return 'video';
        }
        
        // Default to image
        return 'image';
      };
      
      const mediaType = detectMediaType(postToSchedule.image);
      console.log(`📋 Media type detected: ${mediaType} for URL: ${postToSchedule.image?.substring(0, 80)}...`);

      // Get the full platform texts (not truncated)
      // Use fullPlatformTexts if available, otherwise fall back to description
      const originalPlatformTexts = (postToSchedule as any).fullPlatformTexts || {};
      
      // Merge with user-edited captions (edited captions take priority)
      const editedCaptions = (postToSchedule as any).editedCaptions || {};
      const finalPlatformTexts = { ...originalPlatformTexts };
      
      // Override with user-edited captions for each platform
      Object.keys(editedCaptions).forEach(platform => {
        if (editedCaptions[platform]) {
          finalPlatformTexts[platform] = editedCaptions[platform];
        }
      });
      
      console.log('📤 ScheduleDialog - Sending to API:', {
        'generatedContentId': postToSchedule.generatedContentId,
        'postIndex': postToSchedule.postIndex,
        'originalPlatformTexts': originalPlatformTexts,
        'editedCaptions': editedCaptions,
        'finalPlatformTexts': finalPlatformTexts,
      });
      
      // Call schedule API
      const response = await postingApi.schedulePost({
        scheduledFor: scheduledDateTime.toISOString(),
        platforms,
        content: {
          caption: postToSchedule.description || postToSchedule.title, // For display purposes
          platformTexts: finalPlatformTexts, // Full texts with edited captions taking priority
          mediaUrl,
          mediaType,
          generatedContentId: postToSchedule.generatedContentId,
          postIndex: postToSchedule.postIndex,
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      toast({
        title: "Post Scheduled",
        description: `Scheduled for ${format(scheduledDateTime, "MMM dd, yyyy 'at' h:mm a")}`,
      });

      // Call onScheduleComplete with 'true' to indicate successful scheduling
      onScheduleComplete();
      // Close the schedule dialog
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error scheduling:', error);
      toast({
        title: "Couldn't Schedule Post",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScheduling(false);
    }
  };

  const handleAuthPlatform = async (platformIndex?: number) => {
    const index = platformIndex ?? currentAuthIndex;
    
    if (index >= authPlatforms.length) {
      // All platforms authorized, proceed with scheduling
      setShowAuthDialog(false);
      setIsScheduling(true);
      await performSchedule();
      return;
    }

    const platform = authPlatforms[index];

    try {
      let authUrlResponse;
      
      switch (platform) {
        case 'twitter':
          authUrlResponse = await authApi.getTwitterLoginUrl();
          break;
        case 'instagram':
          authUrlResponse = await socialConnectionsApi.getInstagramAuthUrl();
          break;
        case 'linkedin':
          authUrlResponse = await socialConnectionsApi.getLinkedInAuthUrl();
          break;
        case 'tiktok':
          authUrlResponse = await socialConnectionsApi.getTikTokAuthUrl();
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }

      // Open auth popup
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        authUrlResponse.data.authUrl || authUrlResponse.data.oauth_url,
        `${platform}_auth`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Listen for auth completion
      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        
        // Handle different message types for different platforms
        const successTypes = [
          'twitter_connected',
          'instagram_connected', 
          'linkedin_connected',
          'tiktok_connected',
          `${platform}_auth_success`
        ];
        
        if (successTypes.includes(event.data.type)) {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          
          toast({
            title: "Connected!",
            description: `${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully`,
          });
          
          const nextIndex = index + 1;
          setCurrentAuthIndex(nextIndex);
          
          // Automatically proceed to next platform or schedule
          if (nextIndex < authPlatforms.length) {
            // Small delay to allow UI to update, then auto-trigger next auth
            setTimeout(() => {
              handleAuthPlatform(nextIndex);
            }, 500);
          } else {
            // All OAuth2 done - check if OAuth1 needed for Twitter video
            setShowAuthDialog(false);
            
            // Check if this is a Twitter video post needing OAuth1
            const platforms = post?.requestedPlatforms || post?.platforms || [];
            if (isVideoPost && platforms.includes('twitter')) {
              console.log('🎬 ScheduleDialog - OAuth2 complete, checking OAuth1 for Twitter video...');
              try {
                const oauth1Status = await oauth1Api.getOAuth1Status();
                if (!oauth1Status.data.oauth1Valid) {
                  console.log('🔐 ScheduleDialog - OAuth1 needed');
                  setNeedsOAuth1(true);
                  toast({
                    title: "One More Step for Videos",
                    description: "Twitter requires separate authorization for video uploads. Please complete in the popup.",
                  });
                  await initiateOAuth1Flow();
                  return;
                }
              } catch (error) {
                console.error('OAuth1 check error:', error);
              }
            }
            
            // All authorizations complete, proceed with scheduling
            setIsScheduling(true);
            performSchedule();
          }
        }
      };

      window.addEventListener('message', handleMessage);

      // Check if popup was blocked
      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }
    } catch (error: any) {
      toast({
        title: "Connection Failed",
        description: "Unable to connect. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleReplacePost = () => {
    setShowOverlapDialog(false);
    onScheduleComplete();
    onOpenChange(false);
  };

  const handleChangeTime = () => {
    setShowOverlapDialog(false);
  };

  const getPostsForDate = (date: Date) => {
    return scheduledPosts.filter(
      (post) => post.date.toDateString() === date.toDateString()
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] max-w-4xl h-auto max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl md:text-2xl">Schedule Post</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 py-4">
            {/* Calendar Section */}
            <div className="space-y-4">
              <div>
                <Label className="text-sm sm:text-base">Select Date</Label>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  className="rounded-md border mx-auto lg:mx-0"
                  disabled={(date) => {
                    // Disable past dates (before today)
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return date < today;
                  }}
                  modifiers={{
                    scheduled: scheduledPosts.map(p => p.date)
                  }}
                  modifiersStyles={{
                    scheduled: {
                      fontWeight: 'bold',
                      backgroundColor: 'hsl(var(--primary) / 0.1)',
                    }
                  }}
                />
              </div>

              <div>
                <Label htmlFor="time" className="text-sm sm:text-base">Select Time</Label>
                <div className="relative mt-2">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="time"
                    type="time"
                    value={selectedTime}
                    onChange={(e) => setSelectedTime(e.target.value)}
                    min={getMinTime()}
                    className="pl-10 text-sm sm:text-base"
                  />
                </div>
                {selectedDate && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedDate.toDateString() === new Date().toDateString()
                      ? `Minimum time: ${getMinTime()} (current time + 5 min)`
                      : "Select any time for future dates"}
                  </p>
                )}
              </div>
            </div>

            {/* Scheduled Posts Section */}
            <div className="space-y-4">
              <div>
                <Label className="text-sm sm:text-base">Scheduled Posts</Label>
                {selectedDate ? (
                  <div className="mt-2 space-y-2">
                    {getPostsForDate(selectedDate).length > 0 ? (
                      getPostsForDate(selectedDate).map((post, idx) => (
                        <Card key={idx} className="p-2 sm:p-3">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground" />
                            <span className="text-xs sm:text-sm font-medium">{post.time}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {post.title}
                          </p>
                        </Card>
                      ))
                    ) : (
                      <p className="text-xs sm:text-sm text-muted-foreground py-4">
                        No posts scheduled for this date
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs sm:text-sm text-muted-foreground mt-2">
                    Select a date to see scheduled posts
                  </p>
                )}
              </div>

              {/* Post Preview */}
              {post && (
                <div>
                  <Label className="text-sm sm:text-base">Post Preview</Label>
                  <Card className="mt-2 overflow-hidden">
                    <div className="relative w-full aspect-video bg-gray-100">
                      {post.image && (post.image.includes('video') || post.image.includes('.mp4')) ? (
                        <>
                          <video
                            src={post.image}
                            className="w-full h-full object-cover"
                            muted
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Play className="h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 text-white" fill="white" />
                          </div>
                        </>
                      ) : (
                        <img
                          src={post.image}
                          alt={post.title}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="p-2 sm:p-3">
                      <p className="font-medium text-xs sm:text-sm">{post.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {post.description}
                      </p>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-4">
            <Button 
              variant="outline" 
              className="flex-1 text-sm sm:text-base py-2 sm:py-3" 
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-sm sm:text-base py-2 sm:py-3"
              onClick={handleSchedule}
              disabled={!selectedDate || isScheduling}
            >
              {isScheduling ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                  <span className="text-sm sm:text-base">Scheduling...</span>
                </>
              ) : (
                <span className="text-sm sm:text-base">Schedule Post</span>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Authorization Dialog */}
      <AlertDialog open={showAuthDialog} onOpenChange={setShowAuthDialog}>
        <AlertDialogContent className="w-[95vw] sm:w-[90vw] md:w-auto max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base sm:text-lg md:text-xl">
              Authorization Required
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm">
              To schedule this post, you need to authorize the following platforms:
              <br /><br />
              {authPlatforms.map((platform, index) => (
                <span key={platform}>
                  <strong className={index === currentAuthIndex ? 'text-blue-600' : ''}>
                    {platform.charAt(0).toUpperCase() + platform.slice(1)}
                  </strong>
                  {index < authPlatforms.length - 1 && ', '}
                </span>
              ))}
              <br /><br />
              {currentAuthIndex < authPlatforms.length && (
                <>
                  Click "Authorize" to connect <strong>{authPlatforms[currentAuthIndex]}</strong> in a popup window.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              className="w-full sm:w-auto text-sm sm:text-base"
              onClick={() => setShowAuthDialog(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => handleAuthPlatform(currentAuthIndex)} 
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-sm sm:text-base"
            >
              Authorize {authPlatforms[currentAuthIndex]?.charAt(0).toUpperCase() + authPlatforms[currentAuthIndex]?.slice(1)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showOverlapDialog} onOpenChange={setShowOverlapDialog}>
        <AlertDialogContent className="w-[95vw] sm:w-[90vw] md:w-auto max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base sm:text-lg md:text-xl">
              Post Time Conflict
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm">
              There is already a post scheduled within 2 hours of your selected time ({selectedTime}).
              <br />
              <br />
              <strong>Conflicting post:</strong> {conflictingPost?.title} at {conflictingPost?.time}
              <br />
              <br />
              Would you like to replace the existing post or change your timing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              className="w-full sm:w-auto text-sm sm:text-base"
              onClick={handleChangeTime}
            >
              Change Time
            </Button>
            <Button 
              onClick={handleReplacePost} 
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-sm sm:text-base"
            >
              Replace Post
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
