"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { affiliateAuthApi } from '@/lib/api';

interface AffiliateAuthContextType {
  isAuthenticated: boolean;
  affiliateId: number | null;
  affiliateName: string | null;
  affiliateEmail: string | null;
  profilePicture: string | null;
  referralCode: string | null;
  commissionTier: string | null;
  commissionRate: number | null;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AffiliateAuthContext = createContext<AffiliateAuthContextType | undefined>(undefined);

export function AffiliateAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [affiliateId, setAffiliateId] = useState<number | null>(null);
  const [affiliateName, setAffiliateName] = useState<string | null>(null);
  const [affiliateEmail, setAffiliateEmail] = useState<string | null>(null);
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [commissionTier, setCommissionTier] = useState<string | null>(null);
  const [commissionRate, setCommissionRate] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const checkAuth = async () => {
    setIsLoading(true);
    try {
      const response = await affiliateAuthApi.getAuthStatus();
      if (response.success && response.data.authenticated) {
        setIsAuthenticated(true);
        setAffiliateId(response.data.affiliateId || null);
        setAffiliateName(response.data.name || null);
        setAffiliateEmail(response.data.email || null);
        setProfilePicture(response.data.profilePicture || null);
        setReferralCode(response.data.referralCode || null);
        setCommissionTier(response.data.commissionTier || null);
        setCommissionRate(response.data.commissionRate || null);

        if (response.data.affiliateId) {
          localStorage.setItem('dvyb_affiliate_id', String(response.data.affiliateId));
          localStorage.setItem('dvyb_affiliate_session_active', 'true');
        }
      } else {
        setIsAuthenticated(false);
        setAffiliateId(null);
        setAffiliateName(null);
        setAffiliateEmail(null);
        setProfilePicture(null);
        setReferralCode(null);
        setCommissionTier(null);
        setCommissionRate(null);
      }
    } catch (error) {
      console.error('Affiliate auth check failed:', error);
      const hasReference = localStorage.getItem('dvyb_affiliate_id');
      if (!hasReference) {
        setIsAuthenticated(false);
        setAffiliateId(null);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    try {
      const response = await affiliateAuthApi.getGoogleLoginUrl();
      if (response.success) {
        localStorage.setItem('dvyb_affiliate_oauth_state', response.data.state);
        window.location.href = response.data.oauth_url;
      }
    } catch (error) {
      console.error('Affiliate login failed:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await affiliateAuthApi.logout();
      setIsAuthenticated(false);
      setAffiliateId(null);
      setAffiliateName(null);
      setAffiliateEmail(null);
      setProfilePicture(null);
      setReferralCode(null);
      setCommissionTier(null);
      setCommissionRate(null);

      localStorage.removeItem('dvyb_affiliate_id');
      localStorage.removeItem('dvyb_affiliate_session_active');
      localStorage.removeItem('dvyb_affiliate_oauth_state');
      document.cookie = 'dvyb_affiliate_id=; path=/; max-age=0';

      window.location.href = '/affiliates/login';
    } catch (error) {
      console.error('Affiliate logout failed:', error);
      throw error;
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AffiliateAuthContext.Provider
      value={{
        isAuthenticated,
        affiliateId,
        affiliateName,
        affiliateEmail,
        profilePicture,
        referralCode,
        commissionTier,
        commissionRate,
        isLoading,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AffiliateAuthContext.Provider>
  );
}

export function useAffiliateAuth() {
  const context = useContext(AffiliateAuthContext);
  if (context === undefined) {
    throw new Error('useAffiliateAuth must be used within an AffiliateAuthProvider');
  }
  return context;
}
