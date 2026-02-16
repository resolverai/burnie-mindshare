"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AffiliateAuthProvider, useAffiliateAuth } from "@/contexts/AffiliateAuthContext";
import { AffiliateSidebar } from "@/components/AffiliateSidebar";
import { affiliateApi } from "@/lib/api";
import { Loader2, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "signed_up", label: "Signed Up" },
  { value: "subscribed", label: "Subscribed" },
  { value: "churned", label: "Churned" },
];

function AffiliateReferredUsersInner() {
  const [activeView] = useState("referred-users");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAffiliateAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/affiliates/login");
    }
  }, [isAuthenticated, isLoading, router]);

  const fetchReferrals = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await affiliateApi.getReferrals(page, 20, statusFilter || undefined);
      if (res.success) {
        setReferrals(res.data.referrals);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      console.error("Failed to fetch referrals:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (isAuthenticated) fetchReferrals();
  }, [isAuthenticated, fetchReferrals]);

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
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Referred Users</h1>
            <p className="text-muted-foreground mt-1">Users who signed up using your referral link</p>
          </div>

          {/* Filters */}
          <div className="flex gap-1 p-1 rounded-full bg-secondary border border-[hsl(var(--landing-nav-bar-border))] w-full lg:w-fit mb-6">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setStatusFilter(filter.value);
                }}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200",
                  statusFilter === filter.value
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : referrals.length === 0 ? (
            <div className="bg-card rounded-lg border border-border shadow-sm p-12 text-center">
              <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No referred users yet</h3>
              <p className="text-muted-foreground text-sm">Share your referral link to start earning commissions.</p>
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="rounded-lg overflow-hidden bg-card shadow-sm border border-border overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="border-b border-border bg-secondary/50">
                    <tr>
                      <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                      <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscription</th>
                      <th className="text-left py-3.5 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Signed Up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.map((ref) => (
                      <tr key={ref.id} className="border-b border-border last:border-b-0 hover:bg-secondary/50 transition-colors bg-card">
                        <td className="py-3.5 px-5">
                          <div>
                            <p className="text-sm font-medium text-foreground">{ref.referredAccount?.name || "Unknown"}</p>
                            <p className="text-xs text-muted-foreground">{ref.referredAccount?.email || "-"}</p>
                          </div>
                        </td>
                        <td className="py-3.5 px-5">
                          <span className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium",
                            ref.status === "subscribed" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                            ref.status === "signed_up" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                            ref.status === "churned" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}>
                            {ref.status === "signed_up" ? "Signed Up" : ref.status === "subscribed" ? "Subscribed" : "Churned"}
                          </span>
                        </td>
                        <td className="py-3.5 px-5">
                          {ref.subscription ? (
                            <div>
                              <p className="text-sm text-foreground">{ref.subscription.planName}</p>
                              <p className="text-xs text-muted-foreground capitalize">{ref.subscription.billingCycle}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Free / No subscription</span>
                          )}
                        </td>
                        <td className="py-3.5 px-5">
                          <span className="text-sm text-muted-foreground">
                            {new Date(ref.signedUpAt).toLocaleDateString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page <= 1}
                      onClick={() => fetchReferrals(pagination.page - 1)}
                      className="rounded-lg"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => fetchReferrals(pagination.page + 1)}
                      className="rounded-lg"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AffiliateReferredUsersPage() {
  return (
    <AffiliateAuthProvider>
      <AffiliateReferredUsersInner />
    </AffiliateAuthProvider>
  );
}
