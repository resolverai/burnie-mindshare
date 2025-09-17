"use client";

import { useState } from 'react';
import { useAccount } from 'wagmi';
import useMixpanel from './useMixpanel';

interface UseTextEditingProps {
  contentId: number;
  postType: string;
  onSuccess?: (updatedContent: any) => void;
  onError?: (error: string) => void;
}

export const useTextEditing = ({ contentId, postType, onSuccess, onError }: UseTextEditingProps) => {
  const [isSaving, setIsSaving] = useState(false);
  const { address } = useAccount();
  const mixpanel = useMixpanel();

  const saveTextChanges = async (updatedTweet: string, updatedThread?: string[]) => {
    if (!address) {
      onError?.('Wallet not connected');
      return;
    }

    setIsSaving(true);

    try {
      console.log('🚀 saveTextChanges called with:', {
        contentId,
        updatedTweet,
        updatedThread,
        walletAddress: address
      });

      // Track edit started event
      mixpanel.tweetEditStarted({
        contentId,
        postType,
        editType: 'main_tweet',
        screenName: 'TextEditing'
      });

      const requestBody = {
        updatedTweet,
        updatedThread: updatedThread || [],
        walletAddress: address,
      };

      console.log('📤 Sending API request to:', `/api/marketplace/content/${contentId}/edit-text`);
      console.log('📤 Request body:', requestBody);

      const response = await fetch(`/api/marketplace/content/${contentId}/edit-text`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      console.log('📥 API Response status:', response.status);
      console.log('📥 API Response:', result);

      if (!response.ok) {
        throw new Error(result.message || 'Failed to save changes');
      }

      // Track successful save
      mixpanel.tweetEditSaved({
        contentId,
        postType,
        editType: 'main_tweet',
        characterCount: updatedTweet.length,
        maxLength: postType === 'longpost' ? 25000 : 280,
        threadLength: updatedThread?.length,
        screenName: 'TextEditing'
      });

      onSuccess?.(result.content);
      return result.content;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Error saving text changes:', error);
      onError?.(errorMessage);
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const getCharacterLimit = () => {
    return postType === 'longpost' ? 25000 : 280;
  };

  const canEditThread = () => {
    return postType === 'thread';
  };

  return {
    saveTextChanges,
    isSaving,
    getCharacterLimit,
    canEditThread,
  };
};

export default useTextEditing;
