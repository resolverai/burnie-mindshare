import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ROAST_TOKEN_FALLBACK } from '../app/wagmi';
import { tokenMetadataService } from '../services/tokenMetadataService';

/**
 * Hook to automatically register ROAST token in user's wallet
 * This helps wallets display token information correctly
 */
export function useTokenRegistration() {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    const addTokenToWallet = async () => {
      if (!isConnected || !address || !window.ethereum) {
        return;
      }

      try {
        console.log('🏷️ Fetching real-time ROAST token metadata for wallet registration...');
        
        // Fetch real-time token metadata
        const tokenMetadata = await tokenMetadataService.getROASTTokenMetadata();
        const metadata = tokenMetadata || ROAST_TOKEN_FALLBACK;
        
        console.log('📋 Token metadata source:', tokenMetadata ? 'DEX API' : 'Fallback');
        
        // Check if wallet supports token registration
        const provider = window.ethereum;
        
        // Add ROAST token to wallet's token list with real-time data
        await provider.request({
          method: 'wallet_watchAsset',
          params: {
            type: 'ERC20',
            options: {
              address: metadata.address,
              symbol: metadata.symbol,
              decimals: metadata.decimals,
              name: metadata.name,
              // Use DEX image if available, otherwise fallback to local
              image: metadata.image && !metadata.image.startsWith('/') 
                ? metadata.image 
                : `${window.location.origin}${metadata.image || ROAST_TOKEN_FALLBACK.image}`,
            },
          },
        });
        
        console.log('✅ ROAST token added to wallet with real-time metadata');
      } catch (error) {
        // Silently fail - user may have rejected or wallet may not support it
        console.log('ℹ️ Could not add ROAST token to wallet (user rejected or not supported)');
      }
    };

    // Add token when wallet connects
    if (isConnected) {
      // Small delay to ensure wallet is fully connected
      setTimeout(addTokenToWallet, 1000);
      
      // Also try to add it again after a longer delay to ensure it sticks
      setTimeout(addTokenToWallet, 5000);
    }
  }, [isConnected, address]);
}

/**
 * Function to manually trigger adding ROAST token to wallet with real-time metadata
 * Can be called before transactions to ensure token is recognized
 */
export async function addROASTTokenToWallet(): Promise<boolean> {
  if (!window.ethereum) {
    console.warn('❌ No wallet provider found');
    return false;
  }

  try {
    console.log('🏷️ Fetching real-time ROAST token metadata for manual registration...');
    
    // Fetch real-time token metadata
    const tokenMetadata = await tokenMetadataService.getROASTTokenMetadata();
    const metadata = tokenMetadata || ROAST_TOKEN_FALLBACK;
    
    console.log('📋 Using metadata from:', tokenMetadata ? 'DEX API' : 'Fallback');
    
    const provider = window.ethereum;
    
    await provider.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: metadata.address,
          symbol: metadata.symbol,
          decimals: metadata.decimals,
          name: metadata.name,
          // Use DEX image if available, otherwise fallback to local
          image: metadata.image && !metadata.image.startsWith('/') 
            ? metadata.image 
            : `${window.location.origin}${metadata.image || ROAST_TOKEN_FALLBACK.image}`,
        },
      },
    });
    
    console.log('✅ ROAST token manually added to wallet with real-time metadata');
    return true;
  } catch (error) {
    console.log('ℹ️ User rejected adding ROAST token to wallet');
    return false;
  }
}

// Extend Window interface for TypeScript (compatible with existing declarations)
declare global {
  interface Window {
    ethereum?: any; // Use any to avoid conflicts with other declarations
  }
}
