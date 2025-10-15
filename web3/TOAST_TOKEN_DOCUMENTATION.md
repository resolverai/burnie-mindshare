# TOAST Token Smart Contract Documentation

## Overview

The TOAST Token is an ERC-20 compatible token designed for the Burnie Platform on Somnia Network. It features a fixed supply of 1 billion tokens with advanced functionality including staking, gaming rewards, anti-whale protection, and emergency controls.

## Contract Features

### 🔥 Core Features
- **Fixed Supply**: 1,000,000,000 TOAST tokens (18 decimals)
- **ERC-20 Compatible**: Full ERC-20 standard compliance
- **Burnable**: Users can burn their tokens to reduce supply
- **Pausable**: Emergency pause functionality for transfers
- **Owner Controls**: Administrative functions for platform management

### 🎮 Gaming & Staking Features
- **Staking System**: Users can stake tokens to earn 5% APY rewards
- **Gaming Rewards**: Authorized distributors can reward users for gaming activities
- **Anti-Whale Protection**: Maximum 10M tokens per transaction
- **Reward Distribution**: Automated reward calculations and distributions

### 🔒 Security Features
- **ReentrancyGuard**: Protection against reentrancy attacks
- **Access Control**: Owner-only functions with proper authorization
- **Emergency Controls**: Pause, emergency withdrawals, and recovery functions

## Prerequisites

Before deploying or interacting with the TOAST token, ensure you have:

1. **Node.js** (v16 or higher)
2. **Hardhat** development environment
3. **Somnia Testnet** access and test ETH
4. **Private Key** with sufficient ETH for gas fees

## Installation & Setup

### 1. Install Dependencies

```bash
cd web3
npm install
npm install axios  # Required for Somnia Explorer API integration
```

### 2. Environment Configuration

Create a `.env` file in the `web3` directory:

```bash
# Copy example file
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Blockchain Configuration
PRIVATE_KEY=your_private_key_here
SOMNIA_TESTNET_RPC_URL=https://dream-rpc.somnia.network
SOMNIA_MAINNET_RPC_URL=https://rpc.somnia.network

# Contract Addresses (populated after deployment)
TOAST_TOKEN_ADDRESS=
ROAST_TOKEN_ADDRESS=

# Gas Configuration
REPORT_GAS=true
```

### 3. Compile Contracts

```bash
npm run compile
```

## Available NPM Scripts

The project includes comprehensive npm scripts for all blockchain operations. No need to use `npx` commands!

### 🔨 **Development Scripts**
```bash
npm run compile          # Compile smart contracts
npm run test            # Run test suite
npm run test:coverage   # Run tests with coverage report
npm run test:gas        # Run tests with gas reporting
npm run clean           # Clean compiled artifacts
npm run typechain       # Generate TypeScript bindings
npm run lint            # Lint TypeScript files
npm run lint:fix        # Fix linting issues automatically
```

### 🚀 **Deployment Scripts**
```bash
# Testnet Deployment
npm run deploy:toast:testnet    # Deploy TOAST to Somnia testnet
npm run deploy:toast:local      # Deploy to local Hardhat network

# Mainnet Deployment
npm run deploy:toast:mainnet    # Deploy TOAST to Somnia mainnet

# Combined Development Workflows
npm run dev:setup              # Compile + generate types
npm run dev:test              # Compile + run tests
npm run dev:deploy            # Compile + deploy to testnet
npm run dev:full              # Full development workflow

# Production Workflows
npm run prod:deploy           # Deploy to mainnet
npm run prod:verify          # Verify on mainnet
npm run prod:monitor         # Monitor mainnet contract
```

