"use client";


import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search, Filter, Eye, Heart, MessageCircle, Share2 } from "lucide-react";
import { PostDetailDialog } from "@/components/calendar/PostDetailDialog";

interface PlatformAnalytics {
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

interface ContentItem {
  id: string;
  date: string;
  time: string;
  type: "Post" | "Story";
  platforms: string[];
  title: string;
  description: string;
  image: string;
  status: "scheduled" | "generated" | "published" | "not-selected";
  selected?: boolean;
  analytics?: PlatformAnalytics[];
}

export const ContentLibrary = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPost, setSelectedPost] = useState<ContentItem | null>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [showPosted, setShowPosted] = useState(false);
  const [showAnalyticsDialog, setShowAnalyticsDialog] = useState(false);

  // Mock data - this will include calendar posts and generated content
  const contentItems: ContentItem[] = [
    {
      id: "1",
      date: "Nov 13 Thu",
      time: "3:00pm",
      type: "Post",
      platforms: ["instagram", "twitter"],
      title: "Turn humor into your fastest growth hack",
      description: "Master AI comedy and watch your engagement soar...",
      image: "/7.jpg",
      status: "scheduled",
    },
    {
      id: "2",
      date: "Nov 14 Fri",
      time: "3:00pm",
      type: "Post",
      platforms: ["instagram", "twitter"],
      title: "Create viral AI-made videos and earn $ROASTS tokens",
      description: "AI and blockchain just flipped digital creation...",
      image: "/2.jpg",
      status: "scheduled",
    },
    {
      id: "3",
      date: "Nov 15 Sat",
      time: "12:00pm",
      type: "Post",
      platforms: ["instagram", "twitter"],
      title: "Decentralized content isn't just buzzwords",
      description: "Connect your wallet, create fearless content...",
      image: "/3.jpg",
      status: "scheduled",
    },
    {
      id: "4",
      date: "Nov 16 Sun",
      time: "9:00am",
      type: "Post",
      platforms: ["instagram", "twitter"],
      title: "Power to creators. No middlemen",
      description: "Burnie AI lets you make roasts, earn crypto...",
      image: "/4.jpg",
      status: "scheduled",
    },
    {
      id: "5",
      date: "",
      time: "",
      type: "Post",
      platforms: ["instagram", "linkedin"],
      title: "AI-powered creativity unleashed",
      description: "Explore the future of content creation...",
      image: "/5.jpg",
      status: "not-selected",
      selected: false,
    },
    {
      id: "6",
      date: "",
      time: "",
      type: "Post",
      platforms: ["twitter"],
      title: "Build, share, and monetize",
      description: "Your content, your rules, your rewards...",
      image: "/6.jpg",
      status: "not-selected",
      selected: false,
    },
    {
      id: "7",
      date: "Nov 10 Mon",
      time: "2:00pm",
      type: "Post",
      platforms: ["instagram", "twitter", "linkedin", "tiktok"],
      title: "Revolutionizing digital content",
      description: "Our AI comedy platform is changing the game...",
      image: "/8.jpg",
      status: "published",
      analytics: [
        { platform: "instagram", views: 15420, likes: 2341, comments: 184, shares: 432 },
        { platform: "twitter", views: 8932, likes: 1567, comments: 92, shares: 234 },
        { platform: "linkedin", views: 5621, likes: 894, comments: 67, shares: 156 },
        { platform: "tiktok", views: 23456, likes: 4521, comments: 312, shares: 789 },
      ],
    },
    {
      id: "8",
      date: "Nov 11 Tue",
      time: "11:00am",
      type: "Post",
      platforms: ["instagram", "twitter"],
      title: "Behind the AI: How it works",
      description: "Dive deep into our technology stack...",
      image: "/9.jpg",
      status: "published",
      analytics: [
        { platform: "instagram", views: 12340, likes: 1876, comments: 145, shares: 321 },
        { platform: "twitter", views: 7821, likes: 1234, comments: 78, shares: 189 },
      ],
    },
  ];

  const filteredContent = contentItems.filter(
    (item) =>
      (showPosted ? item.status === "published" : item.status !== "published") &&
      (item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const scheduledContent = filteredContent.filter(item => item.status === "scheduled");
  const notSelectedContent = filteredContent.filter(item => item.status === "not-selected");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "bg-blue-500";
      case "generated":
        return "bg-green-500";
      case "published":
        return "bg-purple-500";
      case "not-selected":
        return "bg-orange-500";
      default:
        return "bg-gray-500";
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "k";
    }
    return num.toString();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-foreground">Content Library</h1>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Posted Content</span>
                <Switch checked={showPosted} onCheckedChange={setShowPosted} />
              </div>
              <div className="relative w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search content..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button variant="outline">
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Content Grid */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {showPosted ? (
          // Posted Content as Cards
          <>
            {filteredContent.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-muted-foreground">No posted content found</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-4">
                {filteredContent.map((item) => (
                  <Card
                    key={item.id}
                    className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                    onClick={() => {
                      setSelectedPost(item);
                      setShowAnalyticsDialog(true);
                    }}
                  >
                    <div className="relative">
                      <img
                        src={item.image}
                        alt={item.title}
                        className="w-full aspect-square object-cover group-hover:scale-105 transition-transform"
                      />
                      <Badge
                        className={`absolute top-2 right-2 ${getStatusColor(item.status)}`}
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          {item.platforms.includes("instagram") && (
                            <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                          )}
                          {item.platforms.includes("twitter") && (
                            <div className="w-5 h-5 rounded bg-black" />
                          )}
                          {item.platforms.includes("linkedin") && (
                            <div className="w-5 h-5 rounded bg-blue-600" />
                          )}
                          {item.platforms.includes("tiktok") && (
                            <div className="w-5 h-5 rounded bg-black" />
                          )}
                        </div>
                        <span className="text-xs font-medium">{item.type}</span>
                      </div>
                      <h3 className="font-semibold text-sm line-clamp-2">{item.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.date} at {item.time}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : (
          // Scheduled and Not Selected Content
          <>
            {scheduledContent.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Scheduled</h2>
                <div className="grid grid-cols-4 gap-4">
                  {scheduledContent.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => {
                        setSelectedPost(item);
                        setShowPostDetail(true);
                      }}
                    >
                      <div className="relative">
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full aspect-square object-cover group-hover:scale-105 transition-transform"
                        />
                        <Badge
                          className={`absolute top-2 right-2 ${getStatusColor(item.status)}`}
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            {item.platforms.includes("instagram") && (
                              <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                            )}
                            {item.platforms.includes("twitter") && (
                              <div className="w-5 h-5 rounded bg-black" />
                            )}
                            {item.platforms.includes("linkedin") && (
                              <div className="w-5 h-5 rounded bg-blue-600" />
                            )}
                            {item.platforms.includes("tiktok") && (
                              <div className="w-5 h-5 rounded bg-black" />
                            )}
                          </div>
                          <span className="text-xs font-medium">{item.type}</span>
                        </div>
                        <h3 className="font-semibold text-sm line-clamp-2">{item.title}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.date} at {item.time}
                        </p>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {notSelectedContent.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4">Not Selected</h2>
                <div className="grid grid-cols-4 gap-4">
                  {notSelectedContent.map((item) => (
                    <Card
                      key={item.id}
                      className="overflow-hidden hover:shadow-lg transition-all cursor-pointer group"
                      onClick={() => {
                        setSelectedPost(item);
                        setShowPostDetail(true);
                      }}
                    >
                      <div className="relative">
                        <img
                          src={item.image}
                          alt={item.title}
                          className="w-full aspect-square object-cover group-hover:scale-105 transition-transform"
                        />
                        <Badge
                          className={`absolute top-2 right-2 ${getStatusColor(item.status)}`}
                        >
                          not selected
                        </Badge>
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            {item.platforms.includes("instagram") && (
                              <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                            )}
                            {item.platforms.includes("twitter") && (
                              <div className="w-5 h-5 rounded bg-black" />
                            )}
                            {item.platforms.includes("linkedin") && (
                              <div className="w-5 h-5 rounded bg-blue-600" />
                            )}
                            {item.platforms.includes("tiktok") && (
                              <div className="w-5 h-5 rounded bg-black" />
                            )}
                          </div>
                          <span className="text-xs font-medium">{item.type}</span>
                        </div>
                        <h3 className="font-semibold text-sm line-clamp-2">{item.title}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.description}
                        </p>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {filteredContent.length === 0 && (
              <div className="text-center py-16">
                <p className="text-muted-foreground">No content found</p>
              </div>
            )}
          </>
        )}
      </div>

      <PostDetailDialog
        post={selectedPost}
        open={showPostDetail}
        onOpenChange={setShowPostDetail}
      />

      {/* Analytics Dialog */}
      <Dialog open={showAnalyticsDialog} onOpenChange={setShowAnalyticsDialog}>
        <DialogContent className="max-w-2xl">
          {selectedPost && (
            <div className="space-y-6">
              <div className="flex gap-4">
                <img
                  src={selectedPost.image}
                  alt={selectedPost.title}
                  className="w-32 h-32 object-cover rounded"
                />
                <div className="flex-1">
                  <h2 className="text-2xl font-bold mb-2">{selectedPost.title}</h2>
                  <p className="text-muted-foreground mb-3">{selectedPost.description}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {selectedPost.platforms.includes("instagram") && (
                        <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                      )}
                      {selectedPost.platforms.includes("twitter") && (
                        <div className="w-5 h-5 rounded bg-black" />
                      )}
                      {selectedPost.platforms.includes("linkedin") && (
                        <div className="w-5 h-5 rounded bg-blue-600" />
                      )}
                      {selectedPost.platforms.includes("tiktok") && (
                        <div className="w-5 h-5 rounded bg-black" />
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      Posted on {selectedPost.date} at {selectedPost.time}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-xl font-semibold mb-4">Analytics</h3>
                <div className="space-y-6">
                  {selectedPost.analytics?.map((analytics) => (
                    <div key={analytics.platform} className="space-y-3">
                      <div className="flex items-center gap-2">
                        {analytics.platform === "instagram" && (
                          <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-pink-500" />
                        )}
                        {analytics.platform === "twitter" && (
                          <div className="w-6 h-6 rounded bg-black" />
                        )}
                        {analytics.platform === "linkedin" && (
                          <div className="w-6 h-6 rounded bg-blue-600" />
                        )}
                        {analytics.platform === "tiktok" && (
                          <div className="w-6 h-6 rounded bg-black" />
                        )}
                        <span className="font-medium capitalize">{analytics.platform}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-4">
                        <div className="bg-muted/50 p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Eye className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Views</span>
                          </div>
                          <p className="text-2xl font-bold">{formatNumber(analytics.views)}</p>
                        </div>
                        <div className="bg-muted/50 p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Heart className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Likes</span>
                          </div>
                          <p className="text-2xl font-bold">{formatNumber(analytics.likes)}</p>
                        </div>
                        <div className="bg-muted/50 p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageCircle className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Comments</span>
                          </div>
                          <p className="text-2xl font-bold">{formatNumber(analytics.comments)}</p>
                        </div>
                        <div className="bg-muted/50 p-4 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Share2 className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Shares</span>
                          </div>
                          <p className="text-2xl font-bold">{formatNumber(analytics.shares)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
