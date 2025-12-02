"use client";


import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Sparkles, RotateCcw, Music, Calendar as CalendarIcon } from "lucide-react";
import { CaptionEditDialog } from "./CaptionEditDialog";
import { ScheduleDialog } from "./ScheduleDialog";
import { accountApi } from "@/lib/api";

interface Post {
  id: string;
  generatedContentId?: number; // For scheduling
  postIndex?: number; // For scheduling
  date: string;
  time: string;
  type: "Post" | "Story";
  platforms: string[];
  title: string;
  description: string; // Truncated for UI display
  fullPlatformTexts?: any; // Full platform texts for posting
  image: string;
  requestedPlatforms?: string[];
}

interface PostDetailDialogProps {
  post: Post | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditDesignModeChange?: (isEditMode: boolean) => void;
  onScheduleComplete?: () => void;
}

type Platform = "instagram" | "linkedin" | "twitter";

export const PostDetailDialog = ({ post, open, onOpenChange, onEditDesignModeChange, onScheduleComplete }: PostDetailDialogProps) => {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("instagram");
  const [showCaptionEdit, setShowCaptionEdit] = useState(false);
  const [showEditDesign, setShowEditDesign] = useState(false);
  const [caption, setCaption] = useState(post?.description || "");
  const [aiPrompt, setAiPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);

  // Helper function to get platform-specific caption
  const getPlatformCaption = (platform: Platform): string => {
    if (post?.fullPlatformTexts && post.fullPlatformTexts[platform]) {
      return post.fullPlatformTexts[platform];
    }
    // Fallback to description if platform-specific text not available
    return post?.description || "";
  };
  const [platformConnections, setPlatformConnections] = useState<{
    twitter?: { handle: string; name?: string; profileImageUrl?: string };
    instagram?: { username: string; name?: string; profilePicture?: string };
    linkedin?: { name: string; picture?: string };
  }>({});

  // Fetch platform connections on mount
  useEffect(() => {
    const fetchConnections = async () => {
      try {
        const [twitterRes, instagramRes, linkedinRes] = await Promise.all([
          accountApi.getTwitterConnection().catch(() => null),
          accountApi.getInstagramConnection().catch(() => null),
          accountApi.getLinkedInConnection().catch(() => null),
        ]);

        const connections: any = {};

        // Twitter
        if (twitterRes?.data) {
          connections.twitter = { 
            handle: twitterRes.data.twitterHandle || 'account',
            name: twitterRes.data.name,
            profileImageUrl: twitterRes.data.profileImageUrl
          };
        }
        
        // Instagram - use name from profileData (preferred) or username
        if (instagramRes?.data) {
          connections.instagram = { 
            username: instagramRes.data.username || 
                     instagramRes.data.profileData?.username || 
                     'instagram_account',
            name: instagramRes.data.profileData?.name,
            profilePicture: instagramRes.data.profileData?.profile_picture_url
          };
        }

        // LinkedIn - use name from connection, prefer profileData.name
        if (linkedinRes?.data) {
          connections.linkedin = { 
            name: linkedinRes.data.profileData?.name || 
                 linkedinRes.data.name || 
                 linkedinRes.data.email || 
                 'Professional Account',
            picture: linkedinRes.data.profileData?.picture
          };
        }

        setPlatformConnections(connections);
      } catch (error) {
        console.error('Failed to fetch platform connections:', error);
      }
    };

    if (open) {
      fetchConnections();
    }
  }, [open]);

  // Notify parent when Edit Design mode changes (desktop only)
  const handleEditDesignToggle = (value: boolean) => {
    setShowEditDesign(value);
    // Only collapse sidebar on desktop
    if (window.innerWidth >= 1024) {
      onEditDesignModeChange?.(value);
    }
  };

  // Reset Edit Design mode when dialog closes
  const handleDialogOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setShowEditDesign(false);
      onEditDesignModeChange?.(false);
    }
  };

  if (!post) return null;

  const handleSaveCaption = (newCaption: string) => {
    setCaption(newCaption);
  };

  const handleOpenScheduleDialog = () => {
    // Just open schedule dialog - don't close PostDetailDialog
    setShowScheduleDialog(true);
  };

  const handleScheduleDialogClose = (scheduleWasCreated?: boolean) => {
    setShowScheduleDialog(false);
    
    // If scheduling was successful, close PostDetailDialog and refresh
    if (scheduleWasCreated) {
      // Close PostDetailDialog completely
      onOpenChange(false);
      
      // Trigger parent refresh
      if (onScheduleComplete) {
        onScheduleComplete();
      }
    }
    // If user cancelled (scheduleWasCreated is false/undefined), do nothing
    // PostDetailDialog stays open in the background
  };

  const handleSendPrompt = () => {
    if (!aiPrompt.trim()) return;
    
    // Add user message
    setChatMessages(prev => [...prev, { role: 'user', content: aiPrompt }]);
    
    // Simulate AI response
    setTimeout(() => {
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I'm updating the design for you now. Please hold on a moment while I make this change."
      }]);
    }, 500);
    
    setAiPrompt("");
  };

  const handleExamplePrompt = (prompt: string) => {
    setAiPrompt(prompt);
  };

  const allPlatformOptions: { id: Platform; label: string; icon: string }[] = [
    { id: "instagram", label: "Instagram", icon: "🟣" },
    { id: "linkedin", label: "LinkedIn", icon: "🔷" },
    { id: "twitter", label: "X / Twitter", icon: "⚫" },
  ];

  // Filter platforms based on requestedPlatforms if available
  const platformOptions = post?.requestedPlatforms && post.requestedPlatforms.length > 0
    ? allPlatformOptions.filter(option => post.requestedPlatforms?.includes(option.id))
    : allPlatformOptions;

  const renderPlatformPreview = () => {
    const isVideo = post.image && (post.image.includes('video') || post.image.includes('.mp4'));
    
    switch (selectedPlatform) {
      case "instagram":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg w-full max-w-sm md:max-w-md mx-auto">
            {/* Instagram Header */}
            <div className="flex items-center justify-between p-2 md:p-3 border-b">
              <div className="flex items-center gap-2">
                {platformConnections.instagram?.profilePicture ? (
                  <img 
                    src={platformConnections.instagram.profilePicture} 
                    alt="Profile"
                    className="w-6 h-6 md:w-8 md:h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                )}
                <span className="font-semibold text-xs md:text-sm text-gray-900">
                  {platformConnections.instagram?.name || platformConnections.instagram?.username || 'instagram_account'}
                </span>
              </div>
              <MoreHorizontal className="w-4 h-4 md:w-5 md:h-5 text-gray-900" />
            </div>
            
            {/* Instagram Media - Images 1:1, Videos 9:16 */}
            <div className={`w-full ${isVideo ? 'aspect-[9/16]' : 'aspect-square'}`}>
              {isVideo ? (
                <video 
                  src={post.image} 
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <img 
                  src={post.image} 
                  alt={post.title}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            
            {/* Instagram Actions */}
            <div className="p-2 md:p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 md:gap-4">
                  <Heart className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                  <MessageCircle className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                  <Send className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                </div>
                <Bookmark className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
              </div>
              <div className="font-semibold text-xs md:text-sm text-gray-900 mb-1">50,024 likes</div>
              <div className="text-xs md:text-sm text-gray-900 line-clamp-3">
                <span className="font-semibold">{platformConnections.instagram?.name || platformConnections.instagram?.username || 'instagram_account'}</span> {getPlatformCaption('instagram')}
              </div>
            </div>
          </div>
        );
      
      case "twitter":
        return (
          <div className="bg-white rounded-2xl overflow-hidden shadow-lg w-full max-w-sm md:max-w-xl mx-auto border border-gray-200">
            {/* Twitter Header */}
            <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4">
              {platformConnections.twitter?.profileImageUrl ? (
                <img 
                  src={platformConnections.twitter.profileImageUrl} 
                  alt="Profile"
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full flex-shrink-0 object-cover"
                />
              ) : (
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gray-300 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 md:gap-2 flex-wrap">
                  <span className="font-bold text-sm md:text-base text-gray-900">
                    {platformConnections.twitter?.name || platformConnections.twitter?.handle || 'Twitter Account'}
                  </span>
                  {platformConnections.twitter?.handle && (
                    <span className="text-gray-500 text-sm md:text-base">
                      @{platformConnections.twitter.handle}
                    </span>
                  )}
                </div>
                <div className="mt-2 text-gray-900 text-sm md:text-lg leading-snug">
                  {getPlatformCaption('twitter')}
                </div>
                <div className="mt-3 rounded-xl md:rounded-2xl overflow-hidden aspect-square">
                  {isVideo ? (
                    <video 
                      src={post.image} 
                      controls
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img 
                      src={post.image} 
                      alt={post.title}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between mt-3 text-gray-500">
                  <MessageCircle className="w-4 h-4 md:w-5 md:h-5" />
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <Heart className="w-4 h-4 md:w-5 md:h-5" />
                  <Bookmark className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
            </div>
          </div>
        );
      
      case "linkedin":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg w-full max-w-sm md:max-w-xl mx-auto border border-gray-200">
            {/* LinkedIn Header */}
            <div className="flex items-start gap-2 md:gap-3 p-3 md:p-4">
              {platformConnections.linkedin?.picture ? (
                <img 
                  src={platformConnections.linkedin.picture} 
                  alt="Profile"
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full flex-shrink-0 object-cover"
                />
              ) : (
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-600 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm md:text-base text-gray-900">
                  {platformConnections.linkedin?.name || 'LinkedIn Account'}
                </div>
                <div className="text-xs md:text-sm text-gray-500">Professional • 1h</div>
              </div>
            </div>
            
            {/* LinkedIn Content */}
            <div className="px-3 md:px-4 pb-3">
              <div className="text-sm md:text-base text-gray-900 mb-3">
                {getPlatformCaption('linkedin')}
              </div>
            </div>
            
            {/* LinkedIn Media - Both Images and Videos 1:1 */}
            <div className="w-full aspect-square">
              {isVideo ? (
                <video 
                  src={post.image} 
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <img 
                  src={post.image} 
                  alt={post.title}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            
            {/* LinkedIn Actions */}
            <div className="flex items-center justify-around p-2 border-t">
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                👍 Like
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                💬 Comment
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                🔄 Repost
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600 text-xs md:text-sm px-2 md:px-4">
                📤 Send
              </Button>
            </div>
          </div>
        );
      
    }
  };

  return (
    <>
      {/* Hide PostDetailDialog when ScheduleDialog is open to prevent z-index conflicts */}
      <Dialog open={open && !showScheduleDialog} onOpenChange={handleDialogOpenChange}>
        <DialogContent className={`${
          showEditDesign 
            ? 'w-[95vw] md:w-[calc(100vw-8rem)] lg:w-[calc(100vw-10rem)] max-w-none ml-0 md:ml-6 lg:ml-6 mr-0 md:mr-6 lg:mr-6' 
            : 'w-[95vw] md:w-[calc(100vw-8rem)] lg:w-auto max-w-7xl ml-0 md:ml-6 lg:ml-0 mr-0 md:mr-6 lg:mr-0'
        } h-[90vh] p-0 gap-0 overflow-hidden z-[100]`}>
          {/* Desktop Layout - 3 Column (with chat panel on left when Edit Design ON) */}
          <div className="hidden lg:flex flex-row h-full overflow-hidden">
            {/* Left Side - AI Chat (Edit Design mode - desktop only) */}
            {showEditDesign && (
              <div className="lg:w-72 bg-background lg:border-r flex-col">
                {/* Header */}
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      <span className="font-semibold">Ask Dvyb to Make Changes</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">BETA</Badge>
                  </div>
                </div>

                {/* Chat Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4">
                    {chatMessages.length === 0 ? (
                      <div className="space-y-2 md:space-y-3">
                        <p className="text-xs md:text-sm text-muted-foreground">Try asking Dvyb to:</p>
                        <div className="space-y-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Make this into green colour")}
                          >
                            Make this into green colour
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Make a generated background")}
                          >
                            Make a generated background
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Change the text style")}
                          >
                            Change the text style
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs h-auto py-2"
                            onClick={() => handleExamplePrompt("Add brand logo")}
                          >
                            Add brand logo
                          </Button>
                        </div>
                      </div>
                    ) : (
                      chatMessages.map((message, index) => (
                        <div key={index} className={`${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                          <div className={`inline-block p-3 rounded-lg text-sm ${
                            message.role === 'user' 
                              ? 'bg-primary text-primary-foreground' 
                              : 'bg-muted'
                          }`}>
                            {message.content}
                          </div>
                        </div>
                      ))
                    )}

                    {/* Example variations */}
                    {chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'assistant' && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Generated variations:</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[1, 2, 3, 4].map((i) => (
                            <div key={i} className={`aspect-square rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 p-3 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all`}>
                              <p className="text-white text-xs font-bold text-center leading-tight">
                                {post.title}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="p-3 md:p-4 border-t space-y-2">
                  <div className="hidden flex gap-2">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs md:text-sm">
                      <Sparkles className="w-3 h-3 md:w-4 md:h-4" />
                      Tools
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1 text-xs md:text-sm">
                      <RotateCcw className="w-3 h-3 md:w-4 md:h-4" />
                      Revert
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ask Dvyb to change something..."
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendPrompt()}
                      className="flex-1 text-sm"
                    />
                    <Button size="icon" onClick={handleSendPrompt}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Center - Platform Preview (desktop) */}
            <div className="flex-1 bg-muted overflow-y-auto">
              <div className="min-h-full p-4 md:p-8 lg:p-8 flex flex-col">
                {/* Platform Preview */}
                <div className="flex items-center justify-center lg:flex-1">
                  {renderPlatformPreview()}
                </div>
                
                {/* Make Changes section - shown below image on mobile/tablet (non-Edit Design) */}
                <div className={`${showEditDesign ? 'hidden' : 'lg:hidden'} mt-6 bg-background rounded-lg p-4`}>
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Make Changes</h2>
                      <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 text-xs md:text-sm"
                      onClick={() => setShowCaptionEdit(true)}
                    >
                      <span className="mr-1 md:mr-2">📝</span>
                      Edit Caption
                    </Button>
                    <div className="flex-1 flex flex-col gap-1">
                      <Button 
                        variant={showEditDesign ? "default" : "outline"} 
                        className="w-full text-xs md:text-sm"
                        disabled={true}
                      >
                        <span className="mr-1 md:mr-2">🎨</span>
                        Edit Design
                      </Button>
                      <span className="text-[10px] text-muted-foreground text-center">Coming Soon</span>
                    </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="text-xs md:text-sm font-medium mb-2">Posting on</h3>
                      <Button 
                        variant="outline" 
                        className="w-full justify-between text-xs md:text-sm hover:bg-accent"
                        onClick={handleOpenScheduleDialog}
                      >
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-3 h-3 md:w-4 md:h-4" />
                          <span>
                            {post.date && post.time ? `${post.date} ${post.time}` : 'Not Selected'}
                          </span>
                        </div>
                        <ChevronRight className="w-3 h-3 md:w-4 md:h-4" />
                      </Button>
                    </div>
                    
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs md:text-sm font-medium">Posts</h3>
                        <Button variant="ghost" size="sm" className="text-xs md:text-sm">
                          ⚙️ Manage
                        </Button>
                      </div>
                      
                      <div className="space-y-2">
                        {platformOptions.map((platform) => (
                          <Card
                            key={platform.id}
                            className={`p-2 md:p-3 cursor-pointer transition-colors ${
                              selectedPlatform === platform.id
                                ? "border-primary bg-primary/5"
                                : "hover:bg-muted/50"
                            }`}
                            onClick={() => setSelectedPlatform(platform.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg md:text-xl">{platform.icon}</span>
                                <span className="font-medium text-sm md:text-base">{platform.label}</span>
                              </div>
                              <div className="w-4 h-4 md:w-5 md:h-5 rounded-full border-2 border-primary flex items-center justify-center">
                                {selectedPlatform === platform.id && (
                                  <div className="w-2 h-2 md:w-3 md:h-3 rounded-full bg-primary" />
                                )}
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Right Side - Make Changes (Desktop Only - non-Edit Design) */}
            <div className="lg:w-80 bg-background lg:border-l p-6 overflow-y-auto">
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-4">Make Changes</h2>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 text-sm"
                      onClick={() => setShowCaptionEdit(true)}
                    >
                      <span className="mr-2">📝</span>
                      Edit Caption
                    </Button>
                    <div className="flex-1 flex flex-col gap-1">
                      <Button 
                        variant={showEditDesign ? "default" : "outline"} 
                        className="w-full text-sm"
                        disabled={true}
                      >
                        <span className="mr-2">🎨</span>
                        Edit Design
                      </Button>
                      <span className="text-[10px] text-muted-foreground text-center">Coming Soon</span>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-sm font-medium mb-2">Posting on</h3>
                  <Button 
                    variant="outline" 
                    className="w-full justify-between text-sm hover:bg-accent"
                    onClick={handleOpenScheduleDialog}
                  >
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      <span>
                        {post.date && post.time ? `${post.date} ${post.time}` : 'Not Selected'}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium">Posts</h3>
                    <Button variant="ghost" size="sm" className="text-sm">
                      ⚙️ Manage
                    </Button>
                  </div>
                  
                  <div className="space-y-2">
                    {platformOptions.map((platform) => (
                      <Card
                        key={platform.id}
                        className={`p-3 cursor-pointer transition-colors ${
                          selectedPlatform === platform.id
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedPlatform(platform.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{platform.icon}</span>
                            <span className="font-medium text-base">{platform.label}</span>
                          </div>
                          <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center">
                            {selectedPlatform === platform.id && (
                              <div className="w-3 h-3 rounded-full bg-primary" />
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile/Tablet Layout - Single Column with Vertical Scroll */}
          <div className="flex lg:hidden flex-col h-full overflow-y-auto">
            {/* Image Preview at Top */}
            <div className="bg-muted p-4 md:p-8 pt-6 md:pt-8 pb-6 md:pb-8 flex items-start justify-center">
              <div className="w-full max-w-md">
                {renderPlatformPreview()}
              </div>
            </div>

            {/* AI Chat Panel (only when Edit Design is ON) */}
            {showEditDesign && (
              <div className="bg-background border-t">
                <div className="px-4 py-3 md:px-6 md:py-4 border-b">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                      <span className="font-semibold text-sm md:text-base">Ask Dvyb to Make Changes</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] md:text-xs px-1.5 md:px-2">BETA</Badge>
                  </div>
                </div>

                <div className="px-4 py-4 md:px-6 md:py-4">
                  <div className="space-y-3 md:space-y-4">
                    {chatMessages.length === 0 ? (
                      <div className="space-y-2 md:space-y-3">
                        <p className="text-xs md:text-sm text-muted-foreground">Try asking Dvyb to:</p>
                        <div className="space-y-2 md:space-y-2.5">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Make this into green colour")}
                          >
                            Make this into green colour
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Make a generated background")}
                          >
                            Make a generated background
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Change the text style")}
                          >
                            Change the text style
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full justify-start text-xs md:text-sm h-auto py-2.5 md:py-2"
                            onClick={() => handleExamplePrompt("Add brand logo")}
                          >
                            Add brand logo
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 md:space-y-4">
                        {chatMessages.map((message, index) => (
                          <div key={index} className={`${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                            <div className={`inline-block p-2.5 md:p-3 rounded-lg text-xs md:text-sm ${
                              message.role === 'user' 
                                ? 'bg-primary text-primary-foreground' 
                                : 'bg-muted'
                            }`}>
                              {message.content}
                            </div>
                          </div>
                        ))}

                        {chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'assistant' && (
                          <div className="space-y-2 md:space-y-3">
                            <p className="text-xs md:text-sm text-muted-foreground">Generated variations:</p>
                            <div className="grid grid-cols-2 gap-2 md:gap-3">
                              {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="aspect-square rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 p-2 md:p-3 flex items-center justify-center cursor-pointer hover:ring-2 ring-primary transition-all">
                                  <p className="text-white text-[10px] md:text-xs font-bold text-center leading-tight">
                                    {post.title}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-4 md:mt-5">
                    <Input
                      placeholder="Ask Dvyb to change something..."
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendPrompt()}
                      className="flex-1 text-xs md:text-sm h-10 md:h-10"
                    />
                    <Button size="icon" className="h-10 w-10 md:h-10 md:w-10" onClick={handleSendPrompt}>
                      <Send className="w-4 h-4 md:w-4 md:h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Make Changes Section */}
            <div className="bg-background border-t px-4 py-4 md:px-6 md:py-5">
              <div className="space-y-5 md:space-y-6">
                <div>
                  <h2 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Make Changes</h2>
                  <div className="flex gap-2 md:gap-3">
                    <Button 
                      variant="outline" 
                      className="flex-1 text-xs md:text-sm h-10 md:h-10"
                      onClick={() => setShowCaptionEdit(true)}
                    >
                      <span className="mr-1.5 md:mr-2">📝</span>
                      Edit Caption
                    </Button>
                    <div className="flex-1 flex flex-col gap-1">
                      <Button 
                        variant={showEditDesign ? "default" : "outline"} 
                        className="w-full text-xs md:text-sm h-10 md:h-10"
                        disabled={true}
                      >
                        <span className="mr-1.5 md:mr-2">🎨</span>
                        Edit Design
                      </Button>
                      <span className="text-[10px] text-muted-foreground text-center">Coming Soon</span>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-xs md:text-sm font-medium mb-2 md:mb-3">Posting on</h3>
                  <Button 
                    variant="outline" 
                    className="w-full justify-between text-xs md:text-sm h-11 md:h-12 px-3 md:px-4 hover:bg-accent"
                    onClick={handleOpenScheduleDialog}
                  >
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      <span>
                        {post.date && post.time ? `${post.date} ${post.time}` : 'Not Selected'}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 md:w-4 md:h-4" />
                  </Button>
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-3 md:mb-4">
                    <h3 className="text-xs md:text-sm font-medium">Posts</h3>
                    <Button variant="ghost" size="sm" className="text-xs md:text-sm h-8 md:h-9 px-2 md:px-3">
                      ⚙️ Manage
                    </Button>
                  </div>
                  
                  <div className="space-y-2 md:space-y-3">
                    {platformOptions.map((platform) => (
                      <Card
                        key={platform.id}
                        className={`p-3 md:p-3.5 cursor-pointer transition-colors ${
                          selectedPlatform === platform.id
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedPlatform(platform.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5 md:gap-3">
                            <span className="text-xl md:text-xl">{platform.icon}</span>
                            <span className="font-medium text-sm md:text-base">{platform.label}</span>
                          </div>
                          <div className="w-5 h-5 md:w-5 md:h-5 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
                            {selectedPlatform === platform.id && (
                              <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-primary" />
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CaptionEditDialog
        open={showCaptionEdit}
        onOpenChange={setShowCaptionEdit}
        initialCaption={caption}
        onSave={handleSaveCaption}
      />

      {/* Schedule Dialog */}
      {post && showScheduleDialog && (
        <ScheduleDialog
          open={showScheduleDialog}
          onOpenChange={(open) => {
            if (!open) {
              // User clicked outside or pressed ESC - treat as cancel
              handleScheduleDialogClose(false);
            }
          }}
          post={{
            ...post,
            generatedContentId: (post as any).contentId, // Map contentId to generatedContentId
            postIndex: (post as any).postIndex,
            fullPlatformTexts: (post as any).fullPlatformTexts, // Pass full texts for posting
          }}
          onScheduleComplete={() => {
            // Scheduling was successful - close both dialogs
            handleScheduleDialogClose(true);
          }}
        />
      )}
    </>
  );
};
