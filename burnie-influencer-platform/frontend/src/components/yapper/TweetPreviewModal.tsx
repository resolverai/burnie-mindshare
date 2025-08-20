"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { useAccount } from 'wagmi';
import { useTwitter } from '../../contexts/TwitterContext';

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
        winning_bid: {
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
    startPurchased?: boolean; // Always true for My Content - user already owns this
}

const TweetPreviewModal = ({ isOpen, onClose, contentData, startPurchased = true }: TweetPreviewModalProps) => {
    const { address } = useAccount();
    const { twitter, isTwitterReady } = useTwitter();
    const [selectedVoiceTone, setSelectedVoiceTone] = useState("auto");
    const [selectedTone, setSelectedTone] = useState("Select tone");
    const [toneOpen, setToneOpen] = useState<boolean>(false);
    // Twitter state now managed by global context
    const [isPurchased, setIsPurchased] = useState<boolean>(startPurchased ?? true);

    // Helper functions to get display data based on Twitter connection (for yapper/logged-in user)
    const getDisplayName = () => {
        return twitter.profile?.displayName || twitter.profile?.username || contentData?.creator?.username || 'Yapper'
    }

    const getTwitterHandle = () => {
        return twitter.profile?.username || contentData?.creator?.username?.toLowerCase() || 'yapper'
    }

    const getInitialLetter = () => {
        const name = getDisplayName()
        return name.charAt(0).toUpperCase()
    }

    // Content parsing functions (extracted from YapperMyContent)
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

    const formatTwitterContent = (contentText: string): { text: string; hashtags: string[]; characterCount: number; imageUrl: string | null } => {
        const imageUrl = extractImageUrl(contentText)
        
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

    // Ensure the modal opens in purchased state for My Content
    useEffect(() => {
        if (isOpen) {
            setIsPurchased(true); // Always true for My Content
        }
    }, [isOpen]);

    // Download image function
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
            console.log('✅ Image download initiated')
        } catch (error) {
            console.error('❌ Failed to download image:', error)
            window.open(imageUrl, '_blank')
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
            <div className="relative w-full max-w-[95vw] lg:max-w-6xl rounded-2xl bg-[#492222] max-h-[100vh] overflow-y-auto lg:overflow-y-hidden shadow-2xl p-4 lg:p-6 overscroll-contain">
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

                                            {/* Tweet Actions */}
                                            <div className="flex items-center justify-between text-gray-500 text-sm py-2 border-b border-gray-800">
                                                <div className="flex items-center gap-6">
                                                    <button className="flex items-center gap-1 hover:text-white text-xs">
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                                        </svg>
                                                        Tag people
                                                    </button>
                                                    <button className="flex items-center gap-1 hover:text-white text-xs">
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                            <circle cx="12" cy="12" r="3" />
                                                            <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1" />
                                                        </svg>
                                                        Descriptions
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="flex items-center gap-1 text-xs">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="#F59E0B">
                                                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                                        </svg>
                                                        #{contentData?.quality_score?.toFixed(0) || '1'}
                                                    </span>
                                                    <button className="hover:text-white">⋯</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Thread Replies */}
                                {contentData?.tweet_thread && contentData.tweet_thread.map((tweet, idx) => (
                                    <div key={idx} className="relative pt-3">
                                        <div className="flex gap-3 pr-2">
                                            <div className="relative flex-shrink-0">
                                                <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-orange-500 flex items-center justify-center relative z-10 mr-2 overflow-hidden">
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
                                                    <span className={`text-white font-bold text-xs ${twitter.profile?.profileImage ? 'hidden' : ''}`}>
                                                        {getInitialLetter()}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0 pb-3">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-white font-bold text-xs lg:text-sm">
                                                        {getDisplayName()}
                                                    </span>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#1DA1F2">
                                                        <path d="M22.46 6.003c-.77.35-1.6.58-2.46.69a4.3 4.3 0 0 0 1.88-2.37 8.58 8.58 0 0 1-2.72 1.04 4.28 4.28 0 0 0-7.29 3.9 12.14 12.14 0 0 1-8.82-4.47 4.27 4.27 0 0 0 1.32 5.71 4.25 4.25 0 0 1-1.94-.54v.05a4.28 4.28 0 0 0 3.43 4.19 4.3 4.3 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.97A8.58 8.58 0 0 1 2 18.13a12.1 12.1 0 0 0 6.56 1.92c7.88 0 12.2-6.53 12.2-12.2 0-.19 0-.37-.01-.56A8.72 8.72 0 0 0 23 4.59a8.52 8.52 0 0 1-2.54.7z" />
                                                    </svg>
                                                    <span className="text-gray-500 text-xs lg:text-sm">@{getTwitterHandle()}</span>
                                                </div>
                                                <div className="text-white text-xs lg:text-sm leading-relaxed pr-2">
                                                    {tweet}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="w-full lg:w-1/2 px-4 pt-4 lg:px-8 lg:pt-8 flex flex-col gap-4 overflow-y-auto justify-between">
                        {/* Always show purchased state for My Content */}
                        <div className="flex flex-col gap-4">
                            {/* Purchase Completed Header */}
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                                    <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="text-white font-bold">Content Owned</div>
                                    <div className="text-white text-xs">
                                        Purchased on {contentData?.winning_bid ? new Date(contentData.winning_bid.bid_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Unknown date'} • {contentData?.winning_bid?.amount || 'N/A'} {contentData?.winning_bid?.currency || 'ROAST'}
                                    </div>
                                </div>
                            </div>



                            {/* How to thread */}
                            <div className="bg-[#331C1E] rounded-md px-4 py-2 flex items-start gap-3">
                                <div className="flex items-center justify-center">
                                    <Image src="/bulb.svg" alt="Info" width={24} height={24} className="w-10 h-10" />
                                </div>
                                <div className="text-white/80 text-sm">
                                    <div className="font-medium mb-1">How to thread: After posting the first tweet, click the + button on Twitter, paste Tweet 2, post it, then repeat for Tweet 3, etc.</div>
                                </div>
                            </div>

                            {/* Tweets List */}
                            {tweetsData.map((section, idx) => (
                                <div key={idx} className="bg-[#FFFFFF1A] rounded-md p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-white/90 text-sm">{section.title}</div>
                                        <button
                                            type="button" 
                                            onClick={() => {
                                                if (section.text) {
                                                    navigator.clipboard?.writeText(section.text);
                                                } else if (section.image) {
                                                    // Download the image
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
                                        <div className="text-white/80 text-sm leading-relaxed">{section.text}</div>
                                    )}
                                    {section.image && (
                                        <div className="mt-3 rounded-md overflow-hidden">
                                            <Image src={String(section.image)} alt="Tweet image" width={600} height={400} className="w-[50%] h-auto object-cover" />
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Blockchain Transaction */}
                            {contentData?.transaction_hash && (
                                <div className="bg-[#331C1E] rounded-md px-4 py-3 flex items-center justify-between">
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
        </div>
    );
};

export default TweetPreviewModal;
