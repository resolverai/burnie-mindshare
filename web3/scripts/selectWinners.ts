import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// Contract ABI for Campaign contract
const CAMPAIGN_ABI = [
  "function selectWinners(uint256 campaignId, uint256 winnerSubmissionId, address _winner) external",
  "function campaignCounter() external view returns (uint256)",
  "function totalSubmissions(uint256) external view returns (uint256)",
  "event WinnersSelected(uint256 indexed campaignId, uint256 winnerSubmissionId, address winner)"
];

async function selectWinners() {
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
    
    // Get current campaign count
    const campaignCount = await campaignContract.campaignCounter();
    console.log(`Total campaigns: ${campaignCount}`);
    
    // Check which campaigns are active and have submissions
    console.log(`\n📋 Campaign Status:`);
    const activeCampaigns = [];
    
    for (let i = 1; i <= campaignCount; i++) {
      const submissions = await campaignContract.totalSubmissions(i);
      console.log(`   Campaign ${i}: Active | Submissions: ${submissions} | Winner: TBD`);
      
      if (submissions > 0) { // Has submissions
        activeCampaigns.push(i);
      }
    }
    
    if (activeCampaigns.length === 0) {
      console.log(`\n❌ No active campaigns with submissions found.`);
      return;
    }
    
    console.log(`\n🎯 Active campaigns with submissions: ${activeCampaigns.join(', ')}`);
    
    // Select winners for active campaigns
    const winners = [
      "0xE6eF3Bd910a7Cf0f180fA9346964dfFCe0db7c3c", // user1
      "0x114e375B6FCC6d6fCb68c7A1d407E652C54F25FB", // user2
      "0x94fFA1C7330845646CE9128450F8e6c3B5e44F86", // user3
      "0x7Cf4be31f546c04787886358b9486ca3d62B9acf", // user4
      "0xA3307BF348ACC4bEDdd67CCA2f7F0c4349d347Db"  // user5
    ];
    
    console.log(`\n🏆 Selecting winners...`);
    
    for (let i = 0; i < activeCampaigns.length; i++) {
      const campaignId = activeCampaigns[i];
      const winner = winners[i % winners.length]; // Cycle through winners
      const submissionId = i + 1; // Dummy submission ID
      
      console.log(`Selecting winner for Campaign ${campaignId}...`);
      console.log(`   Winner: ${winner}`);
      console.log(`   Submission ID: ${submissionId}`);
      
      try {
        const tx = await campaignContract.selectWinners(campaignId, submissionId, winner);
        const receipt = await tx.wait();
        
        // Find the WinnersSelected event
        const event = receipt.logs.find((log: any) => {
          try {
            const parsed = campaignContract.interface.parseLog(log);
            return parsed?.name === 'WinnersSelected';
          } catch {
            return false;
          }
        });
        
        if (event) {
          const parsed = campaignContract.interface.parseLog(event);
          if (parsed) {
            console.log(`✅ Winner selected for Campaign ${parsed.args[0]}`);
            console.log(`   Winner: ${parsed.args[2]}`);
            console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
          } else {
            console.log(`✅ Winner selected (parsing failed)`);
            console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
          }
        } else {
          console.log(`✅ Winner selected (event not found)`);
          console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
        }
        
      } catch (error) {
        console.log(`❌ Failed to select winner for Campaign ${campaignId}:`, (error as Error).message);
      }
    }
    
    // Display final status
    console.log(`\n📋 Final Campaign Status:`);
    for (let i = 1; i <= campaignCount; i++) {
      const submissions = await campaignContract.totalSubmissions(i);
      console.log(`   Campaign ${i}: Active | Submissions: ${submissions} | Winner: TBD`);
    }
    
  } catch (error) {
    console.error('❌ Error selecting winners:', error);
    process.exit(1);
  }
}

// Run the script
selectWinners(); 