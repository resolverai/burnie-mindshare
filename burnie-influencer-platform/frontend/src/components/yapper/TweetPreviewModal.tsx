"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useAccount } from 'wagmi';
import { useTwitter } from '../../contexts/TwitterContext';
import { useTwitterPosting } from '../../hooks/useTwitterPosting';
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo, markdownToPlainText, markdownToHTML } from '../../utils/markdownParser';
import useMixpanel from '../../hooks/useMixpanel';
import { EditText, ThreadItemEditor } from './EditComponents';
import useTextEditing from '../../hooks/useTextEditing';

interface TweetPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    contentData?: {
        id: number;
        content_text: string;
        tweet_thread?: string[];
        content_images: string[];
        predicted_mindshare: number;
        quality_score: number;
        asking_price: number;
        post_type?: string;
        creator: {
            username: string;
            reputation_score: number;
        };
        campaign: {
            title: string;
            platform_source: string;
            reward_token: string;
        };
        agent_name?: string;
        created_at: string;
        approved_at?: string;
        purchased_at?: string;
        winning_bid?: {
            amount: number;
            currency: string;
            bid_date: string;
        };
        payment_details: {
            payment_currency: string;
            conversion_rate: number;
            original_roast_price: number;
            miner_payout_roast: number;
        };
        transaction_hash?: string;
        treasury_transaction_hash?: string;
        acquisition_type: 'bid' | 'purchase';
        // Text-only regeneration support
        isAvailable?: boolean;
        imagePrompt?: string;
        updatedTweet?: string;
        updatedThread?: string[];
    } | null;
    startPurchased?: boolean;
}

