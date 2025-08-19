/**
 * ROAST Payment Tester
 * Quick testing utility to verify the working implementation
 */

import { executeROASTPayment, prepareROASTDisplay } from '../services/roastPaymentService';
import { fetchROASTBalance, checkSufficientROASTBalance } from '../services/roastBalanceService';

export class ROASTPaymentTester {
  /**
   * Test the complete ROAST payment flow
   */
  static async testPaymentFlow(walletAddress: string, amount: number, recipientAddress: string) {
    console.log('🧪 === TESTING ROAST PAYMENT FLOW ===');
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Amount: ${amount} ROAST`);
    console.log(`Recipient: ${recipientAddress}`);
    
    try {
      // Step 1: Check balance
      console.log('\n1️⃣ Checking ROAST balance...');
      const balanceCheck = await checkSufficientROASTBalance(walletAddress, amount);
      
      if (!balanceCheck.hasBalance) {
        console.log(`❌ Insufficient balance: ${balanceCheck.userBalance} ROAST (need ${balanceCheck.required})`);
        return { success: false, error: 'Insufficient balance' };
      }
      
      console.log(`✅ Balance check passed: ${balanceCheck.userBalance} ROAST available`);
      
      // Step 2: Prepare token display
      console.log('\n2️⃣ Preparing token display...');
      const displayPrepared = await prepareROASTDisplay();
      console.log(displayPrepared ? '✅ Token display prepared' : '⚠️ Token display preparation skipped');
      
      // Step 3: Execute payment
      console.log('\n3️⃣ Executing payment...');
      const transactionHash = await executeROASTPayment(amount, recipientAddress);
      
      console.log(`✅ Payment successful!`);
      console.log(`Transaction: ${transactionHash}`);
      console.log(`BaseScan: https://basescan.org/tx/${transactionHash}`);
      
      return {
        success: true,
        transactionHash,
        balanceCheck
      };
      
    } catch (error) {
      console.error('❌ Payment test failed:', error);
      return {
        success: false,
        error: error
      };
    }
  }
  
  /**
   * Test balance checking only
   */
  static async testBalanceCheck(walletAddress: string) {
    console.log('🧪 === TESTING BALANCE CHECK ===');
    
    try {
      const balance = await fetchROASTBalance(walletAddress);
      if (balance) {
        console.log('✅ Balance fetched successfully:');
        console.table({
          'Raw Balance': balance.balance,
          'Formatted Balance': `${balance.formattedBalance} ROAST`,
          'Decimals': balance.decimals,
          'Has Balance': balance.hasBalance ? 'Yes' : 'No'
        });
      } else {
        console.log('❌ Failed to fetch balance');
      }
      
      return balance;
    } catch (error) {
      console.error('❌ Balance test failed:', error);
      return null;
    }
  }
  
  /**
   * Test token display preparation
   */
  static async testTokenDisplay() {
    console.log('🧪 === TESTING TOKEN DISPLAY ===');
    
    try {
      const result = await prepareROASTDisplay();
      if (result) {
        console.log('✅ Token display preparation successful');
        console.log('💡 Check your wallet - ROAST token should be visible');
      } else {
        console.log('⚠️ Token display preparation failed or skipped');
        console.log('💡 You may need to add the token manually to your wallet');
      }
      
      return result;
    } catch (error) {
      console.error('❌ Token display test failed:', error);
      return false;
    }
  }
}

// Make available globally for browser console testing
if (typeof window !== 'undefined') {
  (window as any).ROASTPaymentTester = ROASTPaymentTester;
  console.log('🧪 ROAST Payment Tester available in console:');
  console.log('   window.ROASTPaymentTester.testBalanceCheck("0x...")');
  console.log('   window.ROASTPaymentTester.testTokenDisplay()');
  console.log('   window.ROASTPaymentTester.testPaymentFlow("0x...", 100, "0x...")');
}

export default ROASTPaymentTester;
