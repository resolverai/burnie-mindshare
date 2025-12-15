"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { XCircle, ArrowLeft, HelpCircle } from "lucide-react";

export default function SubscriptionCancelPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-muted/30 rounded-full blur-xl" />
            <XCircle className="relative h-20 w-20 text-muted-foreground" />
          </div>
        </div>
        
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">
            Subscription Cancelled
          </h1>
          <p className="text-muted-foreground text-lg">
            You can always upgrade later when you&apos;re ready.
          </p>
        </div>

        <div className="bg-muted/50 rounded-xl p-6 space-y-4 border border-border">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <HelpCircle className="h-5 w-5" />
            <span className="font-medium">Questions?</span>
          </div>
          <p className="text-sm text-muted-foreground">
            If you have any questions about our plans or need help choosing the right one,
            feel free to reach out to our support team.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Button 
            onClick={() => router.push('/home')}
            size="lg" 
            className="w-full py-6 text-lg font-semibold"
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            Back to Dashboard
          </Button>
          
          <Button 
            onClick={() => router.push('/pricing')}
            variant="outline"
            size="lg" 
            className="w-full py-6"
          >
            View Plans Again
          </Button>
        </div>
      </div>
    </div>
  );
}

