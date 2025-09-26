import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';

interface UserReferralCode {
  code: string;
  currentUses: number;
  maxUses: number;
  tier: string;
}

export const useUserReferralCode = () => {
  const { address, isConnected } = useAccount();
  const [referralCode, setReferralCode] = useState<UserReferralCode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReferralCode = async () => {
    if (!address || !isConnected) {
      setReferralCode(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/referrals/my-code/${address}`
      );

      const result = await response.json();

      if (result.success) {
        setReferralCode(result.data);
      } else {
        setError(result.message || 'Failed to fetch referral code');
      }
    } catch (err) {
      setError('Error fetching referral code');
      console.error('Error fetching user referral code:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      return true;
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      return false;
    }
  };

  const generateReferralLink = (code: string) => {
    // Use environment variable first, fallback to window.location.origin
    const baseUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${baseUrl}/?ref=${code}`;
  };

  const copyReferralLink = async (code: string) => {
    try {
      const referralLink = generateReferralLink(code);
      await navigator.clipboard.writeText(referralLink);
      return true;
    } catch (err) {
      console.error('Failed to copy referral link to clipboard:', err);
      return false;
    }
  };

  useEffect(() => {
    fetchReferralCode();
  }, [address, isConnected]);

  return {
    referralCode,
    isLoading,
    error,
    fetchReferralCode,
    copyToClipboard,
    generateReferralLink,
    copyReferralLink
  };
};
