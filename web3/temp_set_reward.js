const { ethers } = require('hardhat');

async function main() {
  const contentRegistryAddress = '0x8319877ed76390EbcC069eBf7Be1C9EC3E158E5c';
  const rewardDistributionAddress = '0xBc6e117dC467B0F276203d5015eea5B57547e7e6';
  
  const [deployer] = await ethers.getSigners();
  const contentRegistry = await ethers.getContractAt('ContentRegistry', contentRegistryAddress);
  
  console.log('Setting reward distribution address...');
  const tx = await contentRegistry.setRewardDistribution(rewardDistributionAddress);
  await tx.wait();
  console.log('✅ Reward distribution address set:', rewardDistributionAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
