/**
 * Wallet Display Debugger
 * Helps diagnose and fix wallet token display issues
 */

import { ensureROASTTokenDisplay } from './walletUtils';
import { tokenMetadataService } from '../services/tokenMetadataService';

export class WalletDisplayDebugger {
  /**
   * Run comprehensive diagnostics for wallet token display
   */
  static async diagnoseTokenDisplay() {
    console.log('🔍 === WALLET TOKEN DISPLAY DIAGNOSTICS ===');
    
    try {
      // 1. Check environment configuration
      console.log('\n1️⃣ Environment Configuration:');
      const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ROAST_TOKEN;
      console.log('   Contract Address:', contractAddress || '❌ NOT CONFIGURED');
      
      if (!contractAddress) {
        console.log('   ❌ ISSUE: Contract address not found in environment');
        return;
      }

      // 2. Check wallet availability
      console.log('\n2️⃣ Wallet Availability:');
      if (typeof window === 'undefined') {
        console.log('   ❌ Running server-side, no wallet access');
        return;
      }
      
      if (!window.ethereum) {
        console.log('   ❌ No wallet provider detected');
        return;
      }
      
      console.log('   ✅ Wallet provider available');

      // 3. Fetch token metadata
      console.log('\n3️⃣ Token Metadata:');
      const metadata = await tokenMetadataService.getROASTTokenMetadata();
      
      if (metadata) {
        console.log('   ✅ Metadata fetched successfully:');
        console.table({
          'Name': metadata.name,
          'Symbol': metadata.symbol,
          'Decimals': metadata.decimals,
          'Contract': metadata.address,
          'Image URL': metadata.image,
          'Current Price': metadata.price ? `$${metadata.price.toFixed(6)}` : 'N/A',
          'Market Cap': metadata.marketCap ? `$${(metadata.marketCap / 1000000).toFixed(2)}M` : 'N/A'
        });
      } else {
        console.log('   ⚠️ Could not fetch metadata from DEX APIs');
      }

      // 4. Test token registration
      console.log('\n4️⃣ Token Registration Test:');
      const registrationSuccess = await ensureROASTTokenDisplay();
      
      if (registrationSuccess) {
        console.log('   ✅ Token registration successful');
        console.log('   💡 Wallet should now display ROAST token amounts correctly');
      } else {
        console.log('   ❌ Token registration failed');
      }

      // 5. Provide recommendations
      console.log('\n5️⃣ Recommendations:');
      console.log('   📱 For best results:');
      console.log('      1. Ensure wallet has ROAST token added manually if auto-registration fails');
      console.log('      2. Try refreshing the page after token registration');
      console.log('      3. Check that wallet is connected to Base network (Chain ID 8453)');
      console.log('      4. Some wallets may take a few seconds to update token display');
      
      return {
        contractAddress,
        walletAvailable: !!window.ethereum,
        metadataAvailable: !!metadata,
        registrationSuccess
      };

    } catch (error) {
      console.error('❌ Diagnostics failed:', error);
      return null;
    }
  }

  /**
   * Quick test for transaction amount display
   */
  static testTransactionAmount(amount: number) {
    console.log('\n🧪 === TRANSACTION AMOUNT TEST ===');
    console.log(`Testing transaction amount: ${amount} ROAST`);
    
    // Convert to wei (18 decimals)
    const amountInWei = BigInt(amount * Math.pow(10, 18));
    
    console.log('📋 Transaction Details:');
    console.log(`   Human Amount: ${amount} ROAST`);
    console.log(`   Wei Amount: ${amountInWei.toString()}`);
    console.log(`   Decimals: 18`);
    
    console.log('\n📱 Expected Wallet Display:');
    console.log(`   "Sending ${amount} ROAST"`);
    console.log(`   "To: [recipient address]"`);
    console.log(`   "Token: BurnieAI by Virtuals"`);
    
    return {
      humanAmount: amount,
      weiAmount: amountInWei.toString(),
      expectedDisplay: `${amount} ROAST`
    };
  }

  /**
   * Force refresh token in wallet
   */
  static async forceTokenRefresh() {
    console.log('🔄 Forcing token refresh in wallet...');
    
    try {
      // Clear cache to get fresh data
      tokenMetadataService.clearCache();
      
      // Re-register token
      await ensureROASTTokenDisplay();
      
      console.log('✅ Token refresh complete');
      console.log('💡 Try your transaction again');
      
      return true;
    } catch (error) {
      console.error('❌ Token refresh failed:', error);
      return false;
    }
  }
}

// Make available globally for browser console testing
if (typeof window !== 'undefined') {
  (window as any).WalletDisplayDebugger = WalletDisplayDebugger;
  console.log('🔧 Wallet Display Debugger available:');
  console.log('   window.WalletDisplayDebugger.diagnoseTokenDisplay()');
  console.log('   window.WalletDisplayDebugger.testTransactionAmount(100)');
  console.log('   window.WalletDisplayDebugger.forceTokenRefresh()');
}

export default WalletDisplayDebugger;
