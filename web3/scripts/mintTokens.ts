import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// Contract ABI for Campaign contract
const CAMPAIGN_ABI = [
  "function mintPoints(address to, uint256 amount) external",
  "function pointsToken() external view returns (address)"
];

// Contract ABI for PointsToken
const POINTS_TOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

async function mintTokens() {
  try {
    // Connect to BNB Testnet
    const provider = new ethers.JsonRpcProvider(process.env.BNB_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545");
    
    // Create wallet from private key
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("PRIVATE_KEY not found in environment variables");
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Connected with address: ${wallet.address}`);
    
    // Get contract instance
    const campaignAddress = process.env.CAMPAIGN_CONTRACT_ADDRESS;
    if (!campaignAddress) {
      throw new Error("CAMPAIGN_CONTRACT_ADDRESS not found in environment variables");
    }
    
    const campaignContract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, wallet);
    
    // Get PointsToken address
    const pointsTokenAddress = await campaignContract.pointsToken();
    console.log(`PointsToken address: ${pointsTokenAddress}`);
    
    // Get PointsToken contract instance
    const pointsTokenContract = new ethers.Contract(pointsTokenAddress, POINTS_TOKEN_ABI, provider);
    
    // Get token info
    const tokenName = await pointsTokenContract.name();
    const tokenSymbol = await pointsTokenContract.symbol();
    const decimals = await pointsTokenContract.decimals();
    
    console.log(`\n📋 Token Information:`);
    console.log(`   Name: ${tokenName}`);
    console.log(`   Symbol: ${tokenSymbol}`);
    console.log(`   Decimals: ${decimals}`);
    
    // Get current balances
    const currentBalance = await pointsTokenContract.balanceOf(wallet.address);
    const totalSupply = await pointsTokenContract.totalSupply();
    
    console.log(`\n💰 Current Balances:`);
    console.log(`   Your balance: ${ethers.formatUnits(currentBalance, decimals)} ${tokenSymbol}`);
    console.log(`   Total supply: ${ethers.formatUnits(totalSupply, decimals)} ${tokenSymbol}`);
    
    // Calculate 10 million tokens
    const mintAmount = ethers.parseUnits("10000000", Number(decimals)); // 10 million tokens
    console.log(`\n🪙 Minting ${ethers.formatUnits(mintAmount, decimals)} ${tokenSymbol}...`);
    
    // Mint tokens to your address
    console.log(`   Recipient: ${wallet.address}`);
    
    const tx = await campaignContract.mintPoints(wallet.address, mintAmount);
    const receipt = await tx.wait();
    
    console.log(`✅ Tokens minted successfully!`);
    console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
    
    // Get updated balances
    const newBalance = await pointsTokenContract.balanceOf(wallet.address);
    const newTotalSupply = await pointsTokenContract.totalSupply();
    
    console.log(`\n💰 Updated Balances:`);
    console.log(`   Your balance: ${ethers.formatUnits(newBalance, decimals)} ${tokenSymbol}`);
    console.log(`   Total supply: ${ethers.formatUnits(newTotalSupply, decimals)} ${tokenSymbol}`);
    
    // Calculate difference
    const balanceIncrease = newBalance - currentBalance;
    const supplyIncrease = newTotalSupply - totalSupply;
    
    console.log(`\n📊 Changes:`);
    console.log(`   Your balance increased by: ${ethers.formatUnits(balanceIncrease, decimals)} ${tokenSymbol}`);
    console.log(`   Total supply increased by: ${ethers.formatUnits(supplyIncrease, decimals)} ${tokenSymbol}`);
    
    // Verify the mint was successful
    if (balanceIncrease.toString() === mintAmount.toString() && supplyIncrease.toString() === mintAmount.toString()) {
      console.log(`\n🎉 Mint operation verified successfully!`);
    } else {
      console.log(`\n⚠️  Warning: Mint amounts don't match expected values`);
      console.log(`   Expected: ${ethers.formatUnits(mintAmount, decimals)} ${tokenSymbol}`);
      console.log(`   Balance increase: ${ethers.formatUnits(balanceIncrease, decimals)} ${tokenSymbol}`);
      console.log(`   Supply increase: ${ethers.formatUnits(supplyIncrease, decimals)} ${tokenSymbol}`);
    }
    
  } catch (error) {
    console.error('❌ Error minting tokens:', (error as Error).message);
    process.exit(1);
  }
}

// Run the script
mintTokens(); 