"use client";


import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Instagram, Facebook, Linkedin, Youtube, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { contextApi } from "@/lib/api";

interface ContentChannelsProps {
  onComplete: () => void;
}

export const ContentChannels = ({ onComplete }: ContentChannelsProps) => {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState({
    socialMedia: true,
    instagram: true,
    facebook: false,
    linkedin: false,
    twitter: false,
    video: true,
    instagramReels: true,
    tiktok: false,
    youtube: false,
    blog: false,
    email: false,
  });

  const handleComplete = async () => {
    // Validate that at least one social media channel is selected
    const hasSocialMedia = selectedChannels.instagram || selectedChannels.facebook || selectedChannels.linkedin || selectedChannels.twitter;
    
    // Validate that at least one video channel is selected
    const hasVideo = selectedChannels.instagramReels || selectedChannels.tiktok || selectedChannels.youtube;
    
    if (!hasSocialMedia) {
      toast({
        title: "Selection Required",
        description: "Please select at least one social media channel.",
        variant: "destructive",
      });
      return;
    }
    
    if (!hasVideo) {
      toast({
        title: "Selection Required",
        description: "Please select at least one video channel.",
        variant: "destructive",
      });
      return;
    }

    // Prepare media channels data
    const socialChannels: string[] = [];
    if (selectedChannels.instagram) socialChannels.push('instagram');
    if (selectedChannels.facebook) socialChannels.push('facebook');
    if (selectedChannels.linkedin) socialChannels.push('linkedin');
    if (selectedChannels.twitter) socialChannels.push('twitter');

    const videoChannels: string[] = [];
    if (selectedChannels.instagramReels) videoChannels.push('instagramReels');
    if (selectedChannels.tiktok) videoChannels.push('tiktok');
    if (selectedChannels.youtube) videoChannels.push('youtube');

    const mediaChannels = {
      social: socialChannels,
      video: videoChannels,
    };

    // Save to backend
    setIsSaving(true);
    try {
      await contextApi.updateContext({ mediaChannels });
      
      toast({
        title: "Onboarding Complete!",
        description: "Your brand profile and content strategy are ready.",
      });
      
      onComplete();
    } catch (error: any) {
      console.error('Failed to save media channels:', error);
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save your channel selection. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleChannel = (channel: keyof typeof selectedChannels) => {
    setSelectedChannels((prev) => ({ ...prev, [channel]: !prev[channel] }));
  };

  return (
    <div className="min-h-screen p-4 md:p-6 bg-gradient-to-br from-background via-background to-muted">
      <div className="max-w-4xl mx-auto space-y-4 md:space-y-6 animate-fade-in">
        <div className="text-center space-y-2 px-4">
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground">Tell Autopilot where to focus</h1>
        </div>

        <div className="space-y-3 md:space-y-4">
          <Card className="p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start gap-3 md:gap-4">
              <Checkbox
                id="social-media"
                checked={selectedChannels.socialMedia}
                onCheckedChange={() => toggleChannel("socialMedia")}
                className="mt-1 flex-shrink-0"
              />
              <div className="flex-1 space-y-3 md:space-y-4">
                <div>
                  <label htmlFor="social-media" className="text-lg md:text-xl font-semibold text-foreground cursor-pointer">
                    Social Media
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">Build your audience</p>
                </div>

                {selectedChannels.socialMedia && (
                  <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                    <p className="font-medium text-foreground">Social media channels</p>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="instagram"
                          checked={selectedChannels.instagram}
                          onCheckedChange={() => toggleChannel("instagram")}
                        />
                        <label htmlFor="instagram" className="flex items-center gap-2 cursor-pointer">
                          <Instagram className="w-5 h-5 text-pink-500" />
                          <span className="text-foreground">Instagram</span>
                        </label>
                      </div>

                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="facebook"
                          checked={selectedChannels.facebook}
                          onCheckedChange={() => toggleChannel("facebook")}
                        />
                        <label htmlFor="facebook" className="flex items-center gap-2 cursor-pointer">
                          <Facebook className="w-5 h-5 text-blue-600" />
                          <span className="text-foreground">Facebook</span>
                        </label>
                      </div>

                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="linkedin"
                          checked={selectedChannels.linkedin}
                          onCheckedChange={() => toggleChannel("linkedin")}
                        />
                        <label htmlFor="linkedin" className="flex items-center gap-2 cursor-pointer">
                          <Linkedin className="w-5 h-5 text-blue-700" />
                          <span className="text-foreground">LinkedIn</span>
                        </label>
                      </div>

                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="twitter"
                          checked={selectedChannels.twitter}
                          onCheckedChange={() => toggleChannel("twitter")}
                        />
                        <label htmlFor="twitter" className="flex items-center gap-2 cursor-pointer">
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                          </svg>
                          <span className="text-foreground">Twitter</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start gap-3 md:gap-4">
              <Checkbox
                id="video"
                checked={selectedChannels.video}
                onCheckedChange={() => toggleChannel("video")}
                className="mt-1 flex-shrink-0"
              />
              <div className="flex-1 space-y-3 md:space-y-4">
                <div>
                  <label htmlFor="video" className="text-lg md:text-xl font-semibold text-foreground cursor-pointer">
                    Video
                  </label>
                  <p className="text-sm text-muted-foreground mt-1">Show your personality</p>
                </div>

                {selectedChannels.video && (
                  <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                    <p className="font-medium text-foreground">Video channels</p>
                    
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="instagram-reels"
                          checked={selectedChannels.instagramReels}
                          onCheckedChange={() => toggleChannel("instagramReels")}
                        />
                        <label htmlFor="instagram-reels" className="flex items-center gap-2 cursor-pointer">
                          <Instagram className="w-5 h-5 text-pink-500" />
                          <span className="text-foreground">Instagram Reels</span>
                        </label>
                      </div>

                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="tiktok"
                          checked={selectedChannels.tiktok}
                          onCheckedChange={() => toggleChannel("tiktok")}
                        />
                        <label htmlFor="tiktok" className="flex items-center gap-2 cursor-pointer">
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                          </svg>
                          <span className="text-foreground">TikTok</span>
                        </label>
                      </div>

                      <div className="flex items-center gap-3">
                        <Checkbox
                          id="youtube"
                          checked={selectedChannels.youtube}
                          onCheckedChange={() => toggleChannel("youtube")}
                        />
                        <label htmlFor="youtube" className="flex items-center gap-2 cursor-pointer">
                          <Youtube className="w-5 h-5 text-red-600" />
                          <span className="text-foreground">YouTube</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Blog and Email options hidden for now - will be supported in future */}
          {/* <Card className="p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start gap-3 md:gap-4">
              <Checkbox
                id="blog"
                checked={selectedChannels.blog}
                onCheckedChange={() => toggleChannel("blog")}
                className="mt-1 flex-shrink-0"
              />
              <div className="flex-1">
                <label htmlFor="blog" className="text-lg md:text-xl font-semibold text-foreground cursor-pointer">
                  Blog
                </label>
                <p className="text-sm text-muted-foreground mt-1">Get found when customers search for you</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="flex items-start gap-3 md:gap-4">
              <Checkbox
                id="email"
                checked={selectedChannels.email}
                onCheckedChange={() => toggleChannel("email")}
                className="mt-1 flex-shrink-0"
              />
              <div className="flex-1">
                <label htmlFor="email" className="text-lg md:text-xl font-semibold text-foreground cursor-pointer">
                  Email
                </label>
                <p className="text-sm text-muted-foreground mt-1">Nurture leads and drive sales</p>
              </div>
            </div>
          </Card> */}
        </div>

        <div className="flex justify-center md:justify-end pt-4 px-4">
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
              "Complete Setup"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
