import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useAuth } from './useAuth';
import { useRouter } from 'next/navigation';

interface UseAuthGuardOptions {
  redirectTo?: string;
  requiresAuth?: boolean;
}

export const useAuthGuard = (options: UseAuthGuardOptions = {}) => {
  const { address } = useAccount();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { redirectTo = '/', requiresAuth = true } = options;

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) return;

    // If route requires auth but user is not authenticated
    if (requiresAuth && !isAuthenticated) {
      console.log('🔒 Auth required but user not authenticated, redirecting to:', redirectTo);
      router.push(redirectTo);
    }
  }, [isAuthenticated, authLoading, requiresAuth, redirectTo, router]);

  return {
    isAuthenticated,
    isLoading: authLoading,
    hasWallet: !!address
  };
};
