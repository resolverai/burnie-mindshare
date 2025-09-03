import { parseEther, parseUnits } from 'viem'
import { writeContract, waitForTransactionReceipt, readContract } from 'wagmi/actions'
import { wagmiConfig } from '../app/reown'
import { tokenMetadataService } from '../services/tokenMetadataService'

// ROAST token fallback address
const ROAST_TOKEN_FALLBACK = '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4' as const

// ROAST Token ABI (ERC-20 interface with metadata)
const ROAST_TOKEN_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

// USDC Token ABI (ERC-20 interface) - same as ROAST
const USDC_TOKEN_ABI = ROAST_TOKEN_ABI

// BASE chain USDC contract address
const BASE_USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

export interface TransferResult {
  success: boolean
  transactionHash?: string
  error?: string
}

/**
 * Transfer ROAST tokens to treasury wallet using real wagmi
 */
export async function transferROAST(
  amount: number,
  recipientAddress: string
): Promise<TransferResult> {
  try {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN

    console.log('🔧 Transfer ROAST Debug Info:');
    console.log('📍 Contract Address:', contractAddress);
    console.log('📍 Recipient Address:', recipientAddress);
    console.log('💰 Amount:', amount);

    if (!contractAddress) {
      throw new Error('ROAST token contract address not configured')
    }

    if (!recipientAddress) {
      throw new Error('Recipient address is required')
    }

    console.log(`🔄 Transferring ${amount} ROAST to ${recipientAddress}`)

    // Ensure token is properly registered in wallet for better display
    console.log('🏷️ Optimizing ROAST token display in wallet...');
    try {
      await ensureROASTTokenDisplay();
    } catch (error) {
      console.log('ℹ️ Token display optimization not needed or user declined');
    }

    // Get token metadata for wallet display
    console.log('📋 Getting token metadata...');
    const [decimals, name, symbol] = await Promise.all([
      readContract(wagmiConfig, {
        address: contractAddress as `0x${string}`,
        abi: ROAST_TOKEN_ABI,
        functionName: 'decimals',
      }),
      readContract(wagmiConfig, {
        address: contractAddress as `0x${string}`,
        abi: ROAST_TOKEN_ABI,
        functionName: 'name',
      }),
      readContract(wagmiConfig, {
        address: contractAddress as `0x${string}`,
        abi: ROAST_TOKEN_ABI,
        functionName: 'symbol',
      })
    ]);

    console.log(`📋 Token metadata:`, { name, symbol, decimals });

    // Convert amount to proper units based on token decimals
    const amountInWei = parseUnits(amount.toString(), decimals)

    console.log(`💰 Amount in wei: ${amountInWei}`)
    console.log('🔧 Transaction details:');
    console.log('  - Contract:', contractAddress);
    console.log('  - Token:', `${name} (${symbol})`);
    console.log('  - Function: transfer');
    console.log('  - To:', recipientAddress);
    console.log('  - Amount:', `${amount} ${symbol}`);
    console.log('  - Amount (wei):', amountInWei.toString());

    // Execute the transfer with enhanced metadata for better wallet display
    console.log('🚀 Executing ROAST token transfer...');
    console.log('📋 Transfer parameters:', {
      contractAddress,
      tokenName: name,
      tokenSymbol: symbol,
      fromUser: 'Connected Wallet',
      toAddress: recipientAddress,
      amount: `${amount} ${symbol}`,
      amountWei: amountInWei.toString(),
      decimals: decimals
    });
    
    // CRITICAL: Force token registration before transaction for proper display
    console.log('🏷️ FORCING token registration for transaction display...');
    let tokenRegistered = false;
    
    try {
      // Try multiple registration attempts with different strategies
      console.log('📋 Attempt 1: Standard wallet_watchAsset...');
      tokenRegistered = await ensureROASTTokenDisplay();
      
      if (!tokenRegistered) {
        console.log('📋 Attempt 2: Direct wallet registration...');
        tokenRegistered = await forceTokenRegistration(contractAddress, name, symbol, decimals);
      }
      
      if (!tokenRegistered) {
        console.log('📋 Attempt 3: Alternative registration method...');
        tokenRegistered = await alternativeTokenRegistration(contractAddress, name, symbol, decimals);
      }
      
      if (tokenRegistered) {
        console.log('✅ Token successfully registered - wallet should display transaction details');
        // Wait a bit longer for wallet to process
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.log('⚠️ WARNING: Token registration failed - wallet may show "No balance changes found"');
        console.log('💡 User may need to manually add token to wallet for proper display');
      }
    } catch (error) {
      console.log('⚠️ Token registration failed, proceeding with transaction:', error);
    }
    
    // Enhanced writeContract call with real-time token metadata
    console.log('🚀 Initiating writeContract with the following details:');
    
    // Try to get real-time metadata for logging
    const realtimeMetadata = await tokenMetadataService.getROASTTokenMetadata();
    const displayData = realtimeMetadata || {
      address: ROAST_TOKEN_FALLBACK,
      symbol: 'ROAST',
      decimals: 18,
      name: 'ROAST Token',
      image: '/roast-token.png'
    };
    
    console.log('  📋 Token Name:', displayData.name);
    console.log('  🎯 Token Symbol:', displayData.symbol);
    console.log('  🖼️ Token Image:', displayData.image);
    console.log('  💰 Transaction Amount:', `${amount} ${displayData.symbol}`);
    console.log('  🧮 Amount in Wei:', amountInWei.toString());
    console.log('  🎯 Decimals:', decimals);
    console.log('  📍 Contract:', contractAddress);
    console.log('  🎯 Recipient:', recipientAddress);
    console.log('  ');
    console.log('  📱 WALLET SHOULD DISPLAY:');
    console.log(`     → Sending: ${amount} ${displayData.symbol}`);
    console.log(`     → Token: ${displayData.name}`);
    console.log(`     → To: ${recipientAddress}`);
    console.log('  ');
    console.log('  💡 Market Info (for reference only):');
    console.log('     → Current Price:', realtimeMetadata?.price ? `$${realtimeMetadata.price.toFixed(6)}` : 'N/A');
    console.log('     → 24h Change:', realtimeMetadata?.priceChange24h ? `${realtimeMetadata.priceChange24h.toFixed(2)}%` : 'N/A');
    console.log('     → Market Cap:', realtimeMetadata?.marketCap ? `$${(realtimeMetadata.marketCap / 1000000).toFixed(2)}M` : 'N/A');
    console.log('  🔗 Data Source:', realtimeMetadata ? 'DEX API' : 'Static Fallback');
    
    const hash = await writeContract(wagmiConfig, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'transfer',
      args: [recipientAddress as `0x${string}`, amountInWei],
    })

    console.log(`✅ ROAST transfer transaction submitted: ${hash}`)
    
    // Show post-transaction guidance
    const { showPostTransactionGuidance } = await import('../utils/walletDisplayHelper');
    showPostTransactionGuidance();

    // Wait for transaction confirmation
    console.log('⏳ Waiting for transaction confirmation...');
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash,
      confirmations: 1
    })

    console.log(`🎉 ROAST transfer confirmed: ${hash}`, receipt)

    if (receipt.status === 'success') {
      return {
        success: true,
        transactionHash: hash
      }
    } else {
      throw new Error('Transaction failed on blockchain')
    }

  } catch (error) {
    console.error('❌ ROAST transfer failed:', error)
    console.error('🔍 Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Transfer USDC tokens to treasury wallet on BASE chain
 */
export async function transferUSDC(
  amount: number,
  recipientAddress: string
): Promise<TransferResult> {
  try {
    console.log('🔧 Transfer USDC Debug Info:');
    console.log('📍 Contract Address:', BASE_USDC_CONTRACT);
    console.log('📍 Recipient Address:', recipientAddress);
    console.log('💰 Amount:', amount);

    if (!recipientAddress) {
      throw new Error('Recipient address is required')
    }

    console.log(`🔄 Transferring ${amount} USDC to ${recipientAddress}`)

    // Get USDC token decimals (usually 6 for USDC)
    console.log('📏 Getting USDC token decimals...');
    const decimals = await readContract(wagmiConfig, {
      address: BASE_USDC_CONTRACT as `0x${string}`,
      abi: USDC_TOKEN_ABI,
      functionName: 'decimals',
    })

    console.log(`📏 USDC token decimals: ${decimals}`)

    // Convert amount to proper units based on token decimals
    const amountInWei = parseUnits(amount.toString(), decimals)

    console.log(`💰 Amount in wei: ${amountInWei}`)
    console.log('🔧 Transaction details:');
    console.log('  - Contract:', BASE_USDC_CONTRACT);
    console.log('  - Function: transfer');
    console.log('  - To:', recipientAddress);
    console.log('  - Amount (wei):', amountInWei.toString());

    // Execute the transfer
    console.log('🚀 Executing USDC writeContract...');
    const hash = await writeContract(wagmiConfig, {
      address: BASE_USDC_CONTRACT as `0x${string}`,
      abi: USDC_TOKEN_ABI,
      functionName: 'transfer',
      args: [recipientAddress as `0x${string}`, amountInWei],
    })

    console.log(`✅ USDC transfer transaction submitted: ${hash}`)

    // Wait for transaction confirmation
    console.log('⏳ Waiting for USDC transaction confirmation...');
    const receipt = await waitForTransactionReceipt(wagmiConfig, {
      hash,
      confirmations: 1
    })

    console.log(`🎉 USDC transfer confirmed: ${hash}`, receipt)

    if (receipt.status === 'success') {
      return {
        success: true,
        transactionHash: hash
      }
    } else {
      throw new Error('USDC transaction failed on blockchain')
    }

  } catch (error) {
    console.error('❌ USDC transfer failed:', error)
    console.error('🔍 Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get ROAST token balance for an address
 */
export async function getROASTBalance(address: string): Promise<number> {
  try {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN

    if (!contractAddress) {
      throw new Error('ROAST token contract address not configured')
    }

    const balance = await readContract(wagmiConfig, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })

    // Get decimals to convert balance properly
    const decimals = await readContract(wagmiConfig, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'decimals',
    })

    const balanceInTokens = Number(balance) / Math.pow(10, Number(decimals))
    return balanceInTokens
  } catch (error) {
    console.error('Failed to get ROAST balance:', error)
    return 0
  }
}

/**
 * Get USDC token balance for an address
 */
export async function getUSDCBalance(address: string): Promise<number> {
  try {
    const balance = await readContract(wagmiConfig, {
      address: BASE_USDC_CONTRACT as `0x${string}`,
      abi: USDC_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })

    // Get decimals to convert balance properly
    const decimals = await readContract(wagmiConfig, {
      address: BASE_USDC_CONTRACT as `0x${string}`,
      abi: USDC_TOKEN_ABI,
      functionName: 'decimals',
    })

    const balanceInTokens = Number(balance) / Math.pow(10, Number(decimals))
    return balanceInTokens
  } catch (error) {
    console.error('Failed to get USDC balance:', error)
    return 0
  }
}

/**
 * Check if user has sufficient ROAST balance for purchase
 */
export async function checkROASTBalance(address: string, requiredAmount: number): Promise<boolean> {
  try {
    const balance = await getROASTBalance(address)
    console.log(`🔍 ROAST Balance Check: ${balance} ROAST available, ${requiredAmount} ROAST required`)
    return balance >= requiredAmount
  } catch (error) {
    console.error('Failed to check ROAST balance:', error)
    return false
  }
}

/**
 * Check if user has sufficient USDC balance for purchase
 */
export async function checkUSDCBalance(address: string, requiredAmount: number): Promise<boolean> {
  try {
    const balance = await getUSDCBalance(address)
    console.log(`🔍 USDC Balance Check: ${balance} USDC available, ${requiredAmount} USDC required`)
    return balance >= requiredAmount
  } catch (error) {
    console.error('Failed to check USDC balance:', error)
    return false
  }
} 

/**
 * Add ROAST token to wallet
 */
export async function addROASTTokenToWallet(): Promise<boolean> {
  try {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN
    
    if (!contractAddress) {
      console.error('ROAST token contract address not configured')
      return false
    }

    if (typeof window !== 'undefined' && window.ethereum) {
      const wasAdded = await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: contractAddress,
            symbol: 'ROAST',
            decimals: 18,
            image: `${window.location.origin}/roastusdc.svg`, // Add the correct token logo URL
          },
        },
      })
      
      return wasAdded
    }
    
    return false
  } catch (error) {
    console.error('Failed to add ROAST token to wallet:', error)
    return false
  }
}

