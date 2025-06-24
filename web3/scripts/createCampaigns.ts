import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// Contract ABI for Campaign contract
const CAMPAIGN_ABI = [
  "function createCampaign() external returns (uint256)",
  "function campaignCounter() external view returns (uint256)",
  "function totalSubmissions(uint256) external view returns (uint256)",
  "event CampaignCreated(uint256 indexed campaignId)"
];

async function createCampaigns() {
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
    const currentCount = await campaignContract.campaignCounter();
    console.log(`Current campaign count: ${currentCount}`);
    
    // Create 10 campaigns
    const numCampaigns = 10;
    console.log(`\nCreating ${numCampaigns} campaigns...`);
    
    for (let i = 1; i <= numCampaigns; i++) {
      console.log(`Creating campaign ${i}...`);
      
      const tx = await campaignContract.createCampaign();
      const receipt = await tx.wait();
      
      // Find the CampaignCreated event
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = campaignContract.interface.parseLog(log);
          return parsed?.name === 'CampaignCreated';
        } catch {
          return false;
        }
      });
      
      if (event) {
        const parsed = campaignContract.interface.parseLog(event);
        if (parsed) {
          console.log(`✅ Campaign ${parsed.args[0]} created successfully`);
          console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
        } else {
          console.log(`✅ Campaign created (parsing failed)`);
          console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
        }
      } else {
        console.log(`✅ Campaign created (event not found)`);
        console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
      }
    }
    
    // Verify final count
    const finalCount = await campaignContract.campaignCounter();
    console.log(`\n🎉 Successfully created ${numCampaigns} campaigns!`);
    console.log(`Final campaign count: ${finalCount}`);
    
    // Display all campaigns
    console.log(`\n📋 Campaign Summary:`);
    for (let i = 1; i <= finalCount; i++) {
      const submissions = await campaignContract.totalSubmissions(i);
      console.log(`   Campaign ${i}: Active | Submissions: ${submissions} | Winner: TBD`);
    }
    
  } catch (error) {
    console.error('❌ Error creating campaigns:', (error as Error).message);
    process.exit(1);
  }
}

// Run the script
createCampaigns(); 