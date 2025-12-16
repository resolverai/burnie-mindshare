"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Sparkles, ChevronRight, ChevronLeft, Instagram, Linkedin, Image, Video, Users, TrendingUp, Target, Zap } from "lucide-react";
import { StrategyPreferences, PlatformFollowers } from "@/lib/api";

// Platform icons
const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className || "w-6 h-6"} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className || "w-6 h-6"} fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

interface Question {
  id: string;
  title: string;
  subtitle?: string;
  type: "single" | "multi" | "text" | "followers";
  options?: { value: string; label: string; icon?: React.ReactNode; description?: string }[];
  placeholder?: string;
}

const QUESTIONS: Question[] = [
  {
    id: "goal",
    title: "What's your main goal?",
    subtitle: "We'll create a strategy to achieve 1.5X growth in this area",
    type: "single",
    options: [
      { value: "grow_followers", label: "Grow followers", icon: <Users className="w-6 h-6" />, description: "Increase your audience reach" },
      { value: "get_leads", label: "Get leads", icon: <Target className="w-6 h-6" />, description: "Capture potential customers" },
      { value: "drive_sales", label: "Drive sales", icon: <TrendingUp className="w-6 h-6" />, description: "Convert followers to buyers" },
      { value: "build_community", label: "Build community", icon: <Zap className="w-6 h-6" />, description: "Engage & retain audience" },
    ],
  },
  {
    id: "platforms",
    title: "Which platforms are you active on?",
    subtitle: "Select all that apply",
    type: "multi",
    options: [
      { value: "instagram", label: "Instagram", icon: <Instagram className="w-8 h-8" /> },
      { value: "tiktok", label: "TikTok", icon: <TikTokIcon className="w-8 h-8" /> },
      { value: "twitter", label: "X / Twitter", icon: <XIcon className="w-8 h-8" /> },
      { value: "linkedin", label: "LinkedIn", icon: <Linkedin className="w-8 h-8" /> },
    ],
  },
  {
    id: "platformFollowers",
    title: "How many followers do you have?",
    subtitle: "Enter approximate numbers for each platform",
    type: "followers",
  },
  {
    id: "contentTypes",
    title: "What type of content works best for you?",
    subtitle: "Select your preferred formats",
    type: "multi",
    options: [
      { value: "images", label: "Images", icon: <Image className="w-6 h-6" />, description: "Photos, graphics, carousels" },
      { value: "videos", label: "Videos", icon: <Video className="w-6 h-6" />, description: "Short-form & long-form" },
      { value: "both", label: "Both equally", icon: <Sparkles className="w-6 h-6" />, description: "Mix of formats" },
    ],
  },
  {
    id: "idealCustomer",
    title: "Who are your ideal customers?",
    subtitle: "Help us understand your target audience",
    type: "text",
    placeholder: "e.g., Small business owners aged 30-50, health-conscious millennials, busy parents looking for convenience...",
  },
  {
    id: "postingFrequency",
    title: "How often do you want to post?",
    subtitle: "Consistency is key to growth",
    type: "single",
    options: [
      { value: "daily", label: "Daily", description: "7 posts/week" },
      { value: "few_times_week", label: "Few times a week", description: "3-4 posts/week" },
      { value: "weekly", label: "Weekly", description: "1-2 posts/week" },
    ],
  },
  {
    id: "biggestChallenge",
    title: "What's your biggest content challenge?",
    subtitle: "We'll address this in your strategy",
    type: "single",
    options: [
      { value: "ideas", label: "Coming up with ideas", description: "What to post?" },
      { value: "time", label: "Finding time to create", description: "Too busy to create" },
      { value: "engagement", label: "Getting engagement", description: "Low likes & comments" },
      { value: "consistency", label: "Staying consistent", description: "Hard to post regularly" },
    ],
  },
  {
    id: "businessAge",
    title: "How established is your business?",
    subtitle: "This helps tailor our approach",
    type: "single",
    options: [
      { value: "less_than_1_year", label: "Just starting", description: "< 1 year" },
      { value: "1_to_3_years", label: "Growing", description: "1-3 years" },
      { value: "more_than_3_years", label: "Established", description: "3+ years" },
    ],
  },
];

interface StrategyQuestionnaireProps {
  onComplete: (preferences: StrategyPreferences) => void;
  progressPercent?: number;
  progressMessage?: string;
}