/**
 * Ensure ROAST token is properly configured for optimal wallet display
 * Fetches real-time metadata from DEX APIs for accurate display
 */
export async function ensureROASTTokenDisplay(): Promise<boolean> {
  try {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN;
    
    if (!contractAddress) {
      console.error('ROAST token contract address not configured');
      return false;
    }

    if (typeof window !== 'undefined' && window.ethereum) {
      console.log('🏷️ Fetching real-time ROAST token metadata...');
      
      // Fetch real-time token metadata from DEX APIs
      const tokenMetadata = await tokenMetadataService.getROASTTokenMetadata();
      
      // Use fetched metadata or fallback to static data
      const metadata = tokenMetadata || {
      address: ROAST_TOKEN_FALLBACK,
      symbol: 'ROAST',
      decimals: 18,
      name: 'ROAST Token',
      image: '/roast-token.png'
    };
      
      console.log('📋 Using token metadata:', {
        name: metadata.name,
        symbol: metadata.symbol,
        image: metadata.image,
        decimals: metadata.decimals,
        source: tokenMetadata ? 'DEX API' : 'Fallback'
      });

      // Enhanced token registration with real-time metadata
      const tokenData = {
        type: 'ERC20',
        options: {
          address: contractAddress,
          symbol: metadata.symbol,
          decimals: metadata.decimals,
          name: metadata.name,
          // Use DEX image if available, otherwise fallback to local
          image: metadata.image && !metadata.image.startsWith('/') 
            ? metadata.image 
            : `${window.location.origin}${metadata.image || '/roast-token.png'}`,
        },
      };

      console.log('📋 Registering token with wallet for proper amount display:');
      console.log(`     Token: ${tokenData.options.name} (${tokenData.options.symbol})`);
      console.log(`     Decimals: ${tokenData.options.decimals}`);
      console.log(`     Contract: ${tokenData.options.address}`);
      console.log(`     Image: ${tokenData.options.image}`);

      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: tokenData,
      });
      
      console.log('✅ ROAST token registered - wallet should now display amounts correctly');
      
      // Small delay to let wallet process the registration
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.log('ℹ️ Token display optimization not needed or user declined');
    return false;
  }
}

