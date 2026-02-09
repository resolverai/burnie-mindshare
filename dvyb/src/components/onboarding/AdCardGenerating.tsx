"use client";

import { useState, useEffect, useCallback } from "react";

interface Phase {
  title: string;
  microSteps: string[];
}

const phases: Phase[] = [
  {
    title: "Analyzing Brand Signals",
    microSteps: [
      "Mapping tone & voice",
      "Extracting visual DNA",
      "Studying brand mood",
      "Detecting color patterns",
    ],
  },
  {
    title: "Studying Winning Patterns",
    microSteps: [
      "Comparing high-performing creatives",
      "Evaluating layout structure",
      "Identifying visual hooks",
      "Analyzing attention zones",
    ],
  },
  {
    title: "Rebuilding the Visual",
    microSteps: [
      "Adjusting composition",
      "Refining subject focus",
      "Rebalancing lighting",
      "Enhancing depth",
    ],
  },
  {
    title: "Enhancing Aesthetic Quality",
    microSteps: [
      "Improving texture clarity",
      "Elevating color richness",
      "Polishing highlights",
      "Removing visual noise",
    ],
  },
  {
    title: "Optimizing for Performance",
    microSteps: [
      "Testing caption variations",
      "Calibrating emotional triggers",
      "Refining CTA placement",
      "Balancing contrast for scroll-stop",
    ],
  },
  {
    title: "Final Rendering",
    microSteps: [
      "Running validation checks",
      "Stress testing output",
      "Applying final polish",
      "Preparing export",
    ],
  },
];

const progressMilestones = [12, 27, 39, 61, 78, 100];

const TOTAL_DURATION = 180; // 3 minutes - phases advance until content arrives

interface AdCardGeneratingProps {
  elapsedTime: number;
  startDelay?: number;
  isComplete: boolean;
  cardIndex: number;
}

export function AdCardGenerating({
  elapsedTime,
  startDelay = 0,
  isComplete,
  cardIndex,
}: AdCardGeneratingProps) {
  const [currentPhase, setCurrentPhase] = useState(0);
  const [currentMicroStep, setCurrentMicroStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [displayPercentage, setDisplayPercentage] = useState(0);

  const effectiveElapsedTime = Math.max(0, elapsedTime - startDelay);
  const hasStarted = elapsedTime >= startDelay;
  const phaseDuration = TOTAL_DURATION / 6;
  const microStepDuration = 5;

  // Calculate current phase based on elapsed time
  useEffect(() => {
    const newPhase = Math.min(Math.floor(effectiveElapsedTime / phaseDuration), 5);
    if (newPhase !== currentPhase) {
      setCurrentPhase(newPhase);
      setCurrentMicroStep(0);
    }
  }, [effectiveElapsedTime, phaseDuration, currentPhase]);

  // Rotate micro-steps
  useEffect(() => {
    if (isComplete || !hasStarted) return;

    const interval = setInterval(() => {
      setCurrentMicroStep((prev) => {
        const maxSteps = phases[currentPhase].microSteps.length;
        return (prev + 1) % maxSteps;
      });
    }, microStepDuration * 1000);

    return () => clearInterval(interval);
  }, [currentPhase, isComplete, hasStarted]);

  // Calculate non-linear progress
  useEffect(() => {
    if (isComplete) {
      setProgress(100);
      setDisplayPercentage(100);
      return;
    }

    const phaseProgress = (effectiveElapsedTime % phaseDuration) / phaseDuration;
    const previousMilestone = currentPhase > 0 ? progressMilestones[currentPhase - 1] : 0;
    const currentMilestone = progressMilestones[currentPhase];
    const range = currentMilestone - previousMilestone;

    const easedProgress =
      phaseProgress < 0.5
        ? 2 * phaseProgress * phaseProgress
        : 1 - Math.pow(-2 * phaseProgress + 2, 2) / 2;

    const newProgress = previousMilestone + range * easedProgress;
    setProgress(newProgress);
    setDisplayPercentage(Math.round(newProgress));
  }, [effectiveElapsedTime, currentPhase, phaseDuration, isComplete]);

  const formatTime = useCallback((seconds: number) => {
    const remaining = Math.max(0, TOTAL_DURATION - seconds);
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);

  // Waiting state - card hasn't started yet (stagger)
  if (!hasStarted && !isComplete) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black rounded-t-lg overflow-hidden">
        <div className="relative w-24 h-24 mb-3">
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="3"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <span className="text-xl font-mono font-semibold text-white/50">
              —:——
            </span>
          </div>
        </div>
        <p className="text-xs font-medium text-white/50 text-center px-3">
          Waiting to start...
        </p>
      </div>
    );
  }

  // Generating state - phases, timer, progress
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black rounded-t-lg overflow-hidden">
      {/* Countdown Timer with Ring */}
      <div className="relative w-24 h-24 mb-3">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="3"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="hsl(var(--cta))"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={264}
            strokeDashoffset={264 - (264 * progress) / 100}
            transform="rotate(-90 50 50)"
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <span className="text-xl font-mono font-semibold text-white">
            {formatTime(effectiveElapsedTime)}
          </span>
        </div>
      </div>

      {/* Phase Title */}
      <p
        key={currentPhase}
        className="text-xs font-medium text-white text-center px-3 transition-opacity duration-300"
      >
        {phases[currentPhase].title}
      </p>

      {/* Micro-step */}
      <p
        key={`${currentPhase}-${currentMicroStep}`}
        className="text-[10px] text-white/60 text-center mt-1 px-3 transition-opacity duration-300"
      >
        {phases[currentPhase].microSteps[currentMicroStep]}
      </p>

      {/* Progress bar */}
      <div className="absolute bottom-3 left-3 right-3">
        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-cta rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-white/60 font-mono">
            {displayPercentage}%
          </span>
        </div>
      </div>

      {/* Shimmer overlay for visual interest */}
      <div className="absolute inset-0 pointer-events-none animate-pulse opacity-10">
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent" />
      </div>
    </div>
  );
}
