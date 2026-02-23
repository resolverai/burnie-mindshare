"use client";

import { motion } from "framer-motion";

const DnaAnimation = () => (
  <div className="w-14 h-14 rounded-xl bg-teal-200 flex items-center justify-center overflow-hidden">
    <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.ellipse
          key={i}
          cx="14"
          cy={4 + i * 5}
          rx="10"
          ry="2"
          stroke="hsl(170 50% 30%)"
          strokeWidth={1.5}
          fill="none"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: [1, -1, 1] }}
          transition={{ duration: 2.4, delay: i * 0.18, repeat: Infinity, ease: "easeInOut" }}
          style={{ originX: "14px", originY: `${4 + i * 5}px` }}
        />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.circle
          key={`dot-${i}`}
          r="2"
          fill="hsl(170 50% 30%)"
          initial={{ cx: 4, cy: 4 + i * 5 }}
          animate={{ cx: [4, 24, 4] }}
          transition={{ duration: 2.4, delay: i * 0.18, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </svg>
  </div>
);

const MegaphoneAnimation = () => (
  <div className="w-14 h-14 rounded-xl bg-lime-200 flex items-center justify-center overflow-hidden relative">
    <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
      <motion.path
        d="M6 11 L6 17 L10 17 L18 22 L18 6 L10 11 Z"
        fill="hsl(80 50% 30%)"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
      />
      {[0, 1, 2].map((i) => (
        <motion.path
          key={i}
          d={`M20 ${14 - (i + 1) * 3} Q${23 + i * 2} 14 20 ${14 + (i + 1) * 3}`}
          stroke="hsl(80 50% 30%)"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
          animate={{ opacity: [0, 0.8, 0], pathLength: [0, 1, 0] }}
          transition={{ duration: 1.8, delay: i * 0.3, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </svg>
  </div>
);

const SparklesAnimation = () => {
  const sparkles = [
    { x: 7, y: 7, size: 4, delay: 0 },
    { x: 20, y: 5, size: 3, delay: 0.4 },
    { x: 14, y: 14, size: 5, delay: 0.2 },
    { x: 6, y: 21, size: 3, delay: 0.6 },
    { x: 22, y: 20, size: 4, delay: 0.3 },
  ];
  return (
    <div className="w-14 h-14 rounded-xl bg-lime-100 flex items-center justify-center overflow-hidden">
      <svg width={28} height={28} viewBox="0 0 28 28" fill="none">
        {sparkles.map((s, i) => (
          <motion.path
            key={i}
            d={`M${s.x} ${s.y - s.size} L${s.x + 1} ${s.y - 1} L${s.x + s.size} ${s.y} L${s.x + 1} ${s.y + 1} L${s.x} ${s.y + s.size} L${s.x - 1} ${s.y + 1} L${s.x - s.size} ${s.y} L${s.x - 1} ${s.y - 1} Z`}
            fill="hsl(80 50% 30%)"
            animate={{ scale: [0, 1, 0.6, 1, 0], opacity: [0, 1, 0.7, 1, 0] }}
            transition={{ duration: 2.2, delay: s.delay, repeat: Infinity, ease: "easeInOut" }}
            style={{ originX: `${s.x}px`, originY: `${s.y}px` }}
          />
        ))}
      </svg>
    </div>
  );
};

const animationComponents = [DnaAnimation, MegaphoneAnimation, SparklesAnimation];

const steps = [
  { number: 1, title: "Generate Business DNA", description: "Enter your website and we'll analyze your brand and business." },
  { number: 2, title: "Select winning templates", description: "Choose from winning templates as inspiration for your creative" },
  { number: 3, title: "Generate creatives", description: "Generate high quality, on brand creatives that are ready to share." },
];

const COPY_A_BG_DARK =
  "radial-gradient(ellipse 70% 40% at 50% 15%, hsl(50 30% 30% / 0.3) 0%, transparent 70%), radial-gradient(ellipse 80% 60% at 50% 50%, hsl(240 10% 8%) 0%, hsl(240 10% 4%) 100%)";

interface CopyAWelcomeScreenProps {
  onStart: () => void;
  isDarkTheme?: boolean;
}

export function CopyAWelcomeScreen({ onStart, isDarkTheme = true }: CopyAWelcomeScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16"
      style={{
        background: isDarkTheme ? COPY_A_BG_DARK : "var(--gradient-hero)",
      }}
    >
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-4xl md:text-6xl font-display font-medium tracking-tight text-foreground mb-3 text-center"
      >
        Welcome to dvyb
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="text-muted-foreground text-base md:text-lg mb-12 text-center"
      >
        Generate stunning on brand creatives
      </motion.p>

      <div className="flex flex-col md:flex-row gap-4 md:gap-5 max-w-4xl w-full mb-12">
        {steps.map((step, i) => (
          <motion.div
            key={step.number}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={`flex-1 rounded-2xl backdrop-blur-sm p-6 md:p-8 flex flex-col items-center text-center ${isDarkTheme ? "border border-white/10 bg-white/5" : "border border-border bg-card/80"}`}
          >
            <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center text-sm text-muted-foreground mb-5">
              {step.number}
            </div>
            <h3 className="text-lg md:text-xl font-display font-medium text-foreground mb-4">
              {step.title}
            </h3>
            <div className="mb-5">
              {(() => {
                const Anim = animationComponents[i];
                return <Anim />;
              })()}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {step.description}
            </p>
          </motion.div>
        ))}
      </div>

      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.5 }}
        onClick={onStart}
        className="px-12 py-4 bg-cta text-cta-foreground rounded-full text-lg font-display font-semibold hover:scale-105 transition-all duration-300"
        style={{ boxShadow: "0 0 30px -5px hsl(25 100% 55% / 0.5)" }}
      >
        Let&apos;s go!
      </motion.button>
    </motion.div>
  );
}
