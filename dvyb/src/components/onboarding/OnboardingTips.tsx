"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, Mail, Send, Instagram, Facebook, Linkedin, Youtube, Loader2 } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { topicsApi, contextApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface OnboardingTipsProps {
  onComplete: () => void;
}

interface TopicData {
  topic: string;
  example: {
    title: string;
    subtitle: string;
  };
}

interface ContextData {
  accountName: string;
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
  };
  mediaChannels: {
    social: string[];
    video: string[];
  };
}

export const OnboardingTips = ({ onComplete }: OnboardingTipsProps) => {
  const [currentTip, setCurrentTip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [topics, setTopics] = useState<TopicData[]>([]);
  const [context, setContext] = useState<ContextData | null>(null);
  const { accountId } = useAuth();
  
  // Store random colors once - they won't change on navigation
  const [tipColors, setTipColors] = useState<{
    tip1Avatar: string;
    tip1Background: string;
    tip3Avatar: string;
    tip4Avatar: string;
  }>({
    tip1Avatar: "#0099ff",
    tip1Background: "#0099ff",
    tip3Avatar: "#6b21a8",
    tip4Avatar: "#f97316"
  });

  // Fetch topics and context data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [topicsResponse, contextResponse] = await Promise.all([
          topicsApi.getTopics(),
          contextApi.getContext()
        ]);

        if (topicsResponse.success && topicsResponse.data?.generatedTopics) {
          setTopics(topicsResponse.data.generatedTopics);
        }

        if (contextResponse.success && contextResponse.data) {
          const contextData = {
            accountName: contextResponse.data.accountName || "Your Business",
            colorPalette: contextResponse.data.colorPalette || {
              primary: "#0099ff",
              secondary: "#573cff",
              accent: "#fafafa"
            },
            mediaChannels: contextResponse.data.mediaChannels || { social: ["instagram"], video: [] }
          };
          setContext(contextData);
          
          // Set random colors from brand palette (only once)
          const colors = [contextData.colorPalette.primary, contextData.colorPalette.secondary, contextData.colorPalette.accent];
          setTipColors({
            tip1Avatar: colors[Math.floor(Math.random() * colors.length)],
            tip1Background: colors[Math.floor(Math.random() * colors.length)],
            tip3Avatar: colors[Math.floor(Math.random() * colors.length)],
            tip4Avatar: colors[Math.floor(Math.random() * colors.length)]
          });
        }
      } catch (error) {
        console.error("Failed to fetch tips data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Helper: Get current week's Monday
  const getCurrentWeekMonday = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust if Sunday
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    return monday;
  };

  // Helper: Format date range for week
  const formatWeekRange = (weekOffset: number) => {
    const monday = getCurrentWeekMonday();
    monday.setDate(monday.getDate() + (weekOffset * 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${monthNames[monday.getMonth()]} ${monday.getDate()} - ${sunday.getDate()}`;
  };

  // Helper: Get random example from topics
  const getRandomExample = () => {
    if (!topics || topics.length === 0) {
      return { title: "YOUR NEXT", subtitle: "ROAD TRIP" };
    }
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];
    return randomTopic.example;
  };

  // Helper: Get 3 random topics (truncated)
  const getRandomTopics = (count: number) => {
    if (!topics || topics.length === 0) {
      return ["Interactive Polls about Content", "Tips for Maintaining Brand Consistency", "The difference between content types"];
    }
    const shuffled = [...topics].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count).map(t => {
      if (t.topic.length > 30) {
        return t.topic.substring(0, 30) + "...";
      }
      return t.topic;
    });
  };

  // Helper: Render channel icon
  const renderChannelIcon = (channel: string) => {
    const channelLower = channel.toLowerCase();
    if (channelLower.includes('instagram')) {
      return <Instagram className="w-4 h-4" />;
    } else if (channelLower.includes('facebook')) {
      return <Facebook className="w-4 h-4" />;
    } else if (channelLower.includes('linkedin')) {
      return <Linkedin className="w-4 h-4" />;
    } else if (channelLower.includes('youtube')) {
      return <Youtube className="w-4 h-4" />;
    } else if (channelLower.includes('twitter') || channelLower.includes('x')) {
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 md:p-6 bg-gradient-to-br from-background via-background to-muted">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading tips...</p>
        </div>
      </div>
    );
  }

  const example = getRandomExample();
  const randomTopics = getRandomTopics(3);

  const tips = [
    {
      icon: "✨",
      title: "So what do I need to do right now?",
      steps: [
        {
          number: 1,
          title: "Review this week's content",
          description: "Edit, delete, or keep posts. Your calendar, your call.",
        },
        {
          number: 2,
          title: "Review next week's topics",
          description: "Check your Brand Plan. Update topics as you like.",
        },
      ],
      rightContent: "preview",
    },
    {
      icon: "✨",
      title: "So what do I need to do right now?",
      steps: [
        {
          number: 1,
          title: "Review this week's content",
          description: "Edit, delete, or keep posts. Your calendar, your call.",
        },
        {
          number: 2,
          title: "Review next week's topics",
          description: "Check your Brand Plan. Update topics as you like.",
        },
      ],
      rightContent: "topics",
    },
    {
      icon: "✨",
      title: "Check Dvyb every Monday.",
      workflow: true,
    },
    {
      icon: "💼",
      title: "Brand Kit = Your Content DNA",
      description: "Everything that makes you \"you\" lives here.",
      subtitle: "Voice, visuals, messaging—all in one place.",
      tip: "Pro Tip: Add fresh photos weekly.",
      tipDescription: "More images = more variety in your posts. Think of it as briefing your AI marketing team.",
      rightContent: "images",
    },
    {
      icon: "🙋",
      title: "Real Humans, Real Help",
      description: "Never Get Stuck",
      subtitle: "Integration issues? Strategy questions? Our team helps with everything Dvyb.",
      tip: "Click Support in the menu →",
      tipDescription: "Real humans answer ASAP.",
      rightContent: "support",
    },
  ];

  const handleNext = () => {
    if (currentTip < tips.length - 1) {
      setCurrentTip(currentTip + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentTip > 0) {
      setCurrentTip(currentTip - 1);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-6 bg-gradient-to-br from-background via-background to-muted">
      <div className="max-w-5xl w-full space-y-4 md:space-y-6">
        {/* DVYB Logo */}
        <div className="flex justify-center md:justify-start px-2">
          <div className="w-32 h-24 md:w-40 md:h-28 flex items-center justify-center">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <Card className="p-6 md:p-8 shadow-card-hover animate-fade-in">
            <div className="space-y-4 md:space-y-6">
              <div className="text-3xl md:text-4xl">{tips[currentTip].icon}</div>
              <h2 className="text-xl md:text-2xl font-bold text-foreground">
                {tips[currentTip].title}
              </h2>

              {tips[currentTip].workflow ? (
                <div className="space-y-8 pt-4">
                  <div className="flex items-start gap-6">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Mail className="w-6 h-6 text-primary" />
                      </div>
                      <div className="w-px h-20 bg-gradient-to-b from-primary/50 to-accent/50" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">Every Monday</h3>
                      <p className="text-sm text-muted-foreground">
                        Dvyb delivers fresh content for the week. You'll get an email. Edit anything you want.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-6">
                    <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
                      <Send className="w-6 h-6 text-accent" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">Every Thursday</h3>
                      <p className="text-sm text-muted-foreground">
                        Content starts going live as scheduled. Set it and forget it, or stay in control.
                      </p>
                    </div>
                  </div>
                </div>
              ) : tips[currentTip].steps ? (
                <div className="space-y-4">
                  {tips[currentTip].steps.map((step) => (
                    <div key={step.number} className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-semibold">
                        {step.number}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground mb-1">{step.title}</h3>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-6 pt-4">
                  {tips[currentTip].description && (
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">{tips[currentTip].description}</h3>
                      <p className="text-sm text-muted-foreground">{tips[currentTip].subtitle}</p>
                    </div>
                  )}
                  {tips[currentTip].tip && (
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">{tips[currentTip].tip}</h3>
                      <p className="text-sm text-muted-foreground">{tips[currentTip].tipDescription}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col md:flex-row items-center justify-between pt-6 md:pt-8 gap-4 md:gap-0">
                <Button
                  variant="ghost"
                  onClick={handleBack}
                  disabled={currentTip === 0}
                  className="w-full md:w-auto"
                >
                  Back
                </Button>

                <div className="flex gap-2">
                  {tips.map((_, index) => (
                    <div
                      key={index}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === currentTip ? "bg-foreground" : "bg-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>

                <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4 w-full md:w-auto">
                  <span className="text-sm text-muted-foreground">
                    Tip {currentTip + 1} of {tips.length}
                  </span>
                  <Button onClick={handleNext} className="w-full md:w-auto">
                    {currentTip === tips.length - 1 ? "Finish" : "Next"}
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-card-hover animate-fade-in bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
            <div className="space-y-4">
              {tips[currentTip].rightContent === "preview" && (
                <div className="aspect-video rounded-lg flex items-center justify-center overflow-hidden relative" style={{ background: `linear-gradient(135deg, ${tipColors.tip1Background}, ${tipColors.tip1Background})` }}>
                  <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${tipColors.tip1Background}, ${tipColors.tip1Background})` }}>
                    <div className="absolute top-4 left-4 right-4">
                      <div className="bg-white/90 backdrop-blur rounded-lg p-4 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 rounded-full" style={{ backgroundColor: tipColors.tip1Avatar }} />
                          <span className="text-sm font-medium">{context?.accountName || "radiant_health"}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xl font-bold text-primary">{example.title.toUpperCase()}</div>
                          <div className="text-xs text-muted-foreground mt-2">{example.subtitle.toUpperCase()}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tips[currentTip].rightContent === "topics" && (
                <div className="space-y-4">
                  <div className="bg-white rounded-lg p-4 shadow-sm">
                    <h3 className="font-semibold mb-2">Social Media</h3>
                    <div className="space-y-2 text-sm">
                      {context?.mediaChannels?.social?.map((channel, index) => (
                        <div key={index} className="flex items-center gap-2">
                          {renderChannelIcon(channel)}
                          <span>{channel.charAt(0).toUpperCase() + channel.slice(1)} posts / week</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-lg p-4 shadow-sm">
                    <h3 className="font-semibold mb-3">Topics</h3>
                    <div className="space-y-2">
                      {randomTopics.map((topic, index) => (
                        <div 
                          key={index} 
                          className={`p-2 rounded text-sm ${index === 0 ? 'bg-primary/5 border-2 border-primary' : 'bg-gray-50'}`}
                        >
                          {topic}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {tips[currentTip].workflow && (
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                    <div className="w-8 h-8 rounded-full" style={{ backgroundColor: tipColors.tip3Avatar }} />
                    <span className="font-semibold">{context?.accountName || "Your Business"}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm py-2 border-b">
                      <span className="text-muted-foreground">Date</span>
                      <span className="text-muted-foreground">Status</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm">{formatWeekRange(0)}</span>
                      </span>
                      <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                        Publishing
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-gray-300" />
                        <span className="text-sm">{formatWeekRange(1)}</span>
                      </span>
                      <span className="text-xs px-2 py-1 bg-pink-100 text-pink-700 rounded">
                        Generated
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-gray-300" />
                        <span className="text-sm">{formatWeekRange(2)}</span>
                      </span>
                      <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded">
                        Scheduled
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {tips[currentTip].rightContent === "images" && (
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                    <div className="w-8 h-8 rounded-full" style={{ backgroundColor: tipColors.tip4Avatar }} />
                    <span className="font-semibold">{context?.accountName || "Your Business"}</span>
                  </div>
                  <div className="flex gap-2 mb-2 text-sm border-b">
                    <button className="pb-2 text-muted-foreground">Source Materials</button>
                    <button className="pb-2 border-b-2 border-primary text-primary font-medium">Images & Video</button>
                    <button className="pb-2 text-muted-foreground">Brand</button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Today</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="aspect-square bg-gradient-to-br from-blue-200 to-blue-300 rounded" />
                        <div className="aspect-square bg-gradient-to-br from-orange-200 to-orange-300 rounded" />
                        <div className="aspect-square bg-gradient-to-br from-purple-200 to-purple-300 rounded" />
                        <div className="aspect-square bg-gradient-to-br from-gray-200 to-gray-300 rounded" />
                        <div className="aspect-square bg-gradient-to-br from-pink-200 to-pink-300 rounded" />
                        <div className="aspect-square bg-gradient-to-br from-green-200 to-green-300 rounded" />
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Yesterday</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="aspect-square bg-gradient-to-br from-indigo-200 to-indigo-300 rounded" />
                        <div className="aspect-square bg-gradient-to-br from-cyan-200 to-cyan-300 rounded" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tips[currentTip].rightContent === "support" && (
                <div className="bg-black rounded-lg p-4 shadow-sm overflow-hidden relative h-full min-h-[400px]">
                  <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-yellow-500 to-blue-500 opacity-90" />
                  <div className="relative z-10 h-full flex flex-col justify-between">
                    <div className="bg-white rounded-lg p-4 shadow-lg">
                      <div className="text-sm font-medium mb-3 text-muted-foreground">Support</div>
                      <div className="space-y-2">
                        <button className="w-full flex items-center justify-between p-2 hover:bg-gray-50 rounded text-sm">
                          <span className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            Dvyb YouTube Channel
                          </span>
                        </button>
                        <button className="w-full flex items-center justify-between p-2 hover:bg-gray-50 rounded text-sm">
                          <span className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            Help Center
                          </span>
                        </button>
                        <button className="w-full flex items-center justify-between p-2 hover:bg-gray-50 rounded text-sm">
                          <span className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            Dvyb Academy
                          </span>
                        </button>
                        <button className="w-full flex items-center justify-between p-2 hover:bg-gray-50 rounded text-sm font-semibold">
                          <span className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4" />
                            Support
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
