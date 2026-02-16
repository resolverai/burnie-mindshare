"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AffiliateAuthProvider, useAffiliateAuth } from "@/contexts/AffiliateAuthContext";
import { AffiliateSidebar } from "@/components/AffiliateSidebar";
import { affiliateApi } from "@/lib/api";
import { Loader2, Building2, CreditCard, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function AffiliateBankingInner() {
  const [activeView] = useState("banking");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preferredMethod, setPreferredMethod] = useState<"bank_transfer" | "paypal">("bank_transfer");
  const [form, setForm] = useState({
    accountHolderName: "",
    bankName: "",
    accountNumber: "",
    routingNumber: "",
    accountType: "checking" as "checking" | "savings",
    country: "",
    currency: "USD",
    paypalEmail: "",
  });
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAffiliateAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/affiliates/login");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      affiliateApi.getBanking().then((res) => {
        if (res.success && res.data.banking) {
          const b = res.data.banking;
          setPreferredMethod(b.preferredMethod as "bank_transfer" | "paypal");
          setForm({
            accountHolderName: b.accountHolderName || "",
            bankName: b.bankName || "",
            accountNumber: "", // Don't pre-fill masked number
            routingNumber: b.routingNumber || "",
            accountType: (b.accountType as "checking" | "savings") || "checking",
            country: b.country || "",
            currency: b.currency || "USD",
            paypalEmail: b.paypalEmail || "",
          });
        }
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

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const data: Record<string, any> = { preferredMethod };
      if (preferredMethod === "bank_transfer") {
        data.accountHolderName = form.accountHolderName;
        data.bankName = form.bankName;
        if (form.accountNumber) data.accountNumber = form.accountNumber;
        data.routingNumber = form.routingNumber;
        data.accountType = form.accountType;
        data.country = form.country;
        data.currency = form.currency;
      } else {
        data.paypalEmail = form.paypalEmail;
      }

      const res = await affiliateApi.updateBanking(data);
      if (res.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save banking details:", err);
    } finally {
      setSaving(false);
    }
  };

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
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Banking Details</h1>
            <p className="text-muted-foreground mt-1">Add your payout information for commission payments</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Payment Method Toggle */}
              <div className="bg-card rounded-lg border border-border shadow-sm p-6">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Preferred Payment Method</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "bank_transfer" as const, label: "Bank Transfer", icon: Building2 },
                    { value: "paypal" as const, label: "PayPal", icon: CreditCard },
                  ].map((method) => (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => setPreferredMethod(method.value)}
                      className={cn(
                        "flex items-center gap-3 p-4 rounded-xl border-2 transition-all duration-200",
                        preferredMethod === method.value
                          ? "border-foreground bg-secondary/50"
                          : "border-border/50 hover:border-border"
                      )}
                    >
                      <method.icon className={cn(
                        "w-5 h-5",
                        preferredMethod === method.value ? "text-foreground" : "text-muted-foreground"
                      )} />
                      <span className={cn(
                        "text-sm font-medium",
                        preferredMethod === method.value ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {method.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bank Transfer Form */}
              {preferredMethod === "bank_transfer" && (
                <div className="bg-card rounded-lg border border-border shadow-sm p-6 space-y-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Bank Account Details</h2>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Account Holder Name</label>
                    <Input
                      value={form.accountHolderName}
                      onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })}
                      placeholder="John Doe"
                      className="rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Bank Name</label>
                    <Input
                      value={form.bankName}
                      onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                      placeholder="Chase, Bank of America, etc."
                      className="rounded-xl"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Account Number</label>
                      <Input
                        type="password"
                        value={form.accountNumber}
                        onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                        placeholder="Enter account number"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Routing / SWIFT / IFSC</label>
                      <Input
                        value={form.routingNumber}
                        onChange={(e) => setForm({ ...form, routingNumber: e.target.value })}
                        placeholder="Routing number"
                        className="rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Account Type</label>
                      <select
                        value={form.accountType}
                        onChange={(e) => setForm({ ...form, accountType: e.target.value as "checking" | "savings" })}
                        className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm"
                      >
                        <option value="checking">Checking</option>
                        <option value="savings">Savings</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Country</label>
                      <Input
                        value={form.country}
                        onChange={(e) => setForm({ ...form, country: e.target.value })}
                        placeholder="United States"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Currency</label>
                      <select
                        value={form.currency}
                        onChange={(e) => setForm({ ...form, currency: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm"
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                        <option value="INR">INR</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* PayPal Form */}
              {preferredMethod === "paypal" && (
                <div className="bg-card rounded-lg border border-border shadow-sm p-6 space-y-4">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">PayPal Details</h2>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">PayPal Email</label>
                    <Input
                      type="email"
                      value={form.paypalEmail}
                      onChange={(e) => setForm({ ...form, paypalEmail: e.target.value })}
                      placeholder="your-email@example.com"
                      className="rounded-xl"
                    />
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-foreground text-background hover:bg-foreground/90 rounded-xl px-8"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : saved ? (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  ) : null}
                  {saved ? "Saved!" : saving ? "Saving..." : "Save Details"}
                </Button>
                {saved && (
                  <span className="text-sm text-green-600 dark:text-green-400">Banking details saved successfully</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AffiliateBankingPage() {
  return (
    <AffiliateAuthProvider>
      <AffiliateBankingInner />
    </AffiliateAuthProvider>
  );
}
