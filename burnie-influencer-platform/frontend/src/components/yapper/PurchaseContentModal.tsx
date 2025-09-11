'use client'

import React, { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { appKit } from '@/app/reown'
import Image from 'next/image'
import { generateRandomMindshare, formatMindshare } from '../../utils/mindshareUtils'

import { useROASTPrice, formatUSDCPrice } from '../../utils/priceUtils'
import { transferROAST, checkROASTBalance, transferUSDC, checkUSDCBalance } from '../../utils/walletUtils'
import { executeROASTPayment } from '../../services/roastPaymentService'
import TweetThreadDisplay from '../TweetThreadDisplay'
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo, markdownToPlainText, markdownToHTML } from '../../utils/markdownParser'

import { useTwitter } from '../../contexts/TwitterContext'
import { useMarketplaceAccess } from '../../hooks/useMarketplaceAccess'
import { useAuth } from '../../hooks/useAuth'
import { useTwitterPosting } from '../../hooks/useTwitterPosting'
import { useRouter } from 'next/navigation'

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

  // Cleanup effect to ensure scroll is restored on unmount
  React.useEffect(() => {
    return () => {
      // Force restore scroll when component unmounts
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    };
  }, []);
  
  const { address } = useAccount()
  const { price: roastPrice } = useROASTPrice()
  const { twitter, connect, disconnect, refreshToken, isTwitterReady } = useTwitter()
  const { hasAccess } = useMarketplaceAccess()
  const { isAuthenticated, signIn } = useAuth()
  const { status: twitterPostingStatus, refresh: refreshTwitterStatus } = useTwitterPosting()
  const router = useRouter()
  
  // Helper function to get the current content to display
  // Prioritizes content with updated text over original content
  const getCurrentContent = (): ContentItem | null => {
    // First priority: Check if we have content with updated text (text-only regeneration)
    if (localContent && (localContent.updatedTweet || localContent.updatedThread)) {
      return localContent
    }
    
    // Second priority: Check if generated content has updated text (text-only regeneration)
    if (hasGeneratedContent && generatedContent && (generatedContent.updatedTweet || generatedContent.updatedThread)) {
      return generatedContent
    }
    
    // Third priority: Check if we have generated content (full regeneration)
    if (hasGeneratedContent && generatedContent) {
      return generatedContent
    }
    
    // Fourth priority: Use local content (which should be the most current)
    return localContent
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
    
    // SIMPLIFIED LOGIC: If we have updated content, always show it
    if (currentContent.updatedTweet || currentContent.updatedThread) {
      const result = {
        text: currentContent.updatedTweet || currentContent.content_text,
        thread: currentContent.updatedThread || currentContent.tweet_thread || []
      };
      console.log('🔍 UPDATED CONTENT DISPLAYED:', {
        text: result.text?.substring(0, 100) + '...',
        threadLength: result.thread?.length || 0,
        threadData: result.thread,
        hasUpdatedTweet: !!currentContent.updatedTweet,
        hasUpdatedThread: !!currentContent.updatedThread
      });
      return result;
    }
    
    // Otherwise show original content
    const result = {
      text: currentContent.content_text,
      thread: currentContent.tweet_thread || []
    };
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
      
      // If text-only mode is requested, check if it's enabled on the backend
      let actualTextOnly = textOnly;
      if (textOnly) {
        try {
          const modeResponse = await fetch('/api/text-only-regeneration/mode-status');
          if (modeResponse.ok) {
            const modeData = await modeResponse.json();
            if (!modeData.textOnlyModeEnabled) {
              console.log('🔄 Text-only mode disabled on backend, falling back to full regeneration');
              actualTextOnly = false;
              setIsTextOnlyGeneration(false);
              setGenerationStatus('Text-only mode disabled, using full regeneration instead...');
            }
          }
        } catch (error) {
          console.warn('⚠️ Could not check text-only mode status, falling back to full regeneration:', error);
          actualTextOnly = false;
          setIsTextOnlyGeneration(false);
        }
      }
      
      // Call TypeScript backend to start content generation
      const endpoint = actualTextOnly ? '/api/text-only-regeneration/regenerate-text' : '/api/yapper-interface/generate-content'
      
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
  
  const [selectedVoiceTone, setSelectedVoiceTone] = useState("auto")
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

  // Clear balance error
  const clearBalanceError = () => {
    setBalanceError(null)
  }

  // Clear balance error when payment method changes
  useEffect(() => {
    clearBalanceError()
  }, [selectedPayment])

  // Clear balance error when modal closes
  useEffect(() => {
    if (!isOpen) {
      clearBalanceError()
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
  const [textOnlyModeEnabled, setTextOnlyModeEnabled] = useState<boolean | null>(null)
  
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
        const modeResponse = await fetch('/api/text-only-regeneration/mode-status');
        if (modeResponse.ok) {
          const modeData = await modeResponse.json();
          setTextOnlyModeEnabled(modeData.textOnlyModeEnabled);
        }
      } catch (error) {
        console.warn('⚠️ Could not check text-only mode status:', error);
        setTextOnlyModeEnabled(false); // Default to full regeneration
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
      setIsPurchased(true)
      setShowTweetManagement(true)
      
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

  // Filter yappers based on search query
  const filteredYappers = allYappers.filter((yapper) => {
    const searchLower = yapperSearchQuery.toLowerCase()
    return (
      yapper.twitter_handle.toLowerCase().includes(searchLower) ||
      yapper.display_name.toLowerCase().includes(searchLower)
    )
  })

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
      
      // Use original image for posting (after purchase), not watermarked
      const displayImage = currentContent.content_images && currentContent.content_images.length > 0 
          ? currentContent.content_images[0] 
          : extractedImageUrl

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
    
    // Calculate USDC equivalent
    const usdcPrice = roastPrice ? (getDisplayPrice(currentContent) * roastPrice) : 0
    const usdcFee = 0.03
    const totalUSDC = usdcPrice + usdcFee

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

    // Only now check content availability and lock it (after confirming sufficient balance)
    const isAvailable = await checkContentAvailability()
    if (!isAvailable) {
      return
    }

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
      // Force scroll restoration before closing
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      onClose();
      // Prevent fund management modals from showing up temporarily
      const { disableModalsTemporarily } = require('../../utils/modalManager');
      disableModalsTemporarily();
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
    
    // Use watermarked image for preview, original for purchased content
    const imageUrl = isPurchased 
      ? (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
      : (currentContent.watermark_image || (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl))
    
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
    
    // Use watermarked image for preview, original for purchased content
    const imageUrl = isPurchased 
      ? (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
      : (currentContent.watermark_image || (currentContent.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl))
    
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
  const usdcFee = '0.030' // Constant 0.03 USDC fee
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
      <div className="relative w-full max-w-none lg:max-w-6xl rounded-none lg:rounded-2xl bg-transparent lg:bg-[#492222] max-h-[100vh] overflow-y-auto lg:overflow-y-hidden shadow-none lg:shadow-2xl p-0 lg:p-6 overscroll-contain touch-pan-y modal-scrollable">
        {/* Close Button */}
            <button
              onClick={() => {
                // Force scroll restoration before closing
                document.body.style.position = '';
                document.body.style.top = '';
                document.body.style.width = '';
                onClose();
                // Prevent fund management modals from showing up temporarily
                const { disableModalsTemporarily } = require('../../utils/modalManager');
                disableModalsTemporarily();
              }}
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
            <h2 className="text-white/80 text-base lg:text-lg font-medium mb-4 lg:mb-6">Tweet preview</h2>

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
                          {isGeneratingContent && !isTextOnlyGeneration ? (
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
                            {isGeneratingContent ? (
                              <TextShimmer />
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
                            {isGeneratingContent ? (
                              <TextShimmer />
                            ) : (
                              <>

                                {formatContentText(contentData.text, contentData.shouldUseMarkdown)}
                              </>
                            )}
                          </div>
                          
                          {/* Tweet Images for regular content */}
                          {isGeneratingContent && !isTextOnlyGeneration ? (
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
                              {isGeneratingContent ? (
                                <ThreadItemShimmer />
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
              </div>

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
                        onClick={() => setSelectedVoiceTone("auto")}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "auto"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        Automated
                      </button>
                      <button
                        onClick={() => setSelectedVoiceTone("custom")}
                        className={`py-2 xs:py-2.5 md:py-3 px-2 xs:px-3 md:px-4 rounded-full text-[10px] xs:text-[8px] sm:text-[12px] md:text-[16px] font-bold transition-all duration-200 text-center ${
                          selectedVoiceTone === "custom"
                            ? "bg-white text-black shadow-lg"
                            : "text-white/80 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        Choose Yapper
                      </button>
                      <button
                        onClick={() => setSelectedVoiceTone("mystyle")}
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
                                onClick={() => setSelectedYapper(yapper.twitter_handle)}
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
                          <div className="flex items-center justify-center py-2.5 xs:py-3 md:py-3">
                            <div className="text-white/60 text-[10px] xs:text-[6px] sm:text-[8px] md:text-[10px] text-center">
                              {yapperSearchQuery ? 'No yappers found matching your search' : 'No yappers available'}
                            </div>
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

                    <div className="grid grid-cols-2 gap-2">
                      <div
                        onClick={() => setSelectedPayment("roast")}
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
                        onClick={() => setSelectedPayment("usdc")}
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
                            {isLoading ? 'Processing...' : 'Buy Tweet'}
                          </button>
                        ) : (
                          // Content not generated yet - show single Generate button based on mode
                          <div className="flex flex-col gap-3">
                            <button
                              onClick={textOnlyModeEnabled ? generateTextOnlyContentFromYapper : generateContentFromYapper}
                              disabled={isGeneratingContent || !address || textOnlyModeEnabled === null}
                              className="w-full bg-[#FD7A10] text-white py-3 px-4 rounded-lg font-semibold text-lg hover:bg-[#FD7A10]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                              {textOnlyModeEnabled === null && (
                                <svg className="animate-spin h-5 w-5 text-white mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              )}
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
                            {isLoading ? 'Processing...' : 'Buy Tweet'}
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

                        {/* Transaction Hash Display */}
                        {purchasedContentDetails?.transactionHash && (
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
                              
                              // Use original image for purchased content (post-purchase), watermarked for preview
                              const displayImage = isPurchased 
                                ? (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
                                : (currentContent?.watermark_image || (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));

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

                    {/* Transaction Hash Display */}
                    {purchasedContentDetails?.transactionHash && (
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
                          
                          // Use original image for purchased content (post-purchase), watermarked for preview
                          const displayImage = isPurchased 
                            ? (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
                            : (currentContent?.watermark_image || (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));

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
                                  onClick={() => setSelectedYapper(yapper.twitter_handle)}
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
                            <div className="flex items-center justify-center py-4">
                              <div className="text-white/60 text-xs text-center">
                                {yapperSearchQuery ? 'No yappers found matching your search' : 'No yappers available'}
                              </div>
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
                          if (textOnlyModeEnabled) {
                            generateTextOnlyContentFromYapper(); // Generate text-only content
                          } else {
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
                    disabled={isLoading || (selectedVoiceTone === "custom" && selectedYapper !== "" && isGeneratingContent) || (selectedVoiceTone === "mystyle" && isGeneratingContent)}
                    className={`w-full font-semibold py-4 rounded-sm text-lg transition-all duration-200 ${
                      isLoading || (selectedVoiceTone === "custom" && selectedYapper !== "" && isGeneratingContent)
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
                    {isLoading || (selectedVoiceTone === "custom" && selectedYapper !== "" && isGeneratingContent) || (selectedVoiceTone === "mystyle" && isGeneratingContent) ? (
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
                      {/* Transaction Hash Display */}
                      {purchasedContentDetails?.transactionHash && (
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
                      
                      // Use original image for purchased content (post-purchase), watermarked for preview
                      const displayImage = isPurchased 
                        ? (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl)
                        : (currentContent?.watermark_image || (currentContent?.content_images && currentContent.content_images.length > 0 ? currentContent.content_images[0] : extractedImageUrl));

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
                            <div className="mt-3 rounded-md overflow-hidden">
                              <img src={String(section.image)} alt="Tweet image" className="w-[50%] h-auto object-cover" />
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
