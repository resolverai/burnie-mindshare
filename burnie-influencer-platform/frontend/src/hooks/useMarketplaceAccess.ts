import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useAuth } from './useAuth';
import { useRouter } from 'next/navigation';

interface AccessStatus {
  hasAccess: boolean;
  status: 'PENDING_REFERRAL' | 'PENDING_WAITLIST' | 'APPROVED' | 'REJECTED';
  isLoading: boolean;
}

export const useMarketplaceAccess = () => {
  const { address } = useAccount();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [accessStatus, setAccessStatus] = useState<AccessStatus>({
    hasAccess: false,
    status: 'PENDING_REFERRAL',
    isLoading: false
  });

  // Simple logic: Check access when wallet connects and is authenticated
  useEffect(() => {
    if (!address) {
      // No wallet = public browsing allowed
      setAccessStatus({
        hasAccess: true,
        status: 'PENDING_REFERRAL',
        isLoading: false
      });
      return;
    }

    if (!isAuthenticated) {
      // Wallet connected but not signed = no access
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        isLoading: false
      });
      return;
    }

    // Authenticated = check access status automatically
    const checkAccess = async () => {
      try {
        setAccessStatus(prev => ({ ...prev, isLoading: true }));

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/check-access/${address}`
        );
        const result = await response.json();

        const hasAccess = result.success && result.data.hasAccess;
        const status = result.data?.status || 'PENDING_REFERRAL';

        setAccessStatus({
          hasAccess,
          status,
          isLoading: false
        });

        console.log('✅ Access status checked:', { hasAccess, status });
      } catch (error) {
        console.error('❌ Error checking access:', error);
        setAccessStatus({
          hasAccess: false,
          status: 'PENDING_REFERRAL',
          isLoading: false
        });
      }
    };

    checkAccess();
  }, [address, isAuthenticated]);

  const checkAccessAndRoute = async (targetRoute?: string) => {
    if (!address) return;

    try {
      setAccessStatus(prev => ({ ...prev, isLoading: true }));

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/check-access/${address}`
      );
      const result = await response.json();

      const hasAccess = result.success && result.data.hasAccess;
      const status = result.data?.status || 'PENDING_REFERRAL';

      setAccessStatus({
        hasAccess,
        status,
        isLoading: false
      });

      // Route based on access status and target (only for non-homepage routes)
      if (targetRoute && targetRoute !== 'homepage') {
        if (hasAccess) {
          // APPROVED user
          router.push(targetRoute || '/marketplace');
        } else {
          // NOT APPROVED user
          router.push('/access');
        }
      }
    } catch (error) {
      console.error('Error checking access:', error);
      setAccessStatus({
        hasAccess: false,
        status: 'PENDING_REFERRAL',
        isLoading: false
      });
      // Only auto-route to access if not called from homepage
      if (targetRoute && targetRoute !== 'homepage') {
        router.push('/access');
      }
    }
  };

  const checkAccessOnly = async () => {
    if (!address) return false;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/check-access/${address}`
      );
      const result = await response.json();
      return result.success && result.data.hasAccess;
    } catch (error) {
      console.error('Error checking access:', error);
      return false;
    }
  };

  return {
    ...accessStatus,
    checkAccessAndRoute,
    checkAccessOnly
  };
};