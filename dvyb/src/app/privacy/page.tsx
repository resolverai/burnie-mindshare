"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { NavigationLanding } from "@/components/landing/NavigationLanding";
import { FooterLanding } from "@/components/landing/FooterLanding";
import { getOnboardingCopyForPage } from "@/lib/abCopy";
import { cn } from "@/lib/utils";

export default function PrivacyPage() {
  const { resolvedTheme } = useTheme();
  const isCopyA = getOnboardingCopyForPage() === "A";

  return (
    <div className={cn("min-h-screen bg-[hsl(var(--landing-hero-bg))]", isCopyA && "font-hind")}>
      <NavigationLanding
        variant={resolvedTheme === "dark" ? "dark" : "default"}
        hideExplore
        hidePricing
        showThemeToggle
        navStyle={isCopyA ? "wander" : "default"}
      />
      <main className="pt-20 sm:pt-28 pb-20 px-4 sm:px-6">
        <div className="container mx-auto max-w-3xl">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground text-sm mb-10">Last updated: February 2025</p>

          <article className="prose prose-neutral dark:prose-invert max-w-none space-y-6 text-muted-foreground">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">1. Introduction</h2>
              <p>
                DVYB ("we," "our," or "us") operates the dvyb.ai platform, an AI-powered content creation service
                that helps brands create ad creatives, analyze websites, and generate marketing content. This Privacy
                Policy explains how we collect, use, and protect your information when you use our services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">2. Information We Collect</h2>
              <p className="mb-2">We collect information you provide directly and through your use of our platform:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong className="text-foreground">Account & authentication:</strong> Name, email, and profile data when you sign up via Google or other OAuth providers.</li>
                <li><strong className="text-foreground">Brand context:</strong> Website URL, brand details, logo, colors, fonts, and content preferences you submit for AI analysis and content generation.</li>
                <li><strong className="text-foreground">Product and media:</strong> Product images, screenshots, and other assets you upload for AI-generated creatives.</li>
                <li><strong className="text-foreground">Social connections:</strong> If you connect social accounts (e.g., Twitter, Instagram, LinkedIn, TikTok), we receive profile and authorization data per each platform's OAuth flow.</li>
                <li><strong className="text-foreground">Usage data:</strong> How you use the platform, features accessed, and generated content.</li>
                <li><strong className="text-foreground">Payment data:</strong> Billing details are processed by Stripe; we do not store full card numbers.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">3. How We Use Your Information</h2>
              <p className="mb-2">We use your information to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Provide, maintain, and improve our AI content creation services</li>
                <li>Analyze your website and brand to generate tailored content and recommendations</li>
                <li>Process subscriptions and payments</li>
                <li>Send service-related communications and support</li>
                <li>Improve our AI models and product experience (using aggregated or anonymized data where applicable)</li>
                <li>Comply with legal obligations and enforce our Terms of Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">4. Third-Party Services</h2>
              <p>
                We use third-party services that may collect or process data: authentication (Google, etc.), payment processing (Stripe),
                analytics and conversion tracking (e.g., Mixpanel, Leadsy.ai), cloud storage (e.g., AWS), and AI providers for content
                generation. Each service has its own privacy practices; we encourage you to review their policies.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">5. Cookies and Similar Technologies</h2>
              <p>
                We use cookies and similar technologies for session management, preferences, and analytics. You can control
                cookie settings in your browser, though some features may not work correctly if cookies are disabled.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">6. Data Retention and Security</h2>
              <p>
                We retain your information for as long as your account is active and as needed to provide services, comply with
                legal obligations, and resolve disputes. We implement reasonable technical and organizational measures to protect
                your data against unauthorized access, alteration, or destruction.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">7. Your Rights</h2>
              <p>
                Depending on your location, you may have rights to access, correct, delete, or port your personal data, or to
                object to or restrict certain processing. Contact us at the email below to exercise these rights. You may also
                unsubscribe from marketing emails at any time.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">8. Children</h2>
              <p>
                Our services are not intended for users under 16. We do not knowingly collect personal information from
                children under 16.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">9. Changes</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of material changes by posting the
                updated policy on this page and updating the "Last updated" date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">10. Contact</h2>
              <p>
                For questions about this Privacy Policy or our data practices, contact us at{" "}
                <a href="mailto:privacy@dvyb.ai" className="text-primary hover:underline">privacy@dvyb.ai</a>.
              </p>
            </section>
          </article>

          <div className="mt-12 pt-6 border-t border-border">
            <Link href="/" className="text-primary hover:underline text-sm">← Back to home</Link>
          </div>
        </div>
      </main>
      <FooterLanding />
    </div>
  );
}
