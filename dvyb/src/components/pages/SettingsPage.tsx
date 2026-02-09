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
        {/* Sticky header - wanderlust style */}
        <div className="sticky top-0 z-50 bg-[hsl(var(--app-content-bg))] border-b border-[hsl(var(--landing-nav-bar-border))]">
          <div className="px-2 md:px-3 lg:px-4 py-4 md:py-5">
            <div className="flex flex-row items-center justify-between gap-4">
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">Manage your account and subscription</p>
              </div>
              <div className="shrink-0">
                <TutorialButton screen="settings" />
              </div>
            </div>
            {/* Tabs - same styling as Brand Kit */}
            <div className="mt-4 pt-2">
              <TabsList className="inline-flex w-max flex-wrap gap-4 md:gap-6 h-auto p-0 bg-transparent border-0 rounded-none">
                <TabsTrigger
                  value="subscription"
                  className="text-xs md:text-sm whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-2 -mb-px text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold font-medium"
                >
                  Subscription
                </TabsTrigger>
                <TabsTrigger
                  value="account"
                  className="text-xs md:text-sm whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-2 -mb-px text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold font-medium"
                >
                  Account
                </TabsTrigger>
                <TabsTrigger
                  value="profile"
                  className="text-xs md:text-sm whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-2 -mb-px text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold font-medium"
                >
                  Profile
                </TabsTrigger>
                <TabsTrigger
                  value="images-video"
                  className="text-xs md:text-sm whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-2 -mb-px text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold font-medium"
                >
                  Images & Video
                </TabsTrigger>
                <TabsTrigger
                  value="voice"
                  className="text-xs md:text-sm whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-2 -mb-px text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold font-medium"
                >
                  Voice
                </TabsTrigger>
                <TabsTrigger
                  value="preferences"
                  className="text-xs md:text-sm whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:bg-transparent data-[state=active]:shadow-none px-0 pb-2 -mb-px text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold font-medium"
                >
                  Preferences
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-2 md:px-3 lg:px-4 py-4 md:py-6">
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
