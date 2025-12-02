"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Check } from "lucide-react";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usageData: {
    planName: string;
    imageLimit: number;
    videoLimit: number;
    imageUsage: number;
    videoUsage: number;
    remainingImages: number;
    remainingVideos: number;
    hasUpgradeRequest?: boolean;
  } | null;
}

export const UpgradeDialog = ({ open, onOpenChange, usageData }: UpgradeDialogProps) => {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmitRequest = async () => {
    if (!usageData) return;

    setSubmitting(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://mindshareapi.burnie.io'}/dvyb/upgrade-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          currentPlan: usageData.planName,
          currentImageUsage: usageData.imageUsage,
          currentVideoUsage: usageData.videoUsage,
          imageLimit: usageData.imageLimit,
          videoLimit: usageData.videoLimit,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSubmitted(true);
        setTimeout(() => {
          onOpenChange(false);
          setSubmitted(false);
        }, 3000);
      } else {
        alert('Failed to submit upgrade request. Please try again.');
      }
    } catch (error) {
      console.error('Failed to submit upgrade request:', error);
      alert('Failed to submit upgrade request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!usageData) return null;

  // Show different content if user already has a pending upgrade request
  if (usageData?.hasUpgradeRequest) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-2">
              <Check className="h-6 w-6 text-green-500" />
              <DialogTitle className="text-xl">Request Already Submitted</DialogTitle>
            </div>
            <DialogDescription className="text-base">
              Our team will reach out to you soon to discuss upgrading your plan. Thank you for your patience!
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center pt-4">
            <Button 
              onClick={() => onOpenChange(false)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8"
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {!submitted ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-6 w-6 text-orange-500" />
                <DialogTitle className="text-xl">Usage Limit Reached</DialogTitle>
              </div>
              <DialogDescription className="text-base">
                You've reached your plan's content generation limits.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Current Plan</span>
                  <span className="text-sm font-semibold text-gray-900">{usageData.planName}</span>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Image Posts</span>
                    <span className="font-medium text-gray-900">
                      {usageData.imageUsage} / {usageData.imageLimit}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-orange-500 h-2 rounded-full" 
                      style={{ width: `${Math.min((usageData.imageUsage / usageData.imageLimit) * 100, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-600">Video Posts</span>
                    <span className="font-medium text-gray-900">
                      {usageData.videoUsage} / {usageData.videoLimit}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-orange-500 h-2 rounded-full" 
                      style={{ width: `${Math.min((usageData.videoUsage / usageData.videoLimit) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <p className="text-sm text-gray-600 mb-4">
                  Would you like our team to contact you about upgrading your plan to increase your content generation limits?
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                className="flex-1 text-gray-900 border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSubmitRequest}
                disabled={submitting}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {submitting ? 'Submitting...' : 'Yes, Contact Me'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 mb-2">
                <Check className="h-6 w-6 text-green-500" />
                <DialogTitle className="text-xl">Request Submitted!</DialogTitle>
              </div>
              <DialogDescription className="text-base">
                Thank you! Our team will reach out to you soon to discuss upgrading your plan.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 text-center">
              <p className="text-sm text-gray-600">
                Closing this dialog...
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

