/**
 * ROAST Payment Service
 * Based on working implementation - handles ROAST token payments with proper wallet display
 */

import { writeContract, waitForTransactionReceipt, getChainId } from 'wagmi/actions';
import { parseEther } from 'viem';
import { wagmiConfig } from '../app/reown';
import { disableModalsTemporarily } from '../utils/modalManager';
// Scroll restoration removed - using page reload instead

// ROAST token contract address on Base
const ROAST_CONTRACT_ADDRESS = '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4' as const;


// ERC-20 ABI for transfer function (exact format from working implementation)
const ERC20_ABI = [
  {
    "constant": false,
    "inputs": [
      {"name": "_to", "type": "address"},
      {"name": "_value", "type": "uint256"}
    ],
    "name": "transfer",
    "outputs": [{"name": "", "type": "bool"}],
    "type": "function"
  }
] as const;

/**
 * Execute ROAST token payment using the working implementation pattern
 * This approach properly displays token amount, symbol, and image in wallets
 */
export async function executeROASTPayment(
  amount: number, 
  recipientAddress: string
): Promise<string> {
  // Temporarily disable modals during transaction execution
  const restoreModals = disableModalsTemporarily();
  
  try {
    // Validate that we're on Base network (Chain ID: 8453)
    const currentChainId = await getChainId(wagmiConfig);
    if (currentChainId !== 8453) {
      throw new Error(`Transaction must be executed on Base network (Chain ID: 8453). Current chain: ${currentChainId}. Please switch to Base network in your wallet.`);
    }

    // Convert amount to wei using parseEther (working implementation approach)
    const amountInWei = parseEther(amount.toString());

    console.log('💰 Executing ROAST payment on Base network:', {
      amount: amount,
      amountDisplay: `${amount} ROAST`,
      to: recipientAddress,
      contract: ROAST_CONTRACT_ADDRESS,
      amountInWei: amountInWei.toString(),
      chainId: currentChainId
    });

    // Send transaction using the exact pattern from working implementation
    const hash = await writeContract(wagmiConfig, {
      address: ROAST_CONTRACT_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipientAddress as `0x${string}`, amountInWei]
    });

    console.log('📤 ROAST payment transaction sent:', hash);
    console.log('🔗 Track on BaseScan:', `https://basescan.org/tx/${hash}`);
    
    // Wait for transaction completion to prevent AppKit modal from appearing
    console.log('⏳ Waiting for transaction confirmation...');
    await waitForTransactionReceipt(wagmiConfig, { hash });
    console.log('✅ Transaction confirmed on blockchain');
    
    // Scroll restoration removed - using page reload instead
    
    return hash;

  } catch (error) {
    console.error('❌ Failed to execute ROAST payment:', error);
    throw error;
  } finally {
    // Always restore modal functionality
    restoreModals();
  }
}

/**
 * Prepare ROAST token for wallet display (optional enhancement)
 * This tries to register the token with the wallet for better display
 */
export async function prepareROASTDisplay(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.ethereum) {
      console.log('🏷️ Registering ROAST token for optimal wallet display...');
      
      const tokenData = {
        type: 'ERC20',
        options: {
          address: ROAST_CONTRACT_ADDRESS,
          symbol: 'ROAST',
          decimals: 18,
          name: 'BurnieAI by Virtuals',
          image: 'https://dd.dexscreener.com/ds-data/tokens/base/0x06fe6d0ec562e19cfc491c187f0a02ce8d5083e4.png?key=30985f'
        },
      };

      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: tokenData,
      });
      
      console.log('✅ ROAST token registered for optimal display');
      return true;
    }
    
    return false;
  } catch (error) {
    console.log('ℹ️ Token registration skipped or declined by user');
    return false;
  }
}

export default {
  executeROASTPayment,
  prepareROASTDisplay,
  ROAST_CONTRACT_ADDRESS
};
