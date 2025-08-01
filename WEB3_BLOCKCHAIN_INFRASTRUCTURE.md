# Web3 Blockchain Infrastructure for Burnie Mindshare Platform

## 🎯 Overview

The web3 folder contains a comprehensive blockchain infrastructure designed to support the Burnie mindshare platform's core functionality. The system tracks miner submissions, manages campaigns, distributes rewards, and stores content on IPFS across multiple blockchain networks.

## 🏗️ Blockchain Architecture

### **Multi-Chain Deployment Strategy**
The infrastructure is designed to deploy across multiple blockchain networks:

- **Base Network**: Primary deployment (Mainnet & Testnet)
- **Binance Smart Chain**: Secondary deployment (Testnet configured)
- **Flow Blockchain**: Alternative implementation using Cadence
- **Local Development**: Hardhat local network for testing

### **Core Infrastructure Components**

```
web3/
├── contracts/              # Smart contracts (Solidity)
├── flow/                   # Flow blockchain implementation (Cadence)
├── scripts/                # Deployment and interaction scripts
├── pinata-upload/          # IPFS content storage
├── ignition/               # Deployment configurations
├── Interfaces/             # Contract ABIs and interfaces
└── hardhat.config.ts       # Network configurations
```

## 📜 Smart Contracts Overview

### **1. Campaign Contract (`campaign.sol`)**
**Purpose**: Core contract managing mining campaigns, submissions, and rewards

**Key Features**:
- **Block-Based Submissions**: Exactly 50 submissions per block (batch processing)
- **Campaign Management**: Create campaigns, track status (Active/Inactive)
- **Submission Tracking**: Store CID, AI model, token usage, and submitter address
- **Winner Selection**: Select winners and manage rewards
- **Reward Distribution**: Distribute points to winners

**Core Parameters**:
```solidity
uint8 immutable totalPerBlock = 50;           // 50 submissions per block
uint16 immutable maxSubmissionsPerCampaign = 1500;  // Max 1500 submissions per campaign
uint256 immutable maxRewardPerCampaign = 100000 * 10 ** 18;  // 100k tokens max reward
```

**Key Functions**:
- `createCampaign()`: Creates new campaigns (owner only)
- `addSubmission()`: Adds 50 submissions in a batch (owner only)
- `selectWinners()`: Selects campaign winners (owner only)
- `dispersePoints()`: Distributes rewards to winners (owner only)

### **2. PointsToken Contract (`PointsToken.sol`)**
**Purpose**: ERC20 token for campaign rewards and points

**Features**:
- **Standard ERC20**: Full ERC20 functionality
- **Burnable**: Tokens can be burned
- **Permit Functionality**: Gasless approvals
- **Mintable**: Owner can mint new tokens
- **Initial Supply**: 1 million tokens

### **3. BaseToken Contract (`BaseToken.sol`)**
**Purpose**: Alternative ERC20 token optimized for Base blockchain

**Features**:
- **Larger Supply**: 100 million tokens initial supply
- **Base-Optimized**: Optimized for Base blockchain deployment
- **Same Features**: Burnable, Permit, Mintable

### **4. Flow Implementation (`flow/campaign.cdc`)**
**Purpose**: Campaign contract implementation in Cadence for Flow blockchain

**Features**:
- **Native Flow Integration**: Uses Flow's resource-oriented programming
- **Similar Functionality**: Mirrors Solidity contract features
- **Flow-Specific Optimizations**: Leverages Flow's unique capabilities

## 🛠️ Deployment & Interaction Scripts

### **Available Scripts** (`web3/scripts/`)

#### **1. Deployment Scripts**
- `deploy.ts`: Basic contract deployment
- `deployCampaign.ts`: Deploy Campaign and PointsToken contracts

#### **2. Campaign Management**
- `createCampaigns.ts`: Create multiple campaigns (default: 10)
- `addSubmissions.ts`: Add 50 submissions in batches
- `selectWinners.ts`: Select winners for campaigns with submissions

