"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Rocket } from "lucide-react";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";
import { contextApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface WebsiteAnalysisProps {
  onComplete: (websiteUrl: string) => void;
}

const analysisSteps = [
  "Analyzing your website...",
  "Locating business...",
  "Looking up competitors...",
  "Understanding your brand...",
];

export const WebsiteAnalysis = ({ onComplete }: WebsiteAnalysisProps) => {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (isAnalyzing && !analysisComplete) {
      // Step progression: advances every 2 seconds
      const stepInterval = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev < analysisSteps.length - 1) return prev + 1;
          return prev; // Stay at last step "Understanding your brand..."
        });
      }, 2000); // 2 seconds per step

      // Progress bar: reaches 100% in ~7 seconds
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(progressInterval); // Stop progress bar only
            return 100;
          }
          return prev + 1.5; // Slower increment (100 / (7000ms / 100ms) ≈ 1.4)
        });
      }, 100); // Update every 100ms

      return () => {
        clearInterval(stepInterval);
        clearInterval(progressInterval);
      };
    }
  }, [isAnalyzing, analysisComplete]);

  // Navigate to analysis details when complete
  useEffect(() => {
    if (analysisComplete) {
      setTimeout(() => {
        onComplete(websiteUrl);
        router.push('/onboarding/analysis-details');
      }, 500);
    }
  }, [analysisComplete, websiteUrl, onComplete, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (websiteUrl) {
      setIsAnalyzing(true);
      
      // Store website URL in localStorage
      localStorage.setItem('dvyb_pending_website_url', websiteUrl);
      
      try {
        // Call guest website analysis API (unauthenticated)
        const response = await contextApi.analyzeWebsiteGuest(websiteUrl);
        
        if (response.success && response.data) {
          // Store analysis data in localStorage
          localStorage.setItem('dvyb_website_analysis', JSON.stringify(response.data));
          console.log("✅ Website analysis completed and stored in localStorage");
          
          // Mark as complete (will trigger navigation after 500ms)
          setAnalysisComplete(true);
        } else {
          throw new Error('Website analysis failed');
        }
      } catch (error: any) {
        console.error("❌ Website analysis error:", error);
        toast({
          title: "Analysis Failed",
          description: error.message || "Could not analyze your website. Please try again.",
          variant: "destructive",
        });
        setIsAnalyzing(false);
        setProgress(0);
        setCurrentStep(0);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-6 lg:p-8 bg-gradient-to-br from-background via-background to-muted">
      <div className="w-full max-w-2xl space-y-6 md:space-y-8 animate-fade-in">
        <div className="text-center space-y-3 md:space-y-4">
          <div className="w-32 h-24 md:w-48 md:h-32 mx-auto flex items-center justify-center">
            <Image src={dvybLogo} alt="Dvyb Logo" className="w-full h-auto" priority />
          </div>
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground px-4">
            Turning your identity and "vibe" into
            <br className="hidden sm:block" />
            <span className="sm:hidden"> </span>
            Social media content
          </h1>
        </div>

        {!isAnalyzing ? (
          <Card className="p-6 md:p-8 shadow-card-hover">
            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
              <div className="space-y-2">
                <label htmlFor="website" className="text-sm md:text-base font-medium text-foreground">
                  Enter your website URL
                </label>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://yourwebsite.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="text-base md:text-lg h-12"
                  required
                />
              </div>
              <Button type="submit" className="w-full h-12 md:h-14 text-base md:text-lg" size="lg">
                Start Analysis
              </Button>
            </form>
          </Card>
        ) : (
          <div className="space-y-4 md:space-y-6">
            <Card className="p-4 md:p-6 bg-primary/10 border-primary/20">
              <div className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-primary font-medium text-sm md:text-base">{analysisSteps[currentStep]}</span>
                  <span className="text-primary font-bold text-lg md:text-xl">{Math.round(progress)}%</span>
                </div>
                <div className="h-2 md:h-2.5 bg-background rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </Card>

            <div className="space-y-2 md:space-y-3">
              {analysisSteps.map((step, index) => (
                <Card
                  key={step}
                  className={`p-3 md:p-4 transition-all duration-300 ${
                    index <= currentStep ? "bg-card border-primary/50" : "bg-muted/50 border-border/50"
                  } ${index === currentStep ? "animate-pulse-slow" : ""}`}
                >
                  <span className={`text-sm md:text-base ${index <= currentStep ? "text-foreground" : "text-muted-foreground"}`}>
                    {step}
                  </span>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
