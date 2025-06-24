# Campaign Contract Interaction Scripts

Independent TypeScript scripts to interact with the deployed Campaign contract on BNB Testnet.

## 📋 Prerequisites

1. **Node.js** (v16 or higher)
2. **Deployed Contracts** on BNB Testnet
3. **Environment Variables** configured

## 🚀 Setup

1. **Install Dependencies:**
   ```bash
   cd scripts
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the scripts directory with:
   ```env
   # Your private key (without 0x prefix)
   PRIVATE_KEY=your_private_key_here
   
   # BNB Testnet RPC URL
   BNB_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545
   
   # Deployed contract addresses
   CAMPAIGN_CONTRACT_ADDRESS=0xa8cfD45D9e2526A49Cf3600C9F7cc79Bf2D6F347
   POINTS_TOKEN_CONTRACT_ADDRESS=0xF04F6222dD96f15466AEf22D7A9129dFeBb07F98
   ```

## 📜 Available Scripts

### 1. Create Campaigns
Creates 10 campaigns on the blockchain.

```bash
npm run create-campaigns
# or
ts-node createCampaigns.ts
```

**Features:**
- Creates exactly 10 campaigns
- Shows transaction hashes
- Displays campaign status after creation
- Verifies campaign count

### 2. Add Submissions
Adds 50 submissions distributed across active campaigns.

```bash
npm run add-submissions
# or
ts-node addSubmissions.ts
```

**Features:**
- Generates realistic dummy submissions
- Distributes submissions across active campaigns
- Uses different AI models (GPT-4, Claude-3, Llama-2, etc.)
- Shows submission distribution summary
- Displays sample submissions before adding

### 3. Select Winners
Selects winners for campaigns that have submissions.

```bash
npm run select-winners
# or
ts-node selectWinners.ts
```

**Features:**
- Automatically detects active campaigns with submissions
- Cycles through predefined winner addresses
- Shows campaign status before and after selection
- Displays transaction hashes

### 4. Mint Tokens
Mints 10 million pROAST tokens to your address.

```bash
npm run mint-tokens
# or
ts-node mintTokens.ts
```

**Features:**
- Mints exactly 10,000,000 pROAST tokens
- Shows before and after balances
- Verifies mint operation
- Displays token information

## 🔄 Recommended Workflow

1. **First Time Setup:**
   ```bash
   npm run create-campaigns
   npm run mint-tokens
   ```

2. **Regular Operations:**
   ```bash
   npm run add-submissions
   npm run select-winners
   ```

## 📊 Script Output Examples

### Create Campaigns Output:
```
Connected with address: 0xE6eF3Bd910a7Cf0f180fA9346964dfFCe0db7c3c
Current campaign count: 0

Creating 10 campaigns...
Creating campaign 1...
✅ Campaign 1 created successfully
   Transaction: https://testnet.bscscan.com/tx/0x...

🎉 Successfully created 10 campaigns!
Final campaign count: 10

📋 Campaign Summary:
   Campaign 1: Active | Winner: None
   Campaign 2: Active | Winner: None
   ...
```

### Add Submissions Output:
```
📝 Adding 50 submissions...
   Submissions will be distributed across campaigns: 1, 2, 3, 4, 5
   Each campaign will receive approximately 10 submissions

📋 Sample Submissions:
   1. Campaign 1 | Model: GPT-4 | Tokens: 145 | Submitter: 0xE6eF...
   2. Campaign 2 | Model: Claude-3 | Tokens: 167 | Submitter: 0x114e...

✅ Submissions added successfully!
   Content ID: 0
   Transaction: https://testnet.bscscan.com/tx/0x...
```

## ⚠️ Important Notes

1. **Gas Fees:** All operations require BNB for gas fees
2. **Network:** Scripts are configured for BNB Testnet
3. **Permissions:** Only the contract owner can create campaigns and mint tokens
4. **Submissions:** Each block contains exactly 50 submissions
5. **Winners:** Winners are selected from predefined addresses

## 🔧 Troubleshooting

### Common Issues:

1. **"PRIVATE_KEY not found"**
   - Ensure your `.env` file exists and contains the private key

2. **"CAMPAIGN_CONTRACT_ADDRESS not found"**
   - Update the contract address in your `.env` file

3. **"Insufficient balance"**
   - Ensure you have enough BNB for gas fees

4. **"Campaign not active"**
   - Campaigns become inactive after winners are selected

### Error Handling:
All scripts include comprehensive error handling and will display helpful error messages if something goes wrong.

## 📞 Support

If you encounter any issues, check:
1. Network connectivity
2. Contract deployment status
3. Environment variable configuration
4. Gas fee availability 