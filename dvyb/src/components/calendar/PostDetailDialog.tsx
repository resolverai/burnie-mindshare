"use client";


import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Sparkles, RotateCcw } from "lucide-react";
import { CaptionEditDialog } from "./CaptionEditDialog";

interface Post {
  id: string;
  date: string;
  time: string;
  type: "Post" | "Story";
  platforms: string[];
  title: string;
  description: string;
  image: string;
}

interface PostDetailDialogProps {
  post: Post | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Platform = "instagram" | "facebook" | "linkedin" | "twitter";

export const PostDetailDialog = ({ post, open, onOpenChange }: PostDetailDialogProps) => {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("instagram");
  const [showCaptionEdit, setShowCaptionEdit] = useState(false);
  const [showEditDesign, setShowEditDesign] = useState(false);
  const [caption, setCaption] = useState(post?.description || "");
  const [aiPrompt, setAiPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);

  if (!post) return null;

  const handleSaveCaption = (newCaption: string) => {
    setCaption(newCaption);
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

  const platformOptions: { id: Platform; label: string; icon: string }[] = [
    { id: "instagram", label: "Instagram", icon: "🟣" },
    { id: "facebook", label: "Facebook", icon: "🔵" },
    { id: "linkedin", label: "LinkedIn", icon: "🔷" },
    { id: "twitter", label: "X / Twitter", icon: "⚫" },
  ];

  const renderPlatformPreview = () => {
    switch (selectedPlatform) {
      case "instagram":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg max-w-md mx-auto">
            {/* Instagram Header */}
            <div className="flex items-center justify-between p-3 border-b">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                <span className="font-semibold text-sm text-gray-900">Account Not Connected</span>
              </div>
              <MoreHorizontal className="w-5 h-5 text-gray-900" />
            </div>
            
            {/* Instagram Image */}
            <div className="w-full aspect-square">
              <img 
                src={post.image} 
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
            
            {/* Instagram Actions */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-4">
                  <Heart className="w-6 h-6 text-gray-900" />
                  <MessageCircle className="w-6 h-6 text-gray-900" />
                  <Send className="w-6 h-6 text-gray-900" />
                </div>
                <Bookmark className="w-6 h-6 text-gray-900" />
              </div>
              <div className="font-semibold text-sm text-gray-900 mb-1">50,024</div>
              <div className="text-sm text-gray-900">
                <span className="font-semibold">Account Not Connected</span> {post.description}
              </div>
            </div>
          </div>
        );
      
      case "twitter":
        return (
          <div className="bg-white rounded-2xl overflow-hidden shadow-lg max-w-xl mx-auto border border-gray-200">
            {/* Twitter Header */}
            <div className="flex items-start gap-3 p-4">
              <div className="w-12 h-12 rounded-full bg-gray-300 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-900">Account Not Connected</span>
                  <span className="text-gray-500">@account</span>
                </div>
                <div className="mt-2 text-gray-900 text-lg leading-snug">
                  {post.title}
                </div>
                <div className="mt-3 rounded-2xl overflow-hidden aspect-video">
                  <img 
                    src={post.image} 
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex items-center justify-between mt-3 text-gray-500">
                  <MessageCircle className="w-5 h-5" />
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <Heart className="w-5 h-5" />
                  <Bookmark className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>
        );
      
      case "linkedin":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg max-w-xl mx-auto border border-gray-200">
            {/* LinkedIn Header */}
            <div className="flex items-start gap-3 p-4">
              <div className="w-12 h-12 rounded-full bg-blue-600 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Account Not Connected</div>
                <div className="text-sm text-gray-500">Professional Title • 1h</div>
              </div>
            </div>
            
            {/* LinkedIn Content */}
            <div className="px-4 pb-3">
              <div className="text-gray-900 mb-3">
                {post.title}
                <br /><br />
                {post.description}
              </div>
            </div>
            
            {/* LinkedIn Image */}
            <div className="w-full aspect-video">
              <img 
                src={post.image} 
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
            
            {/* LinkedIn Actions */}
            <div className="flex items-center justify-around p-2 border-t">
              <Button variant="ghost" size="sm" className="text-gray-600">
                👍 Like
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600">
                💬 Comment
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600">
                🔄 Repost
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600">
                📤 Send
              </Button>
            </div>
          </div>
        );
      
      case "facebook":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg max-w-xl mx-auto border border-gray-200">
            {/* Facebook Header */}
            <div className="flex items-start gap-3 p-4">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Account Not Connected</div>
                <div className="text-xs text-gray-500">Just now • 🌎</div>
              </div>
            </div>
            
            {/* Facebook Content */}
            <div className="px-4 pb-3">
              <div className="text-gray-900">
                {post.title}
                <br /><br />
                {post.description}
              </div>
            </div>
            
            {/* Facebook Image */}
            <div className="w-full aspect-video">
              <img 
                src={post.image} 
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
            
            {/* Facebook Reactions */}
            <div className="px-4 py-2 border-y">
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>50K</span>
                <span>2.3K Comments • 1.2K Shares</span>
              </div>
            </div>
            
            {/* Facebook Actions */}
            <div className="flex items-center justify-around p-2">
              <Button variant="ghost" size="sm" className="text-gray-600">
                👍 Like
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600">
                💬 Comment
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-600">
                🔄 Share
              </Button>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`${showEditDesign ? 'max-w-[95vw]' : 'max-w-7xl'} h-[90vh] p-0 gap-0`}>
          <div className="flex h-full">
            {/* Left Side - AI Chat (only shown in Edit Design mode) */}
            {showEditDesign && (
              <div className="w-80 bg-background border-r flex flex-col">
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
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">Try asking Dvyb to:</p>
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
                <div className="p-4 border-t space-y-2">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="gap-1">
                      <Sparkles className="w-4 h-4" />
                      Tools
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1">
                      <RotateCcw className="w-4 h-4" />
                      Revert
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ask Dvyb to change something..."
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendPrompt()}
                      className="flex-1"
                    />
                    <Button size="icon" onClick={handleSendPrompt}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Center - Platform Preview */}
            <div className="flex-1 bg-muted p-8 overflow-y-auto flex items-center justify-center">
              {renderPlatformPreview()}
            </div>
            
            {/* Right Side - Make Changes */}
            <div className="w-96 bg-background border-l p-6 overflow-y-auto">
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold mb-4">Make Changes</h2>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1"
                      onClick={() => setShowCaptionEdit(true)}
                    >
                      <span className="mr-2">📝</span>
                      Edit Caption
                    </Button>
                    <Button 
                      variant={showEditDesign ? "default" : "outline"} 
                      className="flex-1"
                      onClick={() => setShowEditDesign(!showEditDesign)}
                    >
                      <span className="mr-2">🎨</span>
                      Edit Design
                    </Button>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-sm font-medium mb-2">Posting on</h3>
                  <Button variant="outline" className="w-full justify-between">
                    {post.date} {post.time}
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium">Posts</h3>
                    <Button variant="ghost" size="sm">
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
                            <span className="font-medium">{platform.label}</span>
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
        </DialogContent>
      </Dialog>

      <CaptionEditDialog
        open={showCaptionEdit}
        onOpenChange={setShowCaptionEdit}
        initialCaption={caption}
        onSave={handleSaveCaption}
      />
    </>
  );
};
