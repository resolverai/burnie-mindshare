import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useAuth } from './useAuth';

interface AccessStatus {
  hasAccess: boolean;
  status: 'PENDING_REFERRAL' | 'PENDING_WAITLIST' | 'APPROVED' | 'REJECTED';
  requiresReferral: boolean;
  isLoading: boolean;
  user?: {
    id: number;
    walletAddress: string;
    username?: string;
    referralCode?: string;
  };
}

export const useMarketplaceAccess = () => {
  const { address, isConnected } = useAccount();
  const { isAuthenticated } = useAuth();
  const [accessStatus, setAccessStatus] = useState<AccessStatus>({
    hasAccess: false,
    status: 'PENDING_REFERRAL', 
    requiresReferral: true,
    isLoading: true
  });

  // Clear any potential cached access status when wallet address changes
  useEffect(() => {
    if (address) {
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        requiresReferral: true,
        isLoading: true
      });
    }
  }, [address]);

  useEffect(() => {
    if (!address) {
      // No wallet connected - allow public browsing
      setAccessStatus({
        hasAccess: true,
        status: 'PENDING_REFERRAL',
        requiresReferral: false,
        isLoading: false
      });
      return;
    }

    if (!isAuthenticated) {
      // Wallet connected but not authenticated - redirect to access page for signature
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        requiresReferral: true,
        isLoading: false
      });
      return;
    }

    // Authenticated users are BLOCKED by default until we verify their access
    // This prevents any authenticated user from seeing marketplace content
    setAccessStatus({
      hasAccess: false, // Block all authenticated users by default
      status: 'PENDING_REFERRAL',
      requiresReferral: true,
      isLoading: true
    });
    
    // Check access immediately for authenticated users
    checkMarketplaceAccess();
  }, [address, isAuthenticated]);

  const checkMarketplaceAccess = useCallback(async () => {
    if (!address) {
      return;
    }

    try {
      setAccessStatus(prev => ({ ...prev, isLoading: true }));

      // Add cache-busting parameter to force fresh API call
      const timestamp = Date.now();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/check-access/${address}?t=${timestamp}`
      );
      
      const result = await response.json();
      
      if (result.success) {
        const newStatus = {
          hasAccess: result.data.hasAccess,
          status: result.data.status,
          requiresReferral: result.data.requiresReferral,
          isLoading: false,
          user: result.data.user
        };
        setAccessStatus(newStatus);
      } else {
        // If check fails, connected users need referral approval
        setAccessStatus({
          hasAccess: false,
          status: 'PENDING_REFERRAL',
          requiresReferral: true,
          isLoading: false
        });
      }
    } catch (error) {
      // On error for connected users, deny access for security
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        requiresReferral: true,
        isLoading: false
      });
    }
  }, [address]);

  const redirectToAccess = () => {
    window.location.href = '/access';
  };

  const redirectToReferral = () => {
    window.location.href = '/access';
  };

  const redirectToWaitlist = () => {
    window.location.href = '/access';
  };

  const refreshAccess = () => {
    if (isAuthenticated && address) {
      // Force clear current status and re-check
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        requiresReferral: true,
        isLoading: true
      });
      checkMarketplaceAccess();
    }
  };

  const forceRefreshAccess = () => {
    if (isAuthenticated && address) {
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        requiresReferral: true,
        isLoading: true
      });
      checkMarketplaceAccess();
    }
  };

  return {
    ...accessStatus,
    checkMarketplaceAccess,
    redirectToAccess,
    redirectToReferral,
    redirectToWaitlist,
    refreshAccess,
    forceRefreshAccess
  };
};
