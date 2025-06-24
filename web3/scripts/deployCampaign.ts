import { ethers } from "hardhat";

async function main() {
  console.log("Deploying Campaign system contracts to BNB Testnet...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);
  console.log(`Account balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} BNB`);

  // Deploy PointsToken first
  console.log("\n1. Deploying PointsToken...");
  const PointsToken = await ethers.getContractFactory("PointsToken");
  const pointsToken = await PointsToken.deploy(
    "Roast Points",
    "pROAST",
    deployer.address // initialOwner
  );

  await pointsToken.waitForDeployment();
  const pointsTokenAddress = await pointsToken.getAddress();

  console.log(`✅ PointsToken deployed to: ${pointsTokenAddress}`);

  // Deploy Campaign contract
  console.log("\n2. Deploying Campaign contract...");
  const Campaign = await ethers.getContractFactory("Campaign");
  const campaign = await Campaign.deploy(pointsTokenAddress, deployer.address);

  await campaign.waitForDeployment();
  const campaignAddress = await campaign.getAddress();

  console.log(`✅ Campaign contract deployed to: ${campaignAddress}`);

  // Verify the deployment
  console.log("\n3. Verifying deployment...");
  
  const pointsTokenOwner = await pointsToken.owner();
  const campaignOwner = await campaign.owner();
  const totalSupply = await pointsToken.totalSupply();

  console.log("\n=== Deployment Summary ===");
  console.log(`Network: BNB Testnet (Chain ID: 97)`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`PointsToken: ${pointsTokenAddress}`);
  console.log(`Campaign: ${campaignAddress}`);
  console.log(`Initial PointsToken Supply: ${ethers.formatEther(totalSupply)} pROAST`);
  console.log(`PointsToken Owner: ${pointsTokenOwner}`);
  console.log(`Campaign Owner: ${campaignOwner}`);

  console.log("\n=== Contract Verification ===");
  console.log(`PointsToken: npx hardhat verify --network bnbTestnet ${pointsTokenAddress} "Roast Points" "pROAST" "${deployer.address}"`);
  console.log(`Campaign: npx hardhat verify --network bnbTestnet ${campaignAddress} "${pointsTokenAddress}" "${deployer.address}"`);

  console.log("\n=== Next Steps ===");
  console.log("1. The Campaign contract owner can create campaigns");
  console.log("2. Users can submit to active campaigns");
  console.log("3. Owner can select winners and disperse points");
  console.log("4. Owner can mint additional points if needed");
  console.log("\n=== BNB Testnet Explorer ===");
  console.log(`PointsToken: https://testnet.bscscan.com/address/${pointsTokenAddress}`);
  console.log(`Campaign: https://testnet.bscscan.com/address/${campaignAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 