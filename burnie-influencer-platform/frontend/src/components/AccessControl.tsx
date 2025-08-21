import React from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useMarketplaceAccess } from '../hooks/useMarketplaceAccess';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface AccessControlProps {
  children: React.ReactNode;
  requiresAuth?: boolean;
  fallbackComponent?: React.ReactNode;
}

const AccessControl: React.FC<AccessControlProps> = ({ 
  children, 
  requiresAuth = false,
  fallbackComponent 
}) => {
  const { isConnected } = useAccount();
  const { hasAccess, status, isLoading } = useMarketplaceAccess();
  const router = useRouter();

  const handleReferralRedirect = () => {
    router.push('/referral');
  };

  const handleWaitlistRedirect = () => {
    router.push('/waitlist');
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-white/70">Checking access...</div>
      </div>
    );
  }

  // If auth is not required, always show content
  if (!requiresAuth) {
    return <>{children}</>;
  }

  // If not connected, show connect prompt
  if (!isConnected) {
    return fallbackComponent || (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full max-w-md bg-yapper-surface border-yapper">
          <CardHeader className="text-center">
            <CardTitle className="text-white text-xl">Connect Your Wallet</CardTitle>
            <p className="text-white/70 mt-2">
              Connect your wallet to access authenticated features
            </p>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ConnectButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  // If user doesn't have access, show appropriate message
  if (!hasAccess) {
    if (status === 'PENDING_WAITLIST') {
      return fallbackComponent || (
        <div className="flex items-center justify-center min-h-[400px]">
          <Card className="w-full max-w-md bg-yapper-surface border-yapper">
            <CardHeader className="text-center">
              <CardTitle className="text-white text-xl">Waitlist Application Pending</CardTitle>
              <p className="text-white/70 mt-2">
                Your application is being reviewed. You'll be notified when approved.
              </p>
            </CardHeader>
            <CardContent className="text-center space-y-3">
              <Button
                onClick={handleWaitlistRedirect}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Check Waitlist Status
              </Button>
              <div className="text-white/50 text-sm">or</div>
              <Button
                onClick={handleReferralRedirect}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Enter Referral Code
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (status === 'REJECTED') {
      return fallbackComponent || (
        <div className="flex items-center justify-center min-h-[400px]">
          <Card className="w-full max-w-md bg-yapper-surface border-yapper">
            <CardHeader className="text-center">
              <CardTitle className="text-white text-xl">Access Not Approved</CardTitle>
              <p className="text-white/70 mt-2">
                Your waitlist application was not approved at this time.
              </p>
            </CardHeader>
            <CardContent className="text-center">
              <Button
                onClick={handleReferralRedirect}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Try Referral Code
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Default: PENDING_REFERRAL
    return fallbackComponent || (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="w-full max-w-md bg-yapper-surface border-yapper">
          <CardHeader className="text-center">
            <CardTitle className="text-white text-xl">Platform Access Required</CardTitle>
            <p className="text-white/70 mt-2">
              Join the Burnie platform with a referral code or apply for the waitlist
            </p>
          </CardHeader>
          <CardContent className="text-center space-y-3">
            <Button
              onClick={handleReferralRedirect}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
            >
              Enter Referral Code
            </Button>
            <div className="text-white/50 text-sm">or</div>
            <Button
              onClick={handleWaitlistRedirect}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Join Waitlist
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User has access, show content
  return <>{children}</>;
};

export default AccessControl;