#### **3. Token Management**
- `mintTokens.ts`: Mint pROAST tokens (default: 10 million)
- `stakingInterface.ts`: Staking functionality interface
- `getStakedAmount.ts`: Query staked token amounts

### **Script Usage Workflow**

```bash
# 1. Initial Setup
npm run create-campaigns    # Creates 10 campaigns
npm run mint-tokens        # Mints 10M pROAST tokens

# 2. Regular Operations
npm run add-submissions    # Adds 50 submissions per batch
npm run select-winners     # Selects winners for completed campaigns
```

## 📊 Blockchain Data Structure

### **Submission Data Model**
```solidity
struct Submission {
    string submissionString;  // IPFS CID (Content Identifier)
    string model;            // AI Model used (GPT-4, Claude-3, etc.)
    uint256 llmTokensUsed;   // Number of AI tokens consumed
    address submitter;       // Ethereum address of the miner
}
```

### **Content Structure**
```solidity
struct content {
    uint256 campaignId;      // Campaign ID this submission belongs to
    Submission submission;   // The actual submission data
}
```

### **Campaign Data**
```solidity
struct CampaignStruct {
    Status status;           // Active/Inactive
    uint256[] submissionIds; // Array of submission IDs
    address winner;          // Winner address (if selected)
}
```

## 💾 IPFS Integration (`pinata-upload/`)

### **Purpose**
Store content submissions on IPFS for decentralized, permanent storage

### **Features**
- **Pinata API Integration**: Direct upload to Pinata IPFS service
- **CID Generation**: Returns Content Identifier for blockchain storage
- **Gateway URLs**: Provides public access URLs
- **Standalone Script**: Independent TypeScript utility

### **Usage**
```bash
# Upload content to IPFS
ts-node uploadToPinata.ts "content text" filename.txt

# Programmatic usage
const cid = await uploadStringToPinata("content", "file.txt");
```

### **Integration Flow**
1. **Miner generates content** → Upload to IPFS via Pinata
2. **Receive CID** → Store CID in blockchain submission
3. **Content retrievable** → Anyone can access via IPFS CID

## 🌐 Network Configuration

### **Configured Networks** (`hardhat.config.ts`)

#### **Base Networks**
- **Base Mainnet**: Primary production deployment
  - Chain ID: 8453
  - RPC: `https://mainnet.base.org`
- **Base Testnet (Sepolia)**
  - Chain ID: 84532
  - RPC: `https://sepolia.base.org`

#### **Binance Smart Chain**
- **BSC Testnet**: Secondary deployment
  - Chain ID: 97
  - RPC: `https://data-seed-prebsc-1-s1.binance.org:8545`

#### **Local Development**
- **Hardhat Network**: Local testing
  - Chain ID: 31337

### **Contract Verification**
- **BaseScan Integration**: Automatic contract verification on Base
- **BSCScan Integration**: Contract verification on BSC
- **API Keys Configured**: For automated verification

## 🔄 Operational Workflow

### **1. Campaign Lifecycle**
```
1. Create Campaign (Owner) 
   ↓
2. Campaign becomes Active
   ↓
3. Miners submit content (50 per block)
   ↓
4. Content stored on IPFS (CID)
   ↓
5. CID stored on blockchain
   ↓
6. Winner selection (Owner)
   ↓
7. Campaign becomes Inactive
   ↓
8. Rewards distributed to winner
```

### **2. Submission Process**
```
Miner creates content 
   ↓
Upload to IPFS (get CID)
   ↓
Submit to blockchain (with metadata)
   ↓
Content tracked on-chain
   ↓
Available for winner selection
```

### **3. Reward Distribution**
```
Campaign completed
   ↓
Owner selects winner
   ↓
Winner address stored on-chain
   ↓
Pending rewards calculated
   ↓
Points dispersed to winner
   ↓
Transaction recorded on blockchain
```

## 🎯 Key Benefits & Features