### 🔍 **Interaction & Monitoring Scripts**
```bash
# Contract Interaction
npm run interact:toast:testnet   # Interact with testnet contract
npm run interact:toast:mainnet   # Interact with mainnet contract
npm run interact:toast:local     # Interact with local contract

# Contract Monitoring
npm run monitor:toast:testnet    # Monitor testnet contract
npm run monitor:toast:mainnet    # Monitor mainnet contract
npm run explorer:monitor         # Quick monitor (alias)

# Network Utilities
npm run network:info:testnet     # Get testnet network info
npm run network:info:mainnet     # Get mainnet network info
npm run explorer:info           # Quick network info (alias)

# Balance Checking
npm run balance:check           # Check balances on testnet
npm run balance:check:mainnet   # Check balances on mainnet
```

### ✅ **Verification Scripts**
```bash
# Contract Verification
npm run verify:testnet <address> <args>    # Verify on Somnia testnet
npm run verify:mainnet <address> <args>    # Verify on Somnia mainnet
npm run verify:base:testnet <address>      # Verify on Base testnet
npm run verify:base:mainnet <address>      # Verify on Base mainnet
```

### 🖥️ **Console & Node Scripts**
```bash
# Hardhat Console
npm run console:testnet         # Console on Somnia testnet
npm run console:mainnet         # Console on Somnia mainnet
npm run console:local           # Console on local network
npm run console:base:testnet    # Console on Base testnet
npm run console:base:mainnet    # Console on Base mainnet

# Local Development
npm run node                    # Start local Hardhat node
```

## Quick Start Workflow

### For Development:
```bash
# 1. Setup environment
npm install
npm run dev:setup

# 2. Run tests
npm run dev:test

# 3. Deploy to testnet
npm run dev:deploy

# 4. Interact with contract
npm run interact:toast:testnet

# 5. Monitor contract
npm run monitor:toast:testnet
```

### For Production:
```bash
# 1. Deploy to mainnet
npm run prod:deploy

# 2. Verify contract
npm run verify:mainnet <CONTRACT_ADDRESS> <OWNER_ADDRESS>

# 3. Monitor deployment
npm run prod:monitor
```

## Deployment Commands

### Deploy to Somnia Testnet

```bash
# Deploy TOAST token to Somnia testnet
npm run deploy:toast:testnet

# Alternative: Deploy with full development setup
npm run dev:deploy
```

### Deploy to Somnia Mainnet

```bash
# Deploy TOAST token to Somnia mainnet
npm run deploy:toast:mainnet

# Alternative: Production deployment with verification
npm run prod:deploy
```

### Deploy to Local Network

```bash
# Start local Hardhat node
npm run node

# Deploy to local network (in another terminal)
npm run deploy:toast:local
```

### Verify Contract on Explorer

```bash
# Verify on Somnia testnet
npm run verify:testnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>

# Verify on Somnia mainnet
npm run verify:mainnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>

# Example:
npm run verify:testnet 0x1234567890123456789012345678901234567890 "0xYourOwnerAddress"
```

## Contract Interaction Commands

### Basic Token Operations

```bash
# Run interaction script (includes Somnia Explorer integration)
npm run interact:toast:testnet

# Run on mainnet
npm run interact:toast:mainnet

# Run on local network
npm run interact:toast:local
```

### Monitor Contract on Somnia Explorer

```bash
# Monitor contract activity and statistics on testnet
npm run monitor:toast:testnet

# Monitor on mainnet
npm run monitor:toast:mainnet

# Quick explorer monitoring (alias)
npm run explorer:monitor
```

This monitoring script provides:
- Real-time contract statistics
- Token holder information
- Recent transaction history
- Network status and block information
- Integration with Somnia Shannon Explorer API

### Network Information & Utilities

```bash
# Get comprehensive network information
npm run network:info:testnet
npm run network:info:mainnet

# Check account and token balances
npm run balance:check
npm run balance:check:mainnet

# Get network info (alias)
npm run explorer:info
```

### Manual Interactions via Hardhat Console

```bash
# Open Hardhat console on testnet
npm run console:testnet

# Open console on mainnet
npm run console:mainnet

# Open console on local network
npm run console:local
```

