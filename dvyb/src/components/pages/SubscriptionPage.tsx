"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Calendar, ExternalLink, AlertCircle, Check, X, ArrowUpRight, ArrowDownRight, RefreshCw } from "lucide-react";
import { subscriptionApi } from "@/lib/api";
import { PricingModal } from "@/components/PricingModal";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  trackSubscriptionPageViewed,
  trackCancelSubscriptionClicked,
  trackCancelSubscriptionConfirmed,
  trackResumeSubscriptionClicked,
  trackCancelBillingCycleSwitchClicked,
  trackViewInvoiceClicked,
  trackChangePlanClicked,
} from "@/lib/mixpanel";

interface SubscriptionData {
  isSubscribed: boolean;
  currentPlan?: {
    id: number;
    planName: string;
    monthlyPrice: number;
    annualPrice: number;
    monthlyImageLimit: number;
    annualImageLimit: number;
    monthlyVideoLimit: number;
    annualVideoLimit: number;
    dealActive?: boolean;
    dealMonthlyPrice?: number | null;
    dealAnnualPrice?: number | null;
  };
  isFree?: boolean;
  subscription?: {
    id: number;
    planId: number;
    stripeSubscriptionId?: string;
    status: string;
    frequency: 'monthly' | 'annual';
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    pendingPlanId?: number;
    pendingFrequency?: 'monthly' | 'annual';
    trialStart?: string;
    trialEnd?: string;
    plan?: {
      id: number;
      planName: string;
      monthlyPrice: number;
      annualPrice: number;
      monthlyImageLimit: number;
      annualImageLimit: number;
      monthlyVideoLimit: number;
      annualVideoLimit: number;
      dealActive?: boolean;
      dealMonthlyPrice?: number | null;
      dealAnnualPrice?: number | null;
    };
  };
  usage?: {
    imagesUsed: number;
    videosUsed: number;
    imagesRemaining: number;
    videosRemaining: number;
  };
  planName?: string;
  initialAcquisitionFlow?: 'website_analysis' | 'product_photoshot' | null;
}

interface Payment {
  id: number;
  amount: number;
  currency: string;
  status: string;
  paymentType: string;
  description: string | null;
  paidAt: string | null;
  createdAt: string;
  invoiceUrl?: string;
  stripeInvoiceId?: string;
  promoCodeName?: string;
  discountAmount?: number;
}

interface SubscriptionPageProps {
  hideHeader?: boolean;
}

