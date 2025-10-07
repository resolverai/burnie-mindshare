import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";
import RequestContentModal from "./RequestContentModal";
import { useAuth } from "@/hooks/useAuth";
import { useAccount } from "wagmi";
import { appKit } from "@/app/reown";
import { useRouter } from "next/navigation";
// Scroll restoration removed - using page reload instead

interface NoContentFoundProps {
    searchQuery: string;
    onRequestContent?: (data: {
        projectName: string;
        platform: string;
        campaignLinks: string;
    }) => void;
}

export default function NoContentFound({ searchQuery, onRequestContent }: NoContentFoundProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { isAuthenticated, needsSignature, signIn } = useAuth();
    const { isConnected } = useAccount();
    const router = useRouter();

    // Handle authentication flow after wallet connection
    useEffect(() => {
        if (isConnected && needsSignature) {
            // Wallet is connected but needs signature - trigger sign in
            console.log("🔐 Wallet connected, requesting signature for authentication");
            signIn();
        } else if (isConnected && isAuthenticated) {
            // User is fully authenticated - redirect to marketplace
            console.log("✅ User authenticated, redirecting to marketplace");
            router.push("/marketplace");
        }
    }, [isConnected, needsSignature, isAuthenticated, signIn, router]);

    const handleRequestContent = () => {
        // Check if user is authenticated
        if (!isAuthenticated) {
            // Open Reown wallet connection modal for unauthenticated users
            // This will trigger the complete authentication flow
            const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search + window.location.hash : "/";
            localStorage.setItem("wc_return_path", currentPath);
            
            // Only set timestamp for mobile devices to enable mobile recovery
            const isMobile = typeof window !== "undefined" && (
              /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
              window.innerWidth < 768
            );
            
            if (isMobile) {
              localStorage.setItem("wc_connection_timestamp", Date.now().toString());
              console.log('📱 Mobile wallet connection initiated from NoContentFound:', currentPath);
            } else {
              console.log('🖥️ Desktop wallet connection initiated from NoContentFound:', currentPath);
            }
            
            appKit.open(); // This opens wallet connection, then signature, then redirect
        } else {
            // Open request content modal for authenticated users
            setIsModalOpen(true);
        }
    };

    const handleModalSubmit = async (data: {
        projectName: string;
        platform: string;
        campaignLinks: string;
    }) => {
        // If custom handler is provided, call it
        if (onRequestContent) {
            await onRequestContent(data);
        }
        
        // Close the modal
        setIsModalOpen(false);
    };

    return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="mb-6">
                <h2 className="text-white text-xl md:text-2xl font-semibold mb-2">
                    No content found for "{searchQuery}"
                </h2>
                <p className="text-white text-sm">
                    Let us know if you want us to provide content for it
                </p>
            </div>

            <Button
                variant="default"
                size="lg"
                onClick={handleRequestContent}
                className="h-9 md:h-10 px-4 md:px-5 rounded-[12px] text-[#ffffff] font-semibold bg-[#FD7A10] hover:bg-[#FD7A10] glow-button-orange shadow-[0_10px_30px_rgba(0,0,0,0.25)] cursor-pointer"
            >
                Request content
            </Button>

            {/* Request Content Modal */}
            <RequestContentModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                }}
                searchQuery={searchQuery}
                onSubmit={handleModalSubmit}
            />
        </div>
    );
}
