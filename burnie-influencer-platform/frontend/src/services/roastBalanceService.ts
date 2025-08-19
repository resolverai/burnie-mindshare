/**
 * ROAST Balance Service
 * Based on working implementation - checks ROAST token balance
 */

import { createPublicClient, http, formatUnits } from 'viem';
import { base } from 'viem/chains';

const ROAST_CONTRACT_ADDRESS = '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4';

const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{"name": "", "type": "uint8"}],
    "type": "function"
  }
] as const;

const publicClient = createPublicClient({
  chain: base,
  transport: http()
});

export interface ROASTBalance {
  balance: string;
  formattedBalance: string;
  decimals: number;
  hasBalance: boolean;
}

/**
 * Fetch ROAST token balance for a wallet (working implementation pattern)
 */
export async function fetchROASTBalance(walletAddress: string): Promise<ROASTBalance | null> {
  try {
    console.log('🔗 Fetching ROAST balance for wallet:', walletAddress);

    // Get balance
    const balance = await publicClient.readContract({
      address: ROAST_CONTRACT_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`]
    });

    // Get decimals
    const decimals = await publicClient.readContract({
      address: ROAST_CONTRACT_ADDRESS as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'decimals'
    });

    const balanceBigInt = balance as bigint;
    const decimalsNum = decimals as number;
    const formattedBalance = formatUnits(balanceBigInt, decimalsNum);
    
    console.log('💰 ROAST balance:', formattedBalance);

    return {
      balance: balanceBigInt.toString(),
      formattedBalance,
      decimals: decimalsNum,
      hasBalance: balanceBigInt > BigInt(0)
    };
  } catch (error) {
    console.error('❌ Error fetching ROAST balance:', error);
    return null;
  }
}

/**
 * Check if user has sufficient ROAST balance for a transaction
 */
export async function checkSufficientROASTBalance(
  walletAddress: string, 
  requiredAmount: number
): Promise<{hasBalance: boolean, userBalance: number, required: number}> {
  try {
    const balanceData = await fetchROASTBalance(walletAddress);
    
    if (!balanceData) {
      return {
        hasBalance: false,
        userBalance: 0,
        required: requiredAmount
      };
    }

    const userBalance = parseFloat(balanceData.formattedBalance);
    const hasBalance = userBalance >= requiredAmount;
    
    console.log(`💰 Balance check: User has ${userBalance} ROAST, needs ${requiredAmount} ROAST`, {
      hasBalance,
      userBalance,
      required: requiredAmount
    });

    return {
      hasBalance,
      userBalance,
      required: requiredAmount
    };
  } catch (error) {
    console.error('❌ Balance check failed:', error);
    return {
      hasBalance: false,
      userBalance: 0,
      required: requiredAmount
    };
  }
}

export default {
  fetchROASTBalance,
  checkSufficientROASTBalance,
  ROAST_CONTRACT_ADDRESS
};