export const SubscriptionPage = ({ hideHeader }: SubscriptionPageProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  useEffect(() => {
    fetchSubscriptionData();
    fetchPayments();
  }, []);

  // Track page view when subscription data loads
  useEffect(() => {
    if (subscriptionData && !loading) {
      const subscription = subscriptionData.subscription;
      const currentPlan = subscriptionData.currentPlan || subscription?.plan;
      const isFreePlan = subscriptionData.isFree || !subscription;
      
      trackSubscriptionPageViewed({
        planName: currentPlan?.planName || subscriptionData.planName || 'Free',
        billingCycle: subscription?.frequency || 'monthly',
        isFreePlan,
        hasActiveSubscription: !!subscription && subscription.status === 'active',
      });
    }
  }, [subscriptionData, loading]);

  const fetchSubscriptionData = async () => {
    try {
      setLoading(true);
      const response = await subscriptionApi.getCurrentSubscription();
      if (response.success && response.data) {
        setSubscriptionData(response.data);
      }
    } catch (error) {
      console.error("Error fetching subscription:", error);
      toast({
        title: "Error",
        description: "Failed to load subscription data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchPayments = async () => {
    try {
      setPaymentsLoading(true);
      const response = await subscriptionApi.getPaymentHistory(20);
      if (response.success && response.data) {
        setPayments(response.data);
      }
    } catch (error) {
      console.error("Error fetching payments:", error);
    } finally {
      setPaymentsLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    const subscription = subscriptionData?.subscription;
    const currentPlan = subscriptionData?.currentPlan || subscription?.plan;
    
    // Track confirmation
    trackCancelSubscriptionConfirmed({
      planName: currentPlan?.planName || 'Unknown',
      billingCycle: subscription?.frequency || 'monthly',
    });
    
    try {
      setIsCancelling(true);
      const response = await subscriptionApi.cancel();
      if (response.success) {
        const wasTrial = isTrialing;
        toast({
          title: wasTrial ? "Trial Cancelled" : "Subscription Cancelled",
          description: response.message || (wasTrial 
            ? "Your trial has been canceled. No charges will be made to your payment method."
            : "Your subscription will end at the current billing period."),
        });
        fetchSubscriptionData();
      } else {
        throw new Error(response.error);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel subscription",
        variant: "destructive",
      });
    } finally {
      setIsCancelling(false);
      setShowCancelDialog(false);
    }
  };

  const handleResumeSubscription = async () => {
    const subscription = subscriptionData?.subscription;
    const currentPlan = subscriptionData?.currentPlan || subscription?.plan;
    
    // Track resume or cancel billing cycle switch
    if (subscription?.pendingFrequency) {
      trackCancelBillingCycleSwitchClicked({
        planName: currentPlan?.planName || 'Unknown',
        currentCycle: subscription.frequency,
        pendingCycle: subscription.pendingFrequency,
      });
    } else {
      trackResumeSubscriptionClicked({
        planName: currentPlan?.planName || 'Unknown',
        billingCycle: subscription?.frequency || 'monthly',
      });
    }
    
    try {
      setIsResuming(true);
      const response = await subscriptionApi.resume();
      if (response.success) {
        toast({
          title: subscription?.pendingFrequency ? "Billing Switch Cancelled" : "Subscription Resumed",
          description: subscription?.pendingFrequency 
            ? "Your billing cycle change has been cancelled." 
            : "Your subscription has been resumed.",
        });
        fetchSubscriptionData();
      } else {
        throw new Error(response.error);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to resume subscription",
        variant: "destructive",
      });
    } finally {
      setIsResuming(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'succeeded':
        return <Badge className="bg-green-100 text-green-700">Succeeded</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-700">Pending</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-700">Failed</Badge>;
      case 'refunded':
        return <Badge className="bg-gray-100 text-gray-700">Refunded</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatCurrency = (amount: number, currency: string = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const getBillingPeriodText = () => {
    if (!subscriptionData?.subscription) return null;
    const { currentPeriodStart, currentPeriodEnd } = subscriptionData.subscription;
    return `${format(new Date(currentPeriodStart), 'MMM d, yyyy')} - ${format(new Date(currentPeriodEnd), 'MMM d, yyyy')}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const subscription = subscriptionData?.subscription;
  // User is on free plan if not subscribed or explicitly on free plan, but NOT if they have a trialing subscription
  const isFreePlan = (!subscriptionData?.isSubscribed && !subscription) || (subscriptionData?.isFree && !subscription);
  // Check if user is on a trial
  const isTrialing = subscription?.status === 'trialing';
  // Get plan data from subscription.plan (for subscribed users) or currentPlan (for free users)
  const currentPlan = subscription?.plan || subscriptionData?.currentPlan;

  return (
    <div className={`space-y-6 ${!hideHeader ? "px-2 md:px-3 lg:px-4 py-4 md:py-6" : ""}`}>
      {!hideHeader && (
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Manage Subscription</h1>
          <p className="text-muted-foreground mt-1">View and manage your subscription and billing</p>
        </div>
      )}

      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Current Plan
          </CardTitle>
          <CardDescription>
            Your active subscription details
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isFreePlan ? (
            <div className="text-center py-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <CreditCard className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Free Plan</h3>
              <p className="text-muted-foreground mb-4">
                You are currently on the free plan. Upgrade to unlock more features and higher limits.
              </p>
              <Button onClick={() => {
                trackChangePlanClicked({
                  currentPlan: 'Free',
                  currentCycle: 'monthly',
                  source: 'subscription_page',
                });
                setShowPricingModal(true);
              }} className="gap-2 btn-gradient-cta">
                <ArrowUpRight className="w-4 h-4" />
                Upgrade Plan
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-semibold">{currentPlan?.planName || subscriptionData?.planName}</h3>
                    {isTrialing && (
                      <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-100">
                        Free Trial
                      </Badge>
                    )}
                    {subscription?.cancelAtPeriodEnd && subscription?.pendingFrequency && (
                      <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-100">
                        Switching to {subscription.pendingFrequency === 'monthly' ? 'Monthly' : 'Annual'}
                      </Badge>
                    )}
                    {subscription?.cancelAtPeriodEnd && !subscription?.pendingFrequency && (
                      <Badge variant="destructive" className="text-xs">Cancelling</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    {subscription?.frequency === 'annual' ? 'Annual' : 'Monthly'} billing • 
                    {isTrialing ? (
                      <>Free trial until {subscription?.trialEnd && format(new Date(subscription.trialEnd), 'MMM d, yyyy')}</>
                    ) : (() => {
                      const isAnnual = subscription?.frequency === 'annual';
                      const originalPrice = isAnnual ? (currentPlan?.annualPrice || 0) : (currentPlan?.monthlyPrice || 0);
                      const dealPrice = isAnnual ? (currentPlan?.dealAnnualPrice ?? 0) : (currentPlan?.dealMonthlyPrice ?? 0);
                      const hasDeal = !!(currentPlan?.dealActive && (isAnnual ? currentPlan.dealAnnualPrice != null : currentPlan.dealMonthlyPrice != null));
                      const displayPrice = hasDeal && dealPrice > 0 ? dealPrice : originalPrice;
                      const showStrikethrough = hasDeal && originalPrice > displayPrice;
                      return (
                        <>
                          {showStrikethrough && (
                            <span className="line-through mr-1">{formatCurrency(originalPrice)}</span>
                          )}
                          {formatCurrency(displayPrice)}/{isAnnual ? 'year' : 'month'}
                        </>
                      );
                    })()}
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={() => {
                    trackChangePlanClicked({
                      currentPlan: currentPlan?.planName || subscriptionData?.planName || 'Unknown',
                      currentCycle: subscription?.frequency || 'monthly',
                      source: 'subscription_page',
                    });
                    setShowPricingModal(true);
                  }} className="gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Change Plan
                  </Button>
                  {subscription?.cancelAtPeriodEnd ? (
                    <Button 
                      variant="default" 
                      onClick={handleResumeSubscription}
                      disabled={isResuming}
                      className="gap-2 btn-gradient-cta"
                    >
                      {isResuming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {subscription?.pendingFrequency ? 'Cancel Switch' : 'Resume Subscription'}
                    </Button>
                  ) : (
                    <Button 
                      variant="destructive" 
                      onClick={() => {
                        const currentPlanData = subscriptionData?.currentPlan || subscription?.plan;
                        trackCancelSubscriptionClicked({
                          planName: currentPlanData?.planName || 'Unknown',
                          billingCycle: subscription?.frequency || 'monthly',
                        });
                        setShowCancelDialog(true);
                      }}
                      className="gap-2"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              {/* Billing Period */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground border-t pt-4">
                <Calendar className="w-4 h-4" />
                <span>
                  Current billing period: {getBillingPeriodText()}
                </span>
              </div>
              
              {/* Pending Change Info */}
              {subscription?.cancelAtPeriodEnd && subscription?.pendingFrequency && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-2">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="w-5 h-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-900">Billing Cycle Change Scheduled</p>
                      <p className="text-sm text-blue-700 mt-1">
                        Your subscription will switch to <strong>{subscription.pendingFrequency === 'monthly' ? 'monthly' : 'annual'}</strong> billing 
                        on <strong>{format(new Date(subscription.currentPeriodEnd), 'MMM d, yyyy')}</strong>.
                      </p>
                      <p className="text-sm text-blue-600 mt-1">
                        You'll continue to enjoy your current plan benefits until then.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Cancellation Info */}
              {subscription?.cancelAtPeriodEnd && !subscription?.pendingFrequency && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-2">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-900">Subscription Ending</p>
                      <p className="text-sm text-red-700 mt-1">
                        Your subscription will end on <strong>{format(new Date(subscription.currentPeriodEnd), 'MMM d, yyyy')}</strong>.
                        After this date, you'll be moved to the free plan.
                      </p>
                      <p className="text-sm text-red-600 mt-1">
                        Click "Resume Subscription" to keep your current plan.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Trial Info */}
              {isTrialing && subscription?.trialEnd && !subscription?.cancelAtPeriodEnd && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mt-2">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-purple-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-orange-900">Free Trial Active</p>
                      <p className="text-sm text-orange-700 mt-1">
                        You&apos;re currently on a free trial. Your trial ends on <strong>{format(new Date(subscription.trialEnd), 'MMM d, yyyy')}</strong>.
                      </p>
                      <p className="text-sm text-orange-600 mt-1">
                        After the trial ends, your payment method will be charged automatically.
                        Cancel anytime before the trial ends to avoid charges.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Usage */}
              {subscriptionData?.usage && (
                <div className="grid grid-cols-2 gap-4 border-t pt-4">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">Images</p>
                    <p className="text-lg font-semibold">
                      {subscriptionData.usage.imagesUsed} / {subscriptionData.usage.imagesUsed + subscriptionData.usage.imagesRemaining}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {subscriptionData.usage.imagesRemaining} remaining
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">Videos</p>
                    <p className="text-lg font-semibold">
                      {subscriptionData.usage.videosUsed} / {subscriptionData.usage.videosUsed + subscriptionData.usage.videosRemaining}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {subscriptionData.usage.videosRemaining} remaining
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Payment History
          </CardTitle>
          <CardDescription>
            Your recent payments and invoices
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paymentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : payments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No payment history yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Date</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Description</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Amount</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-3 px-2 text-sm">
                        {format(new Date(payment.paidAt || payment.createdAt), 'MMM d, yyyy')}
                      </td>
                      <td className="py-3 px-2 text-sm">
                        <div>
                          {payment.description || `${payment.paymentType.charAt(0).toUpperCase() + payment.paymentType.slice(1)} payment`}
                          {payment.promoCodeName && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {payment.promoCodeName}
                            </Badge>
                          )}
                        </div>
                        {payment.discountAmount && payment.discountAmount > 0 && (
                          <span className="text-xs text-green-600">
                            -{formatCurrency(payment.discountAmount, payment.currency)} discount
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-sm font-medium">
                        {formatCurrency(payment.amount, payment.currency)}
                      </td>
                      <td className="py-3 px-2">
                        {getStatusBadge(payment.status)}
                      </td>
                      <td className="py-3 px-2">
                        {payment.invoiceUrl ? (
                          <a
                            href={payment.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              trackViewInvoiceClicked({
                                amount: payment.amount,
                                paymentType: payment.paymentType,
                              });
                            }}
                            className="inline-flex items-center gap-1 text-sm text-foreground hover:text-foreground/80 hover:underline"
                          >
                            View
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pricing Modal */}
      <PricingModal
        open={showPricingModal}
        onClose={() => {
          setShowPricingModal(false);
          // Refresh subscription data after modal closes
          fetchSubscriptionData();
        }}
        currentPlanInfo={currentPlan ? {
          planName: currentPlan.planName,
          planId: currentPlan.id,
          monthlyPrice: currentPlan.monthlyPrice,
          annualPrice: currentPlan.annualPrice,
          billingCycle: subscription?.frequency || 'monthly',
          isFreeTrialPlan: isFreePlan,
        } : isFreePlan ? {
          planName: subscriptionData?.planName || 'Free',
          planId: null,
          monthlyPrice: 0,
          annualPrice: 0,
          billingCycle: 'monthly',
          isFreeTrialPlan: true,
        } : null}
        isAuthenticated={true}
        canSkip={true}
        reason="user_initiated"
        userFlow={subscriptionData?.initialAcquisitionFlow || 'website_analysis'}
      />

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              {isTrialing ? 'Cancel Trial?' : 'Cancel Subscription?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isTrialing ? (
                <>
                  Your free trial will be canceled immediately. No charges will be made to your payment method.
                  You will be moved to the free plan with limited features.
                </>
              ) : (
                <>
                  Your subscription will remain active until the end of your current billing period 
                  ({subscription?.currentPeriodEnd && format(new Date(subscription.currentPeriodEnd), 'MMMM d, yyyy')}).
                  After that, you will be moved to the free plan with limited features.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>
              {isTrialing ? 'Keep Trial' : 'Keep Subscription'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelSubscription}
              disabled={isCancelling}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isCancelling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Yes, Cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

