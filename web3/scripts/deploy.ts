import { ethers } from "hardhat";

async function main() {
  console.log("Deploying BaseToken contract...");

  // Get the contract factory
  const BaseToken = await ethers.getContractFactory("BaseToken");

  // Deploy the contract
  // Parameters: name, symbol, initial owner (deployer)
  const baseToken = await BaseToken.deploy(
    "Base Token",
    "BASE",
    await ethers.getSigners().then(signers => signers[0].address)
  );

  await baseToken.waitForDeployment();

  const address = await baseToken.getAddress();
  console.log(`BaseToken deployed to: ${address}`);

  // Log initial supply
  const totalSupply = await baseToken.totalSupply();
  console.log(`Initial total supply: ${ethers.formatEther(totalSupply)} BASE`);

  // Log owner
  const owner = await baseToken.owner();
  console.log(`Contract owner: ${owner}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 