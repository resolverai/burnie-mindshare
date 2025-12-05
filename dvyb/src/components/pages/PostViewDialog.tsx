"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Music, Repeat2, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { accountApi, socialConnectionsApi } from "@/lib/api";
import { TikTokIcon } from "@/components/icons/TikTokIcon";

interface PostViewDialogProps {
  post: any;
  platform: "instagram" | "twitter" | "linkedin" | "tiktok";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PostViewDialog = ({ post, platform, open, onOpenChange }: PostViewDialogProps) => {
  const [platformConnections, setPlatformConnections] = useState<{
    twitter?: { handle: string; name?: string; profileImageUrl?: string };
    instagram?: { username: string; name?: string; profilePicture?: string };
    linkedin?: { name: string; picture?: string };
    tiktok?: { displayName: string; avatarUrl?: string };
  }>({});

  useEffect(() => {
    const fetchConnections = async () => {
      try {
        const [twitterRes, instagramRes, linkedinRes, tiktokRes] = await Promise.all([
          accountApi.getTwitterConnection().catch(() => null),
          accountApi.getInstagramConnection().catch(() => null),
          accountApi.getLinkedInConnection().catch(() => null),
          accountApi.getTikTokConnection().catch(() => null),
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

        // TikTok - use displayName from connection or profileData
        if (tiktokRes?.data) {
          connections.tiktok = { 
            displayName: tiktokRes.data.displayName || 
                        tiktokRes.data.profileData?.display_name || 
                        'tiktok_account',
            avatarUrl: tiktokRes.data.profileData?.avatar_url
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

  if (!post) return null;

  const getCaption = () => {
    if (platform === 'twitter') return post.tweetText || post.mainTweet || '';
    if (platform === 'linkedin') return post.postText || post.caption || '';
    if (platform === 'instagram' || platform === 'tiktok') return post.caption || '';
    return '';
  };

  const getMediaUrl = () => {
    if (platform === 'twitter') return post.videoUrl || post.imageUrl || '';
    if (platform === 'instagram' || platform === 'linkedin' || platform === 'tiktok') return post.mediaUrl || post.videoUrl || '';
    return '';
  };

  const isVideo = () => {
    if (platform === 'twitter') return !!post.videoUrl;
    if (platform === 'instagram' || platform === 'linkedin') return post.mediaType === 'video';
    if (platform === 'tiktok') return true; // TikTok is always video
    return false;
  };

  // Determine video aspect ratio based on model:
  // - kling models → 1:1 (aspect-square)
  // - veo3 models → 9:16 (aspect-[9/16])
  // Default to 9:16 if model is unknown
  const getVideoAspectRatio = (isVideoContent: boolean) => {
    if (!isVideoContent) return 'aspect-square'; // Images are always 1:1
    
    const model = (post.videoModel || '').toLowerCase();
    if (model.includes('kling')) {
      return 'aspect-square'; // 1:1 for kling
    }
    // Default to 9:16 for veo3 and other models
    return 'aspect-[9/16]';
  };

  const renderPlatformPreview = () => {
    const caption = getCaption();
    const mediaUrl = getMediaUrl();
    const video = isVideo();
    const videoAspectClass = getVideoAspectRatio(video);

    switch (platform) {
      case "instagram":
        return (
          <div className="bg-white rounded-lg overflow-hidden shadow-lg w-full max-w-sm mx-auto">
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
            
            <div className={`w-full ${video ? videoAspectClass : 'aspect-square'}`}>
              {video ? (
                <video 
                  src={mediaUrl} 
                  controls
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : (
                <img 
                  src={mediaUrl} 
                  alt="Post"
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            
            <div className="p-2 md:p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 md:gap-4">
                  <Heart className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                  <MessageCircle className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                  <Send className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
                </div>
                <Bookmark className="w-5 h-5 md:w-6 md:h-6 text-gray-900" />
              </div>
              {caption && (
                <div className="text-xs md:text-sm text-gray-900">
                  <span className="font-semibold">{platformConnections.instagram?.name || platformConnections.instagram?.username || 'instagram_account'}</span> {caption}
                </div>
              )}
            </div>
          </div>
        );

      case "twitter":
        return (
          <div className="bg-white rounded-2xl overflow-hidden shadow-lg w-full max-w-sm md:max-w-xl mx-auto border border-gray-200">
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
                {caption && (
                  <div className="mt-2 text-gray-900 text-sm md:text-lg leading-snug">
                    {caption}
                  </div>
                )}
                {mediaUrl && (
                  <div className={`mt-3 rounded-xl md:rounded-2xl overflow-hidden ${video ? videoAspectClass : 'aspect-square'}`}>
                    {video ? (
                      <video 
                        src={mediaUrl} 
                        controls
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img 
                        src={mediaUrl} 
                        alt="Post"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                )}
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
            
            <div className="px-3 md:px-4 pb-3">
              {caption && (
                <div className="text-sm md:text-base text-gray-900 mb-3">
                  {caption}
                </div>
              )}
              
              {mediaUrl && (
                <div className={`w-full ${video ? videoAspectClass : 'aspect-square'} rounded-lg overflow-hidden`}>
                  {video ? (
                    <video 
                      src={mediaUrl} 
                      controls
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img 
                      src={mediaUrl} 
                      alt="Post"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-around p-2 border-t">
              <Button variant="ghost" size="sm" className="flex items-center gap-2 text-gray-600 text-xs md:text-sm px-2 md:px-4">
                <ThumbsUp className="w-4 h-4" />
                <span>Like</span>
              </Button>
              <Button variant="ghost" size="sm" className="flex items-center gap-2 text-gray-600 text-xs md:text-sm px-2 md:px-4">
                <MessageCircle className="w-4 h-4" />
                <span>Comment</span>
              </Button>
              <Button variant="ghost" size="sm" className="flex items-center gap-2 text-gray-600 text-xs md:text-sm px-2 md:px-4">
                <Repeat2 className="w-4 h-4" />
                <span>Repost</span>
              </Button>
              <Button variant="ghost" size="sm" className="flex items-center gap-2 text-gray-600 text-xs md:text-sm px-2 md:px-4">
                <Send className="w-4 h-4" />
                <span>Send</span>
              </Button>
            </div>
          </div>
        );

      case "tiktok":
        return (
          <div className={`bg-black rounded-lg overflow-hidden shadow-lg w-full max-w-sm mx-auto relative ${videoAspectClass}`}>
            <div className="absolute inset-0">
              <video 
                src={mediaUrl} 
                controls
                playsInline
                loop
                className="w-full h-full object-cover"
              />
            </div>
            
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute right-2 bottom-20 flex flex-col gap-4 items-center">
                <div className="flex flex-col items-center gap-1">
                  {platformConnections.tiktok?.avatarUrl ? (
                    <img 
                      src={platformConnections.tiktok.avatarUrl} 
                      alt="Avatar"
                      className="w-10 h-10 rounded-full border-2 border-white object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-400 border-2 border-white" />
                  )}
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Heart className="w-8 h-8 text-white" fill="white" />
                  <span className="text-white text-xs font-semibold">125K</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <MessageCircle className="w-8 h-8 text-white" fill="white" />
                  <span className="text-white text-xs font-semibold">1,234</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Bookmark className="w-8 h-8 text-white" fill="white" />
                  <span className="text-white text-xs font-semibold">5,678</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Send className="w-8 h-8 text-white" fill="white" />
                </div>
              </div>
              
              <div className="absolute bottom-2 left-2 right-16 text-white">
                <div className="font-semibold text-sm mb-1">
                  @{platformConnections.tiktok?.displayName || 'tiktok_account'}
                </div>
                {caption && (
                  <div className="text-xs mb-2 line-clamp-2">
                    {caption}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <Music className="w-3 h-3" />
                  <span className="truncate">Original Sound</span>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-6">
        {renderPlatformPreview()}
      </DialogContent>
    </Dialog>
  );
};

