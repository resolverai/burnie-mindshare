import type { Metadata } from "next";
import { Inter, Space_Grotesk, Agdasima, Hind } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const agdasima = Agdasima({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-agdasima" });
const hind = Hind({ weight: ["300", "400", "500", "600", "700"], subsets: ["latin"], variable: "--font-hind" });

export const metadata: Metadata = {
  title: "DVYB | AI-Powered Content Creation Platform",
  description: "Create your complete brand profile, marketing strategy, and content calendar with AI-powered business analysis and social media planning.",
  authors: [{ name: "DVYB" }],
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Leadsy.ai Visitor Tracking Script */}
        <Script
          id="vtag-ai-js"
          src="https://r2.leadsy.ai/tag.js"
          data-pid="oIrG9SV3utrNAGtA"
          data-version="062024"
          strategy="afterInteractive"
        />
      </head>
      <body className={`${inter.className} ${spaceGrotesk.variable} ${agdasima.variable} ${hind.variable}`}>
        <Providers>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            {children}
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}

