"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authApi } from '@/lib/api';

interface AuthContextType {
  isAuthenticated: boolean;
  accountId: number | null;
  onboardingComplete: boolean;
  isLoading: boolean;
  hasValidGoogleConnection: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasValidGoogleConnection, setHasValidGoogleConnection] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const clearAuthData = (options: { clearAnalysis?: boolean; clearOAuthState?: boolean; clearAccountReference?: boolean } = {}) => {
    const { clearAnalysis = false, clearOAuthState = true, clearAccountReference = false } = options;
    
    // Only clear account reference if explicitly requested (e.g., account deleted)
    // Keep account ID in localStorage after logout so we know user has an account
    if (clearAccountReference) {
      localStorage.removeItem('dvyb_account_id');
      localStorage.removeItem('dvyb_account_name');
      localStorage.removeItem('dvyb_auth_timestamp'); // Clear auth timestamp
    }
    
    // Only clear OAuth state if requested (we might want to keep it during OAuth flow)
    if (clearOAuthState) {
      localStorage.removeItem('dvyb_google_oauth_state');
    }
    
    // Only clear analysis data if explicitly requested (e.g., account deleted)
    // For logout, we preserve analysis so user can see it on re-login
    if (clearAnalysis) {
      localStorage.removeItem('dvyb_website_analysis');
      localStorage.removeItem('dvyb_pending_website_url');
    }
    
    // Always clear session cookies (these control the active session)
    document.cookie = 'dvyb_account_id=; path=/; max-age=0';
  };

  const checkAuth = async () => {
    setIsLoading(true); // Always set loading when checking auth
    
    try {
      console.log('🔍 Checking authentication with backend...');
      const response = await authApi.getAuthStatus();
      
      if (response.success && response.data.authenticated) {
        // User is authenticated via Google
        setIsAuthenticated(true);
        setAccountId(response.data.accountId || null);
        setOnboardingComplete(response.data.onboardingComplete || false);
        setHasValidGoogleConnection(response.data.hasValidGoogleConnection || false);
        
        console.log('✅ Session authenticated - Account exists');
        console.log(`   - Onboarding complete: ${response.data.onboardingComplete}`);
        console.log(`   - Google token valid: ${response.data.hasValidGoogleConnection}`);
        
        // User stays on current page - no redirects
        // If Google token is expired, user can re-authenticate
      } else {
        // Not authenticated - check why
        const accountExists = (response.data as any)?.accountExists;
        
        console.log('❌ Not authenticated from backend');
        
        // Check if there's an account reference in localStorage
        const hasAccountReference = localStorage.getItem('dvyb_account_id');
        
        // Check if this is a recent auth (within last 30 seconds) - don't clear data if so
        // This prevents aggressive clearing right after popup authentication
        const recentAuthTimestamp = localStorage.getItem('dvyb_auth_timestamp');
        const isRecentAuth = recentAuthTimestamp && 
          (Date.now() - parseInt(recentAuthTimestamp)) < 30000; // 30 seconds
        
        if (hasAccountReference && !isRecentAuth && accountExists === false) {
          // Account reference exists, NOT a recent auth, and backend confirms account doesn't exist
          // This means account was deleted - clear EVERYTHING
          console.log('🗑️ Account was deleted - clearing all data including account reference');
          clearAuthData({ 
            clearAnalysis: true,        // Clear analysis
            clearOAuthState: true,      // Clear OAuth state
            clearAccountReference: true // Clear account reference
          });
          
          setIsAuthenticated(false);
          setAccountId(null);
          setOnboardingComplete(false);
          setHasValidGoogleConnection(false);
        } else if (hasAccountReference && isRecentAuth) {
          // Recent auth - cookie might not be working, try setting it again
          console.log('⚠️ Recent auth but backend says not authenticated - retrying with localStorage account ID');
          
          // Re-set the cookie from localStorage in case popup cookie wasn't shared
          const accountId = hasAccountReference;
          const isProduction = window.location.protocol === 'https:';
          const cookieOptions = isProduction 
            ? 'path=/; max-age=604800; SameSite=None; Secure'
            : 'path=/; max-age=604800; SameSite=Lax';
          document.cookie = `dvyb_account_id=${accountId}; ${cookieOptions}`;
          console.log('🍪 Re-set account cookie from localStorage');
          
          // Mark as authenticated based on localStorage (optimistic)
          // The next API call will verify this
          setIsAuthenticated(true);
          setAccountId(parseInt(accountId));
          setOnboardingComplete(false); // Will be updated on next check
          setHasValidGoogleConnection(false);
          
          // Clear the timestamp so this doesn't keep happening
          localStorage.removeItem('dvyb_auth_timestamp');
          return; // Don't redirect
        } else {
          // Fresh unauthenticated user (no account reference) - don't clear anything
          // This preserves website analysis data for the unauthenticated flow
          console.log('👤 Fresh unauthenticated user - preserving localStorage');
          
          setIsAuthenticated(false);
          setAccountId(null);
          setOnboardingComplete(false);
          setHasValidGoogleConnection(false);
        }
        
        // Define public routes that don't require authentication
        const publicRoutes = ['/', '/auth/twitter', '/auth/twitter/callback', '/auth/login', '/onboarding/analysis-details', '/onboarding/brand-profile', '/auth/google/callback'];
        const isPublicRoute = publicRoutes.some(route => pathname === route || pathname?.startsWith(route));
        
        // If user is not authenticated and not on a public route, redirect to landing page
        if (!isPublicRoute && pathname !== '/') {
          console.log(`🔒 Account does not exist, redirecting from ${pathname} to /`);
          router.push('/');
        }
      }
    } catch (error) {
      console.error('❌ Auth check failed:', error);
      setIsAuthenticated(false);
      setAccountId(null);
      setOnboardingComplete(false);
      setHasValidGoogleConnection(false);
      
      // On error, only clear session cookies, don't clear localStorage
      // User can still re-login if account exists
      console.log('⚠️ Auth check error - clearing session cookies only');
      document.cookie = 'dvyb_account_id=; path=/; max-age=0';
      document.cookie = 'dvyb_twitter_handle=; path=/; max-age=0';
      
      // Check if user has account reference - redirect accordingly
      const hasAccountReference = localStorage.getItem('dvyb_account_id');
      
      // Redirect based on whether account reference exists
      const publicRoutes = ['/', '/auth/twitter', '/auth/twitter/callback', '/auth/login', '/onboarding/analysis-details', '/onboarding/brand-profile', '/auth/google/callback'];
      const isPublicRoute = publicRoutes.some(route => pathname === route || pathname?.startsWith(route));
      
      if (!isPublicRoute) {
        if (hasAccountReference) {
          // User has logged in before - redirect to Twitter auth
          console.log(`🔒 Auth error with account reference, redirecting from ${pathname} to /auth/login`);
          router.push('/auth/login');
        } else {
          // New user - redirect to landing page
          console.log(`🔒 Auth error without account reference, redirecting from ${pathname} to /`);
          router.push('/');
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    try {
      const response = await authApi.getGoogleLoginUrl();
      if (response.success) {
        // Redirect to Google OAuth
        window.location.href = response.data.oauth_url;
      }
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
      setIsAuthenticated(false);
      setAccountId(null);
      setOnboardingComplete(false);
      
      // On logout: Clear session cookies but keep account reference in localStorage
      // This allows the landing page to show "Already have an account?" with sign-in button
      clearAuthData({ 
        clearAnalysis: false,      // Keep analysis data
        clearOAuthState: true,      // Clear OAuth state
        clearAccountReference: false // Keep account ID so user can sign in again
      });
      
      console.log('👋 User logged out - redirecting to landing page');
      
      // Redirect to landing page (root path)
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        accountId,
        onboardingComplete,
        isLoading,
        hasValidGoogleConnection,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