const TweetPreviewModal = ({ isOpen, onClose, contentData, startPurchased = true }: TweetPreviewModalProps) => {
    const { address } = useAccount();
    const { twitter, isTwitterReady, connect, disconnect } = useTwitter();
    const { status: twitterPostingStatus, refresh: refreshTwitterStatus } = useTwitterPosting();
    const mixpanel = useMixpanel();
    const [selectedVoiceTone, setSelectedVoiceTone] = useState("auto");
    const [selectedTone, setSelectedTone] = useState("Select tone");
    const [toneOpen, setToneOpen] = useState<boolean>(false);
    const [isPurchased, setIsPurchased] = useState<boolean>(startPurchased ?? true);

    // Text editing state
    const [isEditingMainTweet, setIsEditingMainTweet] = useState(false);
    const [isEditingThread, setIsEditingThread] = useState(false);
    const [editedMainTweet, setEditedMainTweet] = useState('');
    const [editedThread, setEditedThread] = useState<string[]>([]);
    const [isUpdatingPost, setIsUpdatingPost] = useState(false);

    // Text editing hook
    const { saveTextChanges, isSaving, getCharacterLimit, canEditThread } = useTextEditing({
        contentId: contentData?.id || 0,
        postType: contentData?.post_type || 'thread',
        onSuccess: (updatedContent) => {
            console.log('✅ Text updated successfully in TweetPreviewModal:', updatedContent);
            // Update local content state if needed
        },
        onError: (error) => {
            console.error('❌ Error updating text in TweetPreviewModal:', error);
        }
    });

    // Reset editing state when content changes
    useEffect(() => {
        if (contentData) {
            console.log('🔄 TweetPreviewModal: Resetting all state for new content:', contentData.id);
            
            // Reset all editing states when new content is loaded
            setIsEditingMainTweet(false);
            setIsEditingThread(false);
            setEditedMainTweet('');
            setEditedThread([]);
            
            // Reset Twitter posting states
            setIsPostingToTwitter(false);
            setTwitterPostingResult(null);
            
            console.log('✅ TweetPreviewModal: All state reset for content:', contentData.id);
        }
    }, [contentData?.id]); // Reset when content ID changes

    // Track tweet preview opened when modal opens
    useEffect(() => {
        if (isOpen && contentData) {
            mixpanel.tweetPreviewOpened({
                contentId: contentData.id,
                contentType: contentData.post_type === 'visual' ? 'visual' : 'text',
                previewSource: 'myContent', // This would need to be passed as prop
                contentPrice: contentData.asking_price,
                acquisitionType: contentData.acquisition_type,
                currency: contentData.payment_details?.payment_currency === 'USDC' ? 'USDC' : 'ROAST',
                screenName: 'TweetPreviewModal'
            });
        }
    }, [isOpen, contentData, mixpanel]);

    // Reset state when modal is closed
    useEffect(() => {
        if (!isOpen) {
            // Reset all editing states when modal is closed
            setIsEditingMainTweet(false);
            setIsEditingThread(false);
            setEditedMainTweet('');
            setEditedThread([]);
        }
    }, [isOpen]);

    // Twitter posting state
    const [postingMethod, setPostingMethod] = useState<'twitter' | 'manual'>('twitter');
    const [isPostingToTwitter, setIsPostingToTwitter] = useState(false);
    const [twitterPostingResult, setTwitterPostingResult] = useState<{
        success: boolean;
        message: string;
        tweetUrl?: string;
    } | null>(null);

    // Helper functions
    const getDisplayName = () => {
        return twitter.profile?.displayName || twitter.profile?.username || contentData?.creator?.username || 'Yapper';
    };

    const getTwitterHandle = () => {
        return twitter.profile?.username || contentData?.creator?.username?.toLowerCase() || 'yapper';
    };

    // Local text editing handlers (no API calls)
    const handleMainTweetLocalEdit = (newText: string) => {
        setEditedMainTweet(newText);
        console.log('📝 TweetPreviewModal: Main tweet edited locally:', newText.substring(0, 50) + '...');
    };

    const handleThreadLocalEdit = (newThread: string[]) => {
        setEditedThread(newThread);
        console.log('📝 TweetPreviewModal: Thread edited locally:', newThread.length, 'items');
    };

    // Final save to API when "Update Post" is pressed
    const handleUpdatePost = async () => {
        if (isUpdatingPost) return; // Prevent multiple clicks
        
        try {
            setIsUpdatingPost(true);
            console.log('💾 TweetPreviewModal: Updating post with final changes...');
            
            // Get current display content to ensure we have the latest values
            const currentDisplayContent = getDisplayContent();
            const finalMainTweet = editedMainTweet || currentDisplayContent.text;
            const finalThread = editedThread.length > 0 ? editedThread : currentDisplayContent.thread;
            
            await saveTextChanges(finalMainTweet, finalThread.length > 0 ? finalThread : undefined);
            
            // Reset editing states
            setIsEditingMainTweet(false);
            setIsEditingThread(false);
            
            console.log('✅ TweetPreviewModal: Post updated successfully');
        } catch (error) {
            console.error('❌ TweetPreviewModal: Error updating post:', error);
        } finally {
            setIsUpdatingPost(false);
        }
    };

    // Legacy handlers for backward compatibility
    const handleMainTweetEdit = async (newText: string) => {
        try {
            await saveTextChanges(newText, editedThread.length > 0 ? editedThread : undefined);
            setEditedMainTweet(newText);
            setIsEditingMainTweet(false);
        } catch (error) {
            console.error('Error saving main tweet:', error);
        }
    };

    const handleThreadEdit = async (newThread: string[]) => {
        try {
            await saveTextChanges(editedMainTweet || getTweetText(), newThread);
            setEditedThread(newThread);
            setIsEditingThread(false);
        } catch (error) {
            console.error('Error saving thread:', error);
        }
    };

    const handleStartMainTweetEdit = () => {
        if (contentData) {
            setEditedMainTweet(getTweetText());
            setIsEditingMainTweet(true);
        }
    };

    const handleStartThreadEdit = () => {
        if (contentData) {
            setEditedThread(getTweetThread());
            setIsEditingThread(true);
        }
    };

    // Check if there are any local changes that need to be saved
    const hasLocalChanges = () => {
        if (!contentData) return false;
        
        const currentText = getTweetText();
        const currentThread = getTweetThread();
        
        return editedMainTweet !== currentText || 
               JSON.stringify(editedThread) !== JSON.stringify(currentThread);
    };

    // Helper function to get current tweet text (prioritizes edited content)
    const getTweetText = () => {
        if (!contentData) return '';
        
        // PRIORITY 1: If we have local edits, show them
        if (editedMainTweet) {
            return editedMainTweet;
        }
        
        // PRIORITY 2: If we have updated content, show it
        if (contentData.updatedTweet) {
            return contentData.updatedTweet;
        }
        
        // PRIORITY 3: Fallback to original content
        return contentData.content_text || '';
    };

    // Helper function to get current thread (prioritizes edited content)
    const getTweetThread = () => {
        if (!contentData) return [];
        
        // PRIORITY 1: If we have local edits, show them
        if (editedThread.length > 0) {
            return editedThread;
        }
        
        // PRIORITY 2: If we have updated content, show it
        if (contentData.updatedThread) {
            return contentData.updatedThread;
        }
        
        // PRIORITY 3: Fallback to original content
        return contentData.tweet_thread || [];
    };

    const getInitialLetter = () => {
        const name = getDisplayName();
        return name.charAt(0).toUpperCase();
    };

    // Content priority helper function (prioritizes edited content)
    const getDisplayContent = () => {
        if (!contentData) return { text: '', thread: [] };
        
        // PRIORITY 1: If we have local edits, show them
        if (editedMainTweet || editedThread.length > 0) {
            return {
                text: editedMainTweet || contentData.updatedTweet || contentData.content_text,
                thread: editedThread.length > 0 ? editedThread : (contentData.updatedThread || contentData.tweet_thread || [])
            };
        }
        
        // PRIORITY 2: If we have updated content, show it
        if (contentData.updatedTweet || contentData.updatedThread) {
            return {
                text: contentData.updatedTweet || contentData.content_text,
                thread: contentData.updatedThread || contentData.tweet_thread || []
            };
        }
        
        // PRIORITY 3: Fallback to original content
        return {
            text: contentData.content_text,
            thread: contentData.tweet_thread || []
        };
    };

    // Content parsing functions
    const extractImageUrl = (contentText: string): string | null => {
        const prefixMatch = contentText.match(/📸 Image URL:\s*(https?:\/\/[^\s\n<>"'`]+)/i);
        if (prefixMatch) {
            return prefixMatch[1].replace(/[.,;'"]+$/, '');
        }
        
        const dalleMatch = contentText.match(/(https?:\/\/oaidalleapiprodscus\.blob\.core\.windows\.net\/[^\s\n<>"'`]+)/i);
        if (dalleMatch) {
            return dalleMatch[1].replace(/[.,;'"]+$/, '');
        }
        
        const blobMatch = contentText.match(/(https?:\/\/[^\s\n<>"'`]*blob\.core\.windows\.net[^\s\n<>"'`]+)/i);
        if (blobMatch) {
            return blobMatch[1].replace(/[.,;'"]+$/, '');
        }
        
        return null;
    };

    const formatTwitterContent = (contentText: string): { text: string; hashtags: string[]; characterCount: number; imageUrl: string | null } => {
        const imageUrl = extractImageUrl(contentText);
        
        let cleanText = contentText;
        
        cleanText = cleanText.replace(/📸 Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '');
        cleanText = cleanText.replace(/Image URL:\s*https?:\/\/[^\s\n<>"'`]+/gi, '');
        cleanText = cleanText.replace(/https?:\/\/burnie-mindshare-content[^\s\n<>"'`]+/gi, '');
        cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*amazonaws[^\s\n<>"'`]+/gi, '');
        cleanText = cleanText.replace(/https?:\/\/[^\s\n<>"'`]*s3[^\s\n<>"'`]+/gi, '');
        
        const lines = cleanText.split('\n');
        let twitterText = "";
        
        for (const line of lines) {
            if (line.includes('📊 Content Stats') || 
                line.includes('🖼️ [Image will be attached') ||
                line.includes('💡 To post:') ||
                line.includes('AWSAccessKeyId=') ||
                line.includes('Signature=') ||
                line.includes('Expires=')) {
                break;
            }
            
            const trimmedLine = line.trim();
            if (trimmedLine && 
                !trimmedLine.startsWith('http') && 
                !trimmedLine.includes('AWSAccessKeyId') &&
                !trimmedLine.includes('Signature=') &&
                !trimmedLine.includes('Expires=')) {
                twitterText += line + "\n";
            }
        }
        
        const finalText = twitterText.trim();
        const hashtags = finalText.match(/#\w+/g) || [];
        
        return {
            text: finalText,
            hashtags,
            characterCount: finalText.length,
            imageUrl
        };
    };

    // Ensure the modal opens in purchased state for My Content
    useEffect(() => {
        if (isOpen) {
            setIsPurchased(true);
            
            // Debug: Log content data when modal opens
            if (contentData) {
                console.log('🔍 TweetPreviewModal opened with content:', {
                    id: contentData.id,
                    hasUpdatedTweet: !!contentData.updatedTweet,
                    hasUpdatedThread: !!contentData.updatedThread,
                    originalText: contentData.content_text?.substring(0, 50) + '...',
                    updatedText: contentData.updatedTweet?.substring(0, 50) + '...',
                    displayContent: getDisplayContent(),
                    isAvailable: contentData.isAvailable
                });
            }
        }
    }, [isOpen, contentData]);

    // Helper function to detect mobile devices
    const isMobileDevice = () => {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
               window.innerWidth <= 768
    }

    // Download image function
    const downloadImage = async (imageUrl: string, filename: string = 'tweet-image.png') => {
        try {
            let downloadUrl = imageUrl;
            
            if (imageUrl.includes('s3.amazonaws.com') || imageUrl.includes('amazonaws.com')) {
                try {
                    const urlParts = imageUrl.split('amazonaws.com/')[1];
                    if (urlParts) {
                        const s3Key = urlParts.split('?')[0];
                        downloadUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/campaigns/download-image/${s3Key}`;
                    }
                } catch (e) {
                    console.log('Using original URL for download');
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
            const response = await fetch(downloadUrl);
            
            if (!response.ok) {
                throw new Error(`Download failed: ${response.status}`);
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
            console.log('✅ Desktop image download initiated');
        } catch (error) {
            console.error('❌ Failed to download image:', error);
            console.log('🔄 Falling back to opening image in new tab')
            window.open(imageUrl, '_blank');
        }
    };

    // Twitter posting function
    const handlePostToTwitter = async () => {
        if (!contentData) return;
        
        if (!address) {
            setTwitterPostingResult({
                success: false,
                message: 'Please connect your wallet first to post to Twitter.'
            });
            return;
        }
        
        try {
            setIsPostingToTwitter(true);
            setTwitterPostingResult(null);
            
            // Get display content based on priority
            const displayContent = getDisplayContent();
            
            // For longpost content, convert markdown to plain text for Twitter
            let tweetText = displayContent.text;
            if (isMarkdownContent(contentData.post_type) || 
                displayContent.text?.includes('##') || 
                displayContent.text?.includes('**')) {
                tweetText = markdownToPlainText(displayContent.text);
            }
            
            // Prepare the payload - match backend expected format
            // Process thread items for markdown if needed
            const processedThread = displayContent.thread ? displayContent.thread.map(tweet => {
                // Check if thread item contains markdown
                if (tweet.includes('##') || tweet.includes('**')) {
                    return markdownToPlainText(tweet);
                }
                return tweet;
            }) : [];

            const payload = {
                mainTweet: tweetText,
                thread: processedThread,
                imageUrl: displayImage
            };
            
            // Call the backend to post to Twitter
            const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/api/twitter/post-thread`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${address}` // Use wallet address as identifier
                },
                body: JSON.stringify(payload),
            });
            
            console.log('🔍 Posting with wallet address:', address);
            
            const result = await response.json();
            
            if (result.success) {
                setTwitterPostingResult({
                    success: true,
                    message: 'Thread posted successfully!',
                    tweetUrl: `https://twitter.com/i/web/status/${result.mainTweetId}`
                });
                
                // Track successful tweet posting
                console.log('🎯 Tracking tweetPosted event:', {
                    contentId: contentData?.id || 0,
                    contentType: contentData?.post_type === 'visual' ? 'visual' : 'text',
                    tweetUrl: `https://twitter.com/i/web/status/${result.mainTweetId}`,
                    postTime: Date.now(),
                    tweetLength: tweetText.length,
                    hasImage: !!displayImage,
                    hasThread: processedThread.length > 0,
                    screenName: 'TweetPreviewModal'
                });
                
                mixpanel.tweetPosted({
                    contentId: contentData?.id || 0,
                    contentType: contentData?.post_type === 'visual' ? 'visual' : 'text',
                    tweetUrl: `https://twitter.com/i/web/status/${result.mainTweetId}`,
                    postTime: Date.now(),
                    tweetLength: tweetText.length,
                    hasImage: !!displayImage,
                    hasThread: processedThread.length > 0,
                    screenName: 'TweetPreviewModal'
                });
                
                refreshTwitterStatus();
            } else {
                throw new Error(result.error || 'Failed to post to Twitter');
            }
        } catch (error) {
            console.error('Error posting to Twitter:', error);
            
            // Track failed tweet posting
            console.log('🎯 Tracking tweetPostFailed event:', {
                contentId: contentData?.id || 0,
                failureReason: 'api_error',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                retryAttempted: false,
                screenName: 'TweetPreviewModal'
            });
            
            mixpanel.tweetPostFailed({
                contentId: contentData?.id || 0,
                failureReason: 'api_error',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                retryAttempted: false,
                screenName: 'TweetPreviewModal'
            });
            
            setTwitterPostingResult({
                success: false,
                message: 'Failed to post to Twitter. Please try again or use manual posting.'
            });
        } finally {
            setIsPostingToTwitter(false);
        }
    };

    // Twitter authentication function
    const handleTwitterAuth = async () => {
        if (!address) {
            setTwitterPostingResult({
                success: false,
                message: 'Please connect your wallet first to authenticate with Twitter.'
            });
            return;
        }

        // Track Twitter connect clicked
        if (contentData) {
            mixpanel.twitterConnectClicked({
                contentId: contentData.id,
                connectSource: 'tweetPreviewModal',
                screenName: 'TweetPreviewModal'
            });
        }

        try {
            if (connect) {
                await connect();
                
                // Track successful Twitter connection
                if (twitter.profile?.username) {
                    mixpanel.twitterConnected({
                        twitterUsername: twitter.profile.username,
                        connectTime: Date.now(),
                        connectSource: 'tweetPreviewModal',
                        screenName: 'TweetPreviewModal'
                    });
                }
                
                // Refresh Twitter posting status after successful auth
                setTimeout(() => {
                    refreshTwitterStatus();
                }, 1000);
            }
        } catch (error) {
            console.error('Error connecting to Twitter:', error);
        }
    };

    const toneOptions = [
        "Select tone",
        "Tone A",
        "Tone B", 
        "Tone C",
        "Tone D",
        "Tone E",
        "Tone F",
    ];

    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    // Parse content for display
    const displayContent = getDisplayContent();
    const { text: tweetText, imageUrl: extractedImageUrl } = contentData ? formatTwitterContent(displayContent.text) : { text: '', imageUrl: null };
    const displayImage = contentData?.content_images && contentData.content_images.length > 0 
        ? contentData.content_images[0] 
        : extractedImageUrl;

    // Prepare tweets for copy
    const tweetsData = [
        { 
            title: 'Tweet 1', 
            text: tweetText || 'Sample tweet content will appear here...' 
        },
        ...(displayImage ? [{ 
            title: 'Tweet 1 (Image)', 
            image: displayImage 
        }] : []),
        ...(displayContent.thread ? displayContent.thread.map((tweet, idx) => ({ 
            title: `Tweet ${idx + 2}`, 
            text: tweet 
        })) : [])
    ];

    return (
        <div
            className="fixed top-0 left-0 w-full h-full bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto touch-pan-y"
            onClick={handleBackdropClick}
            style={{ height: '100vh', minHeight: '100vh' }}
        >
            <div 
                key={`tweet-preview-modal-${contentData?.id || 'no-content'}`}
                className="relative w-full max-w-[95vw] lg:max-w-6xl rounded-2xl bg-[#492222] max-h-[100vh] overflow-y-auto lg:overflow-hidden shadow-2xl p-4 lg:p-6 overscroll-contain"
            >
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 z-50 hover:opacity-80 transition-opacity text-white/60 hover:text-white"
                    type="button"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" />
                    </svg>
                </button>

                <div className="flex flex-col lg:flex-row max-h-[90vh] gap-4 overflow-y-auto lg:overflow-hidden">
                    {/* Left Side - Tweet Preview */}
                    <div className="flex flex-col w-full lg:w-1/2 p-4 lg:p-8 bg-[#121418] rounded-2xl">
                        <h2 className="text-white/80 text-base lg:text-lg font-medium mb-4 lg:mb-6">Tweet preview</h2>

                        {/* Twitter Thread Container */}
                        <div className="w-full flex-1 overflow-y-auto pr-1 lg:pr-2 rounded-2xl">
                            <style jsx>{`
                                    div::-webkit-scrollbar {
                                        width: 6px;
                                    }
                                    div::-webkit-scrollbar-track {
                                        background: transparent;
                                    }
                                    div::-webkit-scrollbar-thumb {
                                        background-color: #374151;
                                        border-radius: 3px;
                                    }
                                    div::-webkit-scrollbar-thumb:hover {
                                        background-color: #4B5563;
                                    }
                            `}</style>

                            {/* Single Tweet Container with Thread Structure */}
                            <div className="relative">
                                {/* Continuous Thread Line */}
                                {displayContent.thread && displayContent.thread.length > 0 && (
                                    <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-gray-600 z-0"></div>
                                )}

                                {/* Main Tweet */}
                                <div className="relative pb-3">
                                    <div className="flex gap-3 pr-2">
                                        <div className="relative flex-shrink-0">
                                            <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                                                {twitter.profile?.profileImage ? (
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
                                                <span className={`text-white font-bold text-sm ${twitter.profile?.profileImage ? 'hidden' : ''}`}>
                                                    {getInitialLetter()}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-white font-bold text-xs lg:text-sm">
                                                    {getDisplayName()}
                                                </span>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DA1F2">
                                                    <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                                                </svg>
                                                <span className="text-gray-500 text-xs lg:text-sm">@{getTwitterHandle()}</span>
                                            </div>

                                            <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                                                <EditText
                                                    text={tweetText}
                                                    onSave={canEditThread() ? handleMainTweetLocalEdit : handleMainTweetEdit}
                                                    onCancel={() => setIsEditingMainTweet(false)}
                                                    maxLength={getCharacterLimit()}
                                                    placeholder="Enter tweet content..."
                                                    isEditing={isEditingMainTweet}
                                                    onStartEdit={handleStartMainTweetEdit}
                                                    editType="main_tweet"
                                                    contentId={contentData?.id || 0}
                                                    postType={contentData?.post_type || 'thread'}
                                                    localSaveOnly={canEditThread()}
                                                    onLocalSave={canEditThread() ? handleMainTweetLocalEdit : undefined}
                                                />
                                            </div>

                                            {/* Tweet Image */}
                                            {displayImage && (
                                                <div className="rounded-2xl overflow-hidden mb-3 border border-gray-700">
                                                    <Image
                                                        src={displayImage}
                                                        alt="Tweet content"
                                                        width={500}
                                                        height={300}
                                                        className="w-full h-auto object-cover"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Thread Tweets */}
                                {displayContent.thread && displayContent.thread.map((tweet, idx) => (
                                    <div key={idx} className="relative pb-3">
                                        <div className="flex gap-3 pr-2">
                                            <div className="relative flex-shrink-0">
                                                <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-orange-500 flex items-center justify-center relative z-10 overflow-hidden">
                                                    {twitter.profile?.profileImage ? (
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
                                                    <span className={`text-white font-bold text-sm ${twitter.profile?.profileImage ? 'hidden' : ''}`}>
                                                        {getInitialLetter()}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-white text-xs lg:text-sm leading-relaxed mb-3 pr-2">
                                                    <div className="flex items-start gap-2">
                                                        <div className="flex-1">
                                                            <EditText
                                                                text={tweet}
                                                                onSave={(newText) => {
                                                                    const updatedThread = [...getTweetThread()];
                                                                    updatedThread[idx] = newText;
                                                                    handleThreadLocalEdit(updatedThread);
                                                                }}
                                                                onCancel={() => {
                                                                    // If this is a newly added empty item, remove it from the thread
                                                                    if (tweet === '') {
                                                                        const updatedThread = getTweetThread().filter((_, i) => i !== idx);
                                                                        handleThreadLocalEdit(updatedThread);
                                                                    }
                                                                    setIsEditingThread(false);
                                                                }}
                                                                maxLength={280}
                                                                placeholder="Enter thread item..."
                                                                isEditing={isEditingThread}
                                                                onStartEdit={() => {
                                                                    setEditedThread(getTweetThread());
                                                                    setIsEditingThread(true);
                                                                }}
                                                                editType="thread_item"
                                                                contentId={contentData?.id || 0}
                                                                postType={contentData?.post_type || 'thread'}
                                                                localSaveOnly={true}
                                                                onLocalSave={(newText) => {
                                                                    const updatedThread = [...getTweetThread()];
                                                                    updatedThread[idx] = newText;
                                                                    handleThreadLocalEdit(updatedThread);
                                                                }}
                                                            />
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                const updatedThread = getTweetThread().filter((_, i) => i !== idx);
                                                                handleThreadLocalEdit(updatedThread);
                                                            }}
                                                            className="p-1 text-red-400 hover:text-red-300 transition-colors"
                                                            aria-label="Delete thread item"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                {/* Thread Management Buttons - Only show for threads */}
                                {canEditThread() && getTweetThread().length > 0 && (
                                    <div className="mt-4 flex justify-center gap-3">
                                        <button
                                            onClick={() => {
                                                const updatedThread = [...getTweetThread(), ''];
                                                handleThreadLocalEdit(updatedThread);
                                                setIsEditingThread(true);
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
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Side - Content Management */}
                    <div className="flex flex-col w-full lg:w-1/2 p-4 lg:p-8">

                        {/* Content Owned Status */}
                        <div className="bg-[#331C1E] rounded-md px-4 py-3 flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                                    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="text-white font-bold">Content Owned</div>
                                    <div className="text-white text-xs">
                                    {contentData?.acquisition_type === 'purchase' ? (
                                        <>
                                            Purchased • {Math.round(Number(contentData?.asking_price || 0))} ROAST
                                        </>
                                    ) : (
                                        <>
                                            Won • {Math.round(Number(contentData?.winning_bid?.amount || 0))} {contentData?.winning_bid?.currency || 'ROAST'}
                                        </>
                                    )}
                                    </div>
                                </div>
                            </div>

                        {/* How to thread - Only show for manual posting */}
                        {postingMethod === 'manual' && (
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

                        {/* Posting Method Selection */}
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="relative">
                                <input
                                    type="radio"
                                    id="post-twitter"
                                    name="posting-method"
                                    value="twitter"
                                    checked={postingMethod === 'twitter'}
                                    onChange={(e) => {
                                        const newMethod = e.target.value as 'twitter' | 'manual'
                                        setPostingMethod(newMethod)
                                        
                                        // Track posting method toggle
                                        if (contentData) {
                                            console.log('🎯 Tracking postingMethodToggled event (twitter):', {
                                                contentId: contentData.id,
                                                selectedMethod: newMethod,
                                                previousMethod: postingMethod,
                                                screenName: 'TweetPreviewModal'
                                            });
                                            
                                            mixpanel.postingMethodToggled({
                                                contentId: contentData.id,
                                                selectedMethod: newMethod,
                                                previousMethod: postingMethod,
                                                screenName: 'TweetPreviewModal'
                                            })
                                        }
                                    }}
                                    className="sr-only"
                                />
                                <label htmlFor="post-twitter" className="flex items-center gap-2 cursor-pointer">
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
                                    id="post-manual"
                                    name="posting-method"
                                    value="manual"
                                    checked={postingMethod === 'manual'}
                                    onChange={(e) => {
                                        const newMethod = e.target.value as 'twitter' | 'manual'
                                        setPostingMethod(newMethod)
                                        
                                        // Track posting method toggle
                                        if (contentData) {
                                            console.log('🎯 Tracking postingMethodToggled event (manual):', {
                                                contentId: contentData.id,
                                                selectedMethod: newMethod,
                                                previousMethod: postingMethod,
                                                screenName: 'TweetPreviewModal'
                                            });
                                            
                                            mixpanel.postingMethodToggled({
                                                contentId: contentData.id,
                                                selectedMethod: newMethod,
                                                previousMethod: postingMethod,
                                                screenName: 'TweetPreviewModal'
                                            })
                                        }
                                    }}
                                    className="sr-only"
                                />
                                <label htmlFor="post-manual" className="flex items-center gap-2 cursor-pointer">
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

                        {/* Content Area - Twitter Posting or Manual */}
                        <div className="flex-1 overflow-y-auto space-y-4">
                            {twitterPostingResult?.success ? (
                                /* Tweet Success State */
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
                                <div>
                            {/* Tweets List */}
                            {tweetsData.map((section, idx) => (
                                        <div key={idx} className="bg-[#FFFFFF1A] rounded-md p-4 mb-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-white/90 text-sm">{section.title}</div>
                                        <button
                                            type="button" 
                                            onClick={() => {
                                                if (section.text) {
                                                    navigator.clipboard?.writeText(section.text);
                                                    
                                                    // Track tweet content copied
                                                    if (contentData) {
                                                        mixpanel.tweetContentCopied({
                                                            contentId: contentData.id,
                                                            contentType: contentData.post_type === 'visual' ? 'visual' : 'text',
                                                            copyFormat: 'text_only',
                                                            screenName: 'TweetPreviewModal'
                                                        });
                                                    }
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
                                                    <Image src="/copy.svg" alt="Copy" width={16} height={16} />
                                                    <span className="text-xs">Copy</span>
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    {section.text && (
                                                <div className="text-white/80 text-sm leading-relaxed">
                                                    {isMarkdownContent(contentData?.post_type) || contentData?.content_text?.includes('##') || contentData?.content_text?.includes('**') ? (
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
                            ))}
                                </div>
                            )}
                        </div>

                        {/* Blockchain Transaction - Always at bottom */}
                            {contentData?.transaction_hash && !contentData.transaction_hash.startsWith('FREE_CONTENT_') && (
                            <div className="bg-[#331C1E] rounded-md px-4 py-3 flex items-center justify-between mt-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                                            <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M3 3h18v18H3zM9 9h6v6H9z" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="text-white font-medium text-sm">Base Transaction</div>
                                            <div className="text-white/60 text-xs font-mono">
                                                {contentData.transaction_hash.slice(0, 10)}...{contentData.transaction_hash.slice(-8)}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            window.open(`https://basescan.org/tx/${contentData.transaction_hash}`, '_blank', 'noopener,noreferrer');
                                        }}
                                        className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/20 hover:bg-blue-500/30 transition-colors"
                                        title="View on BaseScan"
                                    >
                                        <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="11" cy="11" r="8"/>
                                            <path d="m21 21-4.35-4.35"/>
                                        </svg>
                                    </button>
                                </div>
                            )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TweetPreviewModal;
