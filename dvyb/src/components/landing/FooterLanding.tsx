"use client";

import Link from "next/link";
import Image from "next/image";
import dvybLogo from "@/assets/dvyb-logo.png";

export function FooterLanding() {
  return (
    <footer className="py-12 sm:py-16 px-4 sm:px-6 border-t border-border/50 bg-card/30">
      <div className="container mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 sm:gap-8 text-center md:text-left">
          <Link href="/" className="shrink-0 transition-opacity hover:opacity-90">
            <Image src={dvybLogo} alt="dvyb.ai" width={200} height={80} className="h-14 sm:h-16 md:h-20 w-auto object-contain" />
          </Link>
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-4 sm:gap-6 md:gap-8 text-xs sm:text-sm text-muted-foreground">
            <Link href="/pricing" className="hover:text-foreground transition-colors">
              Pricing
            </Link>
            <a href="#" className="hover:text-foreground transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-foreground transition-colors">
              Terms
            </a>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground order-last md:order-none flex items-center justify-center md:justify-start gap-1.5">
            © {new Date().getFullYear()}{" "}
            <Link href="/" className="inline-block transition-opacity hover:opacity-90">
              <Image src={dvybLogo} alt="dvyb.ai" width={112} height={44} className="h-11 w-auto object-contain" />
            </Link>
            . All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
