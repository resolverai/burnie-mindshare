import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  // Get the address from the environment variable
  const userAddress = process.env.ADDRESS;

  if (!userAddress) {
    console.error("Please set the ADDRESS environment variable, e.g.:");
    console.error("ADDRESS=0x... npx hardhat run scripts/checkStakedBalance.ts --network baseMainnet");
    process.exit(1);
  }

  try {
    // Validate the address format
    if (!ethers.isAddress(userAddress)) {
      throw new Error("Invalid address format");
    }

    // Get the contract address from environment variables
    const contractAddress = process.env.STAKED_TOKEN_CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("STAKED_TOKEN_CONTRACT_ADDRESS not found in environment variables");
    }

    console.log(`Checking staked balance for address: ${userAddress}`);
    console.log(`Contract address: ${contractAddress}`);

    // Read the ABI from the JSON file
    const abiPath = path.join(__dirname, "../Interfaces/staked_abi.json");
    const abiContent = fs.readFileSync(abiPath, "utf8");
    const abi = JSON.parse(abiContent);

    // Get the network from environment variable (set by Hardhat)
    const network = process.env.HARDHAT_NETWORK || "hardhat";
    let rpcUrl = "";
    if (network === "baseMainnet") {
      rpcUrl = process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org";
    } else if (network === "baseTestnet") {
      rpcUrl = process.env.BASE_TESTNET_RPC_URL || "https://sepolia.base.org";
    } else {
      rpcUrl = "http://127.0.0.1:8545";
    }

    // Create ethers provider
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // Get the staked balance
    const stakedBalance = await contract.balanceOf(userAddress);

    // Convert from wei to whole number (assuming 18 decimals like most ERC20 tokens)
    const stakedAmount = Number(ethers.formatEther(stakedBalance));
    const wholeNumber = Math.floor(stakedAmount);

    console.log(`Raw balance (wei): ${stakedBalance.toString()}`);
    console.log(`Staked amount (with decimals): ${stakedAmount}`);
    console.log(`Staked amount (whole number): ${wholeNumber}`);
    
    // Exit with the whole number as the result
    process.exit(wholeNumber);
  } catch (error) {
    console.error("Error getting staked amount:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 