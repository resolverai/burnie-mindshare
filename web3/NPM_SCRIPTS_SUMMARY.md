# NPM Scripts Summary - Burnie Web3 Project

## Overview

All blockchain and Hardhat-related interactions can now be run using `npm run` commands instead of `npx`. This provides better consistency, easier command discovery, and simplified workflows.

## 📋 **Complete NPM Scripts List**

### 🔨 **Core Development Scripts**
```bash
npm run compile          # Compile smart contracts
npm run test            # Run test suite
npm run test:coverage   # Run tests with coverage report
npm run test:gas        # Run tests with gas reporting (REPORT_GAS=true)
npm run clean           # Clean compiled artifacts
npm run typechain       # Generate TypeScript bindings
npm run node            # Start local Hardhat node
npm run lint            # Lint TypeScript files
npm run lint:fix        # Fix linting issues automatically
```

### 🚀 **Deployment Scripts**

#### **TOAST Token Deployment**
```bash
npm run deploy:toast:testnet    # Deploy to Somnia testnet
npm run deploy:toast:mainnet    # Deploy to Somnia mainnet
npm run deploy:toast:local      # Deploy to local Hardhat network
```

#### **Development Workflows**
```bash
npm run dev:setup              # Compile + generate TypeScript types
npm run dev:test              # Compile + run full test suite
npm run dev:deploy            # Compile + deploy to testnet
npm run dev:full              # Complete development workflow
```

#### **Production Workflows**
```bash
npm run prod:deploy           # Deploy to mainnet
npm run prod:verify          # Verify contract on mainnet
npm run prod:monitor         # Monitor mainnet contract
```

### 🔍 **Contract Interaction Scripts**

#### **Basic Interactions**
```bash
npm run interact:toast:testnet   # Interact with testnet contract
npm run interact:toast:mainnet   # Interact with mainnet contract
npm run interact:toast:local     # Interact with local contract
```

#### **Contract Monitoring**
```bash
npm run monitor:toast:testnet    # Monitor testnet contract activity
npm run monitor:toast:mainnet    # Monitor mainnet contract activity
npm run explorer:monitor         # Quick monitor alias (testnet)
```

### 🌐 **Network & Utility Scripts**

#### **Network Information**
```bash
npm run network:info:testnet     # Get Somnia testnet network info
npm run network:info:mainnet     # Get Somnia mainnet network info
npm run explorer:info           # Quick network info alias (testnet)
```

#### **Balance Checking**
```bash
npm run balance:check           # Check ETH & token balances (testnet)
npm run balance:check:mainnet   # Check ETH & token balances (mainnet)
```

### ✅ **Contract Verification Scripts**

#### **Somnia Networks**
```bash
npm run verify:testnet <address> <args>    # Verify on Somnia testnet
npm run verify:mainnet <address> <args>    # Verify on Somnia mainnet
```

#### **Base Networks (Future Use)**
```bash
npm run verify:base:testnet <address>      # Verify on Base testnet
npm run verify:base:mainnet <address>      # Verify on Base mainnet
```

### 🖥️ **Console & Development Scripts**

#### **Hardhat Console Access**
```bash
npm run console:testnet         # Open console on Somnia testnet
npm run console:mainnet         # Open console on Somnia mainnet
npm run console:local           # Open console on local network
npm run console:base:testnet    # Open console on Base testnet
npm run console:base:mainnet    # Open console on Base mainnet
```

## 🎯 **Common Usage Patterns**

### **Quick Development Cycle**
```bash
# Setup and test
npm run dev:setup
npm run dev:test

# Deploy and interact
npm run dev:deploy
npm run interact:toast:testnet
npm run monitor:toast:testnet
```

### **Production Deployment**
```bash
# Deploy to mainnet
npm run prod:deploy

# Verify contract (replace with actual values)
npm run verify:mainnet 0xYourContractAddress "0xYourOwnerAddress"

# Monitor deployment
npm run prod:monitor
```

### **Development Debugging**
```bash
# Check environment and balances
npm run balance:check
npm run network:info:testnet

# Open console for manual testing
npm run console:testnet
```

### **Continuous Monitoring**
```bash
# Monitor contract activity
npm run monitor:toast:testnet

# Check network status
npm run explorer:info

# Verify balances
npm run balance:check
```

## 🔧 **Script Features**

### **Enhanced Functionality**
- ✅ **Somnia Explorer Integration**: All scripts include explorer API calls
- ✅ **Real-time Monitoring**: Live transaction and balance tracking
- ✅ **Error Handling**: Graceful fallbacks when APIs are unavailable
- ✅ **Multiple Networks**: Support for Somnia testnet/mainnet and Base networks
- ✅ **Development Workflows**: Combined scripts for common tasks

### **Explorer Integration**
- 🔗 **Automatic URL Generation**: Explorer links for all transactions and contracts
- 📊 **Real-time Data**: Balance verification via explorer API
- 🔍 **Transaction Monitoring**: Status tracking and gas usage reporting
- 📈 **Contract Analytics**: Token holder information and activity tracking

### **Developer Experience**
- 🚀 **No npx Required**: All commands use npm run
- 📝 **Comprehensive Logging**: Detailed output with emojis and status indicators
- ⚡ **Fast Execution**: Optimized scripts with parallel operations where possible
- 🛡️ **Error Recovery**: Graceful handling of network issues and API failures

## 📦 **Dependencies Added**

```json
{
  "dependencies": {
    "axios": "^1.6.0"  // Required for Somnia Explorer API integration
  }
}
```

## 🔄 **Migration from npx Commands**

### **Before (npx)**
```bash
npx hardhat compile
npx hardhat run scripts/deployTOAST.ts --network somniaTestnet
npx hardhat run scripts/interactTOAST.ts --network somniaTestnet
npx hardhat console --network somniaTestnet
npx hardhat verify --network somniaTestnet <address> <args>
```

### **After (npm run)**
```bash
npm run compile
npm run deploy:toast:testnet
npm run interact:toast:testnet
npm run console:testnet
npm run verify:testnet <address> <args>
```

## 🎉 **Benefits**

1. **Simplified Commands**: Shorter, more memorable command names
2. **Better Discovery**: `npm run` shows all available scripts
3. **Consistent Interface**: All blockchain operations use the same pattern
4. **Enhanced Functionality**: Explorer integration and monitoring built-in
5. **Development Workflows**: Combined scripts for common development tasks
6. **Production Ready**: Dedicated production deployment and monitoring scripts

All scripts are now ready to use! Simply run `npm run <script-name>` for any blockchain operation. 🚀
