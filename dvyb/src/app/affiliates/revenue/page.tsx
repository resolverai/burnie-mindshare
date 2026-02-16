"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AffiliateAuthProvider, useAffiliateAuth } from "@/contexts/AffiliateAuthContext";
import { AffiliateSidebar } from "@/components/AffiliateSidebar";
import { affiliateApi } from "@/lib/api";
import { Loader2, DollarSign, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function AffiliateRevenueInner() {
  const [activeView] = useState("revenue");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [revenueData, setRevenueData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"commissions" | "payouts" | "monthly">("commissions");
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAffiliateAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/affiliates/login");
    }
  }, [isAuthenticated, isLoading, router]);

  const fetchRevenue = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await affiliateApi.getRevenue(page, 20);
      if (res.success) setRevenueData(res.data);
    } catch (err) {
      console.error("Failed to fetch revenue:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchRevenue();
  }, [isAuthenticated, fetchRevenue]);

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--app-content-bg))]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs = [
    { id: "commissions" as const, label: "Commissions" },
    { id: "payouts" as const, label: "Payouts" },
    { id: "monthly" as const, label: "Monthly Breakdown" },
  ];

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
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Revenue</h1>
            <p className="text-muted-foreground mt-1">Track your commissions, payouts, and earnings</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-1 p-1 rounded-full bg-secondary border border-[hsl(var(--landing-nav-bar-border))] w-full lg:w-fit mb-6">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                      activeTab === tab.id
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Commissions Tab */}
              {activeTab === "commissions" && (
                <>
                  {revenueData?.commissions?.length === 0 ? (
                    <div className="bg-card rounded-lg border border-border shadow-sm p-12 text-center">
                      <DollarSign className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-foreground mb-2">No commissions yet</h3>
                      <p className="text-muted-foreground text-sm">Commissions will appear when your referred users subscribe to a paid plan.</p>
                    </div>
                  ) : (
                    <div className="rounded-lg overflow-hidden bg-card shadow-sm border border-border overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead className="border-b border-border bg-secondary/50">
                          <tr>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Referred User</th>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                            <th className="text-right py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription</th>
                            <th className="text-right py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Rate</th>
                            <th className="text-right py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Commission</th>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cycle</th>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {revenueData?.commissions?.map((c: any) => (
                            <tr key={c.id} className="border-b border-border last:border-b-0 hover:bg-secondary/50 transition-colors bg-card">
                              <td className="py-3.5 px-5">
                                <p className="text-sm font-medium text-foreground">{c.referredUser?.name || "Unknown"}</p>
                                <p className="text-xs text-muted-foreground">{c.referredUser?.email || "-"}</p>
                              </td>
                              <td className="py-3.5 px-5">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-xs font-medium",
                                  c.commissionType === "direct"
                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                    : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                )}>
                                  {c.commissionType === "direct" ? "Direct" : "2nd Tier"}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-right text-sm text-foreground">${c.subscriptionAmount.toFixed(2)}</td>
                              <td className="py-3.5 px-5 text-right text-sm text-muted-foreground">{c.commissionRate}%</td>
                              <td className="py-3.5 px-5 text-right">
                                <span className="text-sm font-semibold text-foreground">
                                  ${c.commissionAmount.toFixed(2)}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-sm text-muted-foreground capitalize">{c.billingCycle}</td>
                              <td className="py-3.5 px-5">
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-xs font-medium",
                                  c.status === "paid" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                                  c.status === "approved" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                                  c.status === "pending" && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                                  c.status === "cancelled" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                )}>
                                  {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-sm text-muted-foreground">
                                {new Date(c.createdAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {revenueData?.pagination?.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-muted-foreground">
                        Page {revenueData.pagination.page} of {revenueData.pagination.totalPages}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={revenueData.pagination.page <= 1} onClick={() => fetchRevenue(revenueData.pagination.page - 1)} className="rounded-lg">
                          <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm" disabled={revenueData.pagination.page >= revenueData.pagination.totalPages} onClick={() => fetchRevenue(revenueData.pagination.page + 1)} className="rounded-lg">
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Payouts Tab */}
              {activeTab === "payouts" && (
                <>
                  {!revenueData?.payouts?.length ? (
                    <div className="bg-card rounded-lg border border-border shadow-sm p-12 text-center">
                      <DollarSign className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-foreground mb-2">No payouts yet</h3>
                      <p className="text-muted-foreground text-sm">Payouts are processed monthly when your balance reaches the minimum threshold.</p>
                    </div>
                  ) : (
                    <div className="rounded-lg overflow-hidden bg-card shadow-sm border border-border overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead className="border-b border-border bg-secondary/50">
                          <tr>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Period</th>
                            <th className="text-right py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Method</th>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                            <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Paid At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {revenueData.payouts.map((p: any) => (
                            <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-secondary/50 transition-colors bg-card">
                              <td className="py-3.5 px-5 text-sm text-foreground">{p.periodLabel}</td>
                              <td className="py-3.5 px-5 text-right text-sm font-semibold text-foreground">${p.amount.toFixed(2)}</td>
                              <td className="py-3.5 px-5 text-sm text-muted-foreground capitalize">{p.paymentMethod || "-"}</td>
                              <td className="py-3.5 px-5">
                                <span className={cn(
                                  "px-3 py-1 rounded-full text-xs font-medium",
                                  p.status === "completed" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                                  p.status === "processing" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                                  p.status === "pending" && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
                                  p.status === "failed" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                )}>
                                  {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                                </span>
                              </td>
                              <td className="py-3.5 px-5 text-sm text-muted-foreground">
                                {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {/* Monthly Breakdown Tab */}
              {activeTab === "monthly" && (
                <>
                  {!revenueData?.monthlyBreakdown?.length ? (
                    <div className="bg-card rounded-lg border border-border shadow-sm p-12 text-center">
                      <TrendingUp className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-foreground mb-2">No data yet</h3>
                      <p className="text-muted-foreground text-sm">Monthly breakdown will appear as you earn commissions.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {revenueData.monthlyBreakdown.map((m: any) => {
                        const [year, month] = m.month.split("-");
                        const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleString("default", { month: "long", year: "numeric" });
                        return (
                          <div key={m.month} className="bg-card rounded-lg border border-border shadow-sm p-6">
                            <p className="text-sm text-muted-foreground mb-1">{monthName}</p>
                            <p className="text-2xl font-bold text-foreground">${m.total.toFixed(2)}</p>
                            <p className="text-xs text-muted-foreground mt-1">{m.count} commission{m.count !== 1 ? "s" : ""}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AffiliateRevenuePage() {
  return (
    <AffiliateAuthProvider>
      <AffiliateRevenueInner />
    </AffiliateAuthProvider>
  );
}