### **Transparency**
- **On-Chain Tracking**: All submissions recorded on blockchain
- **Public Verification**: Anyone can verify submissions and rewards
- **Immutable History**: Permanent record of all activities

### **Scalability**
- **Batch Processing**: 50 submissions per transaction (gas optimization)
- **Multi-Chain Support**: Deploy on multiple networks
- **IPFS Storage**: Decentralized content storage

### **Security**
- **Owner-Only Operations**: Critical functions restricted to contract owner
- **Smart Contract Audited**: Uses OpenZeppelin standard contracts
- **Multi-Network Redundancy**: Backup deployments across chains

### **Flexibility**
- **Multiple AI Models**: Track different AI model usage
- **Variable Rewards**: Configurable reward amounts
- **Campaign Limits**: Configurable submission limits

## 📈 Current Deployment Status

### **Deployed Contracts** (BNB Testnet)
- **Campaign Contract**: `0xa8cfD45D9e2526A49Cf3600C9F7cc79Bf2D6F347`
- **Points Token**: `0xF04F6222dD96f15466AEf22D7A9129dFeBb07F98`

### **Operational Status**
- ✅ **BNB Testnet**: Fully operational
- ⏳ **Base Network**: Ready for deployment
- ⏳ **Flow Network**: Contract ready, deployment pending

## 🚀 Integration with Burnie Platform

### **Backend Integration Points**
1. **Submission Tracking**: Backend calls blockchain to record submissions
2. **Campaign Management**: Backend triggers campaign creation/winner selection
3. **Reward Distribution**: Automated reward distribution via smart contracts
4. **Content Storage**: IPFS integration for permanent content storage

### **Frontend Features**
1. **Submission History**: Display user's on-chain submissions
2. **Campaign Status**: Real-time campaign progress
3. **Reward Tracking**: Show pending and distributed rewards
4. **Blockchain Explorer**: Links to view transactions on block explorers

### **API Integration**
```typescript
// Example integration
interface BlockchainSubmission {
  campaignId: number;
  submissionCID: string;
  aiModel: string;
  tokensUsed: number;
  submitterAddress: string;
  transactionHash: string;
  blockNumber: number;
}
```

## 🔧 Technical Specifications

### **Contract Architecture**
- **Solidity Version**: 0.8.28
- **OpenZeppelin Integration**: Standard, audited contracts
- **Gas Optimization**: Batch processing for efficiency
- **Upgrade Pattern**: Ownable contracts for administrative control

### **IPFS Integration**
- **Pinata Service**: Professional IPFS pinning service
- **Content Addressing**: CID-based content identification
- **Gateway Access**: Multiple access points for content retrieval
- **Redundancy**: Distributed storage across IPFS network

### **Testing Infrastructure**
- **Hardhat Framework**: Comprehensive testing environment
- **TypeScript Support**: Full TypeScript integration
- **Network Simulation**: Local blockchain for development
- **Gas Reporting**: Detailed gas usage analysis

## 💡 Future Enhancements

### **Planned Features**
1. **Cross-Chain Bridge**: Enable cross-chain reward transfers
2. **DAO Governance**: Transition to community governance
3. **NFT Integration**: Mint NFTs for top submissions
4. **Staking Mechanisms**: Token staking for enhanced rewards
5. **Layer 2 Integration**: Deploy on Polygon, Arbitrum for lower fees

### **Scalability Improvements**
1. **Batch Optimization**: Larger batch sizes for better efficiency
2. **Event Indexing**: Enhanced event tracking and querying
3. **Oracle Integration**: Real-world data feeds for campaigns
4. **Automated Winner Selection**: AI-powered winner selection

---

**📝 Summary**: The web3 infrastructure provides a comprehensive blockchain foundation for the Burnie platform, enabling transparent tracking of miner submissions, automated reward distribution, and permanent content storage across multiple blockchain networks. The system is designed for scalability, security, and seamless integration with the main platform. 