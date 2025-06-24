import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

async function getStakedAmount(userAddress: string): Promise<number> {
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

    // Read the ABI from the JSON file
    const abiPath = path.join(__dirname, "../Interfaces/staked_abi.json");
    const abiContent = fs.readFileSync(abiPath, "utf8");
    const abi = JSON.parse(abiContent);

    // Create contract instance
    const provider = ethers.provider;
    const contract = new ethers.Contract(contractAddress, abi, provider);

    // Get the staked balance
    const stakedBalance = await contract.balanceOf(userAddress);

    // Convert from wei to whole number (assuming 18 decimals like most ERC20 tokens)
    const stakedAmount = Number(ethers.formatEther(stakedBalance));

    return stakedAmount;
  } catch (error) {
    console.error("Error getting staked amount:", error);
    throw error;
  }
}

async function main() {
  // Get the address from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: npx hardhat run scripts/getStakedAmount.ts -- <address>");
    console.error("Example: npx hardhat run scripts/getStakedAmount.ts -- 0x1234567890123456789012345678901234567890");
    process.exit(1);
  }

  const userAddress = args[0];

  try {
    console.log(`Getting staked amount for address: ${userAddress}`);
    
    const stakedAmount = await getStakedAmount(userAddress);
    
    console.log(`Staked amount: ${stakedAmount} tokens`);
    
    // Return the value as a whole number
    return Math.floor(stakedAmount);
  } catch (error) {
    console.error("Failed to get staked amount:", error);
    process.exit(1);
  }
}

// Export the function for use in other scripts
export { getStakedAmount };

// Run the script if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} 