"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi } from '@/lib/api';

interface AuthContextType {
  isAuthenticated: boolean;
  accountId: number | null;
  onboardingComplete: boolean;
  isLoading: boolean;
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

  const checkAuth = async () => {
    setIsLoading(true); // Always set loading when checking auth
    
    try {
      console.log('🔍 Checking authentication with backend...');
      const response = await authApi.getAuthStatus();
      
      if (response.success && response.data.authenticated) {
        setIsAuthenticated(true);
        setAccountId(response.data.accountId || null);
        setOnboardingComplete(response.data.onboardingComplete || false);
        console.log('✅ Authentication verified with backend - authenticated:', true, 'onboarding complete:', response.data.onboardingComplete);
      } else {
        console.log('❌ Not authenticated - clearing local state');
        setIsAuthenticated(false);
        setAccountId(null);
        setOnboardingComplete(false);
        
        // Clear stale localStorage data when backend says not authenticated
        localStorage.removeItem('dvyb_account_id');
        localStorage.removeItem('dvyb_twitter_handle');
        localStorage.removeItem('dvyb_twitter_oauth_state');
        localStorage.removeItem('dvyb_twitter_code_challenge');
      }
    } catch (error) {
      console.error('❌ Auth check failed:', error);
      setIsAuthenticated(false);
      setAccountId(null);
      setOnboardingComplete(false);
      
      // Clear localStorage on error
      localStorage.removeItem('dvyb_account_id');
      localStorage.removeItem('dvyb_twitter_handle');
      localStorage.removeItem('dvyb_twitter_oauth_state');
      localStorage.removeItem('dvyb_twitter_code_challenge');
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    try {
      const response = await authApi.getTwitterLoginUrl();
      if (response.success) {
        // Redirect to Twitter OAuth
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
      
      // Redirect to home
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