Then in the console:

```javascript
// Connect to deployed contract
const toastToken = await ethers.getContractAt("TOASTToken", "YOUR_CONTRACT_ADDRESS");

// Check basic info
await toastToken.name();
await toastToken.symbol();
await toastToken.totalSupply();

// Check balance
await toastToken.balanceOf("0xYourAddress");

// Transfer tokens
await toastToken.transfer("0xRecipientAddress", ethers.parseEther("1000"));

// Approve spending
await toastToken.approve("0xSpenderAddress", ethers.parseEther("500"));

// Stake tokens
await toastToken.stake(ethers.parseEther("1000"));

// Check staking info
await toastToken.getStakingInfo("0xYourAddress");

// Unstake tokens
await toastToken.unstake(ethers.parseEther("500"));
```

## Testing

### Run All Tests

```bash
# Run complete test suite
npx hardhat test
```

### Run Specific Test File

```bash
# Run only TOAST token tests
npx hardhat test test/TOASTToken.test.ts
```

### Run Tests with Gas Reporting

```bash
# Generate gas usage report
REPORT_GAS=true npx hardhat test
```

### Test Coverage

```bash
# Generate test coverage report
npx hardhat coverage
```

## Contract Functions Reference

### Public Read Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `name()` | Token name | "TOAST Token" |
| `symbol()` | Token symbol | "TOAST" |
| `decimals()` | Token decimals | 18 |
| `totalSupply()` | Total token supply | 1,000,000,000 * 10^18 |
| `balanceOf(address)` | Token balance of address | uint256 |
| `allowance(owner, spender)` | Approved spending amount | uint256 |
| `stakedBalance(address)` | Staked tokens of address | uint256 |
| `getStakingInfo(address)` | Complete staking information | (staked, timestamp, pendingRewards) |
| `gameRewardDistributors(address)` | Check if address can distribute rewards | bool |
| `version()` | Contract version | "1.0.0" |

### Public Write Functions

| Function | Description | Access |
|----------|-------------|--------|
| `transfer(to, amount)` | Transfer tokens | Any holder |
| `transferFrom(from, to, amount)` | Transfer using allowance | Approved spender |
| `approve(spender, amount)` | Approve token spending | Any holder |
| `stake(amount)` | Stake tokens for rewards | Any holder |
| `unstake(amount)` | Unstake tokens and claim rewards | Staker |
| `claimStakingRewards()` | Claim pending staking rewards | Staker |
| `burn(amount)` | Burn tokens (reduce supply) | Token holder |

### Owner-Only Functions

| Function | Description | Access |
|----------|-------------|--------|
| `distributeGameReward(recipient, amount, reason)` | Distribute gaming rewards | Game distributors |
| `addGameRewardDistributor(address)` | Add reward distributor | Owner |
| `removeGameRewardDistributor(address)` | Remove reward distributor | Owner |
| `pause()` | Pause all token transfers | Owner |
| `unpause()` | Resume token transfers | Owner |
| `emergencyWithdrawETH()` | Withdraw accidentally sent ETH | Owner |
| `emergencyWithdrawToken(token, amount)` | Withdraw accidentally sent tokens | Owner |

## Events

### Token Events
- `Transfer(from, to, value)` - ERC-20 transfer
- `Approval(owner, spender, value)` - ERC-20 approval

### Staking Events
- `Staked(user, amount)` - User staked tokens
- `Unstaked(user, amount)` - User unstaked tokens
- `StakingRewardsClaimed(user, amount)` - Staking rewards claimed

### Gaming Events
- `GameRewardDistributed(recipient, amount, reason)` - Game reward distributed
- `GameRewardDistributorAdded(distributor)` - New distributor added
- `GameRewardDistributorRemoved(distributor)` - Distributor removed

