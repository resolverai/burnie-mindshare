"use client";


import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { topicsApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface ContentGenerationProps {
  onComplete: () => void;
}

export const ContentGeneration = ({ onComplete }: ContentGenerationProps) => {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("Generating channels...");
  const { toast } = useToast();

  useEffect(() => {
    let isMounted = true;

    const runAnimation = async () => {
      const steps = [
        { progress: 57, label: "Generating channels...", duration: 1500 },
        { progress: 78, label: "Generating topics", duration: 0, action: 'generate' }, // No delay, wait for generation
        { progress: 95, label: "Finishing up", duration: 1500 },
        { progress: 100, label: "Complete!", duration: 500 },
      ];

      for (let i = 0; i < steps.length; i++) {
        if (!isMounted) break;

        const step = steps[i];
        setProgress(step.progress);
        setCurrentStep(step.label);

        // If this is the topic generation step, wait for it to complete
        if (step.action === 'generate') {
          try {
            console.log('🎯 Starting topic generation...');
            await topicsApi.generateTopics();
            console.log('✅ Topics generated successfully');
            
            // Small delay after generation before moving to next step
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error('Failed to generate topics:', error);
            toast({
              title: "Topic Generation Failed",
              description: "We'll use default topics for now. You can regenerate later.",
              variant: "destructive",
            });
          }
        } else {
          // Normal step with duration
          await new Promise(resolve => setTimeout(resolve, step.duration));
        }
      }

      // Navigate to next page
      if (isMounted) {
        setTimeout(() => onComplete(), 500);
      }
    };

    runAnimation();

    return () => {
      isMounted = false;
    };
  }, [onComplete, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-6 bg-gradient-to-br from-background via-background to-muted">
      <div className="max-w-2xl w-full space-y-6 md:space-y-8 animate-fade-in text-center px-4">
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground">
          Dvyb is creating your first batch of topics
        </h1>
        <p className="text-base md:text-lg text-muted-foreground">
          We're creating unique topics for each channel and post
        </p>

        <div className="space-y-3 md:space-y-4 pt-6 md:pt-8">
          <div className="bg-white rounded-full px-6 md:px-8 py-3 md:py-4 inline-block shadow-card">
            <p className="text-primary font-semibold text-sm md:text-base">
              {currentStep} {progress}%
            </p>
          </div>

          <div className="space-y-2">
            <p className={`text-sm md:text-base text-muted-foreground transition-opacity ${progress >= 78 ? 'opacity-100' : 'opacity-30'}`}>
              Generating topics
            </p>
            <p className={`text-sm md:text-base text-muted-foreground transition-opacity ${progress >= 95 ? 'opacity-100' : 'opacity-30'}`}>
              Finishing up
            </p>
          </div>
        </div>

        <div className="max-w-md mx-auto pt-4">
          <Progress value={progress} className="h-2" />
        </div>
      </div>
    </div>
  );
};