export function StrategyQuestionnaire({ 
  onComplete,
  progressPercent = 0,
  progressMessage = "Generating content..."
}: StrategyQuestionnaireProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<StrategyPreferences>({
    platforms: [],
    contentTypes: [],
    platformFollowers: {},
  });
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left');

  const currentQuestion = QUESTIONS[currentStep];
  const isLastQuestion = currentStep === QUESTIONS.length - 1;
  const isFirstQuestion = currentStep === 0;

  // Skip followers question if no platforms selected
  useEffect(() => {
    if (currentQuestion.id === "platformFollowers" && (!answers.platforms || answers.platforms.length === 0)) {
      setCurrentStep(prev => prev + 1);
    }
  }, [currentStep, answers.platforms, currentQuestion.id]);

  const handleSingleSelect = (value: string) => {
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: value,
    }));
  };

  const handleMultiSelect = (value: string, field: string = currentQuestion.id) => {
    const currentValues = (answers as any)[field] || [];
    const isSelected = currentValues.includes(value);
    
    setAnswers(prev => ({
      ...prev,
      [field]: isSelected
        ? currentValues.filter((p: string) => p !== value)
        : [...currentValues, value],
    }));
  };

  const handleTextChange = (value: string) => {
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: value,
    }));
  };

  const handleFollowersChange = (platform: string, value: string) => {
    const numValue = parseInt(value.replace(/,/g, ''), 10) || 0;
    setAnswers(prev => ({
      ...prev,
      platformFollowers: {
        ...prev.platformFollowers,
        [platform]: numValue,
      },
    }));
  };

  const formatFollowerCount = (num: number | undefined): string => {
    if (!num) return '';
    return num.toLocaleString();
  };

  const animateTransition = (direction: 'left' | 'right', callback: () => void) => {
    setSlideDirection(direction);
    setIsAnimating(true);
    setTimeout(() => {
      callback();
      setIsAnimating(false);
    }, 200);
  };

  const handleNext = () => {
    if (isLastQuestion) {
      onComplete(answers);
    } else {
      animateTransition('left', () => setCurrentStep(prev => prev + 1));
    }
  };

  const handlePrev = () => {
    if (!isFirstQuestion) {
      animateTransition('right', () => setCurrentStep(prev => prev - 1));
    }
  };

  const handleSkip = () => {
    if (isLastQuestion) {
      onComplete(answers);
    } else {
      animateTransition('left', () => setCurrentStep(prev => prev + 1));
    }
  };

  const getCurrentAnswer = () => {
    if (currentQuestion.id === "platforms") {
      return answers.platforms || [];
    }
    if (currentQuestion.id === "contentTypes") {
      return answers.contentTypes || [];
    }
    return (answers as any)[currentQuestion.id] || "";
  };

  const canProceed = () => {
    const answer = getCurrentAnswer();
    if (currentQuestion.type === "multi") {
      return (answer as string[]).length > 0;
    }
    if (currentQuestion.type === "followers") {
      return true; // Followers are optional
    }
    return !!answer;
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'instagram': return <Instagram className="w-5 h-5" />;
      case 'tiktok': return <TikTokIcon className="w-5 h-5" />;
      case 'twitter': return <XIcon className="w-5 h-5" />;
      case 'linkedin': return <Linkedin className="w-5 h-5" />;
      default: return null;
    }
  };

  const getPlatformLabel = (platform: string) => {
    switch (platform) {
      case 'instagram': return 'Instagram';
      case 'tiktok': return 'TikTok';
      case 'twitter': return 'X / Twitter';
      case 'linkedin': return 'LinkedIn';
      default: return platform;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top status bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-gradient-to-r from-primary/5 to-emerald-500/5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">{progressMessage}</span>
        </div>
        <span className="text-sm font-medium text-primary">{progressPercent}%</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
        <div className={`w-full max-w-2xl transition-all duration-200 ${isAnimating ? (slideDirection === 'left' ? '-translate-x-4 opacity-0' : 'translate-x-4 opacity-0') : 'translate-x-0 opacity-100'}`}>
          
          {/* Header with sparkle */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-emerald-500/20 mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Question {currentStep + 1} of {QUESTIONS.length}
            </p>
            <h2 className="text-2xl md:text-3xl font-bold mb-2">{currentQuestion.title}</h2>
            {currentQuestion.subtitle && (
              <p className="text-muted-foreground">{currentQuestion.subtitle}</p>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-8">
            <div 
              className="h-full bg-gradient-to-r from-primary to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${((currentStep + 1) / QUESTIONS.length) * 100}%` }}
            />
          </div>

          {/* Question content */}
          <div className="w-full space-y-4">
            {/* Single select with descriptions */}
            {currentQuestion.type === "single" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {currentQuestion.options?.map((option) => (
                  <Card
                    key={option.value}
                    className={`p-5 cursor-pointer transition-all duration-200 hover:border-primary/50 hover:shadow-md ${
                      getCurrentAnswer() === option.value
                        ? "border-primary bg-gradient-to-br from-primary/10 to-emerald-500/10 ring-2 ring-primary/30 shadow-lg"
                        : "hover:bg-muted/30"
                    }`}
                    onClick={() => handleSingleSelect(option.value)}
                  >
                    <div className="flex items-start gap-4">
                      {option.icon && (
                        <div className={`p-2 rounded-lg ${getCurrentAnswer() === option.value ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          {option.icon}
                        </div>
                      )}
                      <div className="flex-1">
                        <span className="font-semibold block">{option.label}</span>
                        {option.description && (
                          <span className="text-sm text-muted-foreground">{option.description}</span>
                        )}
                      </div>
                      {getCurrentAnswer() === option.value && (
                        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* Multi select for platforms */}
            {currentQuestion.type === "multi" && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {currentQuestion.options?.map((option) => {
                  const isSelected = (getCurrentAnswer() as string[]).includes(option.value);
                  return (
                    <Card
                      key={option.value}
                      className={`p-6 cursor-pointer transition-all duration-200 hover:border-primary/50 hover:shadow-md ${
                        isSelected
                          ? "border-primary bg-gradient-to-br from-primary/10 to-emerald-500/10 ring-2 ring-primary/30 shadow-lg"
                          : "hover:bg-muted/30"
                      }`}
                      onClick={() => handleMultiSelect(option.value, currentQuestion.id)}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className={`transition-colors ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                          {option.icon}
                        </div>
                        <span className="font-medium text-sm text-center">{option.label}</span>
                        {option.description && (
                          <span className="text-xs text-muted-foreground text-center">{option.description}</span>
                        )}
                        {isSelected && (
                          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Followers input */}
            {currentQuestion.type === "followers" && (
              <div className="space-y-4">
                {answers.platforms?.map((platform) => (
                  <Card key={platform} className="p-4">
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-muted">
                        {getPlatformIcon(platform)}
                      </div>
                      <div className="flex-1">
                        <label className="text-sm font-medium block mb-1">
                          {getPlatformLabel(platform)} followers
                        </label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={formatFollowerCount(answers.platformFollowers?.[platform as keyof PlatformFollowers])}
                          onChange={(e) => handleFollowersChange(platform, e.target.value)}
                          placeholder="e.g., 1,000"
                          className="w-full"
                        />
                      </div>
                    </div>
                  </Card>
                ))}
                {(!answers.platforms || answers.platforms.length === 0) && (
                  <p className="text-center text-muted-foreground">
                    Please select platforms first
                  </p>
                )}
              </div>
            )}

            {/* Text input */}
            {currentQuestion.type === "text" && (
              <Card className="p-4">
                <Input
                  value={getCurrentAnswer() as string}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder={currentQuestion.placeholder}
                  className="w-full text-lg border-0 focus-visible:ring-0 p-0"
                />
              </Card>
            )}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between w-full mt-10">
            <div className="flex gap-2">
              {!isFirstQuestion && (
                <Button
                  variant="outline"
                  onClick={handlePrev}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={handleSkip}
                className="text-muted-foreground"
              >
                Skip
              </Button>
            </div>
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="btn-gradient-cta px-8"
              size="lg"
            >
              {isLastQuestion ? "Complete Setup" : "Continue"}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom hint */}
      <div className="text-center py-4 border-t bg-muted/30">
        <p className="text-xs text-muted-foreground">
          Your answers help us create a personalized strategy for <span className="text-primary font-medium">1.5X growth</span> in the next month
        </p>
      </div>
    </div>
  );
}
