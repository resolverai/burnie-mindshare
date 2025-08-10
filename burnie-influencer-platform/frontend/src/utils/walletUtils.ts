import { parseEther, parseUnits } from 'viem'
import { writeContract, waitForTransactionReceipt, readContract } from 'wagmi/actions'
import { config } from '../app/wagmi'

// ROAST Token ABI (ERC-20 interface)
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

    // Get ROAST token decimals (usually 18 for ERC-20)
    console.log('📏 Getting token decimals...');
    const decimals = await readContract(config, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'decimals',
    })

    console.log(`📏 ROAST token decimals: ${decimals}`)

    // Convert amount to proper units based on token decimals
    const amountInWei = parseUnits(amount.toString(), decimals)

    console.log(`💰 Amount in wei: ${amountInWei}`)
    console.log('🔧 Transaction details:');
    console.log('  - Contract:', contractAddress);
    console.log('  - Function: transfer');
    console.log('  - To:', recipientAddress);
    console.log('  - Amount (wei):', amountInWei.toString());

    // Execute the transfer
    console.log('🚀 Executing writeContract...');
    const hash = await writeContract(config, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'transfer',
      args: [recipientAddress as `0x${string}`, amountInWei],
    })

    console.log(`✅ ROAST transfer transaction submitted: ${hash}`)

    // Wait for transaction confirmation
    console.log('⏳ Waiting for transaction confirmation...');
    const receipt = await waitForTransactionReceipt(config, {
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
    const decimals = await readContract(config, {
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
    const hash = await writeContract(config, {
      address: BASE_USDC_CONTRACT as `0x${string}`,
      abi: USDC_TOKEN_ABI,
      functionName: 'transfer',
      args: [recipientAddress as `0x${string}`, amountInWei],
    })

    console.log(`✅ USDC transfer transaction submitted: ${hash}`)

    // Wait for transaction confirmation
    console.log('⏳ Waiting for USDC transaction confirmation...');
    const receipt = await waitForTransactionReceipt(config, {
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

    const balance = await readContract(config, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })

    // Get decimals to convert balance properly
    const decimals = await readContract(config, {
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
    const balance = await readContract(config, {
      address: BASE_USDC_CONTRACT as `0x${string}`,
      abi: USDC_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })

    // Get decimals to convert balance properly
    const decimals = await readContract(config, {
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
      const wasAdded = await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: contractAddress,
            symbol: 'ROAST',
            decimals: 18,
            image: '', // You can add a token logo URL here
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
 * Add USDC token to wallet
 */
export async function addUSDCTokenToWallet(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.ethereum) {
      const wasAdded = await window.ethereum.request({
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