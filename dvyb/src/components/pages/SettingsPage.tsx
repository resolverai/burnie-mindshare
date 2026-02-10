"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TutorialButton } from "@/components/TutorialButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trackSettingsViewed, trackSettingsTabSwitched } from "@/lib/mixpanel";
import { SubscriptionPage } from "@/components/pages/SubscriptionPage";
import { SettingsBrandContent } from "@/components/pages/SettingsBrandContent";
import { SettingsAccountContent } from "@/components/pages/SettingsAccountContent";

const TAB_KEYS = ["subscription", "account", "profile", "images-video", "voice", "preferences"] as const;
type SettingsTab = (typeof TAB_KEYS)[number];

export const SettingsPage = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (tabParam && TAB_KEYS.includes(tabParam as SettingsTab)) return tabParam as SettingsTab;
    return "subscription";
  });

  // Track page view on mount and when tab changes
  useEffect(() => {
    trackSettingsViewed(activeTab);
  }, [activeTab]);

  const handleTabChange = (value: string) => {
    const tab = value as SettingsTab;
    if (TAB_KEYS.includes(tab)) {
      setActiveTab(tab);
      trackSettingsTabSwitched(tab);
      router.replace(`/subscription/manage?tab=${tab}`, { scroll: false });
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--app-content-bg))]" data-settings-page>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/* Sticky header - wander-style px-4 for mobile/tablet/desktop */}
        <div className="sticky top-0 z-50 bg-[hsl(var(--app-content-bg))] border-b border-[hsl(var(--landing-nav-bar-border))]">
          <div className="px-4 py-4 lg:py-5">
            <div className="flex flex-row items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl lg:text-3xl font-bold text-foreground font-display">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">Manage your account and subscription</p>
              </div>
              <div className="shrink-0">
                <TutorialButton screen="settings" />
              </div>
            </div>
            {/* Tabs - no outer pill (wander); active = black fill + white text; scrollable on mobile */}
            <div className="mt-4 w-full lg:w-max overflow-x-auto">
              <TabsList className="flex flex-nowrap gap-2 p-0 bg-transparent border-0 rounded-none w-max min-w-full lg:min-w-0 h-auto">
                <TabsTrigger
                  value="subscription"
                  className="flex-shrink-0 text-xs md:text-sm rounded-full border-0 px-3 lg:px-4 py-2 font-medium whitespace-nowrap data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  Subscription
                </TabsTrigger>
                <TabsTrigger
                  value="account"
                  className="flex-shrink-0 text-xs md:text-sm rounded-full border-0 px-3 lg:px-4 py-2 font-medium whitespace-nowrap data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  Account
                </TabsTrigger>
                <TabsTrigger
                  value="profile"
                  className="flex-shrink-0 text-xs md:text-sm rounded-full border-0 px-3 lg:px-4 py-2 font-medium whitespace-nowrap data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  Profile
                </TabsTrigger>
                <TabsTrigger
                  value="images-video"
                  className="flex-shrink-0 text-xs md:text-sm rounded-full border-0 px-3 lg:px-4 py-2 font-medium whitespace-nowrap data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  Images & Video
                </TabsTrigger>
                <TabsTrigger
                  value="voice"
                  className="flex-shrink-0 text-xs md:text-sm rounded-full border-0 px-3 lg:px-4 py-2 font-medium whitespace-nowrap data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  Voice
                </TabsTrigger>
                <TabsTrigger
                  value="preferences"
                  className="flex-shrink-0 text-xs md:text-sm rounded-full border-0 px-3 lg:px-4 py-2 font-medium whitespace-nowrap data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-black data-[state=active]:text-white data-[state=active]:shadow-sm"
                >
                  Preferences
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

        {/* Content - wander-style px-4 */}
        <div className="px-4 py-4 lg:py-5">
          <TabsContent value="subscription" className="mt-0">
            <SubscriptionPage hideHeader />
          </TabsContent>

          <TabsContent value="account" className="mt-0">
            <SettingsAccountContent />
          </TabsContent>

          <TabsContent value="profile" className="mt-0">
            <SettingsBrandContent tab="profile" />
          </TabsContent>

          <TabsContent value="images-video" className="mt-0">
            <SettingsBrandContent tab="images-video" />
          </TabsContent>

          <TabsContent value="voice" className="mt-0">
            <SettingsBrandContent tab="voice" />
          </TabsContent>

          <TabsContent value="preferences" className="mt-0">
            <SettingsBrandContent tab="preferences" />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};
