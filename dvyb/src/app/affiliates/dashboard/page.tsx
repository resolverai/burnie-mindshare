"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AffiliateAuthProvider, useAffiliateAuth } from "@/contexts/AffiliateAuthContext";
import { AffiliateSidebar } from "@/components/AffiliateSidebar";
import { affiliateApi } from "@/lib/api";
import { Loader2, Copy, Check, Users, DollarSign, TrendingUp, MousePointerClick, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";

function AffiliateDashboardInner() {
  const [activeView] = useState("dashboard");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAffiliateAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/affiliates/login");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      affiliateApi.getDashboard().then((res) => {
        if (res.success) setDashboardData(res.data);
      }).catch(console.error).finally(() => setLoading(false));
    }
  }, [isAuthenticated]);

  const handleViewChange = useCallback((view: string) => {
    if (view === "__toggle_mobile__") {
      setIsMobileOpen((v) => !v);
      return;
    }
    const routes: Record<string, string> = {
      dashboard: "/affiliates/dashboard",
      "referred-users": "/affiliates/referred-users",
      revenue: "/affiliates/revenue",
      banking: "/affiliates/banking",
    };
    if (routes[view]) router.push(routes[view]);
  }, [router]);

  const handleCopyLink = async () => {
    if (!dashboardData?.referralLink) return;
    try {
      await navigator.clipboard.writeText(dashboardData.referralLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const chartData = useMemo(() => {
    const apiData = dashboardData?.monthlyEarnings || [];
    const dataMap = new Map<string, number>();
    apiData.forEach((m: { month: string; earnings: number }) => {
      dataMap.set(m.month, m.earnings);
    });

    const now = new Date();
    const result: { month: string; earnings: number; cumulative: number }[] = [];
    let cumulative = 0;

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("default", { month: "short" });
      const earnings = dataMap.get(key) || 0;
      cumulative += earnings;
      result.push({
        month: label,
        earnings: parseFloat(earnings.toFixed(2)),
        cumulative: parseFloat(cumulative.toFixed(2)),
      });
    }
    return result;
  }, [dashboardData?.monthlyEarnings]);

  const MONTHLY_COLOR = "#2563eb";
  const CUMULATIVE_COLOR = "#16a34a";

  const chartConfig = {
    earnings: {
      label: "Monthly Earnings",
      color: MONTHLY_COLOR,
    },
    cumulative: {
      label: "Cumulative Earnings",
      color: CUMULATIVE_COLOR,
    },
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--app-content-bg))]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stats = dashboardData?.stats;
  const affiliate = dashboardData?.affiliate;

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-[hsl(var(--app-content-bg))] overflow-hidden">
      <AffiliateSidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col overflow-hidden overflow-y-auto pb-24 lg:pb-0 order-2 min-h-0">
        <div className="px-4 py-4 lg:py-5">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Welcome back{affiliate?.name ? `, ${affiliate.name}` : ""}!</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Referral Link Card */}
              <div className="bg-card rounded-lg border border-border shadow-sm p-6 mb-6">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Your Referral Link</h2>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 flex items-center gap-2 px-4 py-3 bg-secondary/50 rounded-xl border border-border/30 min-w-0">
                    <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground truncate">{dashboardData?.referralLink || "Loading..."}</span>
                  </div>
                  <Button
                    onClick={handleCopyLink}
                    className="bg-[hsl(var(--landing-cta-orange))] hover:opacity-90 text-white rounded-xl px-6 shrink-0"
                  >
                    {linkCopied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                    {linkCopied ? "Copied!" : "Copy Link"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Share this link with your audience. You earn {affiliate?.commissionRate || 40}% commission on every paid subscription.
                </p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[
                  { label: "Total Clicks", value: stats?.totalClicks || 0, icon: MousePointerClick, color: "text-blue-500" },
                  { label: "Total Signups", value: stats?.totalSignups || 0, icon: Users, color: "text-green-500" },
                  { label: "Paid Conversions", value: stats?.subscribedReferrals || 0, icon: TrendingUp, color: "text-purple-500" },
                  { label: "Conversion Rate", value: `${stats?.conversionRate || 0}%`, icon: TrendingUp, color: "text-foreground" },
                ].map((stat) => (
                  <div key={stat.label} className="bg-card rounded-lg border border-border shadow-sm p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-xl bg-secondary/50 flex items-center justify-center ${stat.color}`}>
                        <stat.icon className="w-5 h-5" />
                      </div>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Revenue Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                {[
                  {
                    label: "Total Earned",
                    value: `$${(stats?.totalCommission || 0).toFixed(2)}`,
                    sub: "All time",
                    icon: DollarSign,
                  },
                  {
                    label: "This Month",
                    value: `$${(stats?.monthlyCommission || 0).toFixed(2)}`,
                    sub: new Date().toLocaleString("default", { month: "long", year: "numeric" }),
                    icon: TrendingUp,
                  },
                  {
                    label: "Available Balance",
                    value: `$${(stats?.availableBalance || 0).toFixed(2)}`,
                    sub: "Ready for payout",
                    icon: DollarSign,
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-card rounded-lg border border-border shadow-sm p-5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-muted-foreground">{item.label}</p>
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{item.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{item.sub}</p>
                  </div>
                ))}
              </div>

              {/* Earnings Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                {/* Monthly Earnings */}
                <div className="bg-card rounded-lg border border-border shadow-sm p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Monthly Earnings</h2>
                  <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#000" }} stroke="#000" />
                      <YAxis tick={{ fontSize: 12, fill: "#000" }} stroke="#000" tickFormatter={(v) => `$${v}`} />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value) => `$${Number(value).toFixed(2)}`}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="earnings"
                        stroke={MONTHLY_COLOR}
                        strokeWidth={2}
                        dot={{ r: 3, fill: MONTHLY_COLOR }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ChartContainer>
                </div>

                {/* Cumulative Earnings */}
                <div className="bg-card rounded-lg border border-border shadow-sm p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Cumulative Earnings</h2>
                  <ChartContainer config={chartConfig} className="aspect-[2/1] w-full">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#000" }} stroke="#000" />
                      <YAxis tick={{ fontSize: 12, fill: "#000" }} stroke="#000" tickFormatter={(v) => `$${v}`} />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value) => `$${Number(value).toFixed(2)}`}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="cumulative"
                        stroke={CUMULATIVE_COLOR}
                        strokeWidth={2}
                        dot={{ r: 3, fill: CUMULATIVE_COLOR }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ChartContainer>
                </div>
              </div>

              {/* Commission Info */}
              <div className="bg-card rounded-lg border border-border shadow-sm p-6">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Your Commission Plan</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Tier</p>
                    <p className="text-lg font-bold text-foreground capitalize">{affiliate?.commissionTier || "Standard"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Commission Rate</p>
                    <p className="text-lg font-bold text-[hsl(var(--landing-cta-orange))]">{affiliate?.commissionRate || 25}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="text-lg font-bold text-foreground">
                      {affiliate?.commissionDurationMonths === 0 ? "Lifetime" : `${affiliate?.commissionDurationMonths || 12} months`}
                    </p>
                  </div>
                </div>
                {affiliate?.secondTierRate > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/30">
                    <p className="text-sm text-muted-foreground">Second-Tier Override</p>
                    <p className="text-lg font-bold text-foreground">{affiliate.secondTierRate}% on sub-affiliate referrals</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AffiliateDashboardPage() {
  return (
    <AffiliateAuthProvider>
      <AffiliateDashboardInner />
    </AffiliateAuthProvider>
  );
}
