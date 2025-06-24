import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// Contract ABI for Campaign contract
const CAMPAIGN_ABI = [
  "function addSubmission(tuple(uint256 campaignId, tuple(string submissionString, string model, uint256 llmTokensUsed, address submitter) submission)[] calldata _content) external returns(uint256[] memory)",
  "function campaignCounter() external view returns (uint256)",
  "function totalSubmissions(uint256) external view returns (uint256)",
  "event SubmissionAdded(uint256 indexed contentID)"
];

// Generate dummy submissions
function generateSubmissions(campaignIds: number[]): any[] {
  const submissions = [];
  const models = ["GPT-4", "Claude-3", "Llama-2", "Gemini", "Mistral"];
  const submitters = [
    "0xE6eF3Bd910a7Cf0f180fA9346964dfFCe0db7c3c",
    "0x114e375B6FCC6d6fCb68c7A1d407E652C54F25FB", 
    "0x94fFA1C7330845646CE9128450F8e6c3B5e44F86",
    "0x7Cf4be31f546c04787886358b9486ca3d62B9acf",
    "0xA3307BF348ACC4bEDdd67CCA2f7F0c4349d347Db"
  ];
  
  for (let i = 0; i < 50; i++) {
    // const campaignId = i%2==0 ? 1:5
    const campaignId = campaignIds[i % campaignIds.length];
    const model = models[i % models.length];
    const submitter = submitters[i % submitters.length];
    
    submissions.push({
      campaignId: campaignId,
      submission: {
        submissionString: `QmX${i.toString().padStart(10, '0')}abcdefghijklmnopqrstuvwxyz123456789`, // IPFS CID format
        model: model,
        llmTokensUsed: 100 + (i * 10) + (Math.floor(Math.random() * 100)), // Random token usage
        submitter: submitter
      }
    });
  }
  
  return submissions;
}

async function addSubmissions() {
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
    
    if (campaignCount === 0) {
      console.log(`❌ No campaigns found. Please create campaigns first.`);
      return;
    }
    
    // Check which campaigns are active
    console.log(`\n📋 Campaign Status:`);
    const activeCampaigns = [];
    
    for (let i = 1; i <= campaignCount; i++) {
      const submissions = await campaignContract.totalSubmissions(i);
      console.log(`   Campaign ${i}: Active | Submissions: ${submissions} | Winner: TBD`);
      
      activeCampaigns.push(i); // Assume all campaigns are active for now
    }
    
    if (activeCampaigns.length === 0) {
      console.log(`\n❌ No active campaigns found.`);
      return;
    }
    
    console.log(`\n🎯 Active campaigns: ${activeCampaigns.join(', ')}`);
    
    // Generate submissions for active campaigns
    const submissions = generateSubmissions(activeCampaigns);
    
    console.log(`\n📝 Adding 50 submissions...`);
    console.log(`   Submissions will be distributed across campaigns: ${activeCampaigns.join(', ')}`);
    console.log(`   Each campaign will receive approximately ${Math.floor(50 / activeCampaigns.length)} submissions`);
    
    // Display sample submissions
    console.log(`\n📋 Sample Submissions:`);
    for (let i = 0; i < Math.min(5, submissions.length); i++) {
      const sub = submissions[i];
      console.log(`   ${i + 1}. Campaign ${sub.campaignId} | Model: ${sub.submission.model} | Tokens: ${sub.submission.llmTokensUsed} | Submitter: ${sub.submitter}`);
    }
    
    // Add submissions
    console.log(`\n🚀 Submitting to blockchain...`);
    
    const tx = await campaignContract.addSubmission(submissions);
    const receipt = await tx.wait();
    
    // Find the SubmissionAdded event
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = campaignContract.interface.parseLog(log);
        return parsed?.name === 'SubmissionAdded';
      } catch {
        return false;
      }
    });
    
    if (event) {
      const parsed = campaignContract.interface.parseLog(event);
      if (parsed) {
        console.log(`✅ Submissions added successfully!`);
        console.log(`   Content ID: ${parsed.args[0]}`);
        console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
      } else {
        console.log(`✅ Submissions added (parsing failed)`);
        console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
      }
    } else {
      console.log(`✅ Submissions added (event not found)`);
      console.log(`   Transaction: https://testnet.bscscan.com/tx/${tx.hash}`);
    }
    
    // Display updated status
    console.log(`\n📋 Updated Campaign Status:`);
    for (let i = 1; i <= campaignCount; i++) {
      const submissions = await campaignContract.totalSubmissions(i);
      const status = submissions > 0 ? 'Active' : 'Inactive';
      
      console.log(`   Campaign ${i}: ${status} | Submissions: ${submissions} | Winner: TBD`);
    }
    
    // Show distribution summary
    console.log(`\n📊 Submission Distribution Summary:`);
    for (const campaignId of activeCampaigns) {
      const submissions = await campaignContract.totalSubmissions(campaignId);
      console.log(`   Campaign ${campaignId}: ${submissions} submissions`);
    }
    
  } catch (error) {
    console.error('❌ Error adding submissions:', (error as Error).message);
    process.exit(1);
  }
}

// Run the script
addSubmissions(); 