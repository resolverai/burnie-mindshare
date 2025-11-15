const { ethers } = require('ethers');

// Configuration
const RPC_URL = 'https://mainnet.base.org';
const ROAST_TOKEN_ADDRESS = '0x06fe6D0EC562e19cFC491C187F0A02cE8D5083E4';
const WALLET_ADDRESS = '0x5Dd40700322E19c0a99d0DD51129d8C25bd479A2';

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
];

async function checkBalance() {
  try {
    console.log('🔍 Checking ROAST balance on Base Mainnet...\n');
    
    // Connect to Base Mainnet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Create contract instance
    const contract = new ethers.Contract(ROAST_TOKEN_ADDRESS, ERC20_ABI, provider);
    
    // Get token info
    const [name, symbol, decimals, balance] = await Promise.all([
      contract.name(),
      contract.symbol(),
      contract.decimals(),
      contract.balanceOf(WALLET_ADDRESS)
    ]);
    
    // Format balance
    const formattedBalance = ethers.formatUnits(balance, decimals);
    
    console.log('📊 Token Information:');
    console.log('   Name:', name);
    console.log('   Symbol:', symbol);
    console.log('   Decimals:', decimals);
    console.log('   Contract:', ROAST_TOKEN_ADDRESS);
    console.log('');
    console.log('💰 Balance for', WALLET_ADDRESS);
    console.log('   Raw:', balance.toString());
    console.log('   Formatted:', formattedBalance, symbol);
    console.log('');
    
    if (parseFloat(formattedBalance) === 0) {
      console.log('❌ Balance is 0 - wallet has no ROAST tokens');
    } else {
      console.log('✅ Wallet has ROAST tokens!');
    }
    
  } catch (error) {
    console.error('❌ Error checking balance:', error.message);
    process.exit(1);
  }
}

checkBalance();

