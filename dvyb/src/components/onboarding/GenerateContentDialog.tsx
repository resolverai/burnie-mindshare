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
import { adhocGenerationApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { TikTokIcon } from "@/components/icons/TikTokIcon";

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
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadedS3Urls, setUploadedS3Urls] = useState<string[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [inspirationLinks, setInspirationLinks] = useState<string[]>([""]);
  const [postCount, setPostCount] = useState([2]);
  const [generatedPosts, setGeneratedPosts] = useState<any[]>([]);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showPostingDialog, setShowPostingDialog] = useState(false);
  const [showPostNowOverlap, setShowPostNowOverlap] = useState(false);
  const [postingComplete, setPostingComplete] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [generationUuid, setGenerationUuid] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    if (files.length === 0) return;
    
    setUploadingFiles(true);
    
    try {
      // Upload each file to S3
      const uploadPromises = files.map(file => adhocGenerationApi.uploadImage(file));
      const s3Urls = await Promise.all(uploadPromises);
      
      setUploadedFiles(prev => [...prev, ...files]);
      setUploadedS3Urls(prev => [...prev, ...s3Urls]);
      
      toast({
        title: "Images uploaded",
        description: `${files.length} ${files.length === 1 ? 'image' : 'images'} uploaded successfully`,
      });
    } catch (error: any) {
      console.error('File upload error:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload images",
        variant: "destructive",
      });
    } finally {
      setUploadingFiles(false);
    }
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
      // Start generation
      const response = await adhocGenerationApi.generateContent({
        topic,
        platforms: selectedPlatforms,
        number_of_posts: postCount[0],
        user_prompt: contextText || undefined,
        user_images: uploadedS3Urls.length > 0 ? uploadedS3Urls : undefined,
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
          if (data && (data.generatedImageUrls || data.generatedVideoUrls)) {
            const imageUrls = data.generatedImageUrls || [];
            const videoUrls = data.generatedVideoUrls || [];
            const platformTexts = data.platformTexts || [];
            
            // Update posts with available content
            setGeneratedPosts(prev => prev.map((post, index) => {
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
                  isGenerating: false,
                };
              }
              
              return post; // Keep placeholder
            }));
          }
          
          if (status.status === 'completed') {
            clearInterval(pollInterval);
            console.log('✅ Generation completed!');
          } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            throw new Error(status.progress_message || 'Generation failed');
          }
          
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

  const handlePostClick = (post: any) => {
    setSelectedPost(post);
    setShowPostDetail(true);
  };

  const handleScheduleClick = (post: any) => {
    setSelectedPost(post);
    setShowScheduleDialog(true);
  };

  const handlePostNowClick = (post: any) => {
    setSelectedPost(post);
    // Check for overlap (simplified logic)
    const hasOverlap = Math.random() > 0.5; // Mock overlap check
    
    if (hasOverlap) {
      setShowPostNowOverlap(true);
    } else {
      startPosting();
    }
  };

  const startPosting = () => {
    setShowPostingDialog(true);
    setPostingComplete(false);
    setTimeout(() => {
      setPostingComplete(true);
    }, 2000);
  };

  const handleReplaceAndPost = () => {
    setShowPostNowOverlap(false);
    startPosting();
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
    setUploadedFiles([]);
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
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                  <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    multiple
                    onChange={handleFileUpload}
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to upload files or screenshots</p>
                  </label>
                </div>
                {uploadedFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadedFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Badge variant="secondary">{file.name}</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
                            setUploadedS3Urls(prev => prev.filter((_, i) => i !== idx));
                          }}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {uploadingFiles && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading images...</span>
                  </div>
                )}
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
                  {post.image ? (
                    <img
                      src={post.image}
                      alt={post.title}
                      className="w-full aspect-square object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-muted flex items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  )}
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
        post={selectedPost}
        open={showScheduleDialog}
        onOpenChange={setShowScheduleDialog}
        onScheduleComplete={() => {
          setShowScheduleDialog(false);
          onOpenChange(false);
          resetDialog();
        }}
      />

      <AlertDialog open={showPostingDialog} onOpenChange={setShowPostingDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">
              {postingComplete ? "Posted Successfully!" : "Posting..."}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              {!postingComplete && (
                <div className="flex flex-col items-center justify-center py-6">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                  <p>Publishing your content</p>
                </div>
              )}
              {postingComplete && (
                <div className="py-6">
                  <p className="text-lg">Your post has been published successfully!</p>
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
                  onOpenChange(false);
                  resetDialog();
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
