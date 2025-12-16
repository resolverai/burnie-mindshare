"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Trash2, Calendar, Image as ImageIcon, Video, Instagram, Linkedin, Hash, MessageSquare, Target, Palette, Mic } from "lucide-react";
import { ContentStrategyItem } from "@/lib/api";

// Platform icons
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className || "w-5 h-5"} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className || "w-5 h-5"} fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

const getPlatformIcon = (platform: string, className?: string) => {
  switch (platform.toLowerCase()) {
    case 'instagram':
      return <Instagram className={className || "w-5 h-5"} />;
    case 'twitter':
      return <XIcon className={className} />;
    case 'linkedin':
      return <Linkedin className={className || "w-5 h-5"} />;
    case 'tiktok':
      return <TikTokIcon className={className} />;
    default:
      return <Calendar className={className || "w-5 h-5"} />;
  }
};

const getPlatformName = (platform: string) => {
  switch (platform.toLowerCase()) {
    case 'instagram':
      return 'Instagram';
    case 'twitter':
      return 'X / Twitter';
    case 'linkedin':
      return 'LinkedIn';
    case 'tiktok':
      return 'TikTok';
    default:
      return platform;
  }
};

const getPlatformColor = (platform: string) => {
  switch (platform.toLowerCase()) {
    case 'instagram':
      return 'from-purple-500 to-pink-500';
    case 'twitter':
      return 'from-gray-800 to-black';
    case 'linkedin':
      return 'from-blue-600 to-blue-700';
    case 'tiktok':
      return 'from-gray-800 to-black';
    default:
      return 'from-gray-500 to-gray-600';
  }
};

interface StrategyItemDetailProps {
  item: ContentStrategyItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (id: number) => void;
}

export function StrategyItemDetail({ item, open, onOpenChange, onDelete }: StrategyItemDetailProps) {
  if (!item) return null;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to remove this item from your strategy?')) {
      onDelete(item.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-r ${getPlatformColor(item.platform)} flex items-center justify-center text-white`}>
                {getPlatformIcon(item.platform)}
              </div>
              <div>
                <DialogTitle className="text-left">{getPlatformName(item.platform)} Post</DialogTitle>
                <p className="text-sm text-muted-foreground">{formatDate(item.date)}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
              onClick={handleDelete}
            >
              <Trash2 className="w-5 h-5" />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Week Theme */}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-2 text-primary mb-1">
              <Target className="w-4 h-4" />
              <span className="text-sm font-medium">Week {item.weekNumber} Theme</span>
            </div>
            <p className="font-medium">{item.weekTheme}</p>
          </Card>

          {/* Topic */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Topic</h4>
            <p className="text-lg font-medium">{item.topic}</p>
          </div>

          {/* Content Type */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="flex items-center gap-1">
              {item.contentType === 'video' ? (
                <>
                  <Video className="w-3 h-3" />
                  Video
                </>
              ) : (
                <>
                  <ImageIcon className="w-3 h-3" />
                  Image
                </>
              )}
            </Badge>
          </div>

          {/* Metadata sections */}
          {item.metadata && (
            <div className="space-y-4 pt-4 border-t">
              {/* Caption Hint */}
              {item.metadata.captionHint && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                    <MessageSquare className="w-4 h-4" />
                    Caption Hint
                  </div>
                  <p className="text-sm bg-muted/50 p-3 rounded-lg">{item.metadata.captionHint}</p>
                </div>
              )}

              {/* Hashtags */}
              {item.metadata.hashtags && item.metadata.hashtags.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                    <Hash className="w-4 h-4" />
                    Suggested Hashtags
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.metadata.hashtags.map((tag, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        #{tag.replace('#', '')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Call to Action */}
              {item.metadata.callToAction && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                    <Target className="w-4 h-4" />
                    Call to Action
                  </div>
                  <p className="text-sm">{item.metadata.callToAction}</p>
                </div>
              )}

              {/* Visual Style */}
              {item.metadata.visualStyle && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                    <Palette className="w-4 h-4" />
                    Visual Style
                  </div>
                  <p className="text-sm">{item.metadata.visualStyle}</p>
                </div>
              )}

              {/* Tone of Voice */}
              {item.metadata.toneOfVoice && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">
                    <Mic className="w-4 h-4" />
                    Tone of Voice
                  </div>
                  <p className="text-sm">{item.metadata.toneOfVoice}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

