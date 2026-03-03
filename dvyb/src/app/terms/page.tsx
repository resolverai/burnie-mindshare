"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { NavigationLanding } from "@/components/landing/NavigationLanding";
import { FooterLanding } from "@/components/landing/FooterLanding";
import { getOnboardingCopyForPage } from "@/lib/abCopy";
import { cn } from "@/lib/utils";

export default function TermsPage() {
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
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Terms of Service</h1>
          <p className="text-muted-foreground text-sm mb-10">Last updated: February 2025</p>

          <article className="prose prose-neutral dark:prose-invert max-w-none space-y-6 text-muted-foreground">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
              <p>
                By accessing or using the DVYB platform ("Service") at dvyb.ai, you agree to be bound by these Terms of
                Service. If you do not agree, do not use the Service. We may update these Terms from time to time; continued
                use after changes constitutes acceptance.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">2. Description of Service</h2>
              <p>
                DVYB is an AI-powered content creation platform that helps brands and agencies create ad creatives, analyze
                websites, discover inspiration from competitor ads, and generate marketing content (images, videos, copy) based
                on your brand profile. The Service includes features such as website analysis, product photoshoot generation,
                ad discovery, content calendar, and social posting.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">3. Account and Eligibility</h2>
              <p>
                You must create an account to use certain features. You represent that you are at least 16 years old and have
                the authority to enter into these Terms. You are responsible for maintaining the confidentiality of your
                account credentials and for all activities under your account.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">4. Acceptable Use</h2>
              <p className="mb-2">You agree not to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Use the Service for any unlawful purpose or in violation of applicable laws</li>
                <li>Upload content that infringes intellectual property rights, or is harmful, offensive, or misleading</li>
                <li>Attempt to reverse-engineer, scrape, or circumvent security measures of the Service</li>
                <li>Resell or redistribute the Service without our prior written consent</li>
                <li>Use the Service to generate content that violates platform policies (e.g., Meta, Google, TikTok) or applicable advertising standards</li>
              </ul>
              <p className="mt-3">
                We may suspend or terminate your account if we reasonably believe you have violated these terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">5. Your Content and IP</h2>
              <p>
                You retain ownership of content you upload (brand assets, product images, etc.). By using the Service, you
                grant us a license to use, process, and store your content to provide and improve the Service. AI-generated
                content created for you through the Service is provided for your use subject to your subscription plan and
                these Terms. You are responsible for ensuring your content and use of generated content comply with applicable
                laws and third-party rights.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">6. Subscriptions and Payment</h2>
              <p>
                Paid plans are billed in advance (monthly or annually) via Stripe. Fees are non-refundable except as required
                by law or as stated in our refund policy. We may change pricing with reasonable notice; continued use after
                a price change constitutes acceptance. You must provide accurate billing information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">7. Affiliate Program</h2>
              <p>
                If you participate in our affiliate program, additional terms apply. Affiliates must comply with applicable
                marketing and disclosure laws. We reserve the right to modify or discontinue the program with notice.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">8. Disclaimers</h2>
              <p>
                THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE
                DO NOT GUARANTEE THAT THE SERVICE OR AI-GENERATED CONTENT WILL MEET YOUR REQUIREMENTS OR BE ERROR-FREE. AI
                outputs may contain inaccuracies; you are responsible for reviewing and validating all generated content before
                use.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">9. Limitation of Liability</h2>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, DVYB AND ITS AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT,
                INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOSS OF PROFITS, DATA, OR GOODWILL, ARISING
                OUT OF OR RELATED TO YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID US IN
                THE TWELVE MONTHS PRECEDING THE CLAIM.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">10. Termination</h2>
              <p>
                You may cancel your account at any time. We may suspend or terminate your access for violation of these
                Terms, non-payment, or for other operational reasons. Upon termination, your right to use the Service ceases;
                provisions that by their nature should survive (e.g., disclaimers, indemnification, limitation of liability)
                will remain in effect.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">11. Governing Law and Disputes</h2>
              <p>
                These Terms are governed by the laws of the jurisdiction in which DVYB operates, without regard to conflict
                of law principles. Any disputes shall be resolved in the courts of that jurisdiction, except where prohibited.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">12. Contact</h2>
              <p>
                For questions about these Terms, contact us at{" "}
                <a href="mailto:legal@dvyb.ai" className="text-primary hover:underline">legal@dvyb.ai</a>.
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
