/**
 * TOAST Payment Service for Somnia Testnet
 * Handles TOAST token payments with EIP-2612 Permit for gasless approvals
 */

import { writeContract, waitForTransactionReceipt, getChainId, signTypedData } from 'wagmi/actions';
import { parseEther } from 'viem';
import { wagmiConfig } from '../app/reown';
import { disableModalsTemporarily } from '../utils/modalManager';
import toast from 'react-hot-toast';

// TOAST token contract address on Somnia Testnet (from env)
const TOAST_CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_TOAST_TOKEN_ADDRESS || '0x73e051113358CaBaAF6eC8d8C0E0FC97FC687379') as `0x${string}`;

// Content Registry contract address on Somnia Testnet (from env)
const CONTENT_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_CONTENT_REGISTRY_ADDRESS || '0x8319877ed76390EbcC069eBf7Be1C9EC3E158E5c') as `0x${string}`;

// Somnia Testnet Chain ID
const SOMNIA_TESTNET_CHAIN_ID = 50312;

// TOAST Token ABI (ERC-20 with approve)
const TOAST_ABI = [
  {
    "inputs": [
      {"name": "spender", "type": "address"},
      {"name": "amount", "type": "uint256"}
    ],
    "name": "approve",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "owner", "type": "address"}],
    "name": "nonces",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [{"name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// Content Registry ABI - both purchase functions
const CONTENT_REGISTRY_ABI = [
  {
    "inputs": [{"name": "_contentId", "type": "uint256"}],
    "name": "purchaseContent",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "_contentId", "type": "uint256"},
      {"name": "_deadline", "type": "uint256"},
      {"name": "_v", "type": "uint8"},
      {"name": "_r", "type": "bytes32"},
      {"name": "_s", "type": "bytes32"}
    ],
    "name": "purchaseContentWithPermit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

/**
 * Get the current nonce for an address from the TOAST token contract
 */
async function getNonce(ownerAddress: string): Promise<bigint> {
  try {
    const { readContract } = await import('wagmi/actions');
    const nonce = await readContract(wagmiConfig, {
      address: TOAST_CONTRACT_ADDRESS,
      abi: TOAST_ABI,
      functionName: 'nonces',
      args: [ownerAddress as `0x${string}`]
    });
    return nonce as bigint;
  } catch (error) {
    console.error('❌ Failed to get nonce:', error);
    return BigInt(0);
  }
}

/**
 * Get the token name from the TOAST token contract
 */
async function getTokenName(): Promise<string> {
  try {
    const { readContract } = await import('wagmi/actions');
    const name = await readContract(wagmiConfig, {
      address: TOAST_CONTRACT_ADDRESS,
      abi: TOAST_ABI,
      functionName: 'name'
    });
    return name as string;
  } catch (error) {
    console.error('❌ Failed to get token name:', error);
    return 'TOAST Token';
  }
}

/**
 * Execute TOAST token payment using EIP-2612 Permit for single-transaction approval + transfer
 * This approach allows the ContentRegistry contract to transfer tokens without prior approval
 */
export async function executeTOASTPaymentWithPermit(
  amount: number,
  blockchainContentId: number,
  userAddress: string
): Promise<string> {
  console.log('⚠️ EIP-2612 Permit has compatibility issues. Falling back to two-step approval...');
  return executeTOASTPayment(amount, blockchainContentId, userAddress);
}

/**
 * Execute TOAST token payment using standard two-step process
 * Step 1: Approve ContentRegistry to spend tokens
 * Step 2: Call purchaseContent
 */
export async function executeTOASTPayment(
  amount: number,
  blockchainContentId: number,
  userAddress: string
): Promise<string> {
  console.log('🚀 Starting TOAST payment (two-step):', { amount, blockchainContentId, userAddress });
  const restoreModals = disableModalsTemporarily();
  
  try {
    // Validate chain
    console.log('🔍 Checking chain ID...');
    const currentChainId = await getChainId(wagmiConfig);
    console.log('📡 Current chain ID:', currentChainId, 'Expected:', SOMNIA_TESTNET_CHAIN_ID);
    
    if (currentChainId !== SOMNIA_TESTNET_CHAIN_ID) {
      throw new Error(`Transaction must be executed on Somnia Testnet (Chain ID: ${SOMNIA_TESTNET_CHAIN_ID}). Current chain: ${currentChainId}. Please switch to Somnia Testnet in your wallet.`);
    }

    console.log('✅ Chain ID validation passed');
    
    const amountInWei = parseEther(amount.toString());
    
    console.log('💰 Executing TOAST payment on Somnia:', {
      amount: amount,
      amountDisplay: `${amount} TOAST`,
      blockchainContentId,
      spender: CONTENT_REGISTRY_ADDRESS,
      tokenContract: TOAST_CONTRACT_ADDRESS,
      amountInWei: amountInWei.toString()
    });
    
    // Step 1: Approve
    console.log('📝 Step 1/2: Approving ContentRegistry to spend TOAST tokens...');
    toast.loading('Step 1/2: Please approve TOAST spending in your wallet...', { id: 'toast-payment', duration: Infinity });
    
    try {
      const approveHash = await writeContract(wagmiConfig, {
        address: TOAST_CONTRACT_ADDRESS,
        abi: TOAST_ABI,
        functionName: 'approve',
        args: [CONTENT_REGISTRY_ADDRESS, amountInWei]
      });
      
      console.log('📤 Approval transaction sent:', approveHash);
      console.log('🔗 Track on Somnia Explorer:', `https://shannon-explorer.somnia.network/tx/${approveHash}`);
      toast.loading('Step 1/2: Confirming approval...', { id: 'toast-payment', duration: Infinity });
      
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      console.log('✅ Approval confirmed!');
    } catch (approveError) {
      console.error('❌ Approval failed:', approveError);
      throw new Error('Failed to approve TOAST tokens. Please try again.');
    }
    
    // Wait a moment for the approval to propagate
    console.log('⏳ Waiting for approval to propagate...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify the approval
    const { readContract } = await import('wagmi/actions');
    const allowance = await readContract(wagmiConfig, {
      address: TOAST_CONTRACT_ADDRESS,
      abi: [
        {
          "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"}
          ],
          "name": "allowance",
          "outputs": [{"name": "", "type": "uint256"}],
          "stateMutability": "view",
          "type": "function"
        }
      ],
      functionName: 'allowance',
      args: [userAddress as `0x${string}`, CONTENT_REGISTRY_ADDRESS]
    });
    
    console.log('📊 Current allowance:', allowance.toString(), 'Required:', amountInWei.toString());
    
    if (allowance < amountInWei) {
      throw new Error(`Approval failed: allowance (${allowance.toString()}) is less than required amount (${amountInWei.toString()})`);
    }
    
    console.log('✅ Allowance verified!');
    
    // Step 2: Purchase
    console.log('📝 Step 2/2: Purchasing content...');
    console.log('📝 Content ID:', blockchainContentId);
    console.log('📝 Buyer address:', userAddress);
    toast.loading('Step 2/2: Please confirm the purchase in your wallet...', { id: 'toast-payment', duration: Infinity });
    
    try {
      const purchaseHash = await writeContract(wagmiConfig, {
        address: CONTENT_REGISTRY_ADDRESS,
        abi: CONTENT_REGISTRY_ABI,
        functionName: 'purchaseContent',
        args: [BigInt(blockchainContentId)]
      });
      
      console.log('📤 Purchase transaction sent:', purchaseHash);
      console.log('🔗 Track on Somnia Explorer:', `https://shannon-explorer.somnia.network/tx/${purchaseHash}`);
      toast.loading('Step 2/2: Confirming purchase...', { id: 'toast-payment', duration: Infinity });
      
      await waitForTransactionReceipt(wagmiConfig, { hash: purchaseHash });
      console.log('✅ Purchase confirmed!');
      toast.success('Purchase successful! 🎉', { id: 'toast-payment', duration: 4000 });
      
      return purchaseHash;
    } catch (purchaseError) {
      console.error('❌ Purchase failed:', purchaseError);
      // Don't try to JSON.stringify as it may contain BigInt
      if (purchaseError && typeof purchaseError === 'object') {
        console.error('❌ Purchase error details:', {
          message: (purchaseError as any).message,
          cause: (purchaseError as any).cause,
          code: (purchaseError as any).code,
          shortMessage: (purchaseError as any).shortMessage
        });
      }
      throw purchaseError;
    }
    
  } catch (error) {
    console.error('❌ Failed to execute TOAST payment:', error);
    toast.dismiss('toast-payment');
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('User rejected') || errorMessage.includes('User denied')) {
      toast.error('Transaction cancelled', { duration: 3000 });
    } else if (errorMessage.includes('insufficient funds')) {
      toast.error('Insufficient STT for gas', { duration: 4000 });
    } else if (errorMessage.includes('Content not available')) {
      toast.error('Content no longer available', { duration: 4000 });
    } else {
      toast.error('Purchase failed. Please try again.', { duration: 3000 });
    }
    
    throw error;
  } finally {
    restoreModals();
  }
}

