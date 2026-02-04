"use client";

import { useState, useEffect } from "react";
import { authApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
import { User, Bell, AlertTriangle } from "lucide-react";

const NOTIFICATIONS_KEY = "dvyb_notification_preferences";

interface NotificationPrefs {
  productUpdates: boolean;
  marketing: boolean;
}

export const SettingsAccountContent = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{
    name: string | null;
    email: string | null;
    accountName: string | null;
  }>({ name: null, email: null, accountName: null });
  const [notifications, setNotifications] = useState<NotificationPrefs>({
    productUpdates: true,
    marketing: false,
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    fetchProfile();
    loadNotificationPrefs();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const authRes = await authApi.getAuthStatus();
      if (authRes.success && authRes.data.authenticated) {
        setProfile({
          name: authRes.data.name ?? null,
          email: authRes.data.email ?? null,
          accountName: authRes.data.accountName ?? null,
        });
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load profile",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadNotificationPrefs = () => {
    try {
      const stored = localStorage.getItem(NOTIFICATIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<NotificationPrefs>;
        setNotifications((n) => ({ ...n, ...parsed }));
      }
    } catch {
      // ignore
    }
  };

  const saveNotificationPref = (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...notifications, [key]: value };
    setNotifications(next);
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
    toast({
      title: "Saved",
      description: "Notification preferences updated",
    });
  };

  const handleDeleteAccount = () => {
    setShowDeleteDialog(false);
    toast({
      title: "Account deletion",
      description: "To delete your account, please contact support at support@burnie.io",
    });
  };

  const cardClass =
    "rounded-xl border border-border bg-card p-4 md:p-6 shadow-sm";

  if (loading) {
    return (
      <div className="space-y-6">
        <div className={cardClass}>
          <div className="animate-pulse space-y-3">
            <div className="h-5 w-32 bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-2/3 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Information */}
      <div className={cardClass}>
        <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
          <User className="w-5 h-5" />
          Profile Information
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Your profile is managed through your Google account
        </p>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground">Name</label>
            <p className="text-sm text-muted-foreground mt-1">
              {profile.name || "—"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Email</label>
            <p className="text-sm text-muted-foreground mt-1">
              {profile.email || "—"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Account name</label>
            <p className="text-sm text-muted-foreground mt-1">
              {profile.accountName || "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className={cardClass}>
        <h3 className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
          <Bell className="w-5 h-5" />
          Notifications
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Choose how you want to be notified
        </p>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Product updates</p>
              <p className="text-xs text-muted-foreground">
                New features, improvements, and tips
              </p>
            </div>
            <Switch
              checked={notifications.productUpdates}
              onCheckedChange={(v) => saveNotificationPref("productUpdates", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Marketing</p>
              <p className="text-xs text-muted-foreground">
                Promotions, offers, and news
              </p>
            </div>
            <Switch
              checked={notifications.marketing}
              onCheckedChange={(v) => saveNotificationPref("marketing", v)}
            />
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className={cardClass + " border-destructive/30"}>
        <h3 className="text-base md:text-lg font-semibold text-destructive flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5" />
          Danger zone
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Irreversible actions for your account
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Delete account</p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your account and all associated data
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            Delete account
          </Button>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. To permanently delete your account and all
              associated data, please contact our support team at support@burnie.io.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Contact support
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
