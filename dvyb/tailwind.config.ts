import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        display: ["var(--font-space-grotesk)", "Space Grotesk", "system-ui", "sans-serif"],
        agdasima: ["var(--font-agdasima)", "Agdasima", "system-ui", "sans-serif"],
        hind: ["var(--font-hind)", "Hind", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        cta: {
          DEFAULT: "hsl(var(--cta))",
          foreground: "hsl(var(--cta-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-10px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "pulse-subtle": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 hsl(var(--accent) / 0.4)",
            transform: "scale(1)",
          },
          "50%": {
            boxShadow: "0 0 20px 8px hsl(var(--accent) / 0.2)",
            transform: "scale(1.02)",
          },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "cube-rotate-in": {
          "0%": { transform: "translateY(100%) rotateX(-90deg)" },
          "100%": { transform: "translateY(0) rotateX(0deg)" },
        },
        "cube-rotate-out": {
          "0%": { transform: "translateY(0) rotateX(0deg)" },
          "100%": { transform: "translateY(-100%) rotateX(90deg)" },
        },
        "text-rotate": {
          "0%, 20%": { transform: "translateY(0%)" },
          "33.33%, 53.33%": { transform: "translateY(-100%)" },
          "66.66%, 86.66%": { transform: "translateY(-200%)" },
          "100%": { transform: "translateY(-300%)" },
        },
        "prism-rotate": {
          "0%, 20%": { transform: "rotateX(0deg)" },
          "33.33%, 53.33%": { transform: "rotateX(120deg)" },
          "66.66%, 86.66%": { transform: "rotateX(240deg)" },
          "100%": { transform: "rotateX(360deg)" },
        },
        "float-up": {
          "0%": { opacity: "1", transform: "translateY(0) translateX(-50%)" },
          "100%": { opacity: "0", transform: "translateY(-40px) translateX(-50%)" },
        },
        "marquee": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        "slide-up": "slide-up 0.5s ease-out",
        "pulse-slow": "pulse-slow 2s ease-in-out infinite",
        "fade-up": "fade-up 0.5s ease-out forwards",
        "slide-in": "slide-in 0.3s ease-out forwards",
        "pulse-subtle": "pulse-subtle 1.5s ease-in-out infinite",
        "scale-in": "scale-in 0.3s ease-out forwards",
        "cube-rotate-in": "cube-rotate-in 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        "cube-rotate-out": "cube-rotate-out 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards",
        "text-rotate": "text-rotate 6s ease-in-out infinite",
        "prism-rotate": "prism-rotate 6s ease-in-out infinite",
        "float-up": "float-up 4s ease-out forwards",
        "marquee": "marquee 25s linear infinite",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        soft: "var(--shadow-soft)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
