'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { appKit } from '@/app/reown'
import Image from 'next/image'
import { generateRandomMindshare, formatMindshare } from '../../utils/mindshareUtils'

import { useROASTPrice, formatUSDCPrice } from '../../utils/priceUtils'
import { transferROAST, checkROASTBalance, transferUSDC, checkUSDCBalance } from '../../utils/walletUtils'
import { executeROASTPayment } from '../../services/roastPaymentService'
import TweetThreadDisplay from '../TweetThreadDisplay'
import VideoPlayer from '../VideoPlayer'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo, markdownToPlainText, markdownToHTML } from '../../utils/markdownParser'

import { useTwitter } from '../../contexts/TwitterContext'
import { useMarketplaceAccess } from '../../hooks/useMarketplaceAccess'
import { useAuth } from '../../hooks/useAuth'
import { useTwitterPosting } from '../../hooks/useTwitterPosting'
import { useRouter } from 'next/navigation'
import useMixpanel from '../../hooks/useMixpanel'
import { EditText, ThreadItemEditor } from './EditComponents'
import useTextEditing from '../../hooks/useTextEditing'
import TweetEditDropdown from './TweetEditDropdown'

interface ContentItem {
  id: number
  content_text: string
  tweet_thread?: string[]
  content_images?: string[]
  watermark_image?: string
  predicted_mindshare: number
  quality_score: number
  asking_price: number
  bidding_ask_price?: number  // Add bidding ask price field
  // Video fields
  is_video?: boolean
  video_url?: string
  watermark_video_url?: string
  video_duration?: number
  subsequent_frame_prompts?: Record<string, string>
  clip_prompts?: Record<string, string>
  audio_prompt?: string
  creator: {
    id: number
    username: string
    reputation_score: number
    wallet_address?: string
  }
  campaign: {
    id: number
    title: string
    platform_source: string
    project_name?: string
    reward_token: string
  }
  agent_name?: string
  created_at: string
  post_type?: string
  approved_at?: string
  bidding_enabled_at?: string
  // Text-only regeneration support
  imagePrompt?: string
  updatedTweet?: string
  updatedThread?: string[]
  isAvailable?: boolean
  purchased_at?: string
}

interface PurchaseContentModalProps {
  content: ContentItem | null
  isOpen: boolean
  onClose: () => void
  onPurchase?: (contentId: number, price: number, currency: 'ROAST' | 'USDC', transactionHash?: string) => void
  onContentUpdate?: (updatedContent: ContentItem) => void
}