/**
 * Force token registration with basic parameters
 */
async function forceTokenRegistration(address: string, name: string, symbol: string, decimals: number): Promise<boolean> {
  try {
    if (!window.ethereum) return false;
    
    const basicTokenData = {
      type: 'ERC20',
      options: {
        address: address,
        symbol: symbol,
        decimals: decimals,
        name: name,
        image: `${window.location.origin}/roastusdc.svg`, // Use local image as fallback
      },
    };
    
    console.log('🔄 Forcing token registration with basic data:', basicTokenData);
    
    await (window.ethereum as any).request({
      method: 'wallet_watchAsset',
      params: basicTokenData,
    });
    
    return true;
  } catch (error) {
    console.log('❌ Force registration failed:', error);
    return false;
  }
}

/**
 * Alternative token registration method - try with minimal data
 */
async function alternativeTokenRegistration(address: string, name: string, symbol: string, decimals: number): Promise<boolean> {
  try {
    if (!window.ethereum) return false;
    
    // Try with absolutely minimal data
    const minimalTokenData = {
      type: 'ERC20',
      options: {
        address: address,
        symbol: symbol,
        decimals: decimals,
      },
    };
    
    console.log('🔄 Alternative registration with minimal data:', minimalTokenData);
    
    await (window.ethereum as any).request({
      method: 'wallet_watchAsset',
      params: minimalTokenData,
    });
    
    return true;
  } catch (error) {
    console.log('❌ Alternative registration failed:', error);
    return false;
  }
}

/**
 * Check if token is already in wallet's token list
 */
async function checkTokenInWallet(address: string): Promise<boolean> {
  try {
    if (!window.ethereum) return false;
    
    // Try to get token balance - if wallet recognizes it, this should work
    const balance = await (window.ethereum as any).request({
      method: 'eth_call',
      params: [{
        to: address,
        data: '0x70a08231' + '000000000000000000000000' + (await (window.ethereum as any).request({method: 'eth_accounts'}))[0].slice(2)
      }, 'latest']
    });
    
    console.log('🔍 Token balance check result:', balance);
    return balance !== null;
  } catch (error) {
    console.log('❌ Token check failed:', error);
    return false;
  }
}

/**
 * Add USDC token to wallet
 */
export async function addUSDCTokenToWallet(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.ethereum) {
      const wasAdded = await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: BASE_USDC_CONTRACT,
            symbol: 'USDC',
            decimals: 6,
            image: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
          },
        },
      })
      
      return wasAdded
    }
    
    return false
  } catch (error) {
    console.error('Failed to add USDC token to wallet:', error)
    return false
  }
} 