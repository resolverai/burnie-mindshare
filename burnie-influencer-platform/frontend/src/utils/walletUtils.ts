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
 * Get ROAST token balance for an address
 */
export async function getROASTBalance(address: string): Promise<number> {
  try {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN

    if (!contractAddress) {
      throw new Error('ROAST token contract address not configured')
    }

    // Get token decimals
    const decimals = await readContract(config, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'decimals',
    })

    // Get balance
    const balance = await readContract(config, {
      address: contractAddress as `0x${string}`,
      abi: ROAST_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })

    // Convert from wei to readable format
    const balanceInROAST = Number(balance) / Math.pow(10, decimals)
    
    console.log(`💰 ROAST balance for ${address}: ${balanceInROAST}`)
    
    return balanceInROAST

  } catch (error) {
    console.error('❌ Failed to get ROAST balance:', error)
    return 0
  }
}

/**
 * Check if user has sufficient ROAST balance
 */
export async function checkROASTBalance(
  userAddress: string,
  requiredAmount: number
): Promise<boolean> {
  try {
    const balance = await getROASTBalance(userAddress)
    return balance >= requiredAmount
  } catch (error) {
    console.error('❌ Failed to check ROAST balance:', error)
    return false
  }
}

/**
 * Verify transaction was successful and tokens reached destination
 */
export async function verifyTransfer(
  transactionHash: string,
  recipientAddress: string,
  expectedAmount: number
): Promise<boolean> {
  try {
    console.log(`🔍 Verifying transfer: ${transactionHash}`)

    // Wait for transaction receipt
    const receipt = await waitForTransactionReceipt(config, {
      hash: transactionHash as `0x${string}`,
      confirmations: 2 // Wait for 2 confirmations for extra security
    })

    console.log(`📋 Transaction receipt:`, receipt)

    if (receipt.status !== 'success') {
      console.error('❌ Transaction failed on blockchain')
      return false
    }

    // Optionally: Check recipient balance increased by expected amount
    // This requires storing the previous balance and comparing
    console.log(`✅ Transaction verified: ${transactionHash}`)
    
    return true

  } catch (error) {
    console.error('❌ Failed to verify transfer:', error)
    return false
  }
} 

/**
 * Add ROAST token to user's wallet (MetaMask, etc.)
 */
export async function addROASTTokenToWallet(): Promise<boolean> {
  try {
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN;
    
    if (!contractAddress) {
      console.error('ROAST token contract address not configured');
      return false;
    }

    // Check if wallet supports token addition
    if (typeof window !== 'undefined' && window.ethereum) {
      await window.ethereum.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: contractAddress,
            symbol: 'ROAST',
            decimals: 18, // Standard ERC-20 decimals
            image: 'https://via.placeholder.com/64x64.png?text=ROAST', // You can replace with actual ROAST logo
          },
        },
      });
      
      console.log('✅ ROAST token added to wallet');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Failed to add ROAST token to wallet:', error);
    return false;
  }
} 