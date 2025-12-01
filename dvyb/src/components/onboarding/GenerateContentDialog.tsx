"use client";


import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { X, Plus, Upload, Link, Loader2, Twitter, Instagram, Linkedin } from "lucide-react";
import { PostDetailDialog } from "@/components/calendar/PostDetailDialog";
import { ScheduleDialog } from "@/components/calendar/ScheduleDialog";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { adhocGenerationApi, postingApi, oauth1Api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { TikTokIcon } from "@/components/icons/TikTokIcon";
import { FileDropZone } from "@/components/ui/file-drop-zone";

interface GenerateContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "topic" | "platform" | "context" | "review" | "generating" | "results";

const TOPICS = [
  "Product Launch",
  "Industry Insights",
  "Customer Stories",
  "Behind the Scenes",
];

const PLATFORMS = [
  { 
    id: "twitter", 
    name: "Twitter", 
    IconComponent: Twitter,
    color: "bg-black" 
  },
  { 
    id: "instagram", 
    name: "Instagram", 
    IconComponent: Instagram,
    color: "bg-gradient-to-br from-purple-500 to-pink-500" 
  },
  { 
    id: "linkedin", 
    name: "LinkedIn", 
    IconComponent: Linkedin,
    color: "bg-blue-600" 
  },
  { 
    id: "tiktok", 
    name: "TikTok", 
    IconComponent: TikTokIcon,
    color: "bg-black" 
  },
];

export const GenerateContentDialog = ({ open, onOpenChange }: GenerateContentDialogProps) => {
  const [step, setStep] = useState<Step>("topic");
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [customTopic, setCustomTopic] = useState("");
  const [showCustomTopic, setShowCustomTopic] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [contextText, setContextText] = useState("");
  const [uploadedS3Urls, setUploadedS3Urls] = useState<string[]>([]);
  const [inspirationLinks, setInspirationLinks] = useState<string[]>([""]);
  const [postCount, setPostCount] = useState([2]);
  const [generatedPosts, setGeneratedPosts] = useState<any[]>([]);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showPostingDialog, setShowPostingDialog] = useState(false);
  const [showPostNowOverlap, setShowPostNowOverlap] = useState(false);
  const [postingComplete, setPostingComplete] = useState(false);
  const [postingResults, setPostingResults] = useState<any[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [needsOAuth1, setNeedsOAuth1] = useState(false);
  const [pendingPost, setPendingPost] = useState<any>(null);
  const [oauth1State, setOAuth1State] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [generationUuid, setGenerationUuid] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [postSchedules, setPostSchedules] = useState<Record<string, any>>({});
  const [generatedContentId, setGeneratedContentId] = useState<number | null>(null);
  const { toast } = useToast();

  const handleFilesSelected = async (files: File[]): Promise<string[]> => {
    try {
      // Upload each file to S3 and get presigned URLs for preview
      const uploadPromises = files.map(file => adhocGenerationApi.uploadImage(file));
      const s3Urls = await Promise.all(uploadPromises);
      
      // Update state with new URLs
      setUploadedS3Urls(prev => [...prev, ...s3Urls]);
      
      return s3Urls;
    } catch (error: any) {
      throw new Error(error.message || "Failed to upload files. Please try again.");
    }
  };

  const handleRemoveFile = (url: string) => {
    setUploadedS3Urls(prev => prev.filter(u => u !== url));
  };

  const handleGenerate = async () => {
    const topic = selectedTopic || customTopic;
    
    // Immediately show grid with placeholder posts
    const placeholders = Array.from({ length: postCount[0] }, (_, i) => ({
      id: String(i + 1),
      date: new Date().toISOString().split('T')[0],
      time: "10:00 AM",
      type: "Loading",
      platforms: selectedPlatforms,
      title: topic,
      description: "Generating content...",
      image: null,
      platformTexts: {},
      isGenerating: true,
    }));
    
    setGeneratedPosts(placeholders);
    setStep("results"); // Show results grid immediately with placeholders
    
    try {
      // Extract S3 keys from presigned URLs for API submission
      const s3Keys = uploadedS3Urls.length > 0 
        ? uploadedS3Urls.map(url => adhocGenerationApi.extractS3Key(url))
        : undefined;
      
      // Start generation
      const response = await adhocGenerationApi.generateContent({
        topic,
        platforms: selectedPlatforms,
        number_of_posts: postCount[0],
        user_prompt: contextText || undefined,
        user_images: s3Keys,  // Send S3 keys, not presigned URLs
        inspiration_links: inspirationLinks.filter(link => link.trim()).length > 0 
          ? inspirationLinks.filter(link => link.trim()) 
          : undefined,
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Generation failed');
      }
      
      setJobId(response.job_id || null);
      setGenerationUuid(response.uuid || null);
      
      // Poll for status and progressively update grid
      pollGenerationStatus();
      
    } catch (error: any) {
      console.error('Generation error:', error);
      toast({
        title: "Generation failed",
        description: error.message || "Failed to start generation",
        variant: "destructive",
      });
      setStep("review");
      setGeneratedPosts([]);
    }
  };
  
  const pollGenerationStatus = async () => {
    const pollInterval = setInterval(async () => {
      try {
        const status = await adhocGenerationApi.getStatus();
        
        if (status.success) {
          const data = status.data;
          
          // Progressively update grid with generated content
          // Priority 1: Check progressive content in metadata (real-time updates)
          // Priority 2: Check final arrays when generation completes
          const progressiveContent = data?.metadata?.progressiveContent || [];
          const imageUrls = data?.generatedImageUrls || [];
          const videoUrls = data?.generatedVideoUrls || [];
          const platformTexts = data?.platformTexts || [];
          
          if (progressiveContent.length > 0 || imageUrls.length > 0 || videoUrls.length > 0) {
            // Update posts with available content
            setGeneratedPosts(prev => prev.map((post, index) => {
              // Check if this post has progressive content
              const progressiveItem = progressiveContent.find((item: any) => item.postIndex === index);
              
              if (progressiveItem) {
                // Use progressive content (real-time update)
                const isVideo = progressiveItem.contentType === 'video';
                return {
                  ...post,
                  type: isVideo ? "Video" : "Post",
                  title: progressiveItem.platformText?.topic || post.title,
                  description: progressiveItem.platformText?.platforms?.[selectedPlatforms[0]] || post.description,
                  image: progressiveItem.contentUrl,
                  platformTexts: progressiveItem.platformText?.platforms || {},
                  generatedContentId: data?.id, // Store the dvyb_generated_content.id
                  postIndex: index, // Store the index within the arrays
                  requestedPlatforms: data?.requestedPlatforms || selectedPlatforms, // Store platforms from backend
                  isGenerating: false,
                };
              }
              
              // Fallback: Check final arrays (for backwards compatibility)
              const textEntry = platformTexts[index];
              const isClip = textEntry?.content_type === 'clip';
              const mediaUrl = isClip 
                ? videoUrls[index] 
                : imageUrls[index];
              
              // If media is available, update the placeholder
              if (mediaUrl && textEntry) {
                return {
                  ...post,
                  type: isClip ? "Video" : "Post",
                  title: textEntry.topic || post.title,
                  description: textEntry.platforms?.[selectedPlatforms[0]] || post.description,
                  image: mediaUrl,
                  platformTexts: textEntry.platforms || {},
                  generatedContentId: data?.id, // Store the dvyb_generated_content.id
                  postIndex: index, // Store the index within the arrays
                  requestedPlatforms: data?.requestedPlatforms || selectedPlatforms, // Store platforms from backend
                  isGenerating: false,
                };
              }
              
              return post; // Keep placeholder
            }));
          }
          
          if (status.status === 'completed') {
            clearInterval(pollInterval);
            console.log('✅ Generation completed!');
            
            // Store generatedContentId for schedule fetching
            if (data?.id) {
              setGeneratedContentId(data.id);
              // Fetch schedules for this content
              fetchSchedules(data.id);
            }
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            throw new Error(status.progress_message || 'Generation failed');
          }
          
          // Update progress state
          setProgressPercent(status.progress_percent || 0);
          setProgressMessage(status.progress_message || "");
          
          // Log progress
          console.log(`Progress: ${status.progress_percent}% - ${status.progress_message}`);
        }
      } catch (error: any) {
        clearInterval(pollInterval);
        console.error('Status poll error:', error);
        toast({
          title: "Generation failed",
          description: error.message,
          variant: "destructive",
        });
        setStep("review");
        setGeneratedPosts([]);
      }
    }, 3000); // Poll every 3 seconds
  };

  const fetchSchedules = async (contentId: number) => {
    try {
      const response = await postingApi.getSchedules(contentId);
      if (response.success && response.data) {
        // Create a map of postIndex -> schedule
        const scheduleMap: Record<string, any> = {};
        response.data.forEach((schedule: any) => {
          if (schedule.postMetadata?.postIndex !== undefined) {
            const key = `${contentId}-${schedule.postMetadata.postIndex}`;
            scheduleMap[key] = schedule;
          }
        });
        setPostSchedules(scheduleMap);
      }
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }
  };

  const handlePostClick = (post: any) => {
    setSelectedPost(post);
    setShowPostDetail(true);
  };

  const handleScheduleClick = (post: any) => {
    setSelectedPost(post);
    setShowScheduleDialog(true);
  };

  const handleScheduleComplete = () => {
    // Refresh schedules after scheduling
    if (generatedContentId) {
      fetchSchedules(generatedContentId);
    }
  };

  const handlePostNowClick = async (post: any) => {
    setSelectedPost(post);
    setPendingPost(post);

    // Use platforms from post data (saved during generation), not current state
    const platforms = post.requestedPlatforms || selectedPlatforms;

    // Check if Twitter video and needs OAuth1 (only videos require OAuth1)
    if (platforms.includes('twitter') && post.type === 'Video') {
      try {
        const oauth1Status = await oauth1Api.getOAuth1Status();
        // Check if OAuth1 token is valid (not just present)
        if (!oauth1Status.data.oauth1Valid) {
          setNeedsOAuth1(true);
          toast({
            title: "Additional Authorization Required",
            description: "Video posting to Twitter requires OAuth1 authorization. Please authorize in the popup.",
            variant: "default",
          });
          // Initiate OAuth1 flow
          await initiateOAuth1Flow();
          return;
        }
      } catch (error) {
        console.error('Error checking OAuth1 status:', error);
      }
    }

    // Proceed with posting
    await startPosting(post);
  };

  const initiateOAuth1Flow = async () => {
    try {
      const response = await oauth1Api.initiateOAuth1();
      const { authUrl, state, oauthToken, oauthTokenSecret } = response.data;

      // Store state and token secret in localStorage for popup to access
      localStorage.setItem('oauth1_state', state);
      localStorage.setItem('oauth1_token_secret', oauthTokenSecret);
      setOAuth1State({ state, oauthTokenSecret });

      // Open popup
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        authUrl,
        'oauth1_popup',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Monitor popup
      const checkPopup = setInterval(() => {
        if (popup && popup.closed) {
          clearInterval(checkPopup);
          // Cleanup localStorage if popup was closed without completing
          const state = localStorage.getItem('oauth1_state');
          if (state) {
            localStorage.removeItem('oauth1_state');
            localStorage.removeItem('oauth1_token_secret');
          }
        }
      }, 500);

      // Listen for callback
      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (event.data.type === 'oauth1_success') {
          window.removeEventListener('message', handleMessage);
          clearInterval(checkPopup);
          setNeedsOAuth1(false);
          
          toast({
            title: "Authorization Successful",
            description: "You can now post videos to Twitter!",
          });

          // Proceed with posting if we have a pending post
          if (pendingPost) {
            await startPosting(pendingPost);
          }
        } else if (event.data.type === 'oauth1_error') {
          window.removeEventListener('message', handleMessage);
          clearInterval(checkPopup);
          setNeedsOAuth1(false);
          
          toast({
            title: "Authorization Failed",
            description: event.data.message || "Failed to authorize OAuth1",
            variant: "destructive",
          });
        }
      };

      window.addEventListener('message', handleMessage);

      // Cleanup listener after 5 minutes
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        clearInterval(checkPopup);
      }, 5 * 60 * 1000);
    } catch (error: any) {
      toast({
        title: "Authorization Error",
        description: error.message || "Failed to initiate OAuth1 flow",
        variant: "destructive",
      });
    }
  };

  const startPosting = async (post: any) => {
    setShowPostingDialog(true);
    setPostingComplete(false);
    setIsPosting(true);
    setPostingResults([]);

    try {
      // Extract media URL and type
      const mediaUrl = post.image; // This contains the S3 URL
      const mediaType = post.type === 'Video' ? 'video' : 'image';
      
      // Use platforms from post data (saved during generation), not current state
      const platforms = post.requestedPlatforms || selectedPlatforms;

      // Call posting API
      const response = await postingApi.postNow({
        platforms: platforms, // Use saved platforms, not current state
        content: {
          caption: post.description || post.title, // Fallback caption
          platformTexts: post.platformTexts || {}, // Platform-specific full texts
          mediaUrl: mediaUrl,
          mediaType: mediaType,
          generatedContentId: post.generatedContentId, // ID of dvyb_generated_content record
          postIndex: post.postIndex, // Index within the arrays (for tracking)
        },
      });

      setPostingResults(response.data.results);
      setPostingComplete(true);

      // Check if any platform needs OAuth1
      const needsOAuth1 = response.data.results.some((r: any) => r.needsOAuth1);
      if (needsOAuth1) {
        setNeedsOAuth1(true);
        toast({
          title: "Additional Authorization Needed",
          description: "Some platforms require additional authorization",
          variant: "default",
        });
      } else {
        const platforms = post.requestedPlatforms || selectedPlatforms;
        const successCount = response.data.results.filter((r: any) => r.success).length;
        toast({
          title: "Posting Complete",
          description: `Posted to ${successCount}/${platforms.length} platform(s)`,
          variant: successCount > 0 ? "default" : "destructive",
        });
      }
    } catch (error: any) {
      console.error('Posting error:', error);
      setPostingComplete(true);
      toast({
        title: "Posting Failed",
        description: error.message || "Failed to post content",
        variant: "destructive",
      });
    } finally {
      setIsPosting(false);
    }
  };

  const handleReplaceAndPost = () => {
    setShowPostNowOverlap(false);
    if (selectedPost) {
      startPosting(selectedPost);
    }
  };

  const handleScheduleInstead = () => {
    setShowPostNowOverlap(false);
    setShowScheduleDialog(true);
  };

  const resetDialog = () => {
    setStep("topic");
    setSelectedTopic("");
    setCustomTopic("");
    setShowCustomTopic(false);
    setSelectedPlatforms([]);
    setContextText("");
    setUploadedS3Urls([]);
    setInspirationLinks([""]);
    setPostCount([2]);
    setGeneratedPosts([]);
    setJobId(null);
    setGenerationUuid(null);
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const renderStep = () => {
    switch (step) {
      case "topic":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-2">Choose a topic</h2>
              <p className="text-muted-foreground">Select a topic or add your own</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {TOPICS.map((topic) => (
                <Card
                  key={topic}
                  className={`p-6 cursor-pointer transition-all hover:border-primary ${
                    selectedTopic === topic ? "border-primary bg-primary/5" : ""
                  }`}
                  onClick={() => setSelectedTopic(topic)}
                >
                  <p className="font-medium text-center">{topic}</p>
                </Card>
              ))}
            </div>

            {showCustomTopic ? (
              <div className="space-y-2">
                <Input
                  placeholder="Enter your custom topic..."
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  autoFocus
                />
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowCustomTopic(true)}
              >
                <Plus className="w-4 h-4" />
                Add custom topic
              </Button>
            )}

            <Button
              className="w-full"
              disabled={!selectedTopic && !customTopic}
              onClick={() => setStep("platform")}
            >
              Continue
            </Button>
          </div>
        );

      case "platform":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-2">Choose platform(s)</h2>
              <p className="text-muted-foreground">Select where you want to post</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {PLATFORMS.map((platform) => (
                <Card
                  key={platform.id}
                  className={`p-6 cursor-pointer transition-all hover:border-primary ${
                    selectedPlatforms.includes(platform.id) ? "border-primary bg-primary/5" : ""
                  }`}
                  onClick={() => {
                    setSelectedPlatforms(prev =>
                      prev.includes(platform.id)
                        ? prev.filter(p => p !== platform.id)
                        : [...prev, platform.id]
                    );
                  }}
                >
                  <div className="flex flex-col items-center gap-2">
                    <div className={`w-12 h-12 rounded-full ${platform.color} flex items-center justify-center text-white`}>
                      <platform.IconComponent className="w-6 h-6" />
                    </div>
                    <p className="font-medium">{platform.name}</p>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("topic")}>
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={selectedPlatforms.length === 0}
                onClick={() => setStep("context")}
              >
                Continue
              </Button>
            </div>
          </div>
        );

      case "context":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-2">Add context</h2>
              <p className="text-muted-foreground">Provide additional details for better content</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Instructions</label>
                <Textarea
                  placeholder="Add any specific instructions or context..."
                  value={contextText}
                  onChange={(e) => setContextText(e.target.value)}
                  rows={4}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Upload files</label>
                <FileDropZone
                  onFilesSelected={handleFilesSelected}
                  accept="image/*"
                  multiple={true}
                  maxFiles={10}
                  currentFiles={uploadedS3Urls}
                  onRemove={handleRemoveFile}
                  preview={true}
                  uploadType="images"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Inspiration links</label>
                <div className="space-y-2">
                  {inspirationLinks.map((link, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        placeholder="Paste URL, X link, Instagram link..."
                        value={link}
                        onChange={(e) => {
                          const newLinks = [...inspirationLinks];
                          newLinks[idx] = e.target.value;
                          setInspirationLinks(newLinks);
                        }}
                      />
                      {inspirationLinks.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setInspirationLinks(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setInspirationLinks(prev => [...prev, ""])}
                  >
                    <Plus className="w-4 h-4" />
                    Add another link
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("platform")}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep("review")}>
                Continue
              </Button>
            </div>
          </div>
        );

      case "review":
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-2">Review & Generate</h2>
              <p className="text-muted-foreground">Review your selections and generate content</p>
            </div>

            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="font-medium mb-2">Topic</h3>
                <p className="text-muted-foreground">{selectedTopic || customTopic}</p>
              </Card>

              <Card className="p-4">
                <h3 className="font-medium mb-2">Platforms</h3>
                <div className="flex gap-2 flex-wrap">
                  {selectedPlatforms.map(id => {
                    const platform = PLATFORMS.find(p => p.id === id);
                    if (!platform) return null;
                    return (
                      <Badge key={id} variant="secondary" className="flex items-center gap-1.5 py-1.5 px-3">
                        <platform.IconComponent className="w-4 h-4" />
                        <span>{platform.name}</span>
                      </Badge>
                    );
                  })}
                </div>
              </Card>

              {contextText && (
                <Card className="p-4">
                  <h3 className="font-medium mb-2">Instructions</h3>
                  <p className="text-sm text-muted-foreground">{contextText}</p>
                </Card>
              )}

              <div>
                <label className="text-sm font-medium mb-3 block">
                  Number of posts: {postCount[0]}
                </label>
                <Slider
                  value={postCount}
                  onValueChange={setPostCount}
                  min={1}
                  max={4}
                  step={1}
                  className="mb-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("context")}>
                Back
              </Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={handleGenerate}>
                Generate
              </Button>
            </div>
          </div>
        );

      case "results":
        const isGenerating = generatedPosts.some(post => post.isGenerating);
        
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-2">
                {isGenerating ? "Generating your content..." : "Your content is ready!"}
              </h2>
              <p className="text-muted-foreground">
                {isGenerating ? "Content will appear as it's generated" : "Select a post to schedule or publish"}
              </p>
            </div>

            {isGenerating && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{progressMessage || "Preparing..."}</span>
                  <span className="font-medium">{progressPercent}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-primary h-full transition-all duration-300 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {progressMessage.includes("video") && (
                  <p className="text-xs text-muted-foreground italic">
                    ⏱️ Video generation in progress - this may take a few minutes...
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {generatedPosts.map((post) => (
                <Card
                  key={post.id}
                  className={`overflow-hidden transition-all ${
                    post.isGenerating 
                      ? "opacity-60" 
                      : "cursor-pointer hover:border-primary group"
                  }`}
                  onClick={() => !post.isGenerating && handlePostClick(post)}
                >
                  <div className="relative">
                    {post.image ? (
                      post.type === "Video" ? (
                        <div className="w-full aspect-square bg-black">
                          <video
                            src={post.image}
                            controls
                            playsInline
                            muted
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              console.error("Video load error:", e);
                            }}
                          />
                        </div>
                      ) : (
                        <img
                          src={post.image}
                          alt={post.title}
                          className="w-full aspect-square object-cover"
                        />
                      )
                    ) : (
                      <div className="w-full aspect-square bg-muted flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    
                    {/* Schedule/Posted Badges */}
                    {(() => {
                      const scheduleKey = `${post.generatedContentId}-${post.postIndex}`;
                      const schedule = postSchedules[scheduleKey];
                      
                      if (!schedule) return null;
                      
                      const status = schedule.status;
                      const platforms = schedule.postMetadata?.platforms || [];
                      
                      // Determine badge color and text
                      let badgeColor = 'bg-yellow-600';
                      let badgeText = 'Scheduled';
                      
                      if (status === 'posted') {
                        badgeColor = 'bg-green-600';
                        // Show which platforms were posted to
                        const postedPlatforms = schedule.postMetadata?.postingResults
                          ?.filter((r: any) => r.success)
                          .map((r: any) => r.platform.charAt(0).toUpperCase() + r.platform.slice(1)) || [];
                        
                        if (postedPlatforms.length === platforms.length) {
                          badgeText = 'Posted';
                        } else if (postedPlatforms.length > 0) {
                          badgeText = `Posted (${postedPlatforms.length}/${platforms.length})`;
                        } else {
                          badgeText = 'Posted';
                        }
                      } else if (status === 'failed') {
                        badgeColor = 'bg-red-600';
                        badgeText = 'Failed';
                      }
                      
                      return (
                        <div className={`absolute top-2 left-2 ${badgeColor} text-white text-xs font-semibold px-2 py-1 rounded-full z-10`}>
                          {badgeText}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-sm line-clamp-2">{post.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {post.description}
                    </p>
                    {!post.isGenerating && (
                      <div className="flex gap-2 mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleScheduleClick(post);
                          }}
                        >
                          Schedule
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-blue-600 hover:bg-blue-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePostNowClick(post);
                          }}
                        >
                          Post Now
                        </Button>
                      </div>
                    )}
                    {post.isGenerating && (
                      <div className="flex items-center justify-center mt-3 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        Generating...
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={handleClose}
                disabled={isGenerating}
              >
                Done
              </Button>
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={() => setStep("review")}
                disabled={isGenerating}
              >
                Generate More
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <Dialog open={open && !showPostDetail && !showScheduleDialog} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <VisuallyHidden>
            <DialogTitle>Generate Content</DialogTitle>
          </VisuallyHidden>
          <div className="py-6">
            {renderStep()}
          </div>
        </DialogContent>
      </Dialog>

      <PostDetailDialog
        post={selectedPost}
        open={showPostDetail}
        onOpenChange={(open) => {
          setShowPostDetail(open);
          if (!open) setSelectedPost(null);
        }}
      />

      <ScheduleDialog
        post={selectedPost ? {
          ...selectedPost,
          fullPlatformTexts: selectedPost.platformTexts, // Map platformTexts to fullPlatformTexts
          generatedContentId: selectedPost.generatedContentId,
          postIndex: selectedPost.postIndex,
        } : null}
        open={showScheduleDialog}
        onOpenChange={setShowScheduleDialog}
        onScheduleComplete={() => {
          handleScheduleComplete();
          setShowScheduleDialog(false);
          onOpenChange(false);
          resetDialog();
        }}
      />

      <AlertDialog open={showPostingDialog} onOpenChange={setShowPostingDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">
              {!postingComplete ? "Posting..." : "Posting Results"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {!postingComplete && (
                <div className="flex flex-col items-center justify-center py-6">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                  <p>Publishing your content to selected platforms...</p>
                </div>
              )}
              {postingComplete && (
                <div className="py-4 space-y-3">
                  {postingResults.length === 0 ? (
                    <p className="text-lg">No results available</p>
                  ) : (
                    <div className="space-y-2">
                      {postingResults.map((result, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border ${
                            result.success
                              ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                              : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium capitalize">{result.platform}</span>
                            <Badge variant={result.success ? "default" : "destructive"}>
                              {result.success ? "✓ Posted" : "✗ Failed"}
                            </Badge>
                          </div>
                          {result.error && (
                            <p className="text-xs text-muted-foreground mt-1">{result.error}</p>
                          )}
                          {result.needsOAuth1 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 w-full"
                              onClick={initiateOAuth1Flow}
                            >
                              Authorize for Video
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {postingComplete && (
            <AlertDialogFooter>
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700"
                onClick={() => {
                  setShowPostingDialog(false);
                  setPostingResults([]);
                }}
              >
                Done
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showPostNowOverlap} onOpenChange={setShowPostNowOverlap}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post Time Conflict</AlertDialogTitle>
            <AlertDialogDescription>
              There is already a post scheduled within 2 hours of the current time.
              <br />
              <br />
              Would you like to replace the existing post or schedule this post for a different time?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleScheduleInstead}>
              Schedule Instead
            </Button>
            <Button onClick={handleReplaceAndPost} className="bg-blue-600 hover:bg-blue-700">
              Replace & Post
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