// OLD IMPLEMENTATION - KEPT FOR REFERENCE BUT NOT USED
async function executeTOASTPaymentWithPermit_OLD(
  amount: number,
  blockchainContentId: number,
  userAddress: string
): Promise<string> {
  console.log('🚀 Starting TOAST payment with permit:', { amount, blockchainContentId, userAddress });
  const restoreModals = disableModalsTemporarily();
  
  try {
    // Validate that we're on Somnia Testnet
    console.log('🔍 Checking chain ID...');
    const currentChainId = await getChainId(wagmiConfig);
    console.log('📡 Current chain ID:', currentChainId, 'Expected:', SOMNIA_TESTNET_CHAIN_ID);
    
    if (currentChainId !== SOMNIA_TESTNET_CHAIN_ID) {
      throw new Error(`Transaction must be executed on Somnia Testnet (Chain ID: ${SOMNIA_TESTNET_CHAIN_ID}). Current chain: ${currentChainId}. Please switch to Somnia Testnet in your wallet.`);
    }

    console.log('✅ Chain ID validation passed');
    
    // Convert amount to wei
    const amountInWei = parseEther(amount.toString());

    console.log('💰 Executing TOAST payment on Somnia with Permit:', {
      amount: amount,
      amountDisplay: `${amount} TOAST`,
      blockchainContentId,
      spender: CONTENT_REGISTRY_ADDRESS,
      contract: TOAST_CONTRACT_ADDRESS,
      amountInWei: amountInWei.toString(),
      chainId: currentChainId
    });

    // Get current nonce for the user
    console.log('📝 Getting nonce for user...');
    const nonce = await getNonce(userAddress);
    console.log('📝 Current nonce:', nonce.toString());

    // Set deadline to 20 minutes from now (in seconds)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

    // Get token name for EIP-712 domain
    const tokenName = await getTokenName();
    
    console.log('📝 Token name:', tokenName);

    // EIP-712 typed data for permit
    // Note: OpenZeppelin ERC20Permit uses the token name as version by default
    const domain = {
      name: tokenName,
      version: '1',  // Standard EIP-2612 version
      chainId: BigInt(SOMNIA_TESTNET_CHAIN_ID),
      verifyingContract: TOAST_CONTRACT_ADDRESS
    };
    
    console.log('📝 Domain:', JSON.stringify(domain, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));

    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' }
      ]
    };

    const message = {
      owner: userAddress as `0x${string}`,
      spender: CONTENT_REGISTRY_ADDRESS,
      value: amountInWei,
      nonce: nonce,
      deadline: deadline
    };

    console.log('📝 EIP-712 Message:', {
      owner: userAddress,
      spender: CONTENT_REGISTRY_ADDRESS,
      value: amountInWei.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString()
    });

    console.log('✍️ Requesting signature for permit...');
    console.log('📋 EIP-712 Domain for signing:');
    console.log('   name:', domain.name);
    console.log('   version:', domain.version);
    console.log('   chainId:', domain.chainId.toString(), '(type:', typeof domain.chainId, ')');
    console.log('   verifyingContract:', domain.verifyingContract);
    console.log('📋 Message for signing:');
    console.log('   owner:', message.owner);
    console.log('   spender:', message.spender);
    console.log('   value:', message.value.toString());
    console.log('   nonce:', message.nonce.toString());
    console.log('   deadline:', message.deadline.toString());
    console.log('📋 Current wallet address:', userAddress);
    console.log('📋 Current chain ID:', currentChainId);
    
    if (currentChainId !== SOMNIA_TESTNET_CHAIN_ID) {
      throw new Error(`CRITICAL: Wallet is on wrong network! Current: ${currentChainId}, Expected: ${SOMNIA_TESTNET_CHAIN_ID}`);
    }
    
    toast.loading('Please sign the message in your wallet (this is NOT a transaction)...', { id: 'toast-payment', duration: Infinity });

    // Sign the permit message using wagmi's signTypedData (more reliable than direct eth_signTypedData_v4)
    console.log('🔄 Using wagmi signTypedData for EIP-2612 permit signature...');
    
    let signature: string;
    try {
      signature = await signTypedData(wagmiConfig, {
        account: userAddress as `0x${string}`, // Explicitly specify the account
        domain,
        types,
        primaryType: 'Permit',
        message
      });
      
      console.log('✅ Permit signature obtained via wagmi');
      console.log('📝 Signature:', signature);
    } catch (sigError) {
      console.error('❌ Failed to sign permit:', sigError);
      toast.dismiss('toast-payment');
      
      const errorMessage = sigError instanceof Error ? sigError.message : String(sigError);
      if (errorMessage.includes('User rejected') || errorMessage.includes('User denied')) {
        toast.error('Signature cancelled by user', { duration: 3000 });
      } else {
        toast.error('Failed to sign permit. Please try again.', { duration: 3000 });
      }
      throw sigError;
    }
    
    toast.loading('Approval signed! Processing purchase...', { id: 'toast-payment', duration: Infinity });

    // Split signature into v, r, s components
    console.log('📝 Raw signature:', signature);
    console.log('📝 Signature length:', signature.length, '(should be 132: 0x + 64 + 64 + 2)');
    
    // Ensure signature is properly formatted
    if (!signature.startsWith('0x')) {
      signature = '0x' + signature;
    }
    
    if (signature.length !== 132) {
      console.error('❌ Invalid signature length:', signature.length);
      throw new Error(`Invalid signature length: ${signature.length}. Expected 132 characters.`);
    }
    
    const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
    const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
    const v = parseInt(signature.slice(130, 132), 16);

    console.log('🔐 Signature components:');
    console.log('  r:', r, '(length:', r.length, ')');
    console.log('  s:', s, '(length:', s.length, ')');
    console.log('  v:', v);

    // CRITICAL: Re-check nonce before sending transaction
    // MetaMask might have triggered an approval that incremented the nonce
    const currentNonce = await getNonce(userAddress);
    console.log('🔍 Nonce verification before transaction:');
    console.log('   Original nonce used in signature:', nonce.toString());
    console.log('   Current nonce on-chain:', currentNonce.toString());
    
    if (currentNonce !== nonce) {
      console.error('❌ NONCE MISMATCH! MetaMask may have submitted an approval transaction.');
      console.error('   The permit signature is now INVALID because the nonce changed.');
      throw new Error(`Nonce mismatch: signature used nonce ${nonce}, but current nonce is ${currentNonce}. Please try again.`);
    }
    
    console.log('✅ Nonce verified - signature is still valid');

    // Call purchaseContentWithPermit on ContentRegistry contract
    console.log('📤 Calling purchaseContentWithPermit...');
    console.log('📤 Parameters:', {
      contentId: blockchainContentId,
      deadline: deadline.toString(),
      v, r, s,
      contract: CONTENT_REGISTRY_ADDRESS,
      buyer: userAddress
    });
    
    toast.loading('Confirm the purchase transaction in your wallet...', { id: 'toast-payment', duration: Infinity });
    
    try {
      const hash = await writeContract(wagmiConfig, {
        address: CONTENT_REGISTRY_ADDRESS,
        abi: CONTENT_REGISTRY_ABI,
        functionName: 'purchaseContentWithPermit',
        args: [BigInt(blockchainContentId), deadline, v, r, s]
      });

      console.log('📤 TOAST payment transaction sent:', hash);
      console.log('🔗 Track on Somnia Explorer:', `https://shannon-explorer.somnia.network/tx/${hash}`);
      toast.loading('Transaction submitted! Waiting for confirmation...', { id: 'toast-payment', duration: Infinity });
      
      // Wait for transaction confirmation
      console.log('⏳ Waiting for transaction confirmation...');
      await waitForTransactionReceipt(wagmiConfig, { hash });
      console.log('✅ Transaction confirmed on blockchain');
      toast.success('Purchase successful! 🎉', { id: 'toast-payment', duration: 4000 });
      
      return hash;
    } catch (txError) {
      console.error('❌ Transaction submission failed:', txError);
      console.error('❌ Transaction error type:', typeof txError);
      console.error('❌ Transaction error keys:', txError ? Object.keys(txError) : 'null');
      
      // Try to extract more details
      if (txError && typeof txError === 'object') {
        console.error('❌ Error details:', {
          message: (txError as any).message,
          code: (txError as any).code,
          data: (txError as any).data,
          reason: (txError as any).reason,
          error: (txError as any).error
        });
      }
      
      throw txError;
    }

  } catch (error) {
    console.error('❌ Failed to execute TOAST payment with permit:', error);
    console.error('❌ Full error object:', JSON.stringify(error, null, 2));
    
    // Dismiss loading toast and show error
    toast.dismiss('toast-payment');
    
    // Check if user rejected the signature/transaction
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorData = (error as any)?.data?.message || (error as any)?.reason || '';
    
    console.error('❌ Error message:', errorMessage);
    console.error('❌ Error data:', errorData);
    
    if (errorMessage.includes('User rejected') || errorMessage.includes('User denied') || errorMessage.includes('user rejected')) {
      toast.error('Transaction cancelled by user', { duration: 3000 });
    } else if (errorMessage.includes('insufficient funds') || errorData.includes('insufficient funds')) {
      toast.error('Insufficient STT for gas fees', { duration: 4000 });
    } else if (errorMessage.includes('Content not available') || errorData.includes('Content not available')) {
      toast.error('Content is no longer available', { duration: 4000 });
    } else if (errorMessage.includes('execution reverted') || errorData.includes('execution reverted')) {
      // Show more specific revert reason if available
      const revertReason = errorData.match(/execution reverted: (.*)/)?.[1] || 'Transaction reverted';
      toast.error(`Purchase failed: ${revertReason}`, { duration: 5000 });
    } else {
      toast.error('Purchase failed. Please try again.', { duration: 3000 });
    }
    
    throw error;
  } finally {
    restoreModals();
  }
}

/**
 * Prepare TOAST token for wallet display
 */
export async function prepareTOASTDisplay(): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.ethereum) {
      console.log('🏷️ Registering TOAST token for optimal wallet display...');
      
      const tokenData = {
        type: 'ERC20',
        options: {
          address: TOAST_CONTRACT_ADDRESS,
          symbol: 'TOAST',
          decimals: 18,
          name: 'TOAST Token'
        },
      };

      await (window.ethereum as any).request({
        method: 'wallet_watchAsset',
        params: tokenData,
      });
      
      console.log('✅ TOAST token registered for optimal display');
      return true;
    }
    
    return false;
  } catch (error) {
    console.log('ℹ️ Token registration skipped or declined by user');
    return false;
  }
}

export default {
  executeTOASTPaymentWithPermit,
  prepareTOASTDisplay,
  TOAST_CONTRACT_ADDRESS,
  CONTENT_REGISTRY_ADDRESS
};