### Control Events
- `Paused()` - Contract paused
- `Unpaused()` - Contract unpaused
- `OwnershipTransferred(previousOwner, newOwner)` - Ownership changed

## Somnia Shannon Explorer Integration

The TOAST token project includes comprehensive integration with the [Somnia Explorer](https://somnia.w3us.site) for enhanced monitoring and interaction capabilities.

### Explorer API Features

Our `somniaExplorerAPI.ts` provides the following functionality:

#### Account Operations
- Get account ETH balance
- Retrieve transaction history
- Monitor token transfers
- Track account activity

#### Contract Operations
- Fetch contract source code and ABI
- Verify contract deployment status
- Monitor contract interactions
- Get token supply and holder information

#### Transaction Monitoring
- Real-time transaction status
- Gas usage tracking
- Transaction receipt verification
- Block confirmation monitoring

### Using the Explorer API

```typescript
import { somniaExplorer } from "./scripts/somniaExplorerAPI";

// Get token information
const tokenInfo = await somniaExplorer.getTOASTTokenInfo(contractAddress);

// Monitor account balance
const balance = await somniaExplorer.getAccountTOASTBalance(contractAddress, userAddress);

// Get transaction history
const transactions = await somniaExplorer.getAccountTOASTTransactions(contractAddress, userAddress);

// Verify contract deployment
const verification = await somniaExplorer.verifyContractDeployment(contractAddress, txHash);
```

### Explorer URLs

All scripts automatically generate relevant Somnia Explorer URLs:

- **Contract**: `https://somnia.w3us.site/address/{contractAddress}`
- **Transaction**: `https://somnia.w3us.site/tx/{txHash}`
- **Block**: `https://somnia.w3us.site/block/{blockNumber}`

### API Configuration

The Somnia Explorer API does not require an API key and uses the base URL:
```
https://somnia.w3us.site/api/v2/
```

All API calls are made without authentication and have no rate limits.

## Security Considerations

### Anti-Whale Protection
- Maximum transfer limit: 10,000,000 TOAST per transaction
- Prevents large holders from manipulating the market

### Reentrancy Protection
- All state-changing functions use `nonReentrant` modifier
- Protects against reentrancy attacks

### Access Control
- Owner-only functions properly protected
- Game reward distributors must be explicitly authorized

### Emergency Controls
- Pausable transfers for emergency situations
- Emergency withdrawal functions for recovery
- Owner can be transferred if needed

## Gas Optimization

The contract is optimized for gas efficiency:
- Compiler optimization enabled (200 runs)
- Efficient storage layout
- Minimal external calls
- Batch operations where possible

## Troubleshooting

### Common Issues

1. **"Insufficient balance" Error**
   - Check token balance before transfers
   - Ensure you have enough tokens for the operation

2. **"Transfer amount exceeds maximum limit" Error**
   - Maximum transfer is 10M TOAST tokens
   - Split large transfers into smaller amounts

3. **"Not authorized to distribute game rewards" Error**
   - Only authorized distributors can give game rewards
   - Owner must add address as distributor first

4. **"Contract paused" Error**
   - All transfers are paused during emergency
   - Wait for owner to unpause the contract

### Network Issues

1. **RPC Connection Problems**
   - Verify Somnia testnet RPC URL is correct
   - Check network connectivity
   - Try alternative RPC endpoints

2. **Gas Estimation Failures**
   - Increase gas limit manually
   - Check account has sufficient ETH
   - Verify contract state allows the operation

## Migration from TOAST to ROAST

When ready to deploy the production ROAST token:

1. Copy `TOASTToken.sol` to `ROASTToken.sol`
2. Update contract name and constructor
3. Update deployment script
4. Deploy to Somnia mainnet
5. Update environment variables

## Support

For technical support or questions:
- Check the Hardhat documentation
- Review Somnia network documentation
- Consult OpenZeppelin contract documentation
- Test on Somnia testnet before mainnet deployment

## License

This contract is released under the MIT License.