export default function PurchaseContentModal({
  content,
  isOpen,
  onClose,
  onPurchase,
  onContentUpdate
}: PurchaseContentModalProps) {
  const mixpanel = useMixpanel()
  
  // Text editing state
  const [isEditingMainTweet, setIsEditingMainTweet] = useState(false)
  const [isEditingThread, setIsEditingThread] = useState(false)
  const [editedMainTweet, setEditedMainTweet] = useState('')
  const [editedThread, setEditedThread] = useState<string[]>([])
  const [isUpdatingPost, setIsUpdatingPost] = useState(false)
  
  // Avatar fusion edit state
  const [editMode, setEditMode] = useState<'text' | 'fusion' | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [isProcessingEdit, setIsProcessingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [remainingCredits, setRemainingCredits] = useState<number>(3)
  const [completedEdit, setCompletedEdit] = useState<any>(null) // Store completed edit data
  const [serverEditContent, setServerEditContent] = useState<any>(null) // Store edit overlay data from server
  const [lastExecutionId, setLastExecutionId] = useState<string | null>(null) // Store last execution ID for post-purchase refresh
  const dropdownRefreshCredits = useRef<(() => void) | null>(null) // Ref to TweetEditDropdown refresh function
  const editTweetUIRef = useRef<HTMLDivElement | null>(null) // Ref to Edit Tweet UI section for scrolling
  
  // Text editing hook
  const { saveTextChanges, isSaving, getCharacterLimit, canEditThread } = useTextEditing({
    contentId: content?.id || 0,
    postType: content?.post_type || 'thread',
    onSuccess: (updatedContent) => {
      console.log('✅ Text updated successfully:', updatedContent)
      // Update local content state
      if (onContentUpdate && content) {
        onContentUpdate({
          ...content,
          updatedTweet: updatedContent.updatedTweet,
          updatedThread: updatedContent.updatedThread
        })
      }
    },
    onError: (error) => {
      console.error('❌ Error updating text:', error)
      // You could show a toast notification here
    }
  })
  
  // Reset editing state when content changes
  React.useEffect(() => {
    if (content) {
      console.log('🔄 Resetting all state for new content:', content.id);
      
      // Reset all editing states when new content is loaded
      setIsEditingMainTweet(false);
      setIsEditingThread(false);
      setEditedMainTweet('');
      setEditedThread([]);
      
      // Reset all content-related states completely
      setLocalContent(null);
      setGeneratedContent(null);
      setHasGeneratedContent(false);
      setIsGeneratingContent(false);
      setIsTextOnlyGeneration(false);
      setGenerationStatus('');
      setGenerationProgress(0);
      setContentUpdateTrigger(0);
      setForceUpdate(0);
      
      // Reset purchase-related states
      setIsPurchased(false);
      setPurchasedContentDetails(null);
      
      // Reset Twitter posting states
      setIsPostingToTwitter(false);
      setTwitterPostingResult(null);
      
      // Reset generation states
      setExecutionId(null);
      // Keep textOnlyModeEnabled as true (default)
      
      // Reset original content
      setOriginalContent(content);
      
      console.log('✅ All state reset for content:', content.id);
    }
  }, [content?.id]); // Reset when content ID changes

  // Scroll restoration effect
  React.useEffect(() => {
    if (isOpen) {
      // Store current scroll position
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
    } else {
      // Restore scroll position
      const scrollY = document.body.style.top;
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1);
      }
    }
    
    // Cleanup function
    return () => {
      if (!isOpen) {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
      }
    };
  }, [isOpen]);

  // Reset state when modal is closed
  React.useEffect(() => {
    if (!isOpen) {
      console.log('🔄 Resetting all state when modal is closed');
      
      // Reset all editing states when modal is closed
      setIsEditingMainTweet(false);
      setIsEditingThread(false);
      setEditedMainTweet('');
      setEditedThread([]);
      
      // Reset all content-related states completely
      setLocalContent(null);
      setGeneratedContent(null);
      setHasGeneratedContent(false);
      setIsGeneratingContent(false);
      setIsTextOnlyGeneration(false);
      setGenerationStatus('');
      setGenerationProgress(0);
      setContentUpdateTrigger(0);
      setForceUpdate(0);
      
      // Reset purchase-related states
      setIsPurchased(false);
      setPurchasedContentDetails(null);
      
      // Reset Twitter posting states
      setIsPostingToTwitter(false);
      setTwitterPostingResult(null);
      
      // Reset generation states
      setExecutionId(null);
      // Keep textOnlyModeEnabled as true (default)
      
      console.log('✅ All state reset when modal closed');
    }
  }, [isOpen]);

  // Cleanup effect to ensure scroll is restored on unmount
  React.useEffect(() => {
    return () => {
      // Force restore scroll when component unmounts
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      
      // Reset all state when component unmounts
      console.log('🔄 Component unmounting, resetting all state');
      setIsEditingMainTweet(false);
      setIsEditingThread(false);
      setEditedMainTweet('');
      setEditedThread([]);
      setLocalContent(null);
      setGeneratedContent(null);
      setHasGeneratedContent(false);
      setIsGeneratingContent(false);
      setIsTextOnlyGeneration(false);
      setGenerationStatus('');
      setGenerationProgress(0);
      setContentUpdateTrigger(0);
      setForceUpdate(0);
      setIsPurchased(false);
      setPurchasedContentDetails(null);
      setIsPostingToTwitter(false);
      setTwitterPostingResult(null);
      setExecutionId(null);
      // Keep textOnlyModeEnabled as true (default)
    };
  }, []);
  
  const { address } = useAccount()
  const { price: roastPrice } = useROASTPrice()
  const { twitter, connect, disconnect, refreshToken, isTwitterReady } = useTwitter()
  const { hasAccess } = useMarketplaceAccess()
  const { isAuthenticated, signIn } = useAuth()
  const { status: twitterPostingStatus, refresh: refreshTwitterStatus } = useTwitterPosting()
  const router = useRouter()

  // Fetch remaining edit credits when wallet changes
  React.useEffect(() => {
    const fetchCredits = async () => {
      if (!address) return;
      
      try {
        const response = await fetch(`/api/edit-tweet/credits/${address}`);
        if (response.ok) {
          const data = await response.json();
          setRemainingCredits(data.remainingCredits);
        }
      } catch (error) {
        console.error('Failed to fetch edit credits:', error);
      }
    };
    
    fetchCredits();
  }, [address]);

  // Reset edit states when content changes (switching between different content items)
  useEffect(() => {
    console.log('🔄 Content ID changed, resetting edit states. Content ID:', content?.id);
    setEditMode(null);
    setEditPrompt('');
    setAvatarFile(null);
    setIsProcessingEdit(false);
    setEditError(null);
    // Don't reset completedEdit immediately - let it persist until we know there's no edit for this content
    // setCompletedEdit(null);
    setIsEditingMainTweet(false);
    setIsEditingThread(false);
    setEditedMainTweet('');
    setEditedThread([]);
  }, [content?.id]); // Reset when content ID changes

  // Also reset serverEditContent when content changes
  useEffect(() => {
    setServerEditContent(null);
  }, [content?.id]);

  // Fetch content with edit overlay when content changes
  useEffect(() => {
    const fetchContentWithEdits = async () => {
      if (!content?.id) return;
      
        try {
         const headers: Record<string, string> = {
           'Content-Type': 'application/json',
         };
         
         // Include wallet address for personalized edit content
         if (address) {
           headers.Authorization = `Bearer ${address}`;
         }
         
         const response = await fetch(`/api/marketplace/content/${content.id}`, {
           method: 'GET',
           headers
         });
         
         if (response.ok) {
          const data = await response.json();
          if (data.success && data.data.editContent) {
            setServerEditContent(data.data.editContent);
            console.log('📝 Found server edit content:', data.data.editContent);
            // Clear completedEdit since we have server edit content
            setCompletedEdit(null);
          } else {
            setServerEditContent(null);
            // Only clear completedEdit if there's no server edit content
            setCompletedEdit(null);
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch content with edits:', error);
        setServerEditContent(null);
        setCompletedEdit(null);
      }
    };

      fetchContentWithEdits();
   }, [content?.id, address]); // Fetch when content ID or wallet address changes

  // Track purchase modal opened
  // Note: purchaseModalOpened tracking removed - now handled by contentItemClicked in BiddingInterface

  // Track purchase cancellation when modal is closed
  const handleModalClose = () => {
    // Track purchase cancellation if we have content and user hasn't completed purchase
    if (content && !purchasedContentDetails && !isPurchased) {
      const startTime = Date.now() // We could track this from when modal opened
      const timeInFlow = Date.now() - startTime // This is approximate
      
      mixpanel.purchaseCancelled({
        contentId: content.id,
        cancellationStage: 'modal_closed',
        timeInFlow: timeInFlow,
        selectedCurrency: selectedPayment === 'roast' ? 'ROAST' : 'USDC',
        screenName: 'PurchaseContentModal'
      })
    }
    
    // Reset all edit-related states when modal is closed
    setEditMode(null);
    setEditPrompt('');
    setAvatarFile(null);
    setIsProcessingEdit(false);
    setEditError(null);
    setCompletedEdit(null);
    setIsEditingMainTweet(false);
    setIsEditingThread(false);
    setEditedMainTweet('');
    setEditedThread([]);
    
    // Force scroll restoration before closing
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    onClose();
    // Prevent fund management modals from showing up temporarily
    const { disableModalsTemporarily } = require('../../utils/modalManager');
    disableModalsTemporarily();
  }
  
  // Helper function to get the current content to display
  // Prioritizes content with updated text over original content
  const getCurrentContent = (): ContentItem | null => {
    // Always start with the current content prop as the base
    if (!content) return null;
    
    console.log('🔍 getCurrentContent called for content ID:', content.id, {
      hasLocalContent: !!localContent,
      localContentId: localContent?.id,
      hasGeneratedContent: hasGeneratedContent,
      generatedContentId: generatedContent?.id,
      hasUpdatedTweet: localContent?.updatedTweet || generatedContent?.updatedTweet,
      hasUpdatedThread: localContent?.updatedThread || generatedContent?.updatedThread
    });
    
    // First priority: Check if we have content with updated text (text-only regeneration)
    // Make sure the local content matches the current content ID
    if (localContent && localContent.id === content.id && (localContent.updatedTweet || localContent.updatedThread)) {
      console.log('🔍 Using local content with updates');
      return localContent
    }
    
    // Second priority: Check if generated content has updated text (text-only regeneration)
    // Make sure the generated content matches the current content ID
    if (hasGeneratedContent && generatedContent && generatedContent.id === content.id && (generatedContent.updatedTweet || generatedContent.updatedThread)) {
      console.log('🔍 Using generated content with updates');
      return generatedContent
    }
    
    // Third priority: Check if we have generated content (full regeneration)
    // Make sure the generated content matches the current content ID
    if (hasGeneratedContent && generatedContent && generatedContent.id === content.id) {
      console.log('🔍 Using generated content');
      return generatedContent
    }
    
    // Fourth priority: Use local content if available and matches current content ID
    if (localContent && localContent.id === content.id) {
      console.log('🔍 Using local content');
      return localContent
    }
    
    // Fallback: Use the current content prop
    console.log('🔍 Using original content prop');
    return content
  }

  // Local text editing handlers (no API calls)
  const handleMainTweetLocalEdit = (newText: string) => {
    setEditedMainTweet(newText)
    console.log('📝 Main tweet edited locally:', newText.substring(0, 50) + '...')
  }

  const handleThreadLocalEdit = (newThread: string[]) => {
    setEditedThread(newThread)
    console.log('📝 Thread edited locally:', newThread.length, 'items')
  }

  // Direct API save for shitpost and longpost
  const handleMainTweetEdit = async (newText: string) => {
    try {
      await saveTextChanges(newText, editedThread.length > 0 ? editedThread : undefined)
      setEditedMainTweet(newText)
      setIsEditingMainTweet(false)
      
      // Set showTweetManagement to true since content has been edited
      setShowTweetManagement(true)
    } catch (error) {
      console.error('Error saving main tweet:', error)
    }
  }

  // Final save to API when "Update Post" is pressed
  const handleUpdatePost = async () => {
    if (isUpdatingPost) return // Prevent multiple clicks
    
    try {
      setIsUpdatingPost(true)
      console.log('💾 Updating post with final changes...')
      
      // Get current display content to ensure we have the latest values
      const currentDisplayContent = getDisplayContent()
      const finalMainTweet = editedMainTweet || currentDisplayContent.text
      const finalThread = editedThread.length > 0 ? editedThread : currentDisplayContent.thread
      
      console.log('🔍 Debug - finalMainTweet:', finalMainTweet)
      console.log('🔍 Debug - finalThread:', finalThread)
      console.log('🔍 Debug - contentId:', content?.id)
      
      await saveTextChanges(finalMainTweet, finalThread.length > 0 ? finalThread : undefined)
      
      // Update local state to reflect the changes
      const currentContent = getCurrentContent()
      if (currentContent) {
        const updatedContent = {
          ...currentContent,
          updatedTweet: finalMainTweet,
          updatedThread: finalThread.length > 0 ? finalThread : currentContent.updatedThread
        }
        setLocalContent(updatedContent)
        setGeneratedContent(updatedContent)
      }
      
      // Reset editing states
      setIsEditingMainTweet(false)
      setIsEditingThread(false)
      
      // Set showTweetManagement to true since content has been edited
      setShowTweetManagement(true)
      
      console.log('✅ Post updated successfully')
    } catch (error) {
      console.error('❌ Error updating post:', error)
      // You could show a toast notification here
    } finally {
      setIsUpdatingPost(false)
    }
  }

  // Edit tweet handlers
  const handleEditSelect = (type: 'text' | 'fusion') => {
    setEditMode(type);
    setEditError(null);
    
    if (type === 'text') {
      // Start text editing mode (existing functionality)
      handleStartMainTweetEdit();
    } else if (type === 'fusion') {
      // For fusion mode, scroll to the Edit Tweet UI after a brief delay to ensure it's rendered
      setTimeout(() => {
        if (editTweetUIRef.current) {
          // Scroll to the Edit Tweet UI with smooth animation
          editTweetUIRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest'
          });
          
          // Add a subtle highlight effect to draw attention (optional)
          editTweetUIRef.current.style.transition = 'box-shadow 0.3s ease';
          editTweetUIRef.current.style.boxShadow = '0 0 20px rgba(253, 122, 16, 0.3)';
          
          // Remove the highlight after 2 seconds
          setTimeout(() => {
            if (editTweetUIRef.current) {
              editTweetUIRef.current.style.boxShadow = '';
            }
          }, 2000);
        }
      }, 100); // Small delay to ensure the UI is rendered
    }
  };

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAvatarFile(file);
    }
  };

  const handleSubmitEdit = async () => {
    if (!editPrompt.trim() || !content || !address) return;
    
    setIsProcessingEdit(true);
    setEditError(null);
    
    try {
      // Track edit submission
      mixpanel.editTweetSubmitted({
        content_id: content.id,
        campaign_title: content.campaign?.title || 'Unknown',
        user_prompt: editPrompt,
        edit_type: content.purchased_at ? 'post_purchase' : 'pre_purchase',
        wallet_address: address
      });

      // Create FormData for file upload
      const formData = new FormData();
      formData.append('walletAddress', address);
      formData.append('contentId', content.id.toString());
      formData.append('userRequest', editPrompt);
      formData.append('isPurchased', (!!content.purchased_at).toString());
      
      if (avatarFile) {
        formData.append('avatarImage', avatarFile);
      }

      // Submit edit request with file upload
      const submitResponse = await fetch('/api/edit-tweet/submit', {
        method: 'POST',
        body: formData
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json();
        throw new Error(errorData.message || 'Failed to submit edit request');
      }

      const submitData = await submitResponse.json();
      
      console.log('🔄 Submit response:', submitData);
      console.log('🔍 Debug - requiresPayment type:', typeof submitData.requiresPayment, 'value:', submitData.requiresPayment);
      console.log('🔍 Debug - roastAmount:', submitData.roastAmount);
      
      // Handle string vs boolean comparison issue
      const needsPayment = submitData.requiresPayment === true || submitData.requiresPayment === 'true';
      
      let processingStarted = false;
      
      if (needsPayment) {
        // Handle payment flow for post-purchase edits
        console.log('💳 Triggering payment flow for execution:', submitData.executionId);
        await handleEditPayment(submitData.executionId, submitData.roastAmount);
        processingStarted = true;
      } else {
        // Handle free edit flow
        console.log('🆓 Triggering free edit flow for execution:', submitData.executionId);
        await handleFreeEdit(submitData.executionId);
        processingStarted = true;
      }

      // Don't set isProcessingEdit to false if processing started successfully
      // It will be set to false when polling completes (success/failure/timeout)
      return;

    } catch (error) {
      console.error('❌ Edit submission failed:', error);
      setEditError(error instanceof Error ? error.message : 'Failed to submit edit');
      setCompletedEdit(null); // Clear any previous completed edit on error
      setIsProcessingEdit(false); // Only set to false on error
    }
  };

  const handleEditPayment = async (executionId: string, roastAmount: number) => {
    try {
      console.log('💳 Payment required:', { executionId, roastAmount });
      
      // TODO: Replace with actual ROAST token contract address
      const roastTokenAddress = "0x..."; // Get from environment or config
      
      // Open wallet to send ROAST tokens
      // This would typically use a library like wagmi/viem to interact with the wallet
      console.log('🔓 Opening wallet for ROAST token transaction...');
      console.log('📄 Token Contract:', roastTokenAddress);
      console.log('💰 Amount:', roastAmount);
      
      // Placeholder for wallet interaction
      // In a real implementation, this would:
      // 1. Connect to wallet
      // 2. Get ROAST token contract
      // 3. Approve/transfer tokens
      // 4. Get transaction hash
      // 5. Call confirm-payment endpoint
      
      const mockTransactionHash = "0x" + Math.random().toString(16).substr(2, 64);
      console.log('✅ Mock transaction successful:', mockTransactionHash);
      
      // Confirm payment with backend
      const confirmResponse = await fetch('/api/edit-tweet/confirm-payment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          executionId, 
          transactionHash: mockTransactionHash 
        })
      });
      
      if (confirmResponse.ok) {
        const confirmData = await confirmResponse.json();
        console.log('✅ Payment confirmed:', confirmData);
        
        // Start polling for status
        pollEditStatus(executionId);
      } else {
        const errorData = await confirmResponse.json();
        console.error('❌ Payment confirmation failed:', errorData);
        setEditError(errorData.message || 'Payment confirmation failed');
      }
      
    } catch (error) {
      console.error('❌ Payment failed:', error);
      setEditError('Payment failed. Please try again.');
    }
  };

  const handleFreeEdit = async (executionId: string) => {
    try {
      console.log('🔄 Making request to trigger-free with executionId:', executionId);
      
      // Set processing state to show shimmers
      setIsProcessingEdit(true);
      setEditError(null);
      
      const response = await fetch('/api/edit-tweet/trigger-free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId })
      });

      console.log('🔄 trigger-free response status:', response.status);
      
      if (response.ok) {
        const responseData = await response.json();
        console.log('✅ trigger-free response data:', responseData);
        
        // Start polling for status (keep isProcessingEdit true until completion)
        pollEditStatus(executionId);
      } else {
        const errorData = await response.json();
        console.error('❌ trigger-free failed:', errorData);
        
        // Provide user-friendly error messages
        let userMessage = 'Failed to start edit processing';
        if (errorData.message?.includes('payment required') || errorData.message?.includes('confirm-payment')) {
          userMessage = 'This edit requires payment. Please try again.';
        } else if (errorData.message?.includes('not found')) {
          userMessage = 'Edit request not found. Please try submitting again.';
        } else if (errorData.message) {
          userMessage = errorData.message;
        }
        
        setEditError(userMessage);
        setCompletedEdit(null); // Clear any previous completed edit on error
        setIsProcessingEdit(false); // Reset processing state on error
      }
    } catch (error) {
      console.error('❌ Failed to trigger free edit:', error);
      setEditError('Failed to start edit processing');
      setCompletedEdit(null); // Clear any previous completed edit on error
      setIsProcessingEdit(false); // Reset processing state on error
    }
  };

  const pollEditStatus = async (executionId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/edit-tweet/status/${executionId}`);
        if (response.ok) {
          const data = await response.json();
          
          if (data.status === 'completed') {
            clearInterval(pollInterval);
            console.log('✅ Edit completed successfully:', data);
            console.log('🔍 Debug - newWatermarkImageUrl:', data.newWatermarkImageUrl);
            console.log('🔍 Debug - newImageUrl:', data.newImageUrl);
            console.log('🔍 Debug - isPurchased:', data.isPurchased);
            console.log('🔍 Debug - content purchased_at:', content?.purchased_at);
            
            // Store the execution ID for potential post-purchase refresh
            setLastExecutionId(executionId);
            
            // Store the completed edit data for display
            setCompletedEdit({
              newTweetText: data.newTweetText,
              newThread: data.newThread,
              newImageUrl: data.newImageUrl, // This is now the appropriate image for purchase status
              newWatermarkImageUrl: data.newWatermarkImageUrl,
              isPurchased: data.isPurchased || !!content?.purchased_at
            });
            
            console.log('🔍 Debug - completedEdit set with watermark:', data.newWatermarkImageUrl);
            console.log('🎯 POLLING - completedEdit state updated, should trigger re-render with new image!');
            
            // ✅ Edit tweet functionality only updates user_tweet_edits table
            // Content marketplace table and main content object remain unchanged
            // The edited content will be displayed via completedEdit state
            
            // Reset edit form state and stop processing
            setEditMode(null);
            setEditPrompt('');
            setAvatarFile(null);
            setIsProcessingEdit(false); // Hide shimmers
            setEditError(null);
            
            // Refresh credits counter to show updated remaining credits
            if (address) {
              const creditsResponse = await fetch(`/api/edit-tweet/credits/${address}`);
              if (creditsResponse.ok) {
                const creditsData = await creditsResponse.json();
                setRemainingCredits(creditsData.remainingCredits);
                console.log('🔄 Updated remaining credits:', creditsData.remainingCredits);
                
                // Also refresh the dropdown credits counter
                if (dropdownRefreshCredits.current) {
                  dropdownRefreshCredits.current();
                }
              }
            }
            
          } else if (data.status === 'failed') {
            clearInterval(pollInterval);
            console.log('❌ Edit failed:', data);
            setEditError(data.error || 'Edit processing failed. Please try again.');
            setIsProcessingEdit(false);
            setCompletedEdit(null); // Clear any previous completed edit
          }
        }
      } catch (error) {
        console.error('❌ Status polling failed:', error);
        // On polling error, also stop processing and clear completed edit
        setIsProcessingEdit(false);
        setCompletedEdit(null);
        setEditError('Failed to check edit status. Please try again.');
      }
    }, 2000); // Poll every 2 seconds

    // Stop polling after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      if (isProcessingEdit) {
        setIsProcessingEdit(false);
        setCompletedEdit(null);
        setEditError('Edit timeout. Please try again.');
      }
    }, 300000);
  };

  const handleStartMainTweetEdit = () => {
    const currentContent = getCurrentContent()
    if (currentContent) {
      setEditedMainTweet(getDisplayContent().text)
      setIsEditingMainTweet(true)
    }
  }

  const handleStartThreadEdit = () => {
    const currentContent = getCurrentContent()
    if (currentContent) {
      setEditedThread(getDisplayContent().thread || [])
      setIsEditingThread(true)
    }
  }

  // Check if there are any local changes that need to be saved
  const hasLocalChanges = () => {
    const currentContent = getCurrentContent()
    if (!currentContent) return false
    
    const currentText = getDisplayContent().text
    const currentThread = getDisplayContent().thread || []
    
    return editedMainTweet !== currentText || 
           JSON.stringify(editedThread) !== JSON.stringify(currentThread)
  }

  // Check if content is purchased (for showing edit options)
  const isContentPurchased = () => {
    // Always check the current content prop, not cached state
    if (!content) return false;
    
    console.log('🔍 isContentPurchased check for content ID:', content.id, {
      hasUpdatedTweet: !!content.updatedTweet,
      hasUpdatedThread: !!content.updatedThread,
      isPurchasedState: isPurchased,
      contentUpdatedTweet: content.updatedTweet?.substring(0, 50) + '...',
      contentUpdatedThread: content.updatedThread?.length || 0
    });
    
    // Check if content has been purchased (has updatedTweet or updatedThread)
    const hasUpdatedContent = content.updatedTweet || content.updatedThread;
    
    // Check if this is a purchased content (from My Content screen)
    const isPurchasedContent = isPurchased;
    
    const result = hasUpdatedContent || isPurchasedContent;
    console.log('🔍 isContentPurchased result:', result);
    
    return result;
  }
  
  // Poll for content update after text-only generation completion
  const pollForContentUpdate = async (execId: string) => {
    const currentContent = getCurrentContent();
    if (!currentContent) return;
    
    console.log('🔄 Polling for content update for ID:', currentContent.id);
    
    // Poll every 1 second for up to 30 seconds
    const maxAttempts = 30;
    let attempts = 0;
    
    const pollInterval = setInterval(async () => {
      attempts++;
      console.log(`🔄 Content update poll attempt ${attempts}/${maxAttempts}`);
      
      try {
        const response = await fetch(`/api/marketplace/content/${currentContent.id}`);
        if (response.ok) {
          const result = await response.json();
          
          if (result.success && result.data?.content) {
            const freshContent = result.data.content;
            console.log('📡 Fresh content polled:', {
              id: freshContent.id,
              updatedTweet: freshContent.updatedTweet,
              updatedThread: freshContent.updatedThread,
              hasUpdates: !!(freshContent.updatedTweet || freshContent.updatedThread)
            });
            
            // Check if content has been updated
            if (freshContent.updatedTweet || freshContent.updatedThread) {
              clearInterval(pollInterval);
              console.log('✅ Content update detected! Updating frontend state...');
              
              // Update local content with the new data
              // For text-only generation, preserve existing image and only update text fields
              const typedContent: ContentItem = {
                ...freshContent, // Start with fresh content as base
                // Only update the text fields
                updatedTweet: freshContent.updatedTweet || undefined,
                updatedThread: freshContent.updatedThread || undefined,
                // Preserve existing image fields from local content
                content_images: localContent?.content_images || freshContent.content_images,
                watermark_image: localContent?.watermark_image || freshContent.watermark_image,
                // Update other fields from fresh content
                isAvailable: freshContent.isAvailable || freshContent.is_available || localContent?.isAvailable
              };
              
              console.log('🔍 Typed content before state update:', typedContent);
              console.log('🔍 Image preservation check:', {
                localContentImages: localContent?.content_images,
                localContentWatermark: localContent?.watermark_image,
                freshContentImages: freshContent.content_images,
                freshContentWatermark: freshContent.watermark_image,
                finalImages: typedContent.content_images,
                finalWatermark: typedContent.watermark_image
              });
              
              setLocalContent(typedContent);
              setGeneratedContent(typedContent);
              setHasGeneratedContent(true);
              
              // Force a re-render by updating state
              setForceUpdate(prev => prev + 1);
              setContentUpdateTrigger(prev => prev + 1);
              
              // Stop shimmer and show success message
              setIsGeneratingContent(false);
              setGenerationStatus('✅ Text-only regeneration completed! Content updated successfully.');
              
              console.log('✅ Content update polling completed successfully');
              
              // Debug: Log state after update
              console.log('🔍 State update completed:', {
                localContentUpdatedTweet: typedContent.updatedTweet?.substring(0, 50) + '...',
                localContentUpdatedThread: typedContent.updatedThread?.length || 0,
                hasGeneratedContent: true,
                contentUpdateTrigger: contentUpdateTrigger + 1
              });
              
              return;
            }
          }
        }
        
        // If we've reached max attempts, give up
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          console.warn('⚠️ Content update polling timed out after 30 seconds');
          setGenerationStatus('⚠️ Text-only generation completed but content update not detected');
          setIsGeneratingContent(false);
        }
        
      } catch (error) {
        console.error('❌ Error polling for content update:', error);
        attempts++;
        
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          setGenerationStatus('❌ Error checking content update');
          setIsGeneratingContent(false);
        }
      }
    }, 1000); // Poll every 1 second
  };

  // Helper function to get the display content (original vs updated)
  const getDisplayContent = (): { text: string; thread: string[] } => {
    const currentContent = getCurrentContent()
    if (!currentContent) return { text: '', thread: [] }
    
    // PRIORITY -1: If we have server edit content from user_tweet_edits table, show it
    if (serverEditContent) {
      const result = {
        text: serverEditContent.newTweetText || currentContent.content_text,
        thread: serverEditContent.newThread || currentContent.tweet_thread || []
      };
      console.log('🔍 SERVER EDIT CONTENT DISPLAYED:', {
        contentId: currentContent.id,
        text: result.text?.substring(0, 100) + '...',
        threadLength: result.thread?.length || 0,
        editedAt: serverEditContent.editedAt,
        source: 'user_tweet_edits_table'
      });
      return result;
    }
    
    // PRIORITY 0: If we have a completed edit from avatar fusion, show it
    if (completedEdit) {
      const result = {
        text: completedEdit.newTweetText || currentContent.content_text,
        thread: completedEdit.newThread || currentContent.tweet_thread || []
      };
      console.log('🔍 COMPLETED EDIT DISPLAYED:', {
        contentId: currentContent.id,
        text: result.text?.substring(0, 100) + '...',
        threadLength: result.thread?.length || 0,
        isPurchased: completedEdit.isPurchased,
        source: 'avatar_fusion_edit'
      });
      return result;
    }
    
    // PRIORITY 1: If we have local text edits, show them
    if (editedMainTweet || editedThread.length > 0) {
      const result = {
        text: editedMainTweet || currentContent.updatedTweet || currentContent.content_text,
        thread: editedThread.length > 0 ? editedThread : (currentContent.updatedThread || currentContent.tweet_thread || [])
      };
      console.log('🔍 EDITED CONTENT DISPLAYED:', {
        contentId: currentContent.id,
        text: result.text?.substring(0, 100) + '...',
        threadLength: result.thread?.length || 0,
        threadData: result.thread,
        hasEditedMainTweet: !!editedMainTweet,
        hasEditedThread: editedThread.length > 0
      });
      return result;
    }
    
    // PRIORITY 2: If we have updated content, show it
    if (currentContent.updatedTweet || currentContent.updatedThread) {
      const result = {
        text: currentContent.updatedTweet || currentContent.content_text,
        thread: currentContent.updatedThread || currentContent.tweet_thread || []
      };
      console.log('🔍 UPDATED CONTENT DISPLAYED:', {
        contentId: currentContent.id,
        text: result.text?.substring(0, 100) + '...',
        threadLength: result.thread?.length || 0,
        threadData: result.thread,
        hasUpdatedTweet: !!currentContent.updatedTweet,
        hasUpdatedThread: !!currentContent.updatedThread
      });
      return result;
    }
    
    // PRIORITY 3: Otherwise show original content
    const result = {
      text: currentContent.content_text,
      thread: currentContent.tweet_thread || []
    };
    console.log('🔍 ORIGINAL CONTENT DISPLAYED:', {
      contentId: currentContent.id,
      text: result.text?.substring(0, 100) + '...',
      threadLength: result.thread?.length || 0
    });
    return result;
  }
  
  // Enhanced version that fetches fresh data if needed
  const getDisplayContentFresh = async (): Promise<{ text: string; thread: string[] }> => {
    const currentContent = getCurrentContent()
    if (!currentContent) return { text: '', thread: [] }
    
    // If we don't have updated content in state, try to fetch it fresh
    if (!currentContent.updatedTweet && !currentContent.updatedThread) {
      try {
        console.log('🔄 Fetching fresh content for display...');
        const response = await fetch(`/api/marketplace/content/${currentContent.id}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data?.content) {
            const freshContent = result.data.content;
            console.log('🔄 Fresh content fetched:', freshContent);
            
            // If fresh content has updates, use it
            if (freshContent.updatedTweet || freshContent.updatedThread) {
              const result = {
                text: freshContent.updatedTweet || currentContent.content_text,
                thread: freshContent.updatedThread || currentContent.tweet_thread || []
              };
              console.log('🔍 getDisplayContentFresh - FRESH UPDATED CONTENT result:', result);
              return result;
            }
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to fetch fresh content:', error);
      }
    }
    
    // Fall back to regular getDisplayContent
    return getDisplayContent();
  }
  
  // Helper function to check if URL is a presigned S3 URL
  const isPresignedS3Url = (url: string) => {
    return url.includes('s3.amazonaws.com') && url.includes('?') && 
           (url.includes('X-Amz-Signature') || url.includes('Signature'))
  }
  
  // Helper function to get the correct price (bidding_ask_price if available, otherwise asking_price)
  const getDisplayPrice = (content: ContentItem | null) => {
    if (!content) return 0
    return content.bidding_ask_price || content.asking_price || 0
  }
  

  
  // Yapper interface content generation functions
  
  const generateContentFromYapper = async () => {
    return generateContentFromYapperInternal(false)
  }
  
  const generateTextOnlyContentFromYapper = async () => {
    return generateContentFromYapperInternal(true)
  }
  
  const generateContentFromYapperInternal = async (textOnly: boolean = false) => {
    const currentContent = getCurrentContent()
    if (!selectedYapper || !currentContent) return
    
    try {
      setIsGeneratingContent(true)
      setIsTextOnlyGeneration(textOnly)
      setGenerationStatus('Starting content generation...')
      setGenerationProgress(0)
      
      // Use the textOnly parameter directly since the frontend already checked the mode
      let actualTextOnly = textOnly;
      
      // Call TypeScript backend to start content generation
      const endpoint = actualTextOnly ? '/api/text-only-regeneration/regenerate-text' : '/api/yapper-interface/generate-content'
      console.log('🔧 Content generation endpoint:', endpoint);
      console.log('🔧 actualTextOnly:', actualTextOnly);
      console.log('🔧 textOnly parameter:', textOnly);
      console.log('🔧 textOnlyModeEnabled from state:', textOnlyModeEnabled);
      
      // Update status message based on actual mode
      if (textOnly && !actualTextOnly) {
        setGenerationStatus('Starting full regeneration (text-only mode disabled)...');
      } else if (actualTextOnly) {
        setGenerationStatus('Starting text-only regeneration...');
      } else {
        setGenerationStatus('Starting full content generation...');
      }
      
      const requestBody = actualTextOnly ? {
        content_id: currentContent.id,
        wallet_address: address,
        selected_yapper_handle: selectedYapper,
        post_type: currentContent.post_type || 'thread'
      } : {
        wallet_address: address,
        campaigns: [{
          campaign_id: typeof currentContent.campaign.id === 'string' ? parseInt(currentContent.campaign.id) : currentContent.campaign.id,
          agent_id: 1, // Default agent
          campaign_context: {
            // Provide some basic context for the campaign
            campaign_title: currentContent.campaign.title || 'Unknown Campaign',
            platform_source: currentContent.campaign.platform_source || 'Unknown Platform',
            project_name: currentContent.campaign.project_name || 'Unknown Project',
            reward_token: currentContent.campaign.reward_token || 'Unknown Token',
            post_type: currentContent.post_type || 'thread'
          },
          post_type: currentContent.post_type || 'thread',
          include_brand_logo: true,
          source: 'yapper_interface',
          selected_yapper_handle: selectedYapper,
          price: getDisplayPrice(currentContent)
        }],
        user_preferences: {},
        user_api_keys: {}, // Empty for yapper interface - system will use system keys
        source: 'yapper_interface'
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })
      
      if (!response.ok) {
        throw new Error('Failed to start content generation')
      }
      
      const result = await response.json()
      setExecutionId(result.execution_id)
      setGenerationStatus('Content generation started. Polling for updates...')
      setGenerationProgress(10)
      
      // Start polling for execution status
      startExecutionPolling(result.execution_id, actualTextOnly)
      
    } catch (error) {
      console.error('Error starting content generation:', error)
      setGenerationStatus('Failed to start content generation')
      setIsGeneratingContent(false)
      setIsTextOnlyGeneration(false)
    }
  }

  const refreshContentAfterTextOnlyGeneration = async () => {
    try {
      const currentContent = getCurrentContent();
      if (!currentContent) return;
      
      console.log('🔄 Refreshing content for ID:', currentContent.id);
      
      // Add a small delay to ensure database transaction is committed
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Fetch the updated content from the backend
      const response = await fetch(`/api/marketplace/content/${currentContent.id}`);
      if (response.ok) {
        const result = await response.json();
        console.log('📡 API response:', result);
        
        if (result.success && result.data?.content) {
          const updatedContent = result.data.content;
          console.log('📝 Updated content received:', updatedContent);
          console.log('📝 updatedTweet:', updatedContent.updatedTweet);
          console.log('📝 updatedThread:', updatedContent.updatedThread);
          console.log('🔍 Full API response structure:', JSON.stringify(result, null, 2));
          console.log('🔍 Content object keys:', Object.keys(updatedContent));
          console.log('🔍 Content object values:', Object.values(updatedContent));
          
          // Update local content with the new data
          // Ensure the content matches our ContentItem interface
          const typedContent: ContentItem = {
            ...updatedContent,
            // Explicitly map fields to ensure compatibility
            updatedTweet: updatedContent.updatedTweet || undefined,
            updatedThread: updatedContent.updatedThread || undefined,
            isAvailable: updatedContent.isAvailable || updatedContent.is_available || undefined
          };
          
          console.log('🔍 Typed content before state update:', typedContent);
          
          setLocalContent(typedContent);
          setGeneratedContent(typedContent); // Use the properly typed content
          setHasGeneratedContent(true);
          
          // Force a re-render by updating state
          setForceUpdate(prev => prev + 1);
          setContentUpdateTrigger(prev => prev + 1);
          
          // Stop shimmer and show success message
          setIsGeneratingContent(false);
          setGenerationStatus('✅ Text-only regeneration completed! Content updated successfully.');
          
          console.log('✅ Content refreshed after text-only generation:', updatedContent);
        }
      }
    } catch (error) {
      console.error('❌ Error refreshing content after text-only generation:', error);
      setGenerationStatus('✅ Text-only generation completed! (Content refresh failed)');
      setIsGeneratingContent(false);
    }
  };

  const startExecutionPolling = async (execId: string, isTextOnly: boolean = false) => {
    const pollInterval = setInterval(async () => {
      try {
        const endpoint = isTextOnly ? `/api/text-only-regeneration/status/${execId}` : `/api/yapper-interface/status/${execId}`
        const response = await fetch(endpoint)
        
        if (!response.ok) {
          clearInterval(pollInterval)
          setGenerationStatus('Failed to get execution status')
          setIsGeneratingContent(false)
          setIsTextOnlyGeneration(false)
          return
        }
        
        const status = await response.json()
        setGenerationProgress(status.progress || 0)
        setGenerationStatus(status.message || 'Processing...')
        
        if (status.status === 'completed') {
          clearInterval(pollInterval)
          
          if (isTextOnly) {
            // For text-only generation, poll until content is actually updated
            setGenerationStatus('Text-only generation completed! Waiting for content update...')
            await pollForContentUpdate(execId);
          } else {
            // For full generation, keep shimmer active during approval process
            setGenerationStatus('Content generation completed! Starting approval process...')
            
            // Store execution ID for the next steps
            setExecutionId(execId)
            
            // Start approval process (shimmer continues until approval is complete)
            await startApprovalProcess(execId)
          }
        } else if (status.status === 'failed') {
          clearInterval(pollInterval)
          setIsGeneratingContent(false)
          setIsTextOnlyGeneration(false)
          setGenerationStatus(`Generation failed: ${status.error || 'Unknown error'}`)
        }
        
      } catch (error) {
        console.error('Error polling execution status:', error)
        clearInterval(pollInterval)
        setGenerationStatus('Error checking status')
        setIsGeneratingContent(false)
        setIsTextOnlyGeneration(false)
      }
    }, 2000) // Poll every 2 seconds
  }
  
  const startApprovalProcess = async (execId: string) => {
    try {
      setGenerationStatus('Starting content approval process...')
      
      // Get execution details to find content ID
      const execResponse = await fetch(`/api/execution/status/${execId}`)
      if (!execResponse.ok) {
        throw new Error('Failed to get execution details')
      }
      
      const execDetails = await execResponse.json()
      console.log('🔍 Execution details:', execDetails)
      
      if (!execDetails.content_id) {
        throw new Error('Content ID not found in execution details. Content may not have been generated properly.')
      }
      
      // Validate that content generation was successful
      if (execDetails.status !== 'completed') {
        throw new Error(`Execution status is ${execDetails.status}, expected 'completed'. Content generation may have failed.`)
      }
      
      // No need to validate content images here - they will be watermarked during approval
      console.log('🔍 Starting approval process for content ID:', execDetails.content_id)
      
      // Step 1: Approve content and create watermarks
      setGenerationStatus('Creating watermarks and approving content...')
      const approveResponse = await fetch(`/api/marketplace/approve-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentId: execDetails.content_id,
          walletAddress: address
        })
      })
      
      if (!approveResponse.ok) {
        const errorData = await approveResponse.json().catch(() => ({}))
        throw new Error(`Failed to approve content: ${errorData.message || approveResponse.statusText}`)
      }
      
      const approveResult = await approveResponse.json()
      setGenerationStatus('Content approved! Making it available for purchase...')
      
      // Step 2: Enable bidding (pushes content to marketplace)
      const biddableResponse = await fetch(`/api/marketplace/content/${execDetails.content_id}/bidding`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_biddable: true,
          bidding_ask_price: getDisplayPrice(localContent) || 100,
          wallet_address: address
        })
      })
      
      if (!biddableResponse.ok) {
        const errorData = await biddableResponse.json().catch(() => ({}))
        throw new Error(`Failed to enable bidding: ${errorData.message || biddableResponse.statusText}`)
      }
      
      const biddableResult = await biddableResponse.json()
      
      // Success! Content is now available on marketplace
      setGenerationStatus('🎉 Content successfully generated and available on marketplace!')
      
      // Fetch the final watermarked content to replace the modal content
      try {
        const contentResponse = await fetch(`/api/marketplace/content/${execDetails.content_id}`)
        if (contentResponse.ok) {
          const responseData = await contentResponse.json()
          console.log('✅ API response received:', responseData)
          
          // Extract content from the nested data structure
          const newContent = responseData.data?.content
          if (!newContent) {
            throw new Error('Content not found in API response')
          }
          
          console.log('✅ New watermarked content extracted:', newContent)
          
          // Now refresh the URLs to get presigned URLs for images
          console.log('🔄 Refreshing presigned URLs for content...')
          const refreshResponse = await fetch(`/api/marketplace/content/${execDetails.content_id}/refresh-urls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
          
          if (refreshResponse.ok) {
            const refreshData = await refreshResponse.json()
            console.log('✅ URLs refreshed:', refreshData)
            
            if (refreshData.success && refreshData.data) {
              // Use the refreshed content with presigned URLs
              const refreshedContent = refreshData.data
              console.log('✅ Refreshed content with presigned URLs:', refreshedContent)
              
              // Update local content state to show new content in modal
              setLocalContent(refreshedContent)
              setGeneratedContent(refreshedContent)
              
              console.log('🔍 State updates applied:')
              console.log('  - localContent set to:', refreshedContent)
              console.log('  - generatedContent set to:', refreshedContent)
              console.log('  - Content ID:', refreshedContent.id)
              console.log('  - Content text length:', refreshedContent.content_text?.length)
              console.log('  - Has images:', refreshedContent.content_images?.length > 0)
              console.log('  - Watermark image:', refreshedContent.watermark_image)
              
              // Notify parent component about content update
              if (onContentUpdate) {
                onContentUpdate(refreshedContent)
              }
              
              // Update the content state to show the new content
              // This will trigger a re-render with the new content
              setGenerationStatus('✅ Content replaced! You can now preview and purchase the generated content.')
              
              // Mark that content has been generated and hide shimmer
              setHasGeneratedContent(true)
              setIsGeneratingContent(false)
              setIsTextOnlyGeneration(false)

              // Track content generation based on voice tone
              if (selectedVoiceTone === "custom" && selectedYapper) {
                // Choose Yapper flow
                mixpanel.chooseYapperContentGenerated({
                  contentId: newContent.id,
                  contentType: newContent.post_type === 'visual' ? 'visual' : 'text',
                  campaignId: newContent.campaign.id,
                  generationTime: Date.now(),
                  generatedContentLength: newContent.content_text?.length || 0,
                  screenName: 'PurchaseContentModal'
                })
              } else if (selectedVoiceTone === "mystyle" && twitter.isConnected) {
                // My Voice flow
                mixpanel.myVoiceContentGenerated({
                  contentId: newContent.id,
                  contentType: newContent.post_type === 'visual' ? 'visual' : 'text',
                  campaignId: newContent.campaign.id,
                  generationTime: Date.now(),
                  generatedContentLength: newContent.content_text?.length || 0,
                  screenName: 'PurchaseContentModal'
                })
              }
            } else {
              throw new Error('Failed to refresh URLs')
            }
          } else {
            console.warn('⚠️ Failed to refresh URLs, using original content')
            // Fallback to original content without presigned URLs
            setLocalContent(newContent)
            setGeneratedContent(newContent)
            
            if (onContentUpdate) {
              onContentUpdate(newContent)
            }
            
            setGenerationStatus('✅ Content replaced! You can now preview and purchase the generated content.')
            setHasGeneratedContent(true)
            setIsGeneratingContent(false)
            setIsTextOnlyGeneration(false)

            // Track content generation based on voice tone
            if (selectedVoiceTone === "custom" && selectedYapper) {
              // Choose Yapper flow
              mixpanel.chooseYapperContentGenerated({
                contentId: newContent.id,
                contentType: newContent.post_type === 'visual' ? 'visual' : 'text',
                campaignId: newContent.campaign.id,
                generationTime: Date.now(),
                generatedContentLength: newContent.content_text?.length || 0,
                screenName: 'PurchaseContentModal'
              })
            } else if (selectedVoiceTone === "mystyle" && twitter.isConnected) {
              // My Voice flow
              mixpanel.myVoiceContentGenerated({
                contentId: newContent.id,
                contentType: newContent.post_type === 'visual' ? 'visual' : 'text',
                campaignId: newContent.campaign.id,
                generationTime: Date.now(),
                generatedContentLength: newContent.content_text?.length || 0,
                screenName: 'PurchaseContentModal'
              })
            }
          }
        } else {
          throw new Error(`Failed to fetch content: ${contentResponse.status} ${contentResponse.statusText}`)
        }
      } catch (error) {
        console.error('Error fetching generated content:', error)
        setGenerationStatus('✅ Content generated! You can now preview and purchase.')
        setIsGeneratingContent(false) // Hide shimmer even on error
        setIsTextOnlyGeneration(false)
      }
      
    } catch (error) {
      console.error('Error in approval process:', error)
      setGenerationStatus(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      
      // Show error to user
      alert(`Content generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  
  const [selectedVoiceTone, setSelectedVoiceTone] = useState<"auto" | "custom" | "mystyle">("auto")
  const [selectedTone, setSelectedTone] = useState("Select tone")
  const [selectedPayment, setSelectedPayment] = useState("roast")
  const [toneOpen, setToneOpen] = useState<boolean>(false)
  const [isPurchased, setIsPurchased] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showCopyProtection, setShowCopyProtection] = useState(false)
  const [balanceError, setBalanceError] = useState<{
    show: boolean;
    message: string;
    tokenType: string;
    currentBalance: number;
    requiredAmount: number;
  } | null>(null)
  
  const [dailyLimitError, setDailyLimitError] = useState<{
    show: boolean;
    message: string;
    dailyLimit: number;
    purchasedToday: number;
    resetTime: string;
  } | null>(null)

  // Clear balance error
  const clearBalanceError = () => {
    setBalanceError(null)
  }
  
  // Clear daily limit error
  const clearDailyLimitError = () => {
    setDailyLimitError(null)
  }

  // Clear balance error when payment method changes
  useEffect(() => {
    clearBalanceError()
    clearDailyLimitError()
  }, [selectedPayment])

  // Clear balance error when modal closes
  useEffect(() => {
    if (!isOpen) {
      clearBalanceError()
      clearDailyLimitError()
    }
  }, [isOpen])

  const [allYappers, setAllYappers] = useState<Array<{
    id: number;
    twitter_handle: string;
    display_name: string;
  }>>([])
  const [selectedYapper, setSelectedYapper] = useState<string>("")
  const [isLoadingYappers, setIsLoadingYappers] = useState(false)
  const [yapperSearchQuery, setYapperSearchQuery] = useState<string>("")
  // Removed minerInfo state to protect privacy - only show username from users table
  const [showTweetManagement, setShowTweetManagement] = useState(false)
  const [postingMethod, setPostingMethod] = useState<'twitter' | 'manual'>('twitter')
  const [loggedInUserInfo, setLoggedInUserInfo] = useState<{
    username: string;
    profileImage?: string;
  } | null>(null)
  
  // Local content state that can be updated when new content is generated
  const [localContent, setLocalContent] = useState<ContentItem | null>(content)
  
  // Yapper interface content generation state
  const [isGeneratingContent, setIsGeneratingContent] = useState(false)
  const [isTextOnlyGeneration, setIsTextOnlyGeneration] = useState(false)
  const [hasGeneratedContent, setHasGeneratedContent] = useState(false) // Track if content has been generated
  const [executionId, setExecutionId] = useState<string | null>(null)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generationStatus, setGenerationStatus] = useState<string>('')
  const [generatedContent, setGeneratedContent] = useState<ContentItem | null>(null)
  const [forceUpdate, setForceUpdate] = useState(0)
  const [contentUpdateTrigger, setContentUpdateTrigger] = useState(0)
  const [textOnlyModeEnabled, setTextOnlyModeEnabled] = useState<boolean | null>(true)
  const [modeCheckInProgress, setModeCheckInProgress] = useState(false)
  
  // Store original content for fallback
  const [originalContent, setOriginalContent] = useState<ContentItem | null>(content)
  
  // Store purchased content details for success screen
  const [purchasedContentDetails, setPurchasedContentDetails] = useState<{
    id: number;
    title: string;
    price: number;
    currency: string;
    transactionHash: string;
  } | null>(null)
  
  // Update local content when content prop changes
  useEffect(() => {
    console.log('🔄 Content prop changed:', { 
      contentId: content?.id, 
      isPurchased, 
      showTweetManagement,
      hasPurchasedContentDetails: !!purchasedContentDetails,
      hasGeneratedContent,
      generatedContentId: generatedContent?.id
    })
    
    // Only update local content if we don't have generated content
    // This prevents overwriting generated content (both text-only and full regeneration) with old content from props
    if (!hasGeneratedContent || !generatedContent) {
      console.log('🔄 Updating local content from prop (no generated content)')
      setLocalContent(content)
      setOriginalContent(content)
    } else {
      console.log('🛡️ Preserving generated content (not overwriting with prop)')
    }
    
    // If this is the same content but with updated fields (text-only regeneration),
    // we should preserve the generated content state
    if (hasGeneratedContent && generatedContent && content?.id === generatedContent.id) {
      // Check if the new content has updated fields
      if (content?.updatedTweet || content?.updatedThread) {
        console.log('🔄 Content updated with new text, updating generated content state')
        setGeneratedContent(content)
        setLocalContent(content)
        // Force re-render to update UI
        setContentUpdateTrigger(prev => prev + 1)
      }
    }
    
    // IMPORTANT: If we have local content with updates, preserve the generation state
    // This prevents the generation state from being reset when content prop changes
    if (localContent && (localContent.updatedTweet || localContent.updatedThread)) {
      console.log('🛡️ Preserving generation state - local content has updates')
      setHasGeneratedContent(true)
      setGeneratedContent(localContent)
    }
    
    // Reset generation state when new content is loaded (but preserve if we're in purchase flow OR if we have generated content)
    if (!isPurchased && !showTweetManagement && !purchasedContentDetails) {
      // Check if we have generated content - if so, don't reset generation state
      if (hasGeneratedContent && generatedContent) {
        console.log('🛡️ Preserving generation state - we have generated content')
        // Don't reset - we want to keep the generation state to show generated content
      } else {
        console.log('🔄 Resetting generation state for new content (no generated content)')
        setHasGeneratedContent(false)
        setGeneratedContent(null)
        setGenerationStatus('')
      }
    } else {
      console.log('🛡️ Preserving generation state - purchase in progress or completed')
    }
    
    // Only reset purchase state if this is a completely different content
    // Don't reset if we're in the middle of a purchase flow or if purchase is completed
    if (!isPurchased && !showTweetManagement && !purchasedContentDetails) {
      console.log('🔄 Resetting purchase state for new content')
      setIsPurchased(false)
      setShowTweetManagement(false)
      setPurchasedContentDetails(null)
    } else {
      console.log('🛡️ Preserving purchase state - purchase in progress or completed')
    }
  }, [content, isPurchased, showTweetManagement, purchasedContentDetails, hasGeneratedContent, generatedContent])
  
  // Check text-only mode status when component loads
  useEffect(() => {
    const checkTextOnlyMode = async () => {
      try {
        setModeCheckInProgress(true);
        console.log('🔍 Checking text-only mode status...');
        const modeResponse = await fetch('/api/text-only-regeneration/mode-status');
        console.log('📡 Mode response status:', modeResponse.status);
        
        if (modeResponse.ok) {
          const modeData = await modeResponse.json();
          console.log('📊 Mode data received:', modeData);
          console.log('🔍 Setting textOnlyModeEnabled to:', modeData.textOnlyModeEnabled);
          setTextOnlyModeEnabled(modeData.textOnlyModeEnabled);
          console.log('✅ Text-only mode enabled:', modeData.textOnlyModeEnabled);
        } else {
          console.error('❌ Mode response not ok:', modeResponse.status, modeResponse.statusText);
          console.log('🔍 Keeping textOnlyModeEnabled as true (default) due to API error');
          // Keep default value of true instead of setting to false
        }
      } catch (error) {
        console.error('❌ Error checking text-only mode status:', error);
        console.log('🔍 Keeping textOnlyModeEnabled as true (default) due to error');
        // Keep default value of true instead of setting to false
      } finally {
        setModeCheckInProgress(false);
      }
    };
    
    checkTextOnlyMode();
  }, []);
  
  // Reset generation state when user changes voice tone or yapper
  useEffect(() => {
    setHasGeneratedContent(false)
    setGeneratedContent(null)
    setGenerationStatus('')
    setIsTextOnlyGeneration(false)
  }, [selectedVoiceTone, selectedYapper])
  
  // Note: Removed auto-refresh useEffects to prevent flickering and unnecessary API calls
  // Content refresh now only happens when explicitly triggered by user actions or generation completion
  
  // Debug: Log content state changes (only when updates occur)
  useEffect(() => {
    if (localContent?.updatedTweet || localContent?.updatedThread || generatedContent?.updatedTweet || generatedContent?.updatedThread) {
      console.log('🔍 CONTENT UPDATED:', {
        hasUpdatedTweet: !!(localContent?.updatedTweet || generatedContent?.updatedTweet),
        hasUpdatedThread: !!(localContent?.updatedThread || generatedContent?.updatedThread),
        updatedTweetPreview: (localContent?.updatedTweet || generatedContent?.updatedTweet)?.substring(0, 50) + '...'
      });
    }
  }, [localContent?.updatedTweet, localContent?.updatedThread, generatedContent?.updatedTweet, generatedContent?.updatedThread])
  
  // Debug: Log when hasGeneratedContent changes
  useEffect(() => {
    console.log('🔍 hasGeneratedContent changed:', hasGeneratedContent);
  }, [hasGeneratedContent])
  
  // Debug: Log when generatedContent changes
  useEffect(() => {
    if (generatedContent) {
      console.log('🔍 generatedContent changed:', {
        id: generatedContent.id,
        content_text: generatedContent.content_text?.substring(0, 50) + '...',
        hasImages: generatedContent.content_images && generatedContent.content_images.length > 0,
        imageCount: generatedContent.content_images?.length || 0
      });
    }
  }, [generatedContent])
  
  // Refresh edit data after purchase to get unwatermarked URLs
  const refreshEditDataAfterPurchase = async (contentId: number) => {
    try {
      if (!address) {
        console.log('⚠️ No wallet address available for refreshing edit data');
        return;
      }

      // If we have a lastExecutionId, re-fetch the edit status to get post-purchase URLs
      if (lastExecutionId && completedEdit) {
        console.log('🔄 Re-fetching edit status after purchase with execution ID:', lastExecutionId);
        
        const response = await fetch(`/api/edit-tweet/status/${lastExecutionId}`);
        console.log('📡 Status endpoint response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('🔄 Post-purchase edit status response:', data);
          console.log('🔍 Backend purchase detection result:', {
            isPurchased: data.isPurchased,
            contentId: data.contentId || 'not provided',
            executionId: data.executionId,
            walletFromEdit: 'not shown in response'
          });
          
          // Update completedEdit with fresh data from backend
          setCompletedEdit({
            newTweetText: data.newTweetText,
            newThread: data.newThread,
            newImageUrl: data.newImageUrl, // Should now be unwatermarked if purchased
            newWatermarkImageUrl: data.newWatermarkImageUrl, // Should now be unwatermarked if purchased
            isPurchased: data.isPurchased
          });
          
          console.log('✅ Updated completedEdit with post-purchase data');
          console.log('🔍 Post-purchase URLs - newImageUrl:', data.newImageUrl?.substring(0, 100) + '...');
          console.log('🔍 Post-purchase URLs - newWatermarkImageUrl:', data.newWatermarkImageUrl?.substring(0, 100) + '...');
          console.log('🔍 Post-purchase isPurchased:', data.isPurchased);
          console.log('🔍 URLs are different (should be true for purchased):', data.newImageUrl !== data.newWatermarkImageUrl);
        } else {
          const errorText = await response.text();
          console.log('❌ Failed to re-fetch edit status after purchase. Status:', response.status);
          console.log('❌ Error response:', errorText);
        }
      } else {
        console.log('⚠️ Cannot re-fetch edit status after purchase');
        console.log('   - lastExecutionId:', lastExecutionId);
        console.log('   - completedEdit exists:', !!completedEdit);
      }
      
      // Also refresh serverEditContent if it exists
      if (serverEditContent && serverEditContent.newImageUrl) {
        console.log('🔄 Refreshing serverEditContent after purchase...');
        
        // Re-fetch content with edits
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        if (address) {
          headers.Authorization = `Bearer ${address}`;
        }
        
        console.log('📡 Fetching content with ID:', contentId, 'and wallet:', address?.substring(0, 10) + '...');
        
        const contentResponse = await fetch(`/api/marketplace/content/${contentId}`, {
          method: 'GET',
          headers
        });
        
        console.log('📡 Content response status:', contentResponse.status);
        
        if (contentResponse.ok) {
          const data = await contentResponse.json();
          console.log('📡 Content response data structure:', {
            success: data.success,
            hasData: !!data.data,
            hasContent: !!data.data?.content,
            hasEditContent: !!data.data?.editContent
          });
          
          if (data.success && data.data.editContent) {
            setServerEditContent(data.data.editContent);
            console.log('✅ Refreshed serverEditContent after purchase:', data.data.editContent);
          } else {
            console.log('⚠️ No editContent in response after purchase');
            console.log('📊 Full response data:', data);
          }
        } else {
          const errorText = await contentResponse.text();
          console.log('❌ Failed to refresh content after purchase. Status:', contentResponse.status, 'Error:', errorText);
        }
      } else {
        console.log('⚠️ Skipping serverEditContent refresh - no existing serverEditContent or newImageUrl');
        console.log('   - serverEditContent exists:', !!serverEditContent);
        console.log('   - has newImageUrl:', !!serverEditContent?.newImageUrl);
      }
      
    } catch (error) {
      console.error('❌ Error refreshing edit data after purchase:', error);
    }
  };
  
  // Handle purchase with content management
  const handlePurchaseWithContentManagement = async (contentToPurchase: ContentItem, price: number, currency: 'ROAST' | 'USDC', transactionHash?: string) => {
    try {
      console.log('🔄 handlePurchaseWithContentManagement called with:', { 
        contentId: contentToPurchase?.id, 
        price, 
        currency, 
        transactionHash,
        hasContent: !!contentToPurchase
      })
      
      if (!contentToPurchase) {
        console.error('❌ No content provided to handlePurchaseWithContentManagement')
        return
      }
      
      // Call the original purchase handler with transaction hash
      // Content availability will be managed by the backend after successful purchase
      if (onPurchase) {
        console.log('📞 Calling onPurchase callback...')
        onPurchase(contentToPurchase.id, price, currency, transactionHash)
        console.log('✅ onPurchase callback completed')
      }
      
      // Set success state immediately after purchase callback completes
      console.log('🎉 Setting purchase success state...')
      console.log('🔍 Before state update - isPurchased:', isPurchased);
      setIsPurchased(true)
      setShowTweetManagement(true)
      console.log('✅ State update calls completed - isPurchased should now be true');
      
      // Refresh edit data after purchase to get unwatermarked URLs
      console.log('🔄 Refreshing edit data after purchase...')
      
      // Add a small delay to ensure purchase transaction is processed in the database
      console.log('⏳ Waiting 3 seconds for purchase to be processed in database...')
      await new Promise(resolve => setTimeout(resolve, 3000))
      
      await refreshEditDataAfterPurchase(contentToPurchase.id)
      
      // Track purchase completion
      mixpanel.purchaseCompleted({
        contentId: contentToPurchase.id,
        contentType: contentToPurchase.post_type === 'visual' ? 'visual' : 'text',
        purchasePrice: price,
        selectedCurrency: currency,
        campaignId: contentToPurchase.campaign.id,
        transactionHash: transactionHash || '',
        purchaseTime: Date.now(),
        userTotalPurchases: 1, // This would need to be tracked from user data
        userTotalSpent: price,
        screenName: 'PurchaseContentModal'
      })
      
      // Scroll restoration removed - using page reload instead
      
      // Store purchased content details for success screen
      setPurchasedContentDetails({
        id: contentToPurchase.id,
        title: contentToPurchase.campaign?.title || 'Unknown Content',
        price: price,
        currency: currency,
        transactionHash: transactionHash || ''
      })
      
      console.log('✅ Purchase success state set - isPurchased:', true, 'showTweetManagement:', true)
      
      // Verify state changes were applied
      console.log('🔍 Current state after setting:', { 
        isPurchased: true, 
        showTweetManagement: true,
        purchasedContentDetails: {
          id: contentToPurchase.id,
          title: contentToPurchase.campaign.title,
          price: price,
          currency: currency,
          transactionHash: transactionHash || ''
        }
      })
      
      // Don't close modal - let it show success state for Twitter posting
      // The modal will be closed when user explicitly chooses to close or post to Twitter
      console.log('✅ Purchase completed successfully, showing success state');
    } catch (error) {
      console.error('Error in purchase with content management:', error)
    }
  }

  // Release purchase flow when user cancels or modal closes
  const releasePurchaseFlow = async () => {
    const currentContent = getCurrentContent()
    if (!currentContent || !address) {
      console.log('⚠️ Cannot release purchase flow - missing currentContent or address')
      return;
    }
    
    try {
      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/content/${currentContent.id}/release-purchase-flow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: address
        }),
      });
      
      console.log('🔓 Purchase flow released for content:', currentContent.id);
    } catch (error) {
      console.error('Error releasing purchase flow:', error);
    }
  };
  
  // Individual shimmer components for different content elements
  const TextShimmer = () => (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-1/2"></div>
    </div>
  )

  const ImageShimmer = () => (
    <div className="w-full h-48 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 animate-pulse rounded-2xl"></div>
  )

  const ThreadItemShimmer = () => (
    <div className="space-y-2 animate-pulse">
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-full"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-4/5"></div>
      <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
    </div>
  )

  // Full shimmer loading component for tweet preview (fallback)
  const TweetPreviewShimmer = () => (
    <div className="animate-pulse">
      {/* Image shimmer */}
      <div className="w-full h-48 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded-2xl mb-4"></div>
      
      {/* Text shimmer */}
      <div className="space-y-3">
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-1/2"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-5/6"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-2/3"></div>
      </div>
      
      {/* Thread shimmer */}
      <div className="mt-6 space-y-3">
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-full"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-4/5"></div>
        <div className="h-4 bg-gradient-to-r from-gray-600 via-gray-500 to-gray-600 rounded w-3/4"></div>
      </div>
    </div>
  )
  
  const [isLoadingUserInfo, setIsLoadingUserInfo] = useState(false)
  const [isPostingToTwitter, setIsPostingToTwitter] = useState(false)
  const [twitterPostingResult, setTwitterPostingResult] = useState<{
    success: boolean;
    message: string;
    tweetUrl?: string;
  } | null>(null)

  // Store original content when modal opens
  useEffect(() => {
    if (content && !originalContent) {
      setOriginalContent(content)
    }
  }, [content, originalContent])
  


  // Auto-close wallet modal when wallet connects - removed, using AppKit instead

  // Twitter connection is now handled by global context - no local effects needed

  // Twitter connection checking now handled by global context

  // Twitter token refresh now handled by global context

  // Twitter disconnect now handled by global context

  // Fetch all yappers from leaderboard
  const fetchAllYappers = async () => {
    setIsLoadingYappers(true)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/leaderboard-yapper/all`
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.yappers) {
          // Map to simplified structure without ranking/snaps
          const simplifiedYappers = data.yappers.map((yapper: any) => ({
            id: yapper.id,
            twitter_handle: yapper.twitter_handle,
            display_name: yapper.display_name
          }))
          setAllYappers(simplifiedYappers)
        }
      } else {
        console.error('Failed to fetch yappers')
      }
    } catch (error) {
      console.error('Error fetching yappers:', error)
    } finally {
      setIsLoadingYappers(false)
    }
  }

  // Fetch yappers when Choose Yapper tab is selected
  useEffect(() => {
    if (selectedVoiceTone === "custom") {
      fetchAllYappers()
    }
  }, [selectedVoiceTone])

  // Fetch logged-in user's information from users table
  const fetchLoggedInUserInfo = async () => {
    if (!address || !isAuthenticated) return

    setIsLoadingUserInfo(true)
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/users/profile/${address}`
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setLoggedInUserInfo({
            username: data.user.username,
            profileImage: data.user.profile?.profileImage
          })
        }
      } else {
        console.error('Failed to fetch user info')
      }
    } catch (error) {
      console.error('Error fetching user info:', error)
    } finally {
      setIsLoadingUserInfo(false)
    }
  }

  // Fetch user info when modal opens and user is authenticated
  useEffect(() => {
    if (address && isAuthenticated) {
      fetchLoggedInUserInfo()
    }
  }, [address, isAuthenticated])

  // Add new yapper handle
  const addNewYapperHandle = async (handle: string): Promise<boolean> => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/leaderboard-yapper/add-handle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          twitter_handle: handle
        })
      })

      const data = await response.json()
      
      if (data.success) {
        // Add the new yapper to the list
        const newYapper = {
          id: data.data.id,
          twitter_handle: data.data.twitter_handle,
          display_name: data.data.display_name
        }
        
        setAllYappers(prev => [...prev, newYapper])
        console.log(`✅ Added new yapper: @${data.data.twitter_handle}`)
        return true
      } else {
        console.error('❌ Failed to add yapper:', data.message)
        return false
      }
    } catch (error) {
      console.error('❌ Error adding yapper:', error)
      return false
    }
  }

  // Filter yappers based on search query and detect potential new handles
  const filteredYappers = allYappers.filter((yapper) => {
    const searchLower = yapperSearchQuery.toLowerCase()
    return (
      yapper.twitter_handle.toLowerCase().includes(searchLower) ||
      yapper.display_name.toLowerCase().includes(searchLower)
    )
  })

  // Check if search query looks like a Twitter handle and isn't in the list
  const isSearchQueryNewHandle = () => {
    if (!yapperSearchQuery.trim()) return false
    
    const cleanQuery = yapperSearchQuery.replace(/^@/, '').toLowerCase().trim()
    
    // Basic Twitter handle validation (alphanumeric, underscores, 1-15 chars)
    const twitterHandleRegex = /^[a-zA-Z0-9_]{1,15}$/
    if (!twitterHandleRegex.test(cleanQuery)) return false
    
    // Check if it's already in the list
    const existsInList = allYappers.some(yapper => 
      yapper.twitter_handle.toLowerCase() === cleanQuery
    )
    
    return !existsInList
  }

  // Handle selecting a new yapper (either from list or new handle)
  const handleYapperSelection = async (handle: string) => {
    // If it's a new handle, add it first
    if (isSearchQueryNewHandle() && handle === yapperSearchQuery.replace(/^@/, '').toLowerCase().trim()) {
      const added = await addNewYapperHandle(handle)
      if (!added) {
        alert('Failed to add new yapper. Please try again.')
        return
      }
    }
    
    setSelectedYapper(handle)
    console.log(`🎯 Selected yapper: @${handle}`)
  }

  // Helper functions to get display data based on Twitter connection (for tweet preview only)
  // Priority: Twitter handle > Logged-in user username > Miner username (for non-logged-in users)
  const getDisplayName = () => {
    if (twitter.isConnected && twitter.profile?.displayName) {
      return twitter.profile.displayName
    }
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username || 'User'
  }

  const getTwitterHandle = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.toLowerCase()
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username?.toLowerCase() || 'user'
  }

  const getInitialLetter = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username.charAt(0).toUpperCase()
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.charAt(0).toUpperCase()
    }
    // If not logged in, show miner's username
    return localContent?.creator?.username?.charAt(0).toUpperCase() || 'U'
  }

  // Content parsing functions for tweet management (from TweetPreviewModal)
  const extractImageUrlForManagement = (contentText: string): string | null => {
    const prefixMatch = contentText.match(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i)
    if (prefixMatch) {
      return prefixMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    const dalleMatch = contentText.match(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i)
    if (dalleMatch) {
      return dalleMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    const blobMatch = contentText.match(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i)
    if (blobMatch) {
      return blobMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    return null
  }

  const formatTwitterContentForManagement = (contentText: string): { text: string; hashtags: string[]; characterCount: number; imageUrl: string | null } => {
    const imageUrl = extractImageUrlForManagement(contentText)
    
    let cleanText = contentText
    
    cleanText = cleanText.replace(/📸 Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+/gi, '')
    cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+/gi, '')
    
    const lines = cleanText.split('\n')
    let twitterText = ""
    
    for (const line of lines) {
      if (line.includes('📊 Content Stats') || 
          line.includes('🖼️ [Image will be attached') ||
          line.includes('💡 To post:') ||
          line.includes('AWSAccessKeyId=') ||
          line.includes('Signature=') ||
          line.includes('Expires=')) {
        break
      }
      
      const trimmedLine = line.trim()
      if (trimmedLine && 
          !trimmedLine.startsWith('http') && 
          !trimmedLine.includes('AWSAccessKeyId') &&
          !trimmedLine.includes('Signature=') &&
          !trimmedLine.includes('Expires=')) {
        twitterText += line + "\n"
      }
    }
    
    const finalText = twitterText.trim()
    const hashtags = finalText.match(/#\w+/g) || []
    
    return {
      text: finalText,
      hashtags,
      characterCount: finalText.length,
      imageUrl
    }
  }

  const getTweetManagementData = () => {
    const currentContent = getCurrentContent()
    if (!currentContent) return { tweetText: '', formatted: null, displayImage: '', processedThread: [] }

    // Check if this is a longpost that should be rendered as markdown
    const shouldUseMarkdown = isMarkdownContent(currentContent.post_type)
    
    // Check if content has markdown syntax
          const hasMarkdownSyntax = getDisplayContent().text?.includes('##') || getDisplayContent().text?.includes('**')
    
    // Force markdown if we detect markdown syntax
    const forceMarkdown = hasMarkdownSyntax
    
    let tweetText = ''
    if (shouldUseMarkdown || forceMarkdown) {
              tweetText = markdownToPlainText(getDisplayContent().text)
    } else {
              const formatted = formatTwitterContentForManagement(getDisplayContent().text)
      tweetText = formatted.text || ''
    }
    
    const displayImage = currentContent.content_images && currentContent.content_images.length > 0
      ? currentContent.content_images[0]
      : ''
    
    const processedThread = getDisplayContent().thread ? getDisplayContent().thread.map(tweet => {
      return {
        text: tweet,
        imageUrl: null
      }
    }) : []
    
    return {
      tweetText,
      formatted: null,
      displayImage,
      processedThread
    }
  }

  // Helper function to detect mobile devices
  const isMobileDevice = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           window.innerWidth <= 768
  }

  // Download image function (from TweetPreviewModal)
  const downloadImage = async (imageUrl: string, filename: string = 'tweet-image.png') => {
    try {
      let downloadUrl = imageUrl
      
      if (imageUrl.includes('s3.amazonaws.com') || imageUrl.includes('amazonaws.com')) {
        try {
          const urlParts = imageUrl.split('amazonaws.com/')[1]
          if (urlParts) {
            const s3Key = urlParts.split('?')[0]
            downloadUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/download-image/${s3Key}`
          }
        } catch (e) {
          console.log('Using original URL for download')
        }
      }
      
      // For mobile devices, use direct link approach to avoid blob URL issues
      if (isMobileDevice()) {
        console.log('📱 Mobile device detected, using direct download approach')
        
        // Create a temporary link with download attribute
        const link = document.createElement('a')
        link.href = downloadUrl
        link.download = filename
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        
        // Add to document, click, and remove
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        
        console.log('✅ Mobile image download initiated')
        return
      }
      
      // For desktop, use the blob approach (which works better on desktop)
      const response = await fetch(downloadUrl)
      
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`)
      }
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      console.log('✅ Desktop image download initiated')
    } catch (error) {
      console.error('❌ Failed to download image:', error)
      console.log('🔄 Falling back to opening image in new tab')
      window.open(imageUrl, '_blank')
    }
  }

  // Twitter posting function
  const handlePostToTwitter = async () => {
    const currentContent = getCurrentContent()
    if (!currentContent) return

    setIsPostingToTwitter(true)
    try {
      // Check if this is markdown content (longpost)
      const shouldUseMarkdown = isMarkdownContent(currentContent.post_type)
      const hasMarkdownSyntax = getDisplayContent().text?.includes('##') || getDisplayContent().text?.includes('**')
      const forceMarkdown = Boolean(shouldUseMarkdown || hasMarkdownSyntax)
      
      let tweetText: string
      let extractedImageUrl: string | null = null
      
      if (forceMarkdown) {
        // For longpost content, convert markdown to plain text for Twitter
        tweetText = markdownToPlainText(getDisplayContent().text)
      } else {
        // For regular content, use existing formatting
        const formatted = formatTwitterContentForManagement(getDisplayContent().text)
        tweetText = formatted.text
        extractedImageUrl = formatted.imageUrl
      }
      
      // Determine the correct image URL to use for Twitter posting
      let displayImage: string | null = null;
      const actualIsPurchased = isPurchased || !!purchasedContentDetails?.transactionHash;
      
      // Priority 1: Use edited image if available
      if (completedEdit?.newImageUrl || serverEditContent?.newImageUrl) {
        if (actualIsPurchased) {
          // Post-purchase: Use unwatermarked edited image
          displayImage = completedEdit?.newImageUrl || serverEditContent?.newImageUrl;
          console.log('🐦 Twitter posting: Using unwatermarked edited image (post-purchase):', displayImage?.substring(0, 100) + '...');
        } else {
          // Pre-purchase: Use watermarked edited image
          displayImage = completedEdit?.newWatermarkImageUrl || serverEditContent?.newWatermarkImageUrl || 
                        completedEdit?.newImageUrl || serverEditContent?.newImageUrl;
          console.log('🐦 Twitter posting: Using watermarked edited image (pre-purchase):', displayImage?.substring(0, 100) + '...');
        }
      } else {
        // Priority 2: Fall back to original content images
        if (actualIsPurchased) {
          // Post-purchase: Use original unwatermarked image
          displayImage = currentContent.content_images && currentContent.content_images.length > 0 
            ? currentContent.content_images[0] 
            : extractedImageUrl;
          console.log('🐦 Twitter posting: Using original unwatermarked image (post-purchase):', displayImage?.substring(0, 100) + '...');
        } else {
          // Pre-purchase: Use watermarked original image
          displayImage = currentContent.watermark_image || 
                        (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl);
          console.log('🐦 Twitter posting: Using watermarked original image (pre-purchase):', displayImage?.substring(0, 100) + '...');
        }
      }

      // Prepare tweet data - also convert thread items if they contain markdown
      const processedThread = getDisplayContent().thread ? getDisplayContent().thread.map(tweet => {
        // Check if thread item contains markdown
        if (tweet.includes('##') || tweet.includes('**')) {
          return markdownToPlainText(tweet)
        }
        return tweet
      }) : []

      const tweetData = {
        mainTweet: tweetText,
        thread: processedThread,
        imageUrl: displayImage
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/twitter/post-thread`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${address}` // Use wallet address as identifier
        },
        body: JSON.stringify(tweetData)
      })

      console.log('🔍 Posting with wallet address:', address)

      const result = await response.json()

      if (result.success) {
        // Track successful tweet posting
        console.log('🎯 Tweet posted successfully from PurchaseContentModal')
        mixpanel.tweetPosted({
          contentId: currentContent.id,
          contentType: currentContent.post_type === 'visual' ? 'visual' : 'text',
          postingMethod: 'direct',
          tweetUrl: `https://twitter.com/i/web/status/${result.mainTweetId}`,
          screenName: 'PurchaseContentModal'
        })
        
        // Show success message within modal
        setTwitterPostingResult({
          success: true,
          message: 'Thread posted successfully!',
          tweetUrl: `https://twitter.com/i/web/status/${result.mainTweetId}`
        })
      } else {
        throw new Error(result.error || 'Failed to post to Twitter')
      }
    } catch (error) {
      console.error('Error posting to Twitter:', error)
      
      // Track failed tweet posting
      console.log('🎯 Tweet post failed from PurchaseContentModal')
      mixpanel.tweetPostFailed({
        contentId: currentContent.id,
        postingMethod: 'direct',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        screenName: 'PurchaseContentModal'
      })
      
      setTwitterPostingResult({
        success: false,
        message: 'Failed to post to Twitter. Please try again or use manual posting.'
      })
    } finally {
      setIsPostingToTwitter(false)
    }
  }

  // Twitter authentication for posting - use global Twitter context
  const handleTwitterAuth = async () => {
    if (!address) {
      console.log('🔗 No wallet connected - should open AppKit modal')
      return
    }

    try {
      // Use the global Twitter context connect method
      await connect()
      // Refresh Twitter posting status after successful auth
      setTimeout(() => {
        refreshTwitterStatus()
      }, 1000)
    } catch (error) {
      console.error('Error initiating Twitter auth:', error)
    }
  }

  // Original Twitter authentication for My Voice tab
  const handleTwitterAuthVoice = async () => {
    if (!address) {
      console.log('🔗 No wallet connected - should open AppKit modal')
      return
    }

    try {
      const success = await connect()
      if (success) {
        console.log('✅ Twitter connection successful in modal')
      } else {
        console.error('❌ Twitter connection failed in modal')
      }
    } catch (error) {
      console.error('❌ Twitter authentication error:', error)
    }
  }

  // Generate button handler with trigger-based token refresh
  const handleGenerate = async () => {
    if (!address) {
      console.log('🔗 No wallet connected - should open AppKit modal')
      return
    }

    // Only proceed if user has connected Twitter (My Voice tab)
    if (!twitter.isConnected) {
      console.log('⚠️ Cannot generate - Twitter not connected')
      alert('Please connect your Twitter account first.')
      return
    }

    console.log('🎯 Generate button clicked - checking if token needs refresh...')

    // Check if token is expired based on tokenExpiresAt timestamp
    // This is the ONLY place where we check and refresh tokens
    try {
      const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/yapper-twitter-auth/twitter/status/${address}`)
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json()
        
        if (statusData.success && statusData.data.token_status === 'expired') {
          console.log('🔄 Token expired based on tokenExpiresAt, attempting refresh...')
          const refreshSuccess = await refreshToken()
          
          if (!refreshSuccess) {
            console.log('❌ Token refresh failed, user needs to reconnect')
            console.error('Your Twitter access has expired and could not be refreshed. Please reconnect your Twitter account.')
            return
          }
          console.log('✅ Token refreshed successfully, proceeding with generation...')
        } else if (statusData.data.token_status === 'valid') {
          console.log('✅ Token is valid, proceeding with generation...')
        } else {
          console.log('⚠️ Token is missing, user needs to connect Twitter')
          console.error('Please connect your Twitter account first.')
          return
        }
      }
    } catch (error) {
      console.error('❌ Error checking token status:', error)
      console.error('Failed to verify Twitter connection. Please try again.')
      return
    }

    // If we reach here, token is valid and we can proceed with generation
    console.log('🚀 Proceeding with content generation using My Voice...')
    
    // Use the same generation logic as yapper flow, but with user's Twitter handle
    const currentContent = getCurrentContent()
    if (!currentContent || !twitter.profile?.username) {
      console.error('❌ Missing content or Twitter username')
      return
    }
    
    try {
      setIsGeneratingContent(true)
      setIsTextOnlyGeneration(false) // Default to full generation for My Voice
      setGenerationStatus('Starting content generation in your voice...')
      setGenerationProgress(0)
      
      // Check if text-only mode is enabled on the backend
      let actualTextOnly = false;
      try {
        const modeResponse = await fetch('/api/text-only-regeneration/mode-status');
        if (modeResponse.ok) {
          const modeData = await modeResponse.json();
          actualTextOnly = modeData.textOnlyModeEnabled;
          setIsTextOnlyGeneration(actualTextOnly);
        }
      } catch (error) {
        console.warn('⚠️ Could not check text-only mode status, using full regeneration:', error);
        actualTextOnly = false;
        setIsTextOnlyGeneration(false);
      }
      
      // Call TypeScript backend to start content generation
      const endpoint = actualTextOnly ? '/api/text-only-regeneration/regenerate-text' : '/api/yapper-interface/generate-content'
      
      // Update status message based on actual mode
      if (actualTextOnly) {
        setGenerationStatus('Starting text-only regeneration in your voice...');
      } else {
        setGenerationStatus('Starting full content generation in your voice...');
      }
      
      const requestBody = actualTextOnly ? {
        content_id: currentContent.id,
        wallet_address: address,
        selected_yapper_handle: twitter.profile.username, // Use user's Twitter handle
        post_type: currentContent.post_type || 'thread'
      } : {
        wallet_address: address,
        campaigns: [{
          campaign_id: typeof currentContent.campaign.id === 'string' ? parseInt(currentContent.campaign.id) : currentContent.campaign.id,
          agent_id: 1, // Default agent
          campaign_context: {
            // Provide some basic context for the campaign
            campaign_title: currentContent.campaign.title || 'Unknown Campaign',
            platform_source: currentContent.campaign.platform_source || 'Unknown Platform',
            project_name: currentContent.campaign.project_name || 'Unknown Project',
            reward_token: currentContent.campaign.reward_token || 'Unknown Token',
            post_type: currentContent.post_type || 'thread'
          },
          post_type: currentContent.post_type || 'thread',
          include_brand_logo: true,
          source: 'yapper_interface',
          selected_yapper_handle: twitter.profile.username, // Use user's Twitter handle
          price: getDisplayPrice(currentContent)
        }],
        user_preferences: {},
        user_api_keys: {}, // Empty for yapper interface - system will use system keys
        source: 'yapper_interface'
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })
      
      if (!response.ok) {
        throw new Error('Failed to start content generation')
      }
      
      const result = await response.json()
      setExecutionId(result.execution_id)
      setGenerationStatus('Content generation started. Polling for updates...')
      setGenerationProgress(10)
      
      // Start polling for execution status
      startExecutionPolling(result.execution_id, actualTextOnly)
      
    } catch (error) {
      console.error('Error starting content generation:', error)
      setGenerationStatus('Failed to start content generation')
      setIsGeneratingContent(false)
      setIsTextOnlyGeneration(false)
    }
  }

  // Generate consistent random leaderboard position change for this content item
  // Intelligent distribution: higher for tweets with 2+ Twitter handles, lower for others
  const getRandomLeaderboardPositionChange = (itemId: string, contentText: string, tweetThread?: string[]) => {
    const seed = itemId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)
    
    // Count Twitter handles in the content
    const allText = [contentText, ...(tweetThread || [])].join(' ')
    const twitterHandleMatches = allText.match(/@[\w]+/g) || []
    const uniqueHandles = new Set(twitterHandleMatches.map(handle => handle.toLowerCase()))
    const handleCount = uniqueHandles.size
    
    // Determine distribution type based on handle count
    const hasMultipleHandles = handleCount >= 2
    
    // Generate two pseudo-random numbers using different seeds
    const random1 = (Math.sin(seed) * 10000) % 1
    const random2 = (Math.sin(seed * 2) * 10000) % 1
    
    // Ensure we don't get 0 or 1 (which cause issues with log)
    const u1 = Math.max(0.0001, Math.min(0.9999, Math.abs(random1)))
    const u2 = Math.max(0.0001, Math.min(0.9999, Math.abs(random2)))
    
    // Use a simpler approach: combine two random numbers with intelligent skew
    const combined = (u1 + u2) / 2 // Average of two random numbers
    
    let skewed: number
    let position: number
    
    if (hasMultipleHandles) {
      // Higher distribution for tweets with 2+ handles (skewed towards higher numbers)
      // Use inverse power function to bias towards higher values
      skewed = 1 - Math.pow(1 - combined, 1.5) // Inverse power skews towards higher values
      position = Math.floor(skewed * 45) + 5
    } else {
      // Lower distribution for tweets with 0-1 handles (skewed towards lower numbers)
      // Use power function to bias towards lower values
      skewed = Math.pow(combined, 1.5) // Power > 1 skews towards lower values
    }
    
    // Transform to 5-50 range
    position = Math.floor(skewed * 45) + 5
    
    // Ensure we're within bounds and return a valid number
    const result = Math.max(5, Math.min(50, position))
    
    // Debug logging to catch any remaining issues
    if (isNaN(result) || !isFinite(result)) {
      console.error('❌ Invalid leaderboard position generated:', {
        itemId,
        handleCount,
        hasMultipleHandles,
        seed,
        random1,
        random2,
        u1,
        u2,
        combined,
        skewed,
        position,
        result
      })
      return hasMultipleHandles ? 35 : 15 // Fallback values based on distribution type
    }
    
    return result
  }

  // Copy protection functions
  const preventRightClick = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowCopyProtection(true)
  }

  const preventKeyboardCopy = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (['c', 'a', 's', 'p', 'v', 'x'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        setShowCopyProtection(true)
      }
    }
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
      e.preventDefault()
      setShowCopyProtection(true)
    }
  }

  // Purchase functionality
  const handlePurchase = async () => {
    if (!content && !purchasedContentDetails) {
      console.error('No content to purchase and no existing purchase details')
      return
    }
    
    // If we have purchase details but no content, we're already in success state
    if (!content && purchasedContentDetails) {
      console.log('✅ Already in purchase success state, no need to purchase again')
      return
    }

    // CRITICAL: Set global purchase flow state IMMEDIATELY to prevent ALL AppKit modals
    // This must happen before any async operations to prevent modal from appearing
    const { setPurchaseFlowActive } = await import('../../app/reown');
    setPurchaseFlowActive(true);
    
    // Use centralized modal management for additional protection
    const { disableModalsTemporarily } = await import('../../utils/modalManager');
    const restoreModals = disableModalsTemporarily();

    // Handle different authentication states first
    if (!address) {
      console.log('🔗 No wallet connected - should open AppKit modal')
      // Restore AppKit modal before opening it
      restoreModals();
      return
    }

    if (!isAuthenticated) {
      console.log('🔐 Wallet connected but not authenticated - need signature')
      
      // Track authentication required event
      mixpanel.errorOccurred({
        errorType: 'authentication_required',
        errorMessage: 'User attempted purchase without authentication',
        errorPage: window.location.pathname,
        userAuthenticated: false,
        errorSeverity: 'low',
        deviceType: window.innerWidth < 768 ? 'mobile' : 'desktop'
      })
      
      // Restore AppKit modal before opening it
      restoreModals();
      try {
        const authResult = await signIn()
        if (authResult) {
          console.log('✅ Authentication successful, continuing purchase...')
          // Don't return here - continue with purchase flow since auth is now complete
        } else {
          console.log('❌ Authentication failed or cancelled')
          return
        }
      } catch (error) {
        console.error('❌ Authentication error:', error)
        return
      }
    }

    if (isAuthenticated && !hasAccess) {
      console.log('🚫 User authenticated but no marketplace access - redirect to access page')
      router.push('/access')
      return
    }

    // Calculate required amount and check balance BEFORE locking content
    const currentContent = getCurrentContent()
    if (!currentContent) {
      console.error('No content available for purchase')
      return
    }
    
    const requiredAmount = getDisplayPrice(currentContent)
    
    // Calculate USDC equivalent - set to 0 if ROAST price is 0
    const usdcPrice = requiredAmount === 0 ? 0 : (roastPrice ? (getDisplayPrice(currentContent) * roastPrice) : 0)
    const usdcFee = requiredAmount === 0 ? 0 : 0.03  // No fee for free content
    const totalUSDC = usdcPrice + usdcFee

    // Track purchase initiation
    const currentContentForTracking = content || purchasedContentDetails
    if (currentContentForTracking && 'post_type' in currentContentForTracking && 'campaign' in currentContentForTracking) {
      mixpanel.purchaseInitiated({
        contentId: currentContentForTracking.id,
        contentType: currentContentForTracking.post_type === 'visual' ? 'visual' : 'text',
        selectedCurrency: selectedPayment === 'roast' ? 'ROAST' : 'USDC',
        purchasePrice: selectedPayment === 'roast' ? roastPrice : usdcPrice,
        campaignId: currentContentForTracking.campaign.id,
        userBalance: 0, // Will be updated with actual balance
        purchaseMethod: 'wallet_connection',
        screenName: 'PurchaseContentModal'
      })
    }

    // Check balance first (before locking content)
    try {
      console.log(`🔍 Checking ${selectedPayment === 'roast' ? 'ROAST' : 'USDC'} balance via backend...`)
      
      const balanceResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/check-balance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: address,
          tokenType: selectedPayment === 'roast' ? 'roast' : 'usdc',
          requiredAmount: selectedPayment === 'roast' ? requiredAmount : totalUSDC
        }),
      })

      if (!balanceResponse.ok) {
        throw new Error('Failed to check balance')
      }

      const balanceData = await balanceResponse.json()
      
      if (!balanceData.success) {
        throw new Error(balanceData.error || 'Balance check failed')
      }

      // If insufficient balance, show error in modal and return (don't lock content)
      if (!balanceData.data.hasBalance) {
        const tokenType = selectedPayment === 'roast' ? 'ROAST' : 'USDC'
        const required = selectedPayment === 'roast' ? Math.round(getDisplayPrice(getCurrentContent())) : totalUSDC
        setBalanceError({
          show: true,
          message: `Insufficient ${tokenType} balance`,
          tokenType: tokenType,
          currentBalance: balanceData.data.balance,
          requiredAmount: required
        })
        return
      }

      console.log(`✅ Balance check passed: ${balanceData.data.balance} ${balanceData.data.tokenType} available`)
    } catch (error) {
      console.error('❌ Balance check failed:', error)
      setBalanceError({
        show: true,
        message: 'Failed to check wallet balance',
        tokenType: selectedPayment === 'roast' ? 'ROAST' : 'USDC',
        currentBalance: 0,
        requiredAmount: selectedPayment === 'roast' ? Math.round(getDisplayPrice(getCurrentContent())) : totalUSDC
      })
      return
    }

    // Handle FREE CONTENT (0 ROAST price) - check daily limit first, skip availability check
    if (requiredAmount === 0) {
      console.log('🆓 Processing FREE CONTENT - checking daily limit first')
      setIsLoading(true)
      
      try {
        // Check daily free content limit
        const limitResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/marketplace/free-content-limit/${address}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!limitResponse.ok) {
          throw new Error('Failed to check daily limit')
        }

        const limitData = await limitResponse.json()
        
        if (!limitData.success || !limitData.data.canPurchase) {
          console.log('🚫 Daily free content limit exceeded:', limitData.data)
          
          // Show limit exceeded message in modal
          setDailyLimitError({
            show: true,
            message: `Daily limit reached! You can only get ${limitData.data.dailyLimit} free tweets per day. You've already claimed ${limitData.data.purchasedToday} today. Try again tomorrow!`,
            dailyLimit: limitData.data.dailyLimit,
            purchasedToday: limitData.data.purchasedToday,
            resetTime: limitData.data.resetTime
          })
          setIsLoading(false)
          return
        }

        console.log('✅ Daily limit check passed:', limitData.data)
        console.log('🆓 Processing FREE CONTENT - explicit user action confirmed, no wallet interaction needed')
        
        // Generate synthetic transaction hash for free content
        const syntheticTxHash = `FREE_CONTENT_${Date.now()}_${currentContent.id}`
        console.log('🔖 Generated synthetic transaction hash for free content:', syntheticTxHash)
        
        // Directly call purchase handler with synthetic hash
        await handlePurchaseWithContentManagement(currentContent, 0, 'ROAST', syntheticTxHash)
        
        console.log('✅ Free content processed successfully!')
        
      } catch (error) {
        console.error('❌ Failed to process free content:', error)
        setDailyLimitError({
          show: true,
          message: error instanceof Error ? `Failed to process free content: ${error.message}` : 'Failed to process free content. Please try again.',
          dailyLimit: 3,
          purchasedToday: 0,
          resetTime: new Date().toISOString()
        })
        setIsLoading(false)
      } finally {
        // Always restore modals and purchase flow state
        restoreModals();
        setPurchaseFlowActive(false);
      }
      return
    }

    // For PAID CONTENT - check content availability and lock it (after confirming sufficient balance)
    const isAvailable = await checkContentAvailability()
    if (!isAvailable) {
      return
    }

    // For PAID CONTENT - continue with normal wallet flow
    // Now start the actual purchase process
    setIsLoading(true)
    try {
      let success = false
      
      // Get treasury address from environment or API
      const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b8D0a8e0E6a1e2cf47' // fallback address
      
      if (!treasuryAddress) {
        console.error('Treasury wallet address not configured')
        return
      }

      // Execute payment directly without token registration

      // Execute transaction using working implementation pattern
      let result: any;
      if (selectedPayment === 'roast') {
        console.log(`🔄 Executing ROAST payment: ${requiredAmount} ROAST to ${treasuryAddress}`)
        
        try {
          // Use the working implementation service for better wallet display
          const transactionHash = await executeROASTPayment(requiredAmount, treasuryAddress);
          result = {
            success: true,
            transactionHash: transactionHash,
            hash: transactionHash
          };
          success = true;
          console.log('✅ ROAST payment successful with proper wallet display:', result);
        } catch (error) {
          console.error('❌ ROAST payment failed:', error);
          result = {
            success: false,
            error: error
          };
          success = false;
        }
      } else {
        console.log(`🔄 Initiating USDC transfer: ${totalUSDC} USDC to ${treasuryAddress}`)
        result = await transferUSDC(totalUSDC, treasuryAddress)
        success = result.success
      }

      if (success) {
        // Call the content management purchase handler
        if (result.success) {
          const transactionHash = result.transactionHash;
          await handlePurchaseWithContentManagement(currentContent, requiredAmount, selectedPayment === 'roast' ? 'ROAST' : 'USDC', transactionHash)
          
          // Refresh presigned URLs for purchased content
          console.log('🔄 Refreshing presigned URLs for purchased content...');
          try {
            const refreshResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/content/${currentContent.id}/refresh-urls`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              }
            });
            
            if (refreshResponse.ok) {
              const refreshData = await refreshResponse.json();
              if (refreshData.success && refreshData.data) {
                console.log('✅ Successfully refreshed presigned URLs');
                // Update the content with fresh URLs
                if (onContentUpdate) {
                  onContentUpdate(refreshData.data);
                }
              } else {
                console.warn('⚠️ Failed to refresh presigned URLs:', refreshData.error);
              }
            } else {
              console.warn('⚠️ Presigned URL refresh API call failed:', refreshResponse.status);
            }
          } catch (error) {
            console.warn('⚠️ Error refreshing presigned URLs:', error);
            // Don't fail the purchase if URL refresh fails
          }
        }
        
        // Success state is now set in handlePurchaseWithContentManagement
        console.log('🎉 Purchase successful! Success state will be set by handlePurchaseWithContentManagement')
      } else {
        console.error('Transaction failed. Please try again.')
      }
    } catch (error) {
      console.error('Purchase failed:', error)
      console.error('Purchase failed. Please try again.')
      
      // Track purchase failure
      if (localContent) {
        mixpanel.purchaseFailed({
          contentId: localContent.id,
          failureReason: 'transaction_failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          selectedCurrency: selectedPayment === 'roast' ? 'ROAST' : 'USDC',
          retryAttempted: false,
          screenName: 'PurchaseContentModal'
        })
      }
      
      // Release purchase flow if purchase fails
      if (localContent && address) {
        await releasePurchaseFlow();
      }
    } finally {
      setIsLoading(false)
      // Always restore modal functionality at the end of purchase flow
      restoreModals();
      setPurchaseFlowActive(false);
    }
  }

  // Track if modal was just opened to prevent state reset during purchase flow
  const modalJustOpened = React.useRef(false)
  
  // Reset state when modal opens
  useEffect(() => {
    if (isOpen && !modalJustOpened.current) {
      console.log('🔄 Modal just opened, resetting state...')
      modalJustOpened.current = true
      setIsPurchased(false)
      setIsLoading(false)
      setSelectedVoiceTone("auto")
      setSelectedPayment("roast")
      setShowTweetManagement(false)
      setPurchasedContentDetails(null)
      // Twitter state reset handled by global context
    } else if (!isOpen) {
      modalJustOpened.current = false
    }
  }, [isOpen])

  // Cleanup purchase flow when modal closes
  useEffect(() => {
    if (!isOpen && getCurrentContent() && address) {
      console.log('🔒 Modal closing, releasing purchase flow...')
      // Release purchase flow when modal closes
      releasePurchaseFlow();
    }
  }, [isOpen, address]);
  
  // Debug logging for state changes
  useEffect(() => {
    console.log('🔍 Modal state changed:', { 
      isOpen, 
      isPurchased, 
      showTweetManagement, 
      hasPurchasedContentDetails: !!purchasedContentDetails 
    });
  }, [isOpen, isPurchased, showTweetManagement, purchasedContentDetails]);
  
  // Monitor showTweetManagement changes specifically
  useEffect(() => {
    console.log('🎯 showTweetManagement changed to:', showTweetManagement);
  }, [showTweetManagement]);
  
  // Monitor isPurchased changes specifically
  useEffect(() => {
    console.log('🎯 isPurchased changed to:', isPurchased);
  }, [isPurchased]);

  const toneOptions = [
    "Select tone",
    "Professional",
    "Casual", 
    "Funny",
    "Technical",
    "Bullish",
    "Contrarian",
  ]

  // Allow modal to stay open even if content becomes unavailable after purchase
  if (!isOpen) return null
  
  // If we have purchase details, keep modal open even without content
  if (!content && !purchasedContentDetails) return null

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleModalClose();
    }
  }

  // Content parsing functions (same as BiddingInterface and mining interface)
  const extractImageUrl = (contentText: string): string | null => {
    const prefixMatch = contentText.match(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i)
    if (prefixMatch) {
      return prefixMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    const dalleMatch = contentText.match(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i)
    if (dalleMatch) {
      return dalleMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    const blobMatch = contentText.match(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i)
    if (blobMatch) {
      return blobMatch[1].replace(/[.,;'"]+$/, '')
    }
    
    return null
  }

  const formatTwitterContent = (contentText: string) => {
    if (!contentText) return { text: '', hashtags: [], characterCount: 0, imageUrl: null }
    
    // Extract image URL and remove it from text
    const imageUrl = extractImageUrl(contentText)
    let cleanedText = contentText
    
    if (imageUrl) {
      cleanedText = cleanedText
        .replace(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i, '')
        .replace(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i, '')
        .replace(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i, '')
        .trim()
    }
    
    const hashtagRegex = /#[\w]+/g
    const hashtags = cleanedText.match(hashtagRegex) || []
    
    return {
      text: cleanedText,
      hashtags,
      characterCount: cleanedText.length,
      imageUrl
    }
  }

  const extractHashtags = (text: string): string[] => {
    const hashtagRegex = /#[\w]+/g
    return text.match(hashtagRegex) || []
  }

  // Comprehensive content parsing logic (same as BiddingInterface and mining interface)
  const getContentData = () => {
    const currentContent = getCurrentContent()
    if (!currentContent) {
      console.log('⚠️ getContentData called with null currentContent, returning empty data')
      return { text: '', hashtags: [], characterCount: 0, imageUrl: null, shouldUseMarkdown: false }
    }

    // Check if this is a longpost that should be rendered as markdown
    const shouldUseMarkdown = isMarkdownContent(currentContent.post_type)
    
    // Check if content has markdown syntax
    const hasMarkdownSyntax = getDisplayContent().text?.includes('##') || getDisplayContent().text?.includes('**')
    
    // Force markdown if we detect markdown syntax
    const forceMarkdown = hasMarkdownSyntax
    
    // For longposts, use raw content; for others, use parsed content
    const { text, imageUrl: extractedImageUrl } = (shouldUseMarkdown || forceMarkdown)
              ? { text: getDisplayContent().text, imageUrl: null }
        : formatTwitterContent(getDisplayContent().text)
    
    // Use edit image if available, otherwise original image
    let imageUrl: string | null = null;
    const hasEditContent = serverEditContent?.newImageUrl || completedEdit?.newImageUrl;
    
    console.log('🔍 [getContentData] Image Display Debug - hasEditContent:', hasEditContent);
    console.log('🔍 [getContentData] Image Display Debug - completedEdit:', completedEdit);
    // Use actual purchase status from component state or transaction hash
    const actualIsPurchased = isPurchased || !!purchasedContentDetails?.transactionHash;
    console.log('🔍 [getContentData] Image Display Debug - isPurchased (state):', isPurchased);
    console.log('🔍 [getContentData] Image Display Debug - transactionHash:', purchasedContentDetails?.transactionHash);
    console.log('🔍 [getContentData] Image Display Debug - actualIsPurchased:', actualIsPurchased);
    
    if (hasEditContent) {
      // Choose correct image based on purchase status
      const editImageUrl = actualIsPurchased 
        ? (serverEditContent?.newImageUrl || completedEdit?.newImageUrl)           // Post-purchase: unwatermarked
        : (serverEditContent?.newWatermarkImageUrl || completedEdit?.newWatermarkImageUrl || 
           serverEditContent?.newImageUrl || completedEdit?.newImageUrl);          // Pre-purchase: watermarked (fallback to unwatermarked)
      console.log('🔍 [getContentData] Image Display Debug - editImageUrl found:', editImageUrl);
      console.log('🔍 [getContentData] Image Display Debug - actualIsPurchased:', actualIsPurchased, 'choosing:', actualIsPurchased ? 'newImageUrl' : 'newWatermarkImageUrl');
      
      if (editImageUrl) {
        imageUrl = editImageUrl;
        console.log(`🖼️ [getContentData] Using edit image (${actualIsPurchased ? 'unwatermarked' : 'watermarked'}):`, imageUrl);
      } else {
        // Fallback to original image based on purchase status
        imageUrl = actualIsPurchased 
      ? (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
          : (currentContent.watermark_image || (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
        console.log('🖼️ [getContentData] Edit failed, using original image:', imageUrl);
      }
    } else {
      // No edit content, show original images based on purchase status
      imageUrl = actualIsPurchased 
        ? (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
        : (currentContent.watermark_image || (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
      console.log('🖼️ [getContentData] Using original image:', imageUrl);
    }
    
    console.log('🎯 [getContentData] FINAL imageUrl value:', imageUrl);
    
    const hashtags = extractHashtags(text)
    
    return {
      text: text || '',
      hashtags,
      characterCount: text?.length || 0,
      imageUrl,
      shouldUseMarkdown: Boolean(shouldUseMarkdown || forceMarkdown)
    }
  }

  // Format content text for display
  const formatContentText = (text: string, shouldUseMarkdown: boolean) => {
    if (shouldUseMarkdown) {
      return renderMarkdown(text)
    }
    return formatPlainText(text)
  }

  // Get parsed content data - force recalculation when content changes
  const contentData = (() => {
    // This will recalculate every time contentUpdateTrigger changes
    const _ = contentUpdateTrigger; // Force recalculation
    
    const currentContent = getCurrentContent()
    if (!currentContent) return { text: '', hashtags: [], characterCount: 0, imageUrl: '', shouldUseMarkdown: false }
    
    // Debug: Log the actual content state being used
    console.log('🔍 contentData - currentContent state:', {
      id: currentContent.id,
      content_text: currentContent.content_text?.substring(0, 50) + '...',
      updatedTweet: currentContent.updatedTweet?.substring(0, 50) + '...',
      updatedThread: currentContent.updatedThread?.length || 0,
      hasUpdatedTweet: !!currentContent.updatedTweet,
      hasUpdatedThread: !!currentContent.updatedThread
    });
    
    const shouldUseMarkdown = isMarkdownContent(currentContent.post_type)
    
    // Check if content has markdown syntax
    const hasMarkdownSyntax = getDisplayContent().text?.includes('##') || getDisplayContent().text?.includes('**')
    
    // Force markdown if we detect markdown syntax
    const forceMarkdown = hasMarkdownSyntax
    
    // For longposts, use raw content; for others, use parsed content
    const { text, imageUrl: extractedImageUrl } = (shouldUseMarkdown || forceMarkdown)
              ? { text: getDisplayContent().text, imageUrl: null }
        : formatTwitterContent(getDisplayContent().text)
    
    // Use edit image if available, otherwise original image
    let imageUrl: string | null = null;
    const hasEditContent = serverEditContent?.newImageUrl || completedEdit?.newImageUrl;
    
    console.log('🔍 [contentData] Image Display Debug - hasEditContent:', hasEditContent);
    console.log('🔍 [contentData] Image Display Debug - completedEdit:', completedEdit);
    // Use actual purchase status from component state or transaction hash
    const actualIsPurchased = isPurchased || !!purchasedContentDetails?.transactionHash;
    console.log('🔍 [contentData] Image Display Debug - isPurchased (state):', isPurchased);
    console.log('🔍 [contentData] Image Display Debug - transactionHash:', purchasedContentDetails?.transactionHash);
    console.log('🔍 [contentData] Image Display Debug - actualIsPurchased:', actualIsPurchased);
    
    if (hasEditContent) {
      // Choose correct image based on purchase status
      const editImageUrl = actualIsPurchased 
        ? (serverEditContent?.newImageUrl || completedEdit?.newImageUrl)           // Post-purchase: unwatermarked
        : (serverEditContent?.newWatermarkImageUrl || completedEdit?.newWatermarkImageUrl || 
           serverEditContent?.newImageUrl || completedEdit?.newImageUrl);          // Pre-purchase: watermarked (fallback to unwatermarked)
      console.log('🔍 [contentData] Image Display Debug - editImageUrl found:', editImageUrl);
      console.log('🔍 [contentData] Image Display Debug - actualIsPurchased:', actualIsPurchased, 'choosing:', actualIsPurchased ? 'newImageUrl' : 'newWatermarkImageUrl');
      
      if (editImageUrl) {
        imageUrl = editImageUrl;
        console.log(`🖼️ [contentData] Using edit image (${actualIsPurchased ? 'unwatermarked' : 'watermarked'}):`, imageUrl);
      } else {
        // Fallback to original image based on purchase status
        imageUrl = actualIsPurchased 
      ? (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
          : (currentContent.watermark_image || (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
        console.log('🖼️ [contentData] Edit failed, using original image:', imageUrl);
      }
    } else {
      // No edit content, show original images based on purchase status
      imageUrl = actualIsPurchased 
        ? (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
        : (currentContent.watermark_image || (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
      console.log('🖼️ [contentData] Using original image:', imageUrl);
    }
    
    console.log('🎯 [contentData] FINAL imageUrl value:', imageUrl);
    
    const hashtags = extractHashtags(text)
    
    const result = {
      text: text || '',
      hashtags,
      characterCount: text?.length || 0,
      imageUrl,
      shouldUseMarkdown: Boolean(shouldUseMarkdown || forceMarkdown)
    }
    
    // Debug: Log when contentData is recalculated
    console.log('🔍 contentData recalculated:', {
      trigger: contentUpdateTrigger,
      text: result.text?.substring(0, 100) + '...',
      hasUpdatedTweet: !!currentContent.updatedTweet,
      hasUpdatedThread: !!currentContent.updatedThread
    });
    
    return result
  })()

  // Debug logging for content parsing (similar to mining interface)
  const currentContent = getCurrentContent()

  // Calculate USDC price
          const usdcPrice = roastPrice && currentContent ? (getDisplayPrice(currentContent) * roastPrice).toFixed(2) : '0.00'
  const usdcFee = currentContent && getDisplayPrice(currentContent) === 0 ? '0.000' : '0.030' // No fee for free content
  const totalUSDC = roastPrice && currentContent ? (parseFloat(usdcPrice) + parseFloat(usdcFee)).toFixed(2) : '0.00'

  // Helper functions to get display data based on Twitter connection (for tweet preview only)
  const getDisplayUsername = () => {
    if (twitter.isConnected && twitter.profile?.displayName) {
      return twitter.profile.displayName
    }
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username
    }
    // If not logged in, show miner's username
    return getCurrentContent()?.creator?.username || 'User'
  }

  const getDisplayUsernameLower = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.toLowerCase()
    }
    // If not logged in, show miner's username
    return getCurrentContent()?.creator?.username?.toLowerCase() || 'user'
  }

  const getDisplayUsernameInitial = () => {
    if (twitter.isConnected && twitter.profile?.username) {
      return twitter.profile.username.charAt(0).toUpperCase()
    }
    // If no Twitter connected but user is logged in, show their username from users table
    if (address && isAuthenticated && loggedInUserInfo?.username) {
      return loggedInUserInfo.username.charAt(0).toUpperCase()
    }
    // If not logged in, show miner's username
    return getCurrentContent()?.creator?.username?.charAt(0).toUpperCase() || 'U'
  }

  // Check content availability before opening wallet
  const checkContentAvailability = async (): Promise<boolean> => {
    const currentContent = getCurrentContent()
    if (!currentContent || !address) {
      console.log('⚠️ Cannot check content availability - missing currentContent or address')
      return false;
    }
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/marketplace/content/${currentContent.id}/check-availability`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: address
        }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        console.error('Failed to check content availability:', result);
        return false;
      }

      if (!result.data.available) {
        // Show user-friendly message
        if (result.data.inPurchaseFlow) {
          alert(`This content is being purchased by another user. Please wait ${result.data.estimatedWaitTime} and try again.`);
        } else {
          alert(result.data.message || 'Content is not available for purchase.');
        }
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking content availability:', error);
      return false;
    }
  };

  return (
    <div
      className="fixed top-0 left-0 w-full h-full bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto touch-pan-y"
      onClick={handleBackdropClick}
      onContextMenu={preventRightClick}
      onKeyDown={preventKeyboardCopy}
      style={{ height: '100vh', minHeight: '100vh' }}
      tabIndex={0}
    >
      <div 
        key={`purchase-modal-${content?.id || 'no-content'}`}
        className="relative w-full max-w-none lg:max-w-6xl rounded-none lg:rounded-2xl bg-transparent lg:bg-[#492222] max-h-[100vh] overflow-y-auto lg:overflow-y-hidden shadow-none lg:shadow-2xl p-0 lg:p-6 overscroll-contain touch-pan-y modal-scrollable"
      >
        {/* DEBUG: Component render trace */}
        {(() => {
          const actualIsPurchased = isPurchased || !!purchasedContentDetails?.transactionHash;
          const hasUnwatermarkedEdit = serverEditContent?.newImageUrl && serverEditContent?.newWatermarkImageUrl && 
                                      serverEditContent.newImageUrl !== serverEditContent.newWatermarkImageUrl;
          console.log('🚀 PurchaseContentModal RENDER - Content ID:', content?.id);
          console.log('🚀 PurchaseContentModal RENDER - isPurchased (state):', isPurchased);
          console.log('🚀 PurchaseContentModal RENDER - transactionHash:', purchasedContentDetails?.transactionHash);
          console.log('🚀 PurchaseContentModal RENDER - actualIsPurchased:', actualIsPurchased);
          console.log('🚀 PurchaseContentModal RENDER - hasUnwatermarkedEdit:', hasUnwatermarkedEdit);
          console.log('🚀 PurchaseContentModal RENDER - completedEdit:', completedEdit);
          console.log('🚀 PurchaseContentModal RENDER - serverEditContent:', serverEditContent);
          if (serverEditContent?.newImageUrl && serverEditContent?.newWatermarkImageUrl) {
            console.log('🔍 SERVER EDIT URLs:');
            console.log('   - newImageUrl (should be unwatermarked):', serverEditContent.newImageUrl.substring(0, 100) + '...');
            console.log('   - newWatermarkImageUrl (should be watermarked):', serverEditContent.newWatermarkImageUrl.substring(0, 100) + '...');
            console.log('   - URLs are different (indicating purchase):', serverEditContent.newImageUrl !== serverEditContent.newWatermarkImageUrl);
          }
          return null;
        })()}
        {/* Close Button */}
            <button
              onClick={handleModalClose}
          className="absolute right-4 top-4 z-50 hover:opacity-80 transition-opacity text-white/60 hover:text-white"
          type="button"
            >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" />
          </svg>
            </button>

        <div className="flex flex-col lg:flex-row max-h-[90vh] gap-0 lg:gap-4 overflow-y-auto lg:overflow-hidden touch-pan-y">
          {/* Left Panel - Tweet Preview + Mobile Purchase Options Combined */}
          <div className="flex flex-col w-full lg:w-1/2 p-4 lg:p-8 bg-[#121418] rounded-none lg:rounded-2xl min-h-screen lg:min-h-0">
            {/* Tweet Preview Header with Edit Options */}
            <div className="flex items-center justify-between mb-4 lg:mb-6">
              <h2 className="text-white/80 text-base lg:text-lg font-medium">
                Tweet preview
                {address && (
                  <TweetEditDropdown 
                    contentId={content?.id || 0}
                    isPurchased={!!content?.purchased_at}
                    walletAddress={address}
                    onEditSelect={handleEditSelect}
                    refreshCredits={dropdownRefreshCredits}
                  />
                )}
              </h2>
            </div>

            {/* Twitter Thread Container */}
            <div className="w-full flex-1 overflow-y-auto pr-0 lg:pr-2 rounded-none lg:rounded-2xl touch-pan-y overscroll-contain modal-scrollable scrollbar-hide">
              

              <style jsx>{`
                div::-webkit-scrollbar {
                  width: 0px !important;
                  display: none !important;
                }
                div::-webkit-scrollbar-track {
                  background: #121418 !important;
                  display: none !important;
                }
                div::-webkit-scrollbar-thumb {
                  background-color: transparent !important;
                  display: none !important;
                }
                div::-webkit-scrollbar-thumb:hover {
                  background-color: transparent !important;
                  display: none !important;
                }
                .scrollbar-hide {
                  -ms-overflow-style: none !important;
                  scrollbar-width: none !important;
                }
                .scrollbar-hide::-webkit-scrollbar {
                  width: 0px !important;
                  display: none !important;
                }
              `}</style>

              {/* Single Tweet Container with Thread Structure */}
              <div className="relative">
                {/* Continuous Thread Line - Only show for threads, not longposts */}
                {(() => {
                  const currentContent = getCurrentContent()
                  return getDisplayContent().thread && getDisplayContent().thread.length > 0 && !contentData.shouldUseMarkdown
                })() && (
                  <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-gray-600 z-0"></div>
                )}

                {/* Main Tweet */}
                <div className="relative pb-3">
                  <div className="flex gap-3 pr-2">
                    <div className="relative flex-shrink-0">
                      <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                        {twitter.isConnected && twitter.profile?.profileImage ? (
                          <img 
                            src={twitter.profile.profileImage} 
                            alt={`${getDisplayName()} profile`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              target.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : null}
                        <span className={`text-white font-bold text-sm ${(twitter.isConnected && twitter.profile?.profileImage) ? 'hidden' : ''}`}>{getDisplayUsernameInitial()}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-bold text-xs lg:text-sm">{getDisplayUsername()}</span>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                            <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.58 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                          </svg>
                          <span className="text-gray-500 text-xs lg:text-sm">@{getDisplayUsernameLower()}</span>
                        </div>

                      {/* For longposts: Image first, then content */}
                      {contentData.shouldUseMarkdown ? (
                        <>
                          {/* Longpost Image at top */}
                          {(isGeneratingContent && !isTextOnlyGeneration) || (isProcessingEdit && !editError) ? (
                            <ImageShimmer />
                          ) : (
                            contentData.imageUrl ? (
                            <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700 relative">
                              <Image
                                src={contentData.imageUrl} 
                                alt="Tweet content"
                                width={500}
                                height={300}
                                className="w-full h-auto object-cover"
                                  unoptimized={isPresignedS3Url(contentData.imageUrl)}
                              />

                            </div>
                            ) : null
                          )}
                          
                          {/* Longpost Content with white text styling */}
                          <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                            {isGeneratingContent || (isProcessingEdit && !editError) ? (
                              <TextShimmer />
                            ) : isContentPurchased() ? (
                              <EditText
                                text={contentData.text}
                                onSave={handleMainTweetEdit}
                                onCancel={() => setIsEditingMainTweet(false)}
                                maxLength={getCharacterLimit()}
                                placeholder="Enter longpost content..."
                                isEditing={isEditingMainTweet}
                                onStartEdit={handleStartMainTweetEdit}
                                editType="main_tweet"
                                contentId={content?.id || 0}
                                postType={content?.post_type || 'longpost'}
                              />
                            ) : (
                              <div 
                                className="longpost-markdown-content"
                                style={{
                                  color: 'white'
                                }}
                              >
                                {formatContentText(contentData.text, contentData.shouldUseMarkdown)}
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Regular content (shitpost/thread): Content first, then image */}
                          <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                            {isGeneratingContent || (isProcessingEdit && !editError) ? (
                              <TextShimmer />
                            ) : isContentPurchased() ? (
                              <EditText
                                text={contentData.text}
                                onSave={canEditThread() ? handleMainTweetLocalEdit : handleMainTweetEdit}
                                onCancel={() => setIsEditingMainTweet(false)}
                                maxLength={getCharacterLimit()}
                                placeholder="Enter tweet content..."
                                isEditing={isEditingMainTweet}
                                onStartEdit={handleStartMainTweetEdit}
                                editType="main_tweet"
                                contentId={content?.id || 0}
                                postType={content?.post_type || 'thread'}
                                localSaveOnly={canEditThread()}
                                onLocalSave={canEditThread() ? handleMainTweetLocalEdit : undefined}
                              />
                            ) : (
                              <>
                                {formatContentText(contentData.text, contentData.shouldUseMarkdown)}
                              </>
                            )}
                          </div>
                          
                          {/* Tweet Images for regular content */}
                          {(isGeneratingContent && !isTextOnlyGeneration) || (isProcessingEdit && !editError) ? (
                            <ImageShimmer />
                          ) : (
                            contentData.imageUrl ? (
                            <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700 relative">
                              <Image
                                src={contentData.imageUrl} 
                                alt="Tweet content"
                                width={500}
                                height={300}
                                className="w-full h-auto object-cover"
                                  unoptimized={isPresignedS3Url(contentData.imageUrl)}
                              />

                            </div>
                            ) : null
                          )}
                        </>
                      )}


                    </div>
                  </div>
                </div>

                {/* Thread Replies - Only show for threads, not longposts */}
                {(() => {
                  const currentContent = getCurrentContent()
                  const threadData = getDisplayContent().thread
                  console.log('🔍 Thread display debug:', {
                    hasThread: !!threadData,
                    threadLength: threadData?.length || 0,
                    threadData: threadData,
                    shouldUseMarkdown: contentData.shouldUseMarkdown
                  })
                  if (threadData && threadData.length > 0 && !contentData.shouldUseMarkdown) {
                    return threadData.map((tweet, index) => (
                      <div key={index} className="relative pb-3">
                        <div className="flex gap-3 pr-2">
                          <div className="relative flex-shrink-0">
                            <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                              {twitter.isConnected && twitter.profile?.profileImage ? (
                                <img 
                                  src={twitter.profile.profileImage} 
                                  alt={`${getDisplayName()} profile`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    target.nextElementSibling?.classList.remove('hidden');
                                  }}
                                />
                              ) : null}
                              <span className={`text-white font-bold text-sm ${(twitter.isConnected && twitter.profile?.profileImage) ? 'hidden' : ''}`}>{getDisplayUsernameInitial()}</span>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-white font-bold text-xs lg:text-sm">{getDisplayUsername()}</span>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                                <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.58 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                              </svg>
                              <span className="text-gray-500 text-xs lg:text-sm">@{getDisplayUsernameLower()}</span>
                            </div>
                            <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                              {isGeneratingContent || (isProcessingEdit && !editError) ? (
                                <ThreadItemShimmer />
                              ) : isContentPurchased() ? (
                                <div className="flex items-start gap-2">
                                  <div className="flex-1">
                                    <EditText
                                      text={tweet}
                                      onSave={(newText) => {
                                        const updatedThread = [...(getDisplayContent().thread || [])]
                                        updatedThread[index] = newText
                                        handleThreadLocalEdit(updatedThread)
                                      }}
                                      onCancel={() => {
                                        // If this is a newly added empty item, remove it from the thread
                                        if (tweet === '') {
                                          const updatedThread = (getDisplayContent().thread || []).filter((_, i) => i !== index)
                                          handleThreadLocalEdit(updatedThread)
                                        }
                                        setIsEditingThread(false)
                                      }}
                                      maxLength={280}
                                      placeholder="Enter thread item..."
                                      isEditing={isEditingThread}
                                      onStartEdit={() => {
                                        setEditedThread(getDisplayContent().thread || [])
                                        setIsEditingThread(true)
                                      }}
                                      editType="thread_item"
                                      contentId={content?.id || 0}
                                      postType={content?.post_type || 'thread'}
                                      localSaveOnly={true}
                                      onLocalSave={(newText) => {
                                        const updatedThread = [...(getDisplayContent().thread || [])]
                                        updatedThread[index] = newText
                                        handleThreadLocalEdit(updatedThread)
                                      }}
                                    />
                                  </div>
                                  <button
                                    onClick={() => {
                                      const updatedThread = (getDisplayContent().thread || []).filter((_, i) => i !== index)
                                      handleThreadLocalEdit(updatedThread)
                                    }}
                                    className="p-1 text-red-400 hover:text-red-300 transition-colors"
                                    aria-label="Delete thread item"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              ) : (
                                tweet
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  }
                  return null
                })()}

                {/* Thread Management Buttons - Only show for threads when purchased */}
                {(() => {
                  const currentContent = getCurrentContent()
                  const threadData = getDisplayContent().thread
                  return isContentPurchased() && canEditThread() && threadData && threadData.length > 0 && (
                    <div className="mt-4 flex justify-center gap-3">
                      <button
                        onClick={() => {
                          const updatedThread = [...(getDisplayContent().thread || []), '']
                          handleThreadLocalEdit(updatedThread)
                          setIsEditingThread(true)
                        }}
                        className="px-2 py-1.5 lg:px-4 lg:py-2 border border-dashed border-white/20 rounded text-white/60 hover:text-white hover:border-white/40 transition-colors text-xs"
                      >
                        + Add thread item
                      </button>
                      <button
                        onClick={handleUpdatePost}
                        disabled={isUpdatingPost}
                        className={`px-3 py-1.5 lg:px-6 lg:py-2 rounded-lg transition-colors font-medium text-xs lg:text-sm ${
                          isUpdatingPost 
                            ? 'bg-orange-400 text-white/80 cursor-not-allowed' 
                            : 'bg-orange-500 hover:bg-orange-600 text-white'
                        }`}
                      >
                        {isUpdatingPost ? (
                          <div className="flex items-center gap-1 lg:gap-2">
                            <div className="w-3 h-3 lg:w-4 lg:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span className="text-xs lg:text-sm">Updating thread...</span>
                          </div>
                        ) : (
                          'Update Post'
                        )}
                      </button>
                    </div>
                  )
                })()}
              </div>

              {/* Avatar Fusion Edit Form */}
              {editMode === 'fusion' && (
                <div ref={editTweetUIRef} className="mt-6 p-4 bg-gray-800/50 rounded-lg border border-gray-600">
                  <h3 className="text-white text-lg font-medium mb-4">
                    Edit This Tweet
                  </h3>
                  
                  {/* Edit Prompt Input */}
                  <div className="mb-4">
                    <label className="block text-white/80 text-sm font-medium mb-2">
                      Describe the changes you want
                    </label>
                    <textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      placeholder="e.g., Replace the character with my avatar wearing sunglasses and holding a microphone..."
                      className="w-full bg-gray-900 text-white text-sm rounded-lg p-3 border border-gray-600 focus:border-orange-500 focus:outline-none resize-none"
                      rows={3}
                      disabled={isProcessingEdit}
                    />
                  </div>

                  {/* Avatar Upload */}
                  <div className="mb-4">
                    <label className="block text-white/80 text-sm font-medium mb-2">
                      Upload Avatar Image (Optional)
                    </label>
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        disabled={isProcessingEdit}
                        className="w-full bg-gray-900 text-white text-sm rounded-lg p-3 border border-gray-600 focus:border-orange-500 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-orange-500 file:text-white hover:file:bg-orange-600"
                      />
                      {avatarFile && (
                        <div className="mt-2 text-xs text-green-400">
                          ✓ {avatarFile.name} selected
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error Message */}
                  {editError && (
                    <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                      <p className="text-red-400 text-sm">{editError}</p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setEditMode(null);
                        setEditPrompt('');
                        setAvatarFile(null);
                        setEditError(null);
                      }}
                      disabled={isProcessingEdit}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitEdit}
                      disabled={!editPrompt.trim() || isProcessingEdit}
                      className="px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessingEdit ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Processing...
                        </div>
                      ) : (
                        'Submit Edit'
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Loading message during processing */}
              {isProcessingEdit && (
                <div className="mt-6 p-4 bg-gray-800/30 rounded-lg">
                  <div className="text-white/80 text-sm text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing avatar fusion... Check the tweet preview above for progress.
                    </div>
                  </div>
                </div>
              )}

              {/* Longpost Warning Message - Only show on mobile for longposts */}
              {contentData.shouldUseMarkdown && (
                <div className="lg:hidden mt-4 p-3 bg-orange-500/20 border border-orange-500/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <span className="text-orange-400 text-sm font-medium">Longpost Content</span>
            </div>
                  <p className="text-orange-300 text-xs mt-1">
                    This is a longpost that will be posted as a single tweet. Make sure your X account supports long tweets.
                  </p>
          </div>
              )}

              {/* Mobile Purchase Options - Now inside the same scrollable container */}
              {!isPurchased ? (
                // Show Buy Tweet view when not purchased
                <div className="lg:hidden mt-6 p-4 bg-[#12141866] rounded-2xl border border-white/20 mb-32">
                  {/* Voice Tone Selection - Mobile/Tablet */}
                  <div className="mb-6">
                    <h3 className="text-white text-[12px] xs:text-[10px] sm:text-[12px] md:text-[16px] font-semibold mb-2 xs:mb-3 md:mb-4">Select tweet voice tone</h3>
                    <p className="text-white/60 text-[10px] xs:text-[8px] sm:text-[10px] md:text-[12px] mb-3 xs:mb-4 md:mb-4">Tweet content and tone will be updated as per your preferences</p>
                    
                    <div className="grid grid-cols-3 bg-[#220808B2] rounded-full p-1 gap-1">
                      <button
                        onClick={() => {
                          setSelectedVoiceTone("auto")
                          // Track voice tone selection for mobile
                          if (content) {
                            console.log('🎯 Mobile voice tone selected: auto')
                            mixpanel.voiceToneSelected({
                              contentId: content.id,
                              selectedTone: 'auto' as 'auto' | 'custom' | 'mystyle',
                              previousTone: selectedVoiceTone,
                              screenName: 'PurchaseContentModal'
                            })
                          }
                        }}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "auto"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        Automated
                      </button>
                      <button
                        onClick={() => {
                          setSelectedVoiceTone("custom")
                          // Track voice tone selection for mobile
                          if (content) {
                            console.log('🎯 Mobile voice tone selected: custom')
                            mixpanel.voiceToneSelected({
                              contentId: content.id,
                              selectedTone: 'custom' as 'auto' | 'custom' | 'mystyle',
                              previousTone: selectedVoiceTone,
                              screenName: 'PurchaseContentModal'
                            })
                          }
                        }}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "custom"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        Choose Yapper
                      </button>
                      <button
                        onClick={() => {
                          setSelectedVoiceTone("mystyle")
                          // Track voice tone selection for mobile
                          if (content) {
                            console.log('🎯 Mobile voice tone selected: mystyle')
                            mixpanel.voiceToneSelected({
                              contentId: content.id,
                              selectedTone: 'mystyle' as 'auto' | 'custom' | 'mystyle',
                              previousTone: selectedVoiceTone,
                              screenName: 'PurchaseContentModal'
                            })
                          }
                        }}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "mystyle"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        My Voice
                      </button>
                    </div>

                    {/* Voice Tone Specific Content */}
                    {selectedVoiceTone === "auto" && (
                      <div className="mt-3 xs:mt-4 md:mt-4 p-2.5 xs:p-3 md:p-3 bg-[#220808]/50 rounded-lg border border-white/10">
                        <div className="flex items-center justify-between">
                          <span className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Extra fee per tweet</span>
                          <span className="text-green-400 font-semibold text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">FREE</span>
                        </div>
                      </div>
                    )}

                    {selectedVoiceTone === "custom" && (
                      <div className="mt-3 xs:mt-4 md:mt-4 space-y-2.5 xs:space-y-3 md:space-y-3">
                        {/* Search input */}
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search yappers..."
                            value={yapperSearchQuery}
                            onChange={(e) => setYapperSearchQuery(e.target.value)}
                            className="w-full bg-[#220808] border border-[#4A3636] rounded-lg px-2.5 xs:px-3 md:px-3 py-2 xs:py-2.5 md:py-2.5 text-white text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] placeholder-white/50 focus:outline-none focus:border-[#FD7A10] focus:ring-1 focus:ring-[#FD7A10]/20"
                          />
                          <svg
                            className="absolute right-2.5 xs:right-3 md:right-3 top-1/2 transform -translate-y-1/2 w-3.5 xs:w-4 md:w-4 h-3.5 xs:h-4 md:h-4 text-white/50"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        
                        {isLoadingYappers ? (
                          <div className="flex items-center justify-center py-2.5 xs:py-3 md:py-3">
                            <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Loading yappers...</div>
                          </div>
                        ) : filteredYappers.length > 0 ? (
                          <div className="space-y-1.5 xs:space-y-2 md:space-y-2 max-h-28 xs:max-h-32 md:max-h-32 overflow-y-auto">
                            {filteredYappers.map((yapper) => (
                              <button
                                key={yapper.id}
                                type="button"
                                onClick={() => handleYapperSelection(yapper.twitter_handle)}
                                className={`w-full text-left p-2 xs:p-2.5 md:p-2.5 rounded-lg border transition-all duration-200 ${
                                  selectedYapper === yapper.twitter_handle
                                    ? 'bg-[#FD7A10] border-[#FD7A10] text-black shadow-lg'
                                    : 'bg-[#220808] border-[#4A3636] text-white hover:bg-[#2a1212] hover:border-[#FD7A10]/30'
                                }`}
                              >
                                <div className="flex items-center gap-1.5 xs:gap-2 md:gap-2">
                                  <div className="w-4 xs:w-5 md:w-5 h-4 xs:h-5 md:h-5 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">
                                    @
                                  </div>
                                  <div>
                                    <div className="font-medium font-nt-brick text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">@{yapper.twitter_handle}</div>
                                    <div className={`text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] ${selectedYapper === yapper.twitter_handle ? 'text-black/60' : 'text-white/50'}`}>
                                      {yapper.display_name}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="py-2.5 xs:py-3 md:py-3">
                            {isSearchQueryNewHandle() ? (
                              <button
                                onClick={() => handleYapperSelection(yapperSearchQuery.replace(/^@/, '').toLowerCase().trim())}
                                className="w-full text-left p-2 xs:p-2.5 md:p-2.5 rounded-lg transition-colors border border-dashed border-[#FD7A10]/50 bg-[#FD7A10]/10 text-white/80 hover:bg-[#FD7A10]/20 hover:border-[#FD7A10]"
                              >
                                <div className="flex items-center space-x-2 xs:space-x-2.5 md:space-x-2.5">
                                  <div className="w-6 xs:w-7 md:w-8 h-6 xs:h-7 md:h-8 rounded-full bg-gradient-to-br from-[#FD7A10] to-[#FF6B35] flex items-center justify-center text-white font-bold text-[8px] xs:text-[9px] md:text-[10px]">
                                    +
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] font-medium truncate">
                                      @{yapperSearchQuery.replace(/^@/, '').toLowerCase().trim()}
                                    </div>
                                    <div className="text-[9px] xs:text-[5px] sm:text-[7px] md:text-[9px] text-[#FD7A10] truncate">
                                      Add new yapper
                                    </div>
                                  </div>
                                </div>
                              </button>
                            ) : (
                              <div className="flex items-center justify-center">
                                <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] text-center">
                                  {yapperSearchQuery ? 'No yappers found. Try entering a valid Twitter handle.' : 'No yappers available'}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Fee message */}
                        <div className="flex items-center justify-between p-2 xs:p-2 md:p-2 bg-[#220808]/50 rounded-lg">
                          <span className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Extra fee per tweet</span>
                          <div className="text-right text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">
                            <span className="line-through">500 ROAST</span>
                            <span className="text-green-400 ml-2 font-semibold">FREE</span>
                          </div>
                        </div>
                        
                        {/* Generate Content Button - Removed since main action button now handles this */}
                        
                        {/* Generation Status - Removed for cleaner UI experience */}
                        
                        
                      </div>
                    )}

                    {selectedVoiceTone === "mystyle" && (
                      <div className="mt-3 xs:mt-4 md:mt-4 space-y-2.5 xs:space-y-3 md:space-y-3">
                        {!twitter.isConnected ? (
                          <div className="text-center p-3 xs:p-4 md:p-4 bg-[#220808]/50 rounded-lg border border-white/10">
                            <h4 className="text-white text-[6px] xs:text-[12px] md:text-[16px] font-semibold mb-1.5 xs:mb-2 md:mb-2">
                              {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                ? 'Twitter reconnection required' 
                                : 'Twitter access required'}
                            </h4>
                            <p className="text-white/60 text-[6px] xs:text-[12px] md:text-[16px] mb-2 xs:mb-3 md:mb-3">
                              {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                ? 'Your Twitter access has been disconnected. Please reconnect to continue using your voice tone.'
                                : 'By getting access to your previous tweets, our AI model can generate content in your voice of tone'}
                            </p>
                            <button
                              onClick={handleTwitterAuthVoice}
                              className="w-full text-[#FD7A10] border border-[#FD7A10] rounded-lg py-2 xs:py-2.5 md:py-2.5 cursor-pointer hover:bg-[#FD7A10]/10 transition-colors text-[6px] xs:text-[12px] md:text-[16px]"
                              disabled={twitter.isLoading}
                            >
                              {twitter.isLoading ? 'Connecting...' : (
                                twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                  ? 'Reconnect Twitter' 
                                  : 'Grant twitter access'
                              )}
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2.5 xs:space-y-3 md:space-y-3">
                            {/* Connected bar */}
                            <div className="flex items-center justify-between bg-[#220808] rounded-lg px-2.5 xs:px-3 md:px-3 py-2 xs:py-2.5 md:py-2.5">
                              <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">Twitter profile</span>
                              <div className="flex items-center gap-1.5 xs:gap-2 md:gap-2">
                                <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">@{twitter.profile?.username || 'profile'}</span>
                                <button
                                  type="button"
                                  onClick={() => disconnect()}
                                  className="text-white/60 hover:text-white/90 text-[6px] xs:text-[12px] md:text-[16px] underline"
                                  disabled={twitter.isLoading}
                                >
                                  {twitter.isLoading ? 'Disconnecting...' : 'Disconnect'}
                                </button>
                              </div>
                            </div>

                            {/* Fee row */}
                            <div className="flex items-center justify-between p-2 xs:p-2 md:p-2 bg-[#220808]/50 rounded-lg">
                              <span className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Extra fee per tweet</span>
                              <div className="text-right text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">
                                <span className="line-through">500 ROAST</span>
                                <span className="text-green-400 ml-2 font-semibold">FREE</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Payment Options - Mobile/Tablet */}
                  <div className="mb-4">
                    {/* Balance Error Message - Mobile */}
                    {balanceError && balanceError.show && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
                        <div className="flex items-center space-x-2 mb-2">
                          <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span className="text-red-400 font-semibold text-sm">⚠️ Insufficient Balance</span>
                          <button
                            onClick={clearBalanceError}
                            className="ml-auto text-red-400 hover:text-red-300 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <p className="text-red-300 text-xs leading-relaxed">
                          {balanceError.message}. You have <span className="font-semibold">{balanceError.tokenType === 'ROAST' ? Math.round(balanceError.currentBalance) : `$${balanceError.currentBalance.toFixed(2)}`}</span>, 
                          but need <span className="font-semibold">{balanceError.tokenType === 'ROAST' ? balanceError.requiredAmount : `$${balanceError.requiredAmount}`}</span>.
                        </p>
                      </div>
                    )}

                    {/* Daily Limit Error Message - Mobile */}
                    {dailyLimitError && dailyLimitError.show && (
                      <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 mb-4">
                        <div className="flex items-center space-x-2 mb-2">
                          <svg className="w-4 h-4 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <span className="text-orange-400 font-semibold text-sm">🆓 Daily Limit Reached</span>
                          <button
                            onClick={clearDailyLimitError}
                            className="ml-auto text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <p className="text-orange-300 text-xs leading-relaxed">
                          {dailyLimitError.message}
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div 
                        onClick={() => {
                          if (selectedPayment !== "roast") {
                            // Track currency toggle
                            if (content) {
                              mixpanel.currencyToggleClicked({
                                contentId: content.id,
                                selectedCurrency: 'ROAST',
                                roastPrice: roastPrice,
                                usdcPrice: roastPrice ? (getDisplayPrice(content) * roastPrice) : 0,
                                conversionRate: roastPrice || 0,
                                screenName: 'PurchaseContentModal'
                              })
                            }
                          }
                          setSelectedPayment("roast")
                        }}
                        className={`p-3 rounded-lg cursor-pointer transition-colors bg-[#12141866] border-2 ${
                          selectedPayment === "roast" ? 'border-[#FD7A10]' : 'border-transparent'
                        }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white font-semibold text-[6px] xs:text-[12px] md:text-[16px]">$ROAST</span>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            selectedPayment === "roast" ? "border-[#FD7A10] bg-[#FD7A10]" : "border-[#FD7A10]"
                          }`}>
                            {selectedPayment === "roast" && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                        </div>
                        <div className="text-white text-[6px] xs:text-[12px] md:text-[16px] font-bold">{Math.round(getDisplayPrice(getCurrentContent()))}</div>
                        <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Platform Token</div>
                      </div>

                      <div 
                        onClick={() => {
                          if (selectedPayment !== "usdc") {
                            // Track currency toggle
                            if (content) {
                              mixpanel.currencyToggleClicked({
                                contentId: content.id,
                                selectedCurrency: 'USDC',
                                roastPrice: roastPrice,
                                usdcPrice: roastPrice ? (getDisplayPrice(content) * roastPrice) : 0,
                                conversionRate: roastPrice || 0,
                                screenName: 'PurchaseContentModal'
                              })
                            }
                          }
                          setSelectedPayment("usdc")
                        }}
                        className={`p-3 rounded-lg cursor-pointer transition-colors bg-[#12141866] border-2 ${
                          selectedPayment === "usdc" ? 'border-[#FD7A10]' : 'border-transparent'
                        }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white font-semibold text-[6px] xs:text-[12px] md:text-[16px]">USDC</span>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            selectedPayment === "usdc" ? "border-[#FD7A10] bg-[#FD7A10]" : "border-[#FD7A10]"
                          }`}>
                            {selectedPayment === "usdc" && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                        </div>
                        <div className="text-white text-[6px] xs:text-[12px] md:text-[16px] font-bold">${totalUSDC}</div>
                        <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px]">Including 0.03 USDC fee</div>
                      </div>
                    </div>

                    {/* Motivational message for USDC users */}
                    {selectedPayment === "usdc" && (
                      <div className="mt-3 bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <svg className="w-4 h-4 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12z" clipRule="evenodd" />
                          </svg>
                          <span className="text-orange-400 font-semibold text-[6px] xs:text-[12px] md:text-[16px]">💡 Save Money with ROAST</span>
                        </div>
                        <p className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px] leading-relaxed">
                          Pay with <span className="text-orange-400 font-semibold">ROAST tokens</span> and save <span className="text-green-400 font-semibold">0.03 USDC</span> in fees! 
                          ROAST holders also get <span className="text-orange-400 font-semibold">exclusive access</span> to premium content and <span className="text-orange-400 font-semibold">early features</span>.
                        </p>
                      </div>
                    )}
                  </div>
                  


                  {/* Action Button - Changes based on selected voice tone and generation state */}
                  {!isPurchased ? (
                    // Show Buy Tweet view when not purchased
                    <>
                      {selectedVoiceTone === "custom" && selectedYapper !== "" ? (
                        // Yapper interface - show different buttons based on generation state
                        hasGeneratedContent ? (
                          // Content has been generated - show Buy Tweet button
                          <button
                            onClick={handlePurchase}
                            disabled={isLoading}
                            className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isLoading ? 'Processing...' : (currentContent && getDisplayPrice(currentContent) === 0 ? 'Get Free Tweet' : 'Buy Tweet')}
                          </button>
                        ) : (
                          // Content not generated yet - show single Generate button based on mode
                          <div className="flex flex-col gap-3">
                            <button
                              onClick={() => {
                                console.log('🎯 Generate button clicked');
                                console.log('📊 textOnlyModeEnabled:', textOnlyModeEnabled);
                                console.log('📊 textOnlyModeEnabled type:', typeof textOnlyModeEnabled);
                                console.log('📊 modeCheckInProgress:', modeCheckInProgress);
                                console.log('📊 selectedYapper:', selectedYapper);
                                console.log('📊 selectedVoiceTone:', selectedVoiceTone);
                                console.log('🔧 Will call:', textOnlyModeEnabled ? 'generateTextOnlyContentFromYapper' : 'generateContentFromYapper');
                                console.log('🔧 textOnlyModeEnabled === true:', textOnlyModeEnabled === true);
                                if (textOnlyModeEnabled) {
                                  console.log('🚀 Calling generateTextOnlyContentFromYapper');
                                  generateTextOnlyContentFromYapper();
                                } else {
                                  console.log('🚀 Calling generateContentFromYapper');
                                  generateContentFromYapper();
                                }
                              }}
                              disabled={isGeneratingContent || !address}
                              className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {isGeneratingContent ? (
                                <>
                                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>Generating...</span>
                                </>
                              ) : (
                                `Generate Content using @${selectedYapper}`
                              )}
                            </button>
                          </div>
                        )
                      ) : selectedVoiceTone === "mystyle" && twitter.isConnected ? (
                        // My Voice interface - show different buttons based on generation state
                        hasGeneratedContent ? (
                          // Content has been generated - show Buy Tweet button
                          <button
                            onClick={handlePurchase}
                            disabled={isLoading}
                            className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isLoading ? 'Processing...' : (currentContent && getDisplayPrice(currentContent) === 0 ? 'Get Free Tweet' : 'Buy Tweet')}
                          </button>
                        ) : (
                          // Content not generated yet - show Generate button
                          <button
                            onClick={handleGenerate}
                            disabled={isGeneratingContent || !address}
                            className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {isGeneratingContent ? (
                              <>
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Generating...</span>
                              </>
                            ) : (
                              `Generate Content using @${twitter.profile?.username || 'handle'}`
                            )}
                          </button>
                        )
                      ) : (
                        // Regular purchase flow (auto generated tone)
                        <button
                          onClick={handlePurchase}
                          disabled={isLoading}
                          className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isLoading ? 'Processing...' : 'Buy Tweet'}
                        </button>
                      )}
                    </>
                  ) : !showTweetManagement ? (
                    // Show Purchase Successful view when purchased but not yet in tweet management
                    <div className="w-full bg-[#12141866] rounded-lg border border-green-500/30 p-6">
                      <div className="flex flex-col items-center text-center gap-4">
                        <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="text-white text-xl font-bold mb-2">Purchase Successful!</h3>
                          <p className="text-white/60">Your content is now ready to tweet</p>
                        </div>
                        <button 
                          onClick={() => setShowTweetManagement(true)}
                          className="w-full bg-[#FD7A10] glow-orange-button text-white font-semibold py-4 rounded-sm text-lg"
                        >
                          Tweet Now
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Show Twitter Posting view when in tweet management
                    <div className="w-full bg-[#12141866] rounded-lg border border-white/20 p-6">
                      <div className="flex flex-col gap-4">
                        {/* Header */}
                        <div className="flex items-center gap-3 mb-4">
                          <button
                            onClick={() => setShowTweetManagement(false)}
                            className="text-white/60 hover:text-white transition-colors"
                          >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M19 12H5M12 19l-7-7 7-7"/>
                            </svg>
                          </button>
                          <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          <div className="flex flex-col gap-1">
                            <div className="text-white font-bold">Content Owned</div>
                            <div className="text-white text-xs">
                              Purchased • {purchasedContentDetails ? `${purchasedContentDetails.price} ${purchasedContentDetails.currency}` : 'Processing...'}
                            </div>
                          </div>
                        </div>

                        {/* Transaction Hash Display - Hide for free content */}
                        {purchasedContentDetails?.transactionHash && !purchasedContentDetails.transactionHash.startsWith('FREE_CONTENT_') && (
                          <div className="bg-[#331C1E] rounded-lg p-4 mb-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                </svg>
                                <span className="text-white/80 text-sm">Transaction Hash:</span>
                              </div>
                              <a
                                href={`https://basescan.org/tx/${purchasedContentDetails.transactionHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 text-sm underline"
                              >
                                View on Base
                              </a>
                            </div>
                            <div className="text-white text-xs font-mono mt-2 break-all">
                              {purchasedContentDetails.transactionHash}
                            </div>
                          </div>
                        )}

                        {/* Posting Method Selection - Hidden when tweet is posted successfully */}
                        {!twitterPostingResult?.success && (
                          <>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <div className="relative">
                                <input
                                  type="radio"
                                  id="post-twitter-mobile"
                                  name="posting-method-mobile"
                                  value="twitter"
                                  checked={postingMethod === 'twitter'}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                                  className="sr-only"
                                />
                                <label htmlFor="post-twitter-mobile" className="flex items-center gap-2 cursor-pointer">
                                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                    postingMethod === 'twitter' 
                                      ? 'border-[#FD7A10] bg-[#FD7A10]' 
                                      : 'border-white/40'
                                  }`}>
                                    {postingMethod === 'twitter' && (
                                      <div className="w-2 h-2 bg-white rounded-full"></div>
                                    )}
                                  </div>
                                  <span className="text-white text-sm font-medium">Post on X</span>
                                </label>
                              </div>
                              <div className="relative">
                                <input
                                  type="radio"
                                  id="post-manual-mobile"
                                  name="posting-method-mobile"
                                  value="manual"
                                  checked={postingMethod === 'manual'}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                                  className="sr-only"
                                />
                                <label htmlFor="post-manual-mobile" className="flex items-center gap-2 cursor-pointer">
                                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                    postingMethod === 'manual' 
                                      ? 'border-[#FD7A10] bg-[#FD7A10]' 
                                      : 'border-white/40'
                                  }`}>
                                    {postingMethod === 'manual' && (
                                      <div className="w-2 h-2 bg-white rounded-full"></div>
                                    )}
                                  </div>
                                  <span className="text-white text-sm font-medium">I will do it manually</span>
                                </label>
                              </div>
                            </div>

                            {postingMethod === 'manual' && (
                              <div className="bg-[#331C1E] rounded-md px-4 py-2 flex items-start gap-3">
                                <div className="flex items-center justify-center">
                                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#FD7A10">
                                    <path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7z" />
                                  </svg>
                                </div>
                                <div className="text-white/80 text-sm">
                                  <div className="font-medium mb-1">How to thread: After posting the first tweet, click the + button on Twitter, paste Tweet 2, post it, then repeat for Tweet 3, etc.</div>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* Content Area - Twitter Posting or Manual */}
                        <div className="flex-1 overflow-y-auto space-y-4">
                          {twitterPostingResult?.success ? (
                            <div className="flex flex-col items-center justify-center text-center h-full gap-6">
                              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                              <div>
                                <h3 className="text-white text-xl font-bold mb-2">{twitterPostingResult.message}</h3>
                                {twitterPostingResult.tweetUrl && (
                                  <a 
                                    href={twitterPostingResult.tweetUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-green-300 hover:text-green-200 underline"
                                  >
                                    View Tweet on X
                                  </a>
                                )}
                              </div>
                            </div>
                          ) : postingMethod === 'twitter' ? (
                            <div className="flex flex-col h-full">
                              {twitter.isConnected && twitter.tokenStatus === 'valid' ? (
                                <div className="flex-1 flex flex-col justify-end">
                                  <div className="space-y-3 mb-6">
                                    <div className="flex items-center gap-3 text-green-400 text-sm">
                                      <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                      <span>We don't store or share any personal details from twitter</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-green-400 text-sm">
                                      <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                      <span>We never post on our behalf. Write access is just for post draft creation</span>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex-1 flex flex-col justify-center">
                                  <div className="bg-[#331C1E] rounded-xl p-6 mb-8">
                                    <div className="flex justify-center mb-4">
                                      <div className="w-20 h-20 bg-[#331C1E] rounded-2xl flex items-center justify-center">
                                        <img src="/twitter-logo-white.png" alt="X" className="w-12 h-12" />
                                      </div>
                                    </div>
                                    <h3 className="text-white text-xl font-semibold mb-3 text-center">Twitter access required</h3>
                                    <p className="text-white/80 text-sm text-center">
                                      To create draft on your twitter account we require write access
                                    </p>
                                  </div>
                                </div>
                              )}
                              
                              {/* Fixed Bottom Section */}
                              <div className="pt-4">
                                {/* Error Messages */}
                                {twitterPostingResult && !twitterPostingResult.success && (
                                  <div className="mb-3 py-2 rounded text-sm text-red-400 bg-red-400/10">
                                    ❌ {twitterPostingResult.message}
                                  </div>
                                )}

                                {/* Tweet Button - Hide after successful posting */}
                                {!twitterPostingResult?.success && (
                                  <button
                                    onClick={handlePostToTwitter}
                                    disabled={isPostingToTwitter}
                                    className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
                                    style={{ display: (twitter.isConnected && twitter.tokenStatus === 'valid') ? 'block' : 'none' }}
                                  >
                                    {isPostingToTwitter ? (
                                      <div className="flex items-center justify-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        <span>Posting...</span>
                                      </div>
                                    ) : (
                                      'Tweet'
                                    )}
                                  </button>
                                )}
                                
                                {/* Auth Button - Shows when auth is required */}
                                <button
                                  onClick={handleTwitterAuth}
                                  disabled={twitter.isLoading}
                                  className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors"
                                  style={{ display: (!twitter.isConnected || twitter.tokenStatus !== 'valid') ? 'block' : 'none' }}
                                >
                                  {twitter.isLoading ? 'Connecting...' : 'Grant access on X'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* Manual Posting Interface - Original tweets list */
                            (() => {
                              // Parse content for display - handle markdown properly
                              const currentContent = getCurrentContent()
                              if (!currentContent) {
                                return null;
                              }
                              
                              // Check if this is markdown content (longpost)
                              const shouldUseMarkdown = isMarkdownContent(currentContent.post_type)
                              const hasMarkdownSyntax = getDisplayContent().text?.includes('##') || getDisplayContent().text?.includes('**')
                              const forceMarkdown = Boolean(shouldUseMarkdown || hasMarkdownSyntax)
                              
                              let tweetText: string
                              let extractedImageUrl: string | null = null
                              
                              if (forceMarkdown) {
                                // For longpost content, convert markdown to plain text for copying/posting
                                tweetText = markdownToPlainText(getDisplayContent().text)
                              } else {
                                // For regular content, use existing formatting
                                const formatted = formatTwitterContentForManagement(getDisplayContent().text)
                                tweetText = formatted.text
                                extractedImageUrl = formatted.imageUrl
                              }
                              
                              // Use edit image if available, otherwise original image
                              let displayImage: string | null = null;
                              const hasEditContent = serverEditContent?.newImageUrl || completedEdit?.newImageUrl;
                              
                              console.log('🔍 [Section 1] Image Display Debug - hasEditContent:', hasEditContent);
                              console.log('🔍 [Section 1] Image Display Debug - completedEdit:', completedEdit);
                              // Use actual purchase status from component state or transaction hash
                              const actualIsPurchased = isPurchased || !!purchasedContentDetails?.transactionHash;
                              console.log('🔍 [Section 1] Image Display Debug - isPurchased (state):', isPurchased);
                              console.log('🔍 [Section 1] Image Display Debug - transactionHash:', purchasedContentDetails?.transactionHash);
                              console.log('🔍 [Section 1] Image Display Debug - actualIsPurchased:', actualIsPurchased);
                              
                              if (hasEditContent) {
                                // Choose correct image based on purchase status
                                const editImageUrl = actualIsPurchased 
                                  ? (serverEditContent?.newImageUrl || completedEdit?.newImageUrl)           // Post-purchase: unwatermarked
                                  : (serverEditContent?.newWatermarkImageUrl || completedEdit?.newWatermarkImageUrl || 
                                     serverEditContent?.newImageUrl || completedEdit?.newImageUrl);          // Pre-purchase: watermarked (fallback to unwatermarked)
                                console.log('🔍 [Section 1] Image Display Debug - editImageUrl found:', editImageUrl);
                                console.log('🔍 [Section 1] Image Display Debug - actualIsPurchased:', actualIsPurchased, 'choosing:', actualIsPurchased ? 'newImageUrl' : 'newWatermarkImageUrl');
                                
                                if (editImageUrl) {
                                  displayImage = editImageUrl;
                                  console.log(`🖼️ [Section 1] Using edit image (${actualIsPurchased ? 'unwatermarked' : 'watermarked'}):`, displayImage);
                                } else {
                                  // Fallback to original image based on purchase status
                                  displayImage = actualIsPurchased 
                                ? (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
                                : (currentContent?.watermark_image || (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
                                  console.log('🖼️ [Section 1] Edit failed, using original image:', displayImage);
                                }
                              } else {
                                // No edit content, show original images based on purchase status
                                displayImage = actualIsPurchased 
                                  ? (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
                                  : (currentContent?.watermark_image || (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
                                console.log('🖼️ [Section 1] Using original image:', displayImage);
                              }
                              
                              console.log('🎯 [Section 1] FINAL displayImage value:', displayImage);

                              // Prepare tweets for copy - also process thread items if they contain markdown
                              const processedThreadItems = getDisplayContent().thread ? getDisplayContent().thread.map(tweet => {
                                // Check if thread item contains markdown
                                if (tweet.includes('##') || tweet.includes('**')) {
                                  return markdownToPlainText(tweet)
                                }
                                return tweet
                              }) : []

                              const tweetsData = [
                                  { 
                                      title: 'Tweet 1', 
                                      text: tweetText || 'Sample tweet content will appear here...' 
                                  },
                                  ...(displayImage ? [{ 
                                      title: 'Tweet 1 (Image)', 
                                      image: displayImage 
                                  }] : []),
                                  ...(currentContent.is_video && currentContent.watermark_video_url ? [{ 
                                      title: 'Tweet 1 (Video)', 
                                      video: currentContent.watermark_video_url,
                                      videoDuration: currentContent.video_duration
                                  }] : []),
                                  ...(currentContent.is_video && !currentContent.watermark_video_url && currentContent.video_url ? [{ 
                                      title: 'Tweet 1 (Video)', 
                                      video: currentContent.video_url,
                                      videoDuration: currentContent.video_duration
                                  }] : []),
                                  ...(processedThreadItems.map((tweet, idx) => ({ 
                                      title: `Tweet ${idx + 2}`, 
                                      text: tweet 
                                  })))
                              ];

                              return tweetsData.map((section, idx) => (
                                <div key={idx} className="bg-[#FFFFFF1A] rounded-md p-4">
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="text-white/90 text-sm">{section.title}</div>
                                    <button
                                      type="button" 
                                      onClick={() => {
                                        if (section.text) {
                                          navigator.clipboard?.writeText(section.text);
                                        } else if (section.image) {
                                          downloadImage(String(section.image), `tweet-image-${idx + 1}.png`);
                                        }
                                      }}
                                      className="text-[#FD7A10] border border-[#FD7A10] rounded-sm px-2 py-1 text-xs flex flex-row gap-1 items-center cursor-pointer hover:bg-[#FD7A10] hover:text-white transition-colors"
                                    >
                                      {section.image ? (
                                        <>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7,10 12,15 17,10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                          </svg>
                                          <span className="text-xs">Download</span>
                                        </>
                                      ) : (
                                        <>
                                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
                                          </svg>
                                          <span className="text-xs">Copy</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  {section.text && (
                                    <div className="text-white/80 text-sm leading-relaxed">
                                      {forceMarkdown ? (
                                        <div 
                                          className="markdown-content max-w-none"
                                          dangerouslySetInnerHTML={{ 
                                            __html: markdownToHTML(section.text)
                                          }}
                                        />
                                      ) : (
                                        section.text
                                      )}
                                    </div>
                                  )}
                                  {section.image && (
                                    <div className="mt-3">
                                      <img 
                                        src={section.image} 
                                        alt="Tweet image" 
                                        className="w-full h-auto rounded-md"
                                      />
                                    </div>
                                  )}
                                  {section.video && (
                                    <div className="mt-3">
                                      <VideoPlayer
                                        src={section.video}
                                        autoPlay={true}
                                        muted={true}
                                        controls={true}
                                        className="w-full h-auto rounded-md"
                                      />
                                      {section.videoDuration && (
                                        <div className="mt-2 text-xs text-white/60">
                                          Duration: {section.videoDuration}s
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ));
                            })()
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : !showTweetManagement ? (
                // Show Purchase Successful view when purchased but not yet in tweet management
                <div className="lg:hidden mt-6 p-4 bg-[#12141866] rounded-2xl border border-green-500/30 mb-32">
                  <div className="flex flex-col items-center text-center gap-4">
                    <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-white text-xl font-bold mb-2">Purchase Successful!</h3>
                      <p className="text-white/60">Your content is now ready to tweet</p>
                    </div>
                    <button 
                      onClick={() => setShowTweetManagement(true)}
                      className="w-full bg-[#FD7A10] glow-orange-button text-white font-semibold py-4 rounded-sm text-lg"
                    >
                      Tweet Now
                    </button>
                  </div>
                </div>
              ) : (
                // Show Twitter Posting view when in tweet management
                <div className="lg:hidden mt-6 p-4 bg-[#12141866] rounded-2xl border border-white/20 mb-32">
                  <div className="flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-4">
                      <button
                        onClick={() => setShowTweetManagement(false)}
                        className="text-white/60 hover:text-white transition-colors"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                      </button>
                      <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-white font-bold">Content Owned</div>
                        <div className="text-white text-xs">
                          Purchased • {purchasedContentDetails ? `${purchasedContentDetails.price} ${purchasedContentDetails.currency}` : 'Processing...'}
                        </div>
                      </div>
                    </div>

                    {/* Transaction Hash Display - Hide for free content */}
                    {purchasedContentDetails?.transactionHash && !purchasedContentDetails.transactionHash.startsWith('FREE_CONTENT_') && (
                      <div className="bg-[#331C1E] rounded-lg p-4 mb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-white/80 text-sm">Transaction Hash:</span>
                          </div>
                          <a
                            href={`https://basescan.org/tx/${purchasedContentDetails.transactionHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 text-sm underline"
                          >
                            View on Base
                          </a>
                        </div>
                        <div className="text-white text-xs font-mono mt-2 break-all">
                          {purchasedContentDetails.transactionHash}
                        </div>
                      </div>
                    )}

                    {/* Posting Method Selection - Hidden when tweet is posted successfully */}
                    {!twitterPostingResult?.success && (
                      <>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div className="relative">
                            <input
                              type="radio"
                              id="post-twitter-mobile"
                              name="posting-method-mobile"
                              value="twitter"
                              checked={postingMethod === 'twitter'}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                              className="sr-only"
                            />
                            <label htmlFor="post-twitter-mobile" className="flex items-center gap-2 cursor-pointer">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                postingMethod === 'twitter' 
                                  ? 'border-[#FD7A10] bg-[#FD7A10]' 
                                  : 'border-white/40'
                              }`}>
                                {postingMethod === 'twitter' && (
                                  <div className="w-2 h-2 bg-white rounded-full"></div>
                                )}
                              </div>
                              <span className="text-white text-sm font-medium">Post on X</span>
                            </label>
                          </div>
                          <div className="relative">
                            <input
                              type="radio"
                              id="post-manual-mobile"
                              name="posting-method-mobile"
                              value="manual"
                              checked={postingMethod === 'manual'}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                              className="sr-only"
                            />
                            <label htmlFor="post-manual-mobile" className="flex items-center gap-2 cursor-pointer">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                postingMethod === 'manual' 
                                  ? 'border-[#FD7A10] bg-[#FD7A10]' 
                                  : 'border-white/40'
                              }`}>
                                {postingMethod === 'manual' && (
                                  <div className="w-2 h-2 bg-white rounded-full"></div>
                                )}
                              </div>
                              <span className="text-white text-sm font-medium">I will do it manually</span>
                            </label>
                          </div>
                        </div>

                        {postingMethod === 'manual' && (
                          <div className="bg-[#331C1E] rounded-md px-4 py-2 flex items-start gap-3">
                            <div className="flex items-center justify-center">
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="#FD7A10">
                                <path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7z" />
                              </svg>
                            </div>
                            <div className="text-white/80 text-sm">
                              <div className="font-medium mb-1">How to thread: After posting the first tweet, click the + button on Twitter, paste Tweet 2, post it, then repeat for Tweet 3, etc.</div>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Content Area - Twitter Posting or Manual */}
                    <div className="flex-1 overflow-y-auto space-y-4">
                      {twitterPostingResult?.success ? (
                        <div className="flex flex-col items-center justify-center text-center h-full gap-6">
                          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="text-white text-xl font-bold mb-2">{twitterPostingResult.message}</h3>
                            {twitterPostingResult.tweetUrl && (
                              <a 
                                href={twitterPostingResult.tweetUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-green-300 hover:text-green-200 underline"
                              >
                                View Tweet on X
                              </a>
                            )}
                          </div>
                        </div>
                      ) : postingMethod === 'twitter' ? (
                        <div className="flex flex-col h-full">
                          {twitter.isConnected && twitter.tokenStatus === 'valid' ? (
                            <div className="flex-1 flex flex-col justify-end">
                              <div className="space-y-3 mb-6">
                                <div className="flex items-center gap-3 text-green-400 text-sm">
                                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  <span>We don't store or share any personal details from twitter</span>
                                </div>
                                <div className="flex items-center gap-3 text-green-400 text-sm">
                                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  <span>We never post on our behalf. Write access is just for post draft creation</span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex-1 flex flex-col justify-center">
                              <div className="bg-[#331C1E] rounded-xl p-6 mb-8">
                                <div className="flex justify-center mb-4">
                                  <div className="w-20 h-20 bg-[#331C1E] rounded-2xl flex items-center justify-center">
                                    <img src="/twitter-logo-white.png" alt="X" className="w-12 h-12" />
                                  </div>
                                </div>
                                <h3 className="text-white text-xl font-semibold mb-3 text-center">Twitter access required</h3>
                                <p className="text-white/80 text-sm text-center">
                                  To create draft on your twitter account we require write access
                                </p>
                              </div>
                            </div>
                          )}
                          
                          {/* Fixed Bottom Section */}
                          <div className="pt-4">
                            {/* Error Messages */}
                            {twitterPostingResult && !twitterPostingResult.success && (
                              <div className="mb-3 py-2 rounded text-sm text-red-400 bg-red-400/10">
                                ❌ {twitterPostingResult.message}
                              </div>
                            )}

                            {/* Tweet Button - Hide after successful posting */}
                            {!twitterPostingResult?.success && (
                              <button
                                onClick={handlePostToTwitter}
                                disabled={isPostingToTwitter}
                                className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3"
                                style={{ display: (twitter.isConnected && twitter.tokenStatus === 'valid') ? 'block' : 'none' }}
                              >
                                {isPostingToTwitter ? (
                                  <div className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    <span>Posting...</span>
                                  </div>
                                ) : (
                                  'Tweet'
                                )}
                              </button>
                            )}
                            
                            {/* Auth Button - Shows when auth is required */}
                            <button
                              onClick={handleTwitterAuth}
                              disabled={twitter.isLoading}
                              className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors"
                              style={{ display: (!twitter.isConnected || twitter.tokenStatus !== 'valid') ? 'block' : 'none' }}
                            >
                              {twitter.isLoading ? 'Connecting...' : 'Grant access on X'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Manual Posting Interface - Original tweets list */
                        (() => {
                          // Parse content for display - handle markdown properly
                          const currentContent = getCurrentContent()
                          if (!currentContent) {
                            return null;
                          }
                          
                          // Check if this is markdown content (longpost)
                          const shouldUseMarkdown = isMarkdownContent(currentContent.post_type)
                          const hasMarkdownSyntax = getDisplayContent().text?.includes('##') || getDisplayContent().text?.includes('**')
                          const forceMarkdown = Boolean(shouldUseMarkdown || hasMarkdownSyntax)
                          
                          let tweetText: string
                          let extractedImageUrl: string | null = null
                          
                          if (forceMarkdown) {
                            // For longpost content, convert markdown to plain text for copying/posting
                            tweetText = markdownToPlainText(getDisplayContent().text)
                          } else {
                            // For regular content, use existing formatting
                            const formatted = formatTwitterContentForManagement(getDisplayContent().text)
                            tweetText = formatted.text
                            extractedImageUrl = formatted.imageUrl
                          }
                          
                          // Use edit image if available, otherwise original image
                          let displayImage: string | null = null;
                          const hasEditContent = serverEditContent?.newImageUrl || completedEdit?.newImageUrl;
                          
                          console.log('🔍 [Section 2] Image Display Debug - hasEditContent:', hasEditContent);
                          console.log('🔍 [Section 2] Image Display Debug - completedEdit:', completedEdit);
                          // Use actual purchase status from component state or transaction hash
                          const actualIsPurchased = isPurchased || !!purchasedContentDetails?.transactionHash;
                          console.log('🔍 [Section 2] Image Display Debug - isPurchased (state):', isPurchased);
                          console.log('🔍 [Section 2] Image Display Debug - transactionHash:', purchasedContentDetails?.transactionHash);
                          console.log('🔍 [Section 2] Image Display Debug - actualIsPurchased:', actualIsPurchased);
                          
                          if (hasEditContent) {
                            // Choose correct image based on purchase status
                            const editImageUrl = actualIsPurchased 
                              ? (serverEditContent?.newImageUrl || completedEdit?.newImageUrl)           // Post-purchase: unwatermarked
                              : (serverEditContent?.newWatermarkImageUrl || completedEdit?.newWatermarkImageUrl || 
                                 serverEditContent?.newImageUrl || completedEdit?.newImageUrl);          // Pre-purchase: watermarked (fallback to unwatermarked)
                            console.log('🔍 [Section 2] Image Display Debug - editImageUrl found:', editImageUrl);
                            console.log('🔍 [Section 2] Image Display Debug - actualIsPurchased:', actualIsPurchased, 'choosing:', actualIsPurchased ? 'newImageUrl' : 'newWatermarkImageUrl');
                            
                            if (editImageUrl) {
                              displayImage = editImageUrl;
                              console.log(`🖼️ [Section 2] Using edit image (${actualIsPurchased ? 'unwatermarked' : 'watermarked'}):`, displayImage);
                            } else {
                              // Fallback to original image based on purchase status
                              displayImage = actualIsPurchased 
                            ? (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
                            : (currentContent?.watermark_image || (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
                              console.log('🖼️ [Section 2] Edit failed, using original image:', displayImage);
                            }
                          } else {
                            // No edit content, show original images based on purchase status
                            displayImage = actualIsPurchased 
                              ? (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
                              : (currentContent?.watermark_image || (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));
                            console.log('🖼️ [Section 2] Using original image:', displayImage);
                          }
                          
                          console.log('🎯 [Section 2] FINAL displayImage value:', displayImage);

                          // Prepare tweets for copy - also process thread items if they contain markdown
                          const processedThreadItems = getDisplayContent().thread ? getDisplayContent().thread.map(tweet => {
                            // Check if thread item contains markdown
                            if (tweet.includes('##') || tweet.includes('**')) {
                              return markdownToPlainText(tweet)
                            }
                            return tweet
                          }) : []

                          const tweetsData = [
                              { 
                                  title: 'Tweet 1', 
                                  text: tweetText || 'Sample tweet content will appear here...' 
                              },
                              ...(displayImage ? [{ 
                                  title: 'Tweet 1 (Image)', 
                                  image: displayImage 
                              }] : []),
                              ...(currentContent.is_video && currentContent.watermark_video_url ? [{ 
                                  title: 'Tweet 1 (Video)', 
                                  video: currentContent.watermark_video_url,
                                  videoDuration: currentContent.video_duration
                              }] : []),
                              ...(currentContent.is_video && !currentContent.watermark_video_url && currentContent.video_url ? [{ 
                                  title: 'Tweet 1 (Video)', 
                                  video: currentContent.video_url,
                                  videoDuration: currentContent.video_duration
                              }] : []),
                              ...(processedThreadItems.map((tweet, idx) => ({ 
                                  title: `Tweet ${idx + 2}`, 
                                  text: tweet 
                              })))
                          ];

                          return tweetsData.map((section, idx) => (
                            <div key={idx} className="bg-[#FFFFFF1A] rounded-md p-4">
                              <div className="flex items-center justify-between mb-3">
                                <div className="text-white/90 text-sm">{section.title}</div>
                                <button
                                  type="button" 
                                  onClick={() => {
                                    if (section.text) {
                                      navigator.clipboard?.writeText(section.text);
                                    } else if (section.image) {
                                      downloadImage(String(section.image), `tweet-image-${idx + 1}.png`);
                                    }
                                  }}
                                  className="text-[#FD7A10] border border-[#FD7A10] rounded-sm px-2 py-1 text-xs flex flex-row gap-1 items-center cursor-pointer hover:bg-[#FD7A10] hover:text-white transition-colors"
                                >
                                  {section.image ? (
                                    <>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7,10 12,15 17,10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                      </svg>
                                      <span className="text-xs">Download</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
                                      </svg>
                                      <span className="text-xs">Copy</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              {section.text && (
                                <div className="text-white/80 text-sm leading-relaxed">
                                  {forceMarkdown ? (
                                    <div 
                                      className="markdown-content max-w-none"
                                      dangerouslySetInnerHTML={{ 
                                        __html: markdownToHTML(section.text)
                                      }}
                                    />
                                  ) : (
                                    section.text
                                  )}
                                </div>
                              )}
                              {section.image && (
                                <div className="mt-3">
                                  <img 
                                    src={section.image} 
                                    alt="Tweet image" 
                                    className="w-full h-auto rounded-md"
                                  />
                                </div>
                              )}
                              {section.video && (
                                <div className="mt-3">
                                  <VideoPlayer
                                    src={section.video}
                                    autoPlay={true}
                                    muted={true}
                                    controls={true}
                                    className="w-full h-auto rounded-md"
                                  />
                                  {section.videoDuration && (
                                    <div className="mt-2 text-xs text-white/60">
                                      Duration: {section.videoDuration}s
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ));
                        })()
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>


          </div>

          {/* Right Panel - Hidden on mobile, shown on desktop */}
          <div className="hidden lg:flex w-full lg:w-1/2 px-4 pt-4 lg:px-8 lg:pt-8 flex-col gap-4 overflow-y-auto justify-between">
            {!isPurchased ? (
              <>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4">
                    {/* Content Miner Info */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#FFCC00] rounded-full flex items-center justify-center overflow-hidden">
                        <span className="text-black font-bold text-lg">
                          {getDisplayUsernameInitial()}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold">
                            {getDisplayUsername()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-white/60">
                          <div className="flex items-center gap-2">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFCC00">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                          </div>
                          <div className="flex items-center gap-1 text-xs">
                            {/* <span className="text-white">{localContent?.creator?.reputation_score} reputation</span>
                            <span className="text-white">•</span> */}
                            <span className="text-white">{new Date(localContent?.created_at || '').toLocaleDateString()}</span>
                          </div>
                          {/* {localContent?.agent_name && (
                            <div className="flex items-start justify-start gap-1">
                              <span className="px-2 py-1 bg-blue-100 text-blue-400 text-xs rounded-2xl font-semibold">🤖 {localContent.agent_name}</span>
                            </div>
                          )} */}
                        </div>
                      </div>
                    </div>




                  </div>

                  {/* Voice Tone Selection */}
                  <div className="flex flex-col">
                    <div className="bg-[#12141866] rounded-t-md p-4 flex flex-col border-b border-white/40">
                      <h3 className="text-white text-md font-semibold">Select tweet voice tone</h3>
                      <p className="text-white/60 text-sm">Tweet content and tone will be updated as per your preferences</p>
                    </div>
                    <div className="flex flex-col gap-6 rounded-b-md p-4 bg-[#12141866]">
                      
                      <div className="grid grid-cols-3 bg-[#220808B2] rounded-full p-1">
                        <button
                          onClick={() => setSelectedVoiceTone("auto")}
                          className={`py-2 px-2 rounded-full text-sm font-medium transition-colors text-center ${selectedVoiceTone === "auto"
                            ? "bg-white text-black"
                            : "text-white/80"
                            }`}
                        >
                          Auto generated
                        </button>
                        <button
                          onClick={() => setSelectedVoiceTone("custom")}
                          className={`py-2 px-2 rounded-full text-sm font-medium transition-colors text-center ${selectedVoiceTone === "custom"
                            ? "bg-white text-black"
                            : "text-white/80"
                            }`}
                        >
                          Choose Yapper
                          {selectedVoiceTone === "custom" && selectedYapper && (
                            <span className="ml-1 text-xs">✨</span>
                          )}
                        </button>
                        <button
                          onClick={() => setSelectedVoiceTone("mystyle")}
                          className={`py-2 px-2 rounded-full text-sm font-medium transition-colors text-center ${selectedVoiceTone === "mystyle"
                            ? "bg-white text-black"
                            : "text-white/80"
                            }`}
                        >
                          My Voice
                        </button>
                      </div>

                      {selectedVoiceTone === "auto" && (
                        <div className="flex flex-row items-center justify-between gap-1 mt-3">
                          <div className="text-white/60 text-sm">Extra fee per tweet</div>
                          <div className="text-right text-white/60 text-xs">
                            <span className="text-green-400 font-semibold">FREE</span>
                          </div>
                        </div>
                      )}

                      {selectedVoiceTone === "custom" && (
                        <div className="space-y-3">
                          {/* Search input */}
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Search yappers..."
                              value={yapperSearchQuery}
                              onChange={(e) => setYapperSearchQuery(e.target.value)}
                              className="w-full bg-[#220808] border border-[#4A3636] rounded-md px-3 py-2 text-white text-xs placeholder-white/50 focus:outline-none focus:border-[#FD7A10]"
                            />
                            <svg
                              className="absolute right-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-white/50"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                          </div>
                          
                          {isLoadingYappers ? (
                            <div className="flex items-center justify-center py-4">
                              <div className="text-white/60 text-xs">Loading yappers...</div>
                            </div>
                          ) : filteredYappers.length > 0 ? (
                            <div className="space-y-1 max-h-44 overflow-y-auto">
                              {filteredYappers.map((yapper) => (
                                <button
                                  key={yapper.id}
                                  type="button"
                                  onClick={() => handleYapperSelection(yapper.twitter_handle)}
                                  className={`w-full text-left p-2 rounded border transition-colors ${
                                    selectedYapper === yapper.twitter_handle
                                      ? 'bg-[#FD7A10] border-[#FD7A10] text-black'
                                      : 'bg-[#220808] border-[#4A3636] text-white hover:bg-[#2a1212]'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                                      @
                                    </div>
                                    <div>
                                      <div className="font-medium font-nt-brick text-xs">@{yapper.twitter_handle}</div>
                                      <div className={`text-xs ${selectedYapper === yapper.twitter_handle ? 'text-black/60' : 'text-white/50'}`}>
                                        {yapper.display_name}
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="py-4">
                              {isSearchQueryNewHandle() ? (
                                <button
                                  onClick={() => handleYapperSelection(yapperSearchQuery.replace(/^@/, '').toLowerCase().trim())}
                                  className="w-full text-left p-2 rounded border border-dashed border-[#FD7A10]/50 bg-[#FD7A10]/10 text-white/80 hover:bg-[#FD7A10]/20 hover:border-[#FD7A10] transition-colors"
                                >
                                  <div className="flex items-center space-x-2">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FD7A10] to-[#FF6B35] flex items-center justify-center text-white font-bold text-sm">
                                      +
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-sm font-medium truncate">
                                        @{yapperSearchQuery.replace(/^@/, '').toLowerCase().trim()}
                                      </div>
                                      <div className="text-xs text-[#FD7A10] truncate">
                                        Add new yapper
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              ) : (
                                <div className="flex items-center justify-center">
                                  <div className="text-white/60 text-xs text-center">
                                    {yapperSearchQuery ? 'No yappers found. Try entering a valid Twitter handle.' : 'No yappers available'}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Fee per tweet message */}
                          <div className="flex flex-row items-center justify-between gap-1 mt-2">
                            <div className="text-white/60 text-[8px] xs:text-[8px] md:text-[12px]">Extra fee per tweet</div>
                            <div className="text-right text-white/60 text-[8px] xs:text-[8px] md:text-[12px]">
                              <span className="line-through">500 ROAST</span>
                              <span className="text-green-400 ml-2 font-semibold">FREE</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedVoiceTone === "mystyle" && (
                        <>
                          {/* Removed duplicate fee message - now only shows after Twitter connection */}

                          {!twitter.isConnected ? (
                            <div className="flex flex-col items-center justify-center text-center">
                              <h3 className="text-white text-lg font-semibold mb-3">
                                {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                  ? 'Twitter reconnection required' 
                                  : 'Twitter access required'}
                              </h3>
                              <p className="text-white/60 text-sm mb-6 px-4">
                                {twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                  ? 'Your Twitter access has been disconnected. Please reconnect to continue using your voice tone.'
                                  : 'By getting access to your previous tweets, our AI model can generate content in your voice of tone'}
                              </p>
                              <button
                                onClick={handleTwitterAuthVoice}
                                className="w-full text-[#FD7A10] border border-[#FD7A10] rounded-sm py-3 cursor-pointer hover:bg-[#FD7A10]/10 transition-colors"
                                disabled={twitter.isLoading}
                              >
                                {twitter.isLoading ? 'Connecting...' : (
                                  twitter.hasPreviousConnection && (twitter.tokenStatus === 'expired' || twitter.tokenStatus === 'missing')
                                    ? 'Reconnect Twitter' 
                                    : 'Grant twitter access'
                                )}
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-4">
                              {/* Connected bar */}
                              <div className="flex items-center justify-between bg-[#220808] rounded-lg px-2.5 xs:px-3 md:px-3 py-2 xs:py-2.5 md:py-2.5">
                                <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">Twitter profile</span>
                                <div className="flex items-center gap-1.5 xs:gap-2 md:gap-2">
                                  <span className="text-white/80 text-[6px] xs:text-[12px] md:text-[16px]">@{twitter.profile?.username || 'profile'}</span>
                                  <button
                                    type="button"
                                    onClick={() => disconnect()}
                                    className="text-white/60 hover:text-white/90 text-[6px] xs:text-[12px] md:text-[16px] underline"
                                    disabled={twitter.isLoading}
                                  >
                                    {twitter.isLoading ? 'Disconnecting...' : 'Disconnect'}
                                  </button>
                                </div>
                              </div>

                              {/* Fee row */}
                              <div className="flex items-center justify-between p-2 xs:p-2 md:p-2 bg-[#220808]/50 rounded-lg">
                                <span className="text-white/60 text-[8px] xs:text-[12px] md:text-[16px]">Extra fee per tweet</span>
                                <div className="text-right text-white/60 text-[6px] xs:text-[12px] md:text-[16px]">
                                  <span className="line-through">500 ROAST</span>
                                  <span className="text-green-400 ml-2 font-semibold">FREE</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Longpost Premium X Account Warning */}
                {localContent?.post_type === 'longpost' && (
                  <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <span className="text-blue-400 font-semibold text-sm">ℹ️ Premium X Account Required</span>
                    </div>
                    <p className="text-white/80 text-xs leading-relaxed">
                      This is a <span className="text-blue-400 font-semibold">longpost content</span>. You must have a <span className="text-blue-400 font-semibold">premium X (Twitter) account</span> that allows posting longer content to use this tweet effectively.
                    </p>
                  </div>
                )}

                {/* Payment Options */}
                <div className="flex flex-col gap-4">
                  {/* Balance Error Message - Desktop */}
                  {balanceError && balanceError.show && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <div className="flex items-center space-x-2 mb-2">
                        <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-red-400 font-semibold text-sm">⚠️ Insufficient Balance</span>
                        <button
                          onClick={clearBalanceError}
                          className="ml-auto text-red-400 hover:text-red-300 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-red-300 text-xs leading-relaxed">
                        {balanceError.message}. You have <span className="font-semibold">{balanceError.tokenType === 'ROAST' ? Math.round(balanceError.currentBalance) : `$${balanceError.currentBalance.toFixed(2)}`}</span>, 
                        but need <span className="font-semibold">{balanceError.tokenType === 'ROAST' ? balanceError.requiredAmount : `$${balanceError.requiredAmount}`}</span>.
                      </p>
                    </div>
                  )}

                  {/* Daily Limit Error Message - Desktop */}
                  {dailyLimitError && dailyLimitError.show && (
                    <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                      <div className="flex items-center space-x-2 mb-2">
                        <svg className="w-4 h-4 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-orange-400 font-semibold text-sm">🆓 Daily Limit Reached</span>
                        <button
                          onClick={clearDailyLimitError}
                          className="ml-auto text-orange-400 hover:text-orange-300 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <p className="text-orange-300 text-xs leading-relaxed">
                        {dailyLimitError.message}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div
                      onClick={() => setSelectedPayment("roast")}
                      className={'p-4 rounded-md cursor-pointer transition-colors bg-[#12141866] '}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-semibold">$ROAST</span>
                        <div className={`w-5 h-5 rounded-full border-[1px] flex items-center justify-center ${selectedPayment === "roast"
                          ? "border-orange-500"
                          : "border-orange-500"
                          }`}>
                          {selectedPayment === "roast" && (
                            <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                          )}
                        </div>
                      </div>
                                              <div className="text-white text-xl font-bold">{Math.round(getDisplayPrice(getCurrentContent()))}</div>
                      <div className="text-white/60 text-xs">Platform Token</div>
                    </div>

                    <div
                      onClick={() => setSelectedPayment("usdc")}
                      className={'p-4 rounded-md cursor-pointer transition-colors bg-[#12141866]'}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-semibold">USDC</span>
                        <div className={`w-5 h-5 rounded-full border-[1px] flex items-center justify-center ${selectedPayment === "usdc"
                          ? "border-orange-500"
                          : "border-orange-500"
                          }`}>
                          {selectedPayment === "usdc" && (
                            <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                          )}
                        </div>
                      </div>
                      <div className="text-white text-xl font-bold">${totalUSDC}</div>
                      <div className="text-white/60 text-xs">Including 0.03 USDC fee</div>
                    </div>
                  </div>

                  {/* Motivational message for USDC users */}
                  {selectedPayment === "usdc" && (
                    <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-500/20 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12z" clipRule="evenodd" />
                        </svg>
                        <span className="text-orange-400 font-semibold text-sm">💡 Save Money with ROAST</span>
                      </div>
                      <p className="text-white/80 text-xs leading-relaxed">
                        Pay with <span className="text-orange-400 font-semibold">ROAST tokens</span> and save <span className="text-green-400 font-semibold">0.03 USDC</span> in fees! 
                        ROAST holders also get <span className="text-orange-400 font-semibold">exclusive access</span> to premium content and <span className="text-orange-400 font-semibold">early features</span>.
                      </p>
                </div>
              )}
              


              <button
                onClick={() => {
                  console.log("[AppKit] Connect button clicked from purchase modal");
                  const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search + window.location.hash : "/";
                  localStorage.setItem("wc_return_path", currentPath);
                  appKit.open();
                      // Handle different button actions based on state
                      if (isLoading || (selectedVoiceTone === "custom" && selectedYapper !== "" && isGeneratingContent)) {
                        return; // No action during loading/generation
                      }
                      
                      if (!address) {
                        // Track wallet connect event from purchase modal
                        console.log('🎯 Wallet connect clicked from purchase modal')
                        mixpanel.walletConnectClicked({
                          connectSource: 'purchaseModal',
                          currentPage: typeof window !== 'undefined' ? window.location.pathname : '/',
                          deviceType: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
                          screenName: 'PurchaseContentModal',
                          contentId: content?.id || 0
                        })
                        
                        // AppKit will handle wallet connection
                        return;
                      }
                      
                      if (!isAuthenticated) {
                        signIn(); // Open signature modal
                        return;
                      }
                      
                      if (!hasAccess) {
                        router.push('/access'); // Redirect to access page
                        return;
                      }
                      
                      // Handle content generation or purchase
                      if (selectedVoiceTone === "custom" && selectedYapper !== "") {
                        if (hasGeneratedContent) {
                          handlePurchase(); // Purchase generated content
                        } else {
                          // Use mode-based function selection
                          console.log('🎯 Mobile button clicked - custom voice tone');
                          console.log('📊 textOnlyModeEnabled:', textOnlyModeEnabled);
                          console.log('📊 selectedYapper:', selectedYapper);
                          if (textOnlyModeEnabled) {
                            console.log('🚀 Mobile: Calling generateTextOnlyContentFromYapper');
                            generateTextOnlyContentFromYapper(); // Generate text-only content
                          } else {
                            console.log('🚀 Mobile: Calling generateContentFromYapper');
                            generateContentFromYapper(); // Generate full content
                          }
                        }
                      } else if (selectedVoiceTone === "mystyle" && twitter.isConnected) {
                        if (hasGeneratedContent) {
                          handlePurchase(); // Purchase generated content
                        } else {
                          handleGenerate(); // Generate content in user's voice
                        }
                      } else {
                        handlePurchase(); // Purchase existing content
                      }
                    }}
                    disabled={isLoading || isGeneratingContent}
                    className={`w-full font-semibold py-4 rounded-sm text-lg transition-all duration-200 ${
                      isLoading || isGeneratingContent
                        ? 'bg-[#FD7A10] cursor-not-allowed' 
                        : !address
                        ? 'bg-[#FD7A10] hover:bg-[#e86d0f] glow-orange-button'
                        : !isAuthenticated
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : !hasAccess
                        ? 'bg-purple-600 hover:bg-purple-700'
                        : 'bg-[#FD7A10] glow-orange-button hover:bg-[#e86d0f]'
                    } text-white flex items-center justify-center gap-2`}
                  >
                    {isLoading || isGeneratingContent ? (
                      <>
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>{isGeneratingContent ? 'Generating...' : 'Processing...'}</span>
                      </>
                    ) : !address ? (
                      'Connect Wallet'
                    ) : !isAuthenticated ? (
                      'Sign Message to Authenticate'
                    ) : !hasAccess ? (
                      'Get Marketplace Access'
                    ) : selectedVoiceTone === "custom" && selectedYapper !== "" ? (
                      hasGeneratedContent ? 'Buy Tweet' : `Generate Content using @${selectedYapper}`
                    ) : selectedVoiceTone === "mystyle" && twitter.isConnected ? (
                      hasGeneratedContent ? 'Buy Tweet' : `Generate Content using @${twitter.profile?.username}`
                    ) : (
                      'Buy Tweet'
                    )}
                  </button>
                </div>
                  </>
                ) : showTweetManagement ? (
              /* Tweet Management State */
              <div className="flex flex-col gap-4 h-full">
                {/* Header with back button and close button */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowTweetManagement(false)}
                      className="text-white/60 hover:text-white transition-colors"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7"/>
                      </svg>
                    </button>
                    <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-white font-bold">Content Owned</div>
                      <div className="text-white text-xs">
                        Purchased • {purchasedContentDetails ? `${purchasedContentDetails.price} ${purchasedContentDetails.currency}` : 'Processing...'}
                      </div>
                    </div>
                  </div>
                </div>



                {/* Posting Method Selection - Hidden when tweet is posted successfully */}
                {!twitterPostingResult?.success && (
                  <>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="relative">
                        <input
                          type="radio"
                          id="post-twitter-desktop"
                          name="posting-method-desktop"
                          value="twitter"
                          checked={postingMethod === 'twitter'}
                          onChange={(e) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                          className="sr-only"
                        />
                        <label htmlFor="post-twitter-desktop" className="flex items-center gap-2 cursor-pointer">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            postingMethod === 'twitter' 
                              ? 'border-[#FD7A10] bg-[#FD7A10]' 
                              : 'border-white/40'
                          }`}>
                            {postingMethod === 'twitter' && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                          <span className="text-white text-sm font-medium">Post on X</span>
                        </label>
                      </div>
                      <div className="relative">
                        <input
                          type="radio"
                          id="post-manual-desktop"
                          name="posting-method-desktop"
                          value="manual"
                          checked={postingMethod === 'manual'}
                          onChange={(e) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
                          className="sr-only"
                        />
                        <label htmlFor="post-manual-desktop" className="flex items-center gap-2 cursor-pointer">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            postingMethod === 'manual' 
                              ? 'border-[#FD7A10] bg-[#FD7A10]' 
                              : 'border-white/40'
                          }`}>
                            {postingMethod === 'manual' && (
                              <div className="w-2 h-2 bg-white rounded-full"></div>
                            )}
                          </div>
                          <span className="text-white text-sm font-medium">I will do it manually</span>
                        </label>
                      </div>
                    </div>

                    {postingMethod === 'manual' && (
                      /* How to thread info for manual posting */
                      <div className="bg-[#331C1E] rounded-md px-4 py-2 flex items-start gap-3 mb-4">
                        <div className="flex items-center justify-center">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="#FD7A10">
                            <path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7z" />
                          </svg>
                        </div>
                        <div className="text-white/80 text-sm">
                          <div className="font-medium mb-1">How to thread: After posting the first tweet, click the + button on Twitter, paste Tweet 2, post it, then repeat for Tweet 3, etc.</div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Content Area - Twitter Posting or Manual */}
                <div className="flex-1 overflow-y-auto space-y-4">
                  {twitterPostingResult?.success ? (
                    /* Tweet Success State - Same position as Purchase Success */
                    <div className="flex flex-col items-center justify-center text-center h-full gap-6">
                      <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-white text-xl font-bold mb-2">{twitterPostingResult.message}</h3>
                        {twitterPostingResult.tweetUrl && (
                          <a 
                            href={twitterPostingResult.tweetUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-green-300 hover:text-green-200 underline"
                          >
                            View Tweet on X
                          </a>
                        )}
                      </div>
                    </div>
                  ) : postingMethod === 'twitter' ? (
                    /* Twitter Posting Interface */
                    <div className="flex flex-col h-full">
                      {/* Transaction Hash Display - Hide for free content */}
                      {purchasedContentDetails?.transactionHash && !purchasedContentDetails.transactionHash.startsWith('FREE_CONTENT_') && (
                        <div className="bg-[#331C1E] rounded-lg p-4 mb-4 mx-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                              </svg>
                              <span className="text-white/80 text-sm">Transaction Hash:</span>
                            </div>
                            <a
                              href={`https://basescan.org/tx/${purchasedContentDetails.transactionHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 text-sm underline"
                            >
                              View on Base
                            </a>
                          </div>
                          <div className="text-white text-xs font-mono mt-2 break-all">
                            {purchasedContentDetails.transactionHash}
                          </div>
                        </div>
                      )}

                      {(() => {
                        // Debug logging
                        console.log('🔍 Twitter Status Debug:', {
                          isConnected: twitter.isConnected,
                          tokenStatus: twitter.tokenStatus,
                          hasPreviousConnection: twitter.hasPreviousConnection,
                          postingStatus: twitterPostingStatus
                        });
                        return null;
                      })()}
                      {twitter.isConnected && twitter.tokenStatus === 'valid' ? (
                        /* Ready to Post - Show green messages */
                        <div className="flex-1 flex flex-col justify-end">
                          <div className="space-y-3 mb-6 px-4">
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We don't store or share any personal details from twitter</span>
                            </div>
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We never post on our behalf. Write access is just for post draft creation</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Twitter Access Required or Expired */
                        <div className="flex-1 flex flex-col justify-center">
                          {/* Combined X logo and message unit */}
                          <div className="bg-[#331C1E] rounded-xl p-6 mx-4 mb-8">
                            <div className="flex justify-center mb-4">
                              <div className="w-20 h-20 bg-[#331C1E] rounded-2xl flex items-center justify-center">
                                <img src="/twitter-logo-white.png" alt="X" className="w-12 h-12" />
                              </div>
                            </div>
                            <h3 className="text-white text-xl font-semibold mb-3 text-center">Twitter access required</h3>
                            <p className="text-white/80 text-sm text-center">
                              To create draft on your twitter account we require write access
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {/* Fixed Bottom Section */}
                      <div className="pt-4">
                        {/* Green checkmark messages - Only when auth is required and tweet not posted */}
                        {(!twitter.isConnected || twitter.tokenStatus !== 'valid') && !twitterPostingResult?.success && (
                          <div className="space-y-2 mb-4 px-4">
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We don't store or share any personal details from twitter</span>
                            </div>
                            <div className="flex items-center gap-3 text-green-400 text-sm">
                              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              <span>We never post on our behalf. Write access is just for post draft creation</span>
                            </div>
                          </div>
                        )}

                        {/* Error Messages */}
                        {twitterPostingResult && !twitterPostingResult.success && (
                          <div className="mb-3 px-4 py-2 rounded text-sm text-red-400 bg-red-400/10">
                            ❌ {twitterPostingResult.message}
                          </div>
                        )}

                        {/* Tweet Button - Hide after successful posting */}
                        {!twitterPostingResult?.success && (
                          <button
                            onClick={handlePostToTwitter}
                            disabled={isPostingToTwitter}
                            className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ display: (twitter.isConnected && twitter.tokenStatus === 'valid') ? 'block' : 'none' }}
                          >
                            {isPostingToTwitter ? (
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>Posting...</span>
                              </div>
                            ) : (
                              'Tweet'
                            )}
                          </button>
                        )}
                        
                        {/* Auth Button - Shows when auth is required */}
                        <button
                          onClick={handleTwitterAuth}
                          disabled={twitter.isLoading}
                          className="w-full bg-[#FD7A10] text-white font-semibold py-4 rounded-sm hover:bg-[#e86d0f] transition-colors"
                          style={{ display: (!twitter.isConnected || twitter.tokenStatus !== 'valid') ? 'block' : 'none' }}
                        >
                          {twitter.isLoading ? 'Connecting...' : 'Grant access on X'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Manual Posting Interface - Original tweets list */
                    (() => {
                      // Parse content for display - handle markdown properly
                      const currentContent = getCurrentContent()
                      if (!currentContent) {
                        return null;
                      }
                      
                      // Check if this is markdown content (longpost)
                      const shouldUseMarkdown = isMarkdownContent(currentContent.post_type)
                      const hasMarkdownSyntax = getDisplayContent().text?.includes('##') || getDisplayContent().text?.includes('**')
                      const forceMarkdown = Boolean(shouldUseMarkdown || hasMarkdownSyntax)
                      
                      let tweetText: string
                      let extractedImageUrl: string | null = null
                      
                      if (forceMarkdown) {
                        // For longpost content, convert markdown to plain text for copying/posting
                        tweetText = markdownToPlainText(getDisplayContent().text)
                      } else {
                        // For regular content, use existing formatting
                        const formatted = formatTwitterContentForManagement(getDisplayContent().text)
                        tweetText = formatted.text
                        extractedImageUrl = formatted.imageUrl
                      }
                      
                      // Determine which image to display with updated priority logic
                      let displayImage: string | null = null;
                      
                      // Check if we have edit content from user_tweet_edits table
                      const hasEditContent = serverEditContent?.newImageUrl || completedEdit?.newImageUrl;
                      
                      console.log('🔍 Image Display Debug - hasEditContent:', hasEditContent);
                      console.log('🔍 Image Display Debug - serverEditContent:', serverEditContent);
                      console.log('🔍 Image Display Debug - completedEdit:', completedEdit);
                      console.log('🔍 Image Display Debug - isPurchased:', isPurchased);
                      console.log('🔍 Image Display Debug - currentContent.watermark_image:', currentContent?.watermark_image);
                      console.log('🔍 Image Display Debug - currentContent.content_images:', currentContent?.content_images);
                      
                      if (hasEditContent) {
                        // Choose correct image based on purchase status
                        const editImageUrl = isPurchased 
                          ? (serverEditContent?.newImageUrl || completedEdit?.newImageUrl)           // Post-purchase: unwatermarked
                          : (serverEditContent?.newWatermarkImageUrl || completedEdit?.newWatermarkImageUrl || 
                             serverEditContent?.newImageUrl || completedEdit?.newImageUrl);          // Pre-purchase: watermarked (fallback to unwatermarked)
                        console.log('🔍 Image Display Debug - editImageUrl found:', editImageUrl);
                        console.log('🔍 Image Display Debug - isPurchased:', isPurchased, 'choosing:', isPurchased ? 'newImageUrl' : 'newWatermarkImageUrl');
                        
                        if (editImageUrl) {
                          displayImage = editImageUrl;
                          console.log(`🖼️ Using edit image (${isPurchased ? 'unwatermarked' : 'watermarked'}):`, displayImage);
                        } else {
                          // Fallback to original image based on purchase status
                          if (!isPurchased) {
                            displayImage = currentContent?.watermark_image || null;
                            console.log('🖼️ Edit failed, using original watermark image:', displayImage);
                          } else {
                            displayImage = currentContent?.content_images && currentContent.content_images.length > 0 
                              ? currentContent.content_images[0] 
                              : extractedImageUrl;
                            console.log('🖼️ Edit failed, using original content image:', displayImage);
                          }
                        }
                      } else {
                        // No edit content, show original images based on purchase status
                        if (!isPurchased) {
                          displayImage = currentContent?.watermark_image || null;
                          console.log('🖼️ Using original watermark image:', displayImage);
                        } else {
                          displayImage = currentContent?.content_images && currentContent.content_images.length > 0 
                            ? currentContent.content_images[0] 
                            : extractedImageUrl;
                          console.log('🖼️ Using original content image:', displayImage);
                        }
                      }
                      
                      console.log('🎯 FINAL displayImage value:', displayImage);

                      // Prepare tweets for copy - also process thread items if they contain markdown
                      const processedThreadItems = getDisplayContent().thread ? getDisplayContent().thread.map(tweet => {
                        // Check if thread item contains markdown
                        if (tweet.includes('##') || tweet.includes('**')) {
                          return markdownToPlainText(tweet)
                        }
                        return tweet
                      }) : []

                      const tweetsData = [
                          { 
                              title: 'Tweet 1', 
                              text: tweetText || 'Sample tweet content will appear here...' 
                          },
                          ...(displayImage ? [{ 
                              title: 'Tweet 1 (Image)', 
                              image: displayImage 
                          }] : []),
                          ...(currentContent.is_video && currentContent.watermark_video_url ? [{ 
                              title: 'Tweet 1 (Video)', 
                              video: currentContent.watermark_video_url,
                              videoDuration: currentContent.video_duration
                          }] : []),
                          ...(currentContent.is_video && !currentContent.watermark_video_url && currentContent.video_url ? [{ 
                              title: 'Tweet 1 (Video)', 
                              video: currentContent.video_url,
                              videoDuration: currentContent.video_duration
                          }] : []),
                          ...(processedThreadItems.map((tweet, idx) => ({ 
                              title: `Tweet ${idx + 2}`, 
                              text: tweet 
                          })))
                      ];

                      return tweetsData.map((section, idx) => (
                        <div key={idx} className="bg-[#FFFFFF1A] rounded-md p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-white/90 text-sm">{section.title}</div>
                            <button
                              type="button" 
                              onClick={() => {
                                if (section.text) {
                                  navigator.clipboard?.writeText(section.text);
                                } else if (section.image) {
                                  downloadImage(String(section.image), `tweet-image-${idx + 1}.png`);
                                }
                              }}
                              className="text-[#FD7A10] border border-[#FD7A10] rounded-sm px-2 py-1 text-xs flex flex-row gap-1 items-center cursor-pointer hover:bg-[#FD7A10] hover:text-white transition-colors"
                            >
                              {section.image ? (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7,10 12,15 17,10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                  <span className="text-xs">Download</span>
                                </>
                              ) : (
                                <>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2 2v1"></path>
                                  </svg>
                                  <span className="text-xs">Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                          {section.text && (
                            <div className="text-white/80 text-sm leading-relaxed">
                              {isProcessingEdit && !editError ? (
                                <TextShimmer />
                              ) : forceMarkdown ? (
                                <div 
                                  className="markdown-content max-w-none"
                                  dangerouslySetInnerHTML={{ 
                                    __html: markdownToHTML(section.text)
                                  }}
                                />
                              ) : (
                                section.text
                              )}
                            </div>
                          )}
                          {section.image && (
                            <div className="mt-3 rounded-md overflow-hidden">
                              {isProcessingEdit && !editError ? (
                                <div className="w-[50%]">
                                  <ImageShimmer />
                                </div>
                              ) : (
                              <img src={String(section.image)} alt="Tweet image" className="w-[50%] h-auto object-cover" />
                              )}
                            </div>
                          )}
                          {section.video && (
                            <div className="mt-3 rounded-md overflow-hidden">
                              <VideoPlayer
                                src={section.video}
                                autoPlay={true}
                                muted={true}
                                controls={true}
                                className="w-[50%] h-auto"
                              />
                              {section.videoDuration && (
                                <div className="mt-2 text-xs text-white/60">
                                  Duration: {section.videoDuration}s
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ));
                    })()
                  )}
                </div>
              </div>
            ) : (
              /* Purchase Success State */
              <div className="flex flex-col items-center justify-center text-center h-full gap-6">
                <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-white text-xl font-bold mb-2">Purchase Successful!</h3>
                  <p className="text-white/60">Your content is now ready to tweet</p>
                </div>
                <button 
                  onClick={() => setShowTweetManagement(true)}
                  className="w-full bg-[#FD7A10] glow-orange-button text-white font-semibold py-4 rounded-sm text-lg"
                >
                  Tweet Now
              </button>
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Copy Protection Modal */}
      {showCopyProtection && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-75">
          <div className="bg-white rounded-lg p-8 max-w-md mx-4 text-center">
            <div className="h-16 w-16 text-red-500 mx-auto mb-4">
              <svg className="w-full h-full" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-4">Content Protected</h3>
            <p className="text-gray-600 mb-6">
              This content is proprietary and protected. Copying, screenshots, and screen recording are prohibited. 
              You can only access this content after purchasing it.
            </p>
            <button
              onClick={() => setShowCopyProtection(false)}
              className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              I Understand
            </button>
          </div>
        </div>
      )}

      {/* Wallet Connection Modal - Removed, using AppKit instead */}
    </div>
  )
} 
