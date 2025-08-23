"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useAccount } from 'wagmi';
import { useTwitter } from '../../contexts/TwitterContext';
import { useTwitterPosting } from '../../hooks/useTwitterPosting';
import { renderMarkdown, isMarkdownContent, formatPlainText, getPostTypeInfo, markdownToPlainText, markdownToHTML } from '../../utils/markdownParser';

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
    } | null;
    startPurchased?: boolean;
}

const TweetPreviewModal = ({ isOpen, onClose, contentData, startPurchased = true }: TweetPreviewModalProps) => {
    const { address } = useAccount();
    const { twitter, isTwitterReady, connect, disconnect } = useTwitter();
    const { status: twitterPostingStatus, refresh: refreshTwitterStatus } = useTwitterPosting();
    const [selectedVoiceTone, setSelectedVoiceTone] = useState("auto");
    const [selectedTone, setSelectedTone] = useState("Select tone");
    const [toneOpen, setToneOpen] = useState<boolean>(false);
    const [isPurchased, setIsPurchased] = useState<boolean>(startPurchased ?? true);
    
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

    const getInitialLetter = () => {
        const name = getDisplayName();
        return name.charAt(0).toUpperCase();
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
        }
    }, [isOpen]);

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
            console.log('✅ Image download initiated');
        } catch (error) {
            console.error('❌ Failed to download image:', error);
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
            
            // For longpost content, convert markdown to plain text for Twitter
            let tweetText = contentData.content_text;
            if (isMarkdownContent(contentData.post_type) || 
                contentData.content_text?.includes('##') || 
                contentData.content_text?.includes('**')) {
                tweetText = markdownToPlainText(contentData.content_text);
            }
            
            // Prepare the payload - match backend expected format
            // Process thread items for markdown if needed
            const processedThread = contentData.tweet_thread ? contentData.tweet_thread.map(tweet => {
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
                refreshTwitterStatus();
            } else {
                throw new Error(result.error || 'Failed to post to Twitter');
            }
        } catch (error) {
            console.error('Error posting to Twitter:', error);
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

        try {
            if (connect) {
                await connect();
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
    const { text: tweetText, imageUrl: extractedImageUrl } = contentData ? formatTwitterContent(contentData.content_text) : { text: '', imageUrl: null };
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
        ...(contentData?.tweet_thread ? contentData.tweet_thread.map((tweet, idx) => ({ 
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
            <div className="relative w-full max-w-[95vw] lg:max-w-6xl rounded-2xl bg-[#492222] max-h-[100vh] overflow-y-auto lg:overflow-hidden shadow-2xl p-4 lg:p-6 overscroll-contain">
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
                                {contentData?.tweet_thread && contentData.tweet_thread.length > 0 && (
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
                                                {tweetText}
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
                                {contentData?.tweet_thread && contentData.tweet_thread.map((tweet, idx) => (
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
                                                    {tweet}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
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
                                    onChange={(e) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
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
                                    onChange={(e) => setPostingMethod(e.target.value as 'twitter' | 'manual')}
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
                        {contentData?.transaction_hash && (
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
