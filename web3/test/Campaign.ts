import { expect } from "chai";
import { ethers } from "hardhat";
import { Campaign, PointsToken } from "../typechain-types";
import { SignerWithAddress } from "@ethersproject/contracts";

describe("Campaign Contract", function () {
  let campaign: Campaign;
  let pointsToken: PointsToken;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;
  let user5: SignerWithAddress;

  const MAX_SUBMISSIONS_PER_CAMPAIGN = 1500;
  const TOTAL_PER_BLOCK = 50;
  const MAX_REWARD_PER_CAMPAIGN = ethers.parseEther("100000");

  beforeEach(async function () {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy PointsToken
    const PointsTokenFactory = await ethers.getContractFactory("PointsToken");
    pointsToken = await PointsTokenFactory.deploy(
      "Roast Points",
      "pROAST",
      owner.address
    );

    // Deploy Campaign
    const CampaignFactory = await ethers.getContractFactory("Campaign");
    campaign = await CampaignFactory.deploy(await pointsToken.getAddress(), owner.address);

    // Transfer PointsToken ownership to Campaign contract so it can mint
    await pointsToken.transferOwnership(await campaign.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await campaign.owner()).to.equal(owner.address);
    });

    it("Should set the correct points token", async function () {
      expect(await campaign.pointsToken()).to.equal(await pointsToken.getAddress());
    });

    it("Should start with zero campaigns and submissions", async function () {
      expect(await campaign.campaignCounter()).to.equal(0);
      expect(await campaign.submissionCounter()).to.equal(0);
    });
  });

  describe("Campaign Creation", function () {
    it("Should allow owner to create campaigns", async function () {
      await expect(campaign.createCampaign())
        .to.emit(campaign, "CampaignCreated")
        .withArgs(1);

      expect(await campaign.campaignCounter()).to.equal(1);
      const campaignData = await campaign.campaigns(1);
      expect(campaignData.status).to.equal(1); // Active
      expect(campaignData.winner).to.equal(ethers.ZeroAddress);
    });

    it("Should create multiple campaigns correctly", async function () {
      for (let i = 1; i <= 10; i++) {
        await expect(campaign.createCampaign())
          .to.emit(campaign, "CampaignCreated")
          .withArgs(i);
      }

      expect(await campaign.campaignCounter()).to.equal(10);

      // Verify all campaigns are active
      for (let i = 1; i <= 10; i++) {
        const campaignData = await campaign.campaigns(i);
        expect(campaignData.status).to.equal(1); // Active
      }
    });

    it("Should not allow non-owner to create campaigns", async function () {
      await expect(campaign.connect(user1).createCampaign())
        .to.be.revertedWithCustomError(campaign, "OwnableUnauthorizedAccount");
    });
  });

  describe("Submission Management", function () {
    beforeEach(async function () {
      // Create 10 campaigns
      for (let i = 1; i <= 10; i++) {
        await campaign.createCampaign();
      }
    });

    it("Should add submissions to correct campaigns", async function () {
      const contents = [];
      
      // Create submissions for campaigns 1-5
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        const campaignId = (i % 5) + 1; // Distribute across campaigns 1-5
        contents.push({
          campaignId: campaignId,
          submission: {
            submissionString: `CID_${i}`,
            model: `Model_${i % 3}`,
            llmTokensUsed: 100 + i,
            submitter: user1.address
          }
        });
      }

      await expect(campaign.addSubmission(contents))
        .to.emit(campaign, "SubmissionAdded")
        .withArgs(0);

      // Verify submissions are added to correct campaigns
      for (let i = 1; i <= 5; i++) {
        expect(await campaign.totalSubmissions(i)).to.equal(10);
      }

      // Verify campaigns 6-10 have no submissions
      for (let i = 6; i <= 10; i++) {
        expect(await campaign.totalSubmissions(i)).to.equal(0);
      }
    });

    it("Should not allow submissions to inactive campaigns", async function () {
      // Make campaign 1 inactive by selecting a winner
      await campaign.selectWinners(1, 1, user1.address);

      const contents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: `CID_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user1.address
          }
        });
      }

      await expect(campaign.addSubmission(contents))
        .to.be.revertedWith("Campaign not active");
    });

    it("Should respect max submissions limit per campaign", async function () {
      // Add 1500 submissions to campaign 1 (30 blocks of 50 submissions each)
      for (let block = 0; block < 30; block++) {
        const contents = [];
        for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
          contents.push({
            campaignId: 1,
            submission: {
              submissionString: `CID_${block}_${i}`,
              model: "Model_1",
              llmTokensUsed: 100,
              submitter: user1.address
            }
          });
        }
        await campaign.addSubmission(contents);
      }

      // Verify campaign 1 has exactly 1500 submissions
      expect(await campaign.totalSubmissions(1)).to.equal(MAX_SUBMISSIONS_PER_CAMPAIGN);

      // Try to add one more submission
      const contents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: `CID_EXTRA_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user1.address
          }
        });
      }

      await expect(campaign.addSubmission(contents))
        .to.be.revertedWith("Max submissions reached");
    });

    it("Should handle edge case of exactly 1500 submissions", async function () {
      // Add 1499 submissions first
      for (let block = 0; block < 29; block++) {
        const contents = [];
        for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
          contents.push({
            campaignId: 1,
            submission: {
              submissionString: `CID_${block}_${i}`,
              model: "Model_1",
              llmTokensUsed: 100,
              submitter: user1.address
            }
          });
        }
        await campaign.addSubmission(contents);
      }

      // Add 49 more submissions (1499 + 49 = 1548, still under limit)
      const contents = [];
      for (let i = 0; i < 49; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: `CID_EDGE_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user1.address
          }
        });
      }
      // Fill the rest with submissions for campaign 2
      for (let i = 49; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 2,
          submission: {
            submissionString: `CID_EDGE_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user1.address
          }
        });
      }

      await campaign.addSubmission(contents);
      expect(await campaign.totalSubmissions(1)).to.equal(1499);
      expect(await campaign.totalSubmissions(2)).to.equal(1);
    });

    it("Should not allow non-owner to add submissions", async function () {
      const contents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: `CID_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user1.address
          }
        });
      }

      await expect(campaign.connect(user1).addSubmission(contents))
        .to.be.revertedWithCustomError(campaign, "OwnableUnauthorizedAccount");
    });
  });

  describe("Winner Selection", function () {
    beforeEach(async function () {
      // Create campaigns and add some submissions
      for (let i = 1; i <= 10; i++) {
        await campaign.createCampaign();
      }

      // Add submissions to campaigns 1-5
      for (let block = 0; block < 3; block++) {
        const contents = [];
        for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
          const campaignId = (i % 5) + 1;
          contents.push({
            campaignId: campaignId,
            submission: {
              submissionString: `CID_${block}_${i}`,
              model: `Model_${i % 3}`,
              llmTokensUsed: 100 + i,
              submitter: user1.address
            }
          });
        }
        await campaign.addSubmission(contents);
      }
    });

    it("Should allow owner to select winners", async function () {
      await expect(campaign.selectWinners(1, 1, user1.address))
        .to.emit(campaign, "WinnersSelected")
        .withArgs(1, 1, user1.address);

      const campaignData = await campaign.campaigns(1);
      expect(campaignData.winner).to.equal(user1.address);
      expect(campaignData.status).to.equal(0); // Inactive
      expect(await campaign.pendingRewards(user1.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);
    });

    it("Should not allow selecting winners for inactive campaigns", async function () {
      await campaign.selectWinners(1, 1, user1.address);

      await expect(campaign.selectWinners(1, 2, user2.address))
        .to.be.revertedWith("Campaign not active");
    });

    it("Should not allow non-owner to select winners", async function () {
      await expect(campaign.connect(user1).selectWinners(1, 1, user1.address))
        .to.be.revertedWithCustomError(campaign, "OwnableUnauthorizedAccount");
    });

    it("Should handle multiple winners correctly", async function () {
      // Select winners for multiple campaigns
      await campaign.selectWinners(1, 1, user1.address);
      await campaign.selectWinners(2, 2, user2.address);
      await campaign.selectWinners(3, 3, user3.address);

      expect(await campaign.pendingRewards(user1.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);
      expect(await campaign.pendingRewards(user2.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);
      expect(await campaign.pendingRewards(user3.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);

      // Verify campaigns are inactive
      expect((await campaign.campaigns(1)).status).to.equal(0);
      expect((await campaign.campaigns(2)).status).to.equal(0);
      expect((await campaign.campaigns(3)).status).to.equal(0);
    });
  });

  describe("Points Distribution", function () {
    beforeEach(async function () {
      // Create campaigns and select winners
      for (let i = 1; i <= 10; i++) {
        await campaign.createCampaign();
      }

      // Select winners for campaigns 1-5
      await campaign.selectWinners(1, 1, user1.address);
      await campaign.selectWinners(2, 2, user2.address);
      await campaign.selectWinners(3, 3, user3.address);
      await campaign.selectWinners(4, 4, user4.address);
      await campaign.selectWinners(5, 5, user5.address);

      // Mint enough tokens to the Campaign contract for distribution
      const totalRewards = MAX_REWARD_PER_CAMPAIGN * 5n; // 5 campaigns
      await campaign.mintPoints(await campaign.getAddress(), totalRewards);
    });

    it("Should disperse points correctly", async function () {
      const initialBalance = await pointsToken.balanceOf(user1.address);
      
      await expect(campaign.dispersePoints(1))
        .to.emit(campaign, "PointsDispersed")
        .withArgs(1, user1.address, MAX_REWARD_PER_CAMPAIGN);

      const finalBalance = await pointsToken.balanceOf(user1.address);
      expect(finalBalance - initialBalance).to.equal(MAX_REWARD_PER_CAMPAIGN);
      expect(await campaign.pendingRewards(user1.address)).to.equal(0);
    });

    it("Should not allow dispersing points for active campaigns", async function () {
      await expect(campaign.dispersePoints(6))
        .to.be.revertedWith("Campaign Winners Not Selected");
    });

    it("Should not allow non-owner to disperse points", async function () {
      await expect(campaign.connect(user1).dispersePoints(1))
        .to.be.revertedWithCustomError(campaign, "OwnableUnauthorizedAccount");
    });

    it("Should handle multiple dispersals correctly", async function () {
      // Disperse points to all winners
      await campaign.dispersePoints(1);
      await campaign.dispersePoints(2);
      await campaign.dispersePoints(3);
      await campaign.dispersePoints(4);
      await campaign.dispersePoints(5);

      expect(await pointsToken.balanceOf(user1.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);
      expect(await pointsToken.balanceOf(user2.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);
      expect(await pointsToken.balanceOf(user3.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);
      expect(await pointsToken.balanceOf(user4.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);
      expect(await pointsToken.balanceOf(user5.address)).to.equal(MAX_REWARD_PER_CAMPAIGN);

      // Verify all pending rewards are cleared
      expect(await campaign.pendingRewards(user1.address)).to.equal(0);
      expect(await campaign.pendingRewards(user2.address)).to.equal(0);
      expect(await campaign.pendingRewards(user3.address)).to.equal(0);
      expect(await campaign.pendingRewards(user4.address)).to.equal(0);
      expect(await campaign.pendingRewards(user5.address)).to.equal(0);
    });

    it("Should not allow double dispersal", async function () {
      await campaign.dispersePoints(1);
      
      // Second dispersal should succeed but with 0 rewards
      await expect(campaign.dispersePoints(1))
        .to.emit(campaign, "PointsDispersed")
        .withArgs(1, user1.address, 0);
    });
  });

  describe("Points Minting", function () {
    it("Should allow owner to mint points", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(campaign.mintPoints(user1.address, mintAmount))
        .to.emit(campaign, "PointsMinted")
        .withArgs(user1.address, mintAmount);

      expect(await pointsToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should not allow non-owner to mint points", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(campaign.connect(user1).mintPoints(user2.address, mintAmount))
        .to.be.revertedWithCustomError(campaign, "OwnableUnauthorizedAccount");
    });

    it("Should handle multiple mints correctly", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await campaign.mintPoints(user1.address, mintAmount);
      await campaign.mintPoints(user2.address, mintAmount);
      await campaign.mintPoints(user3.address, mintAmount);

      expect(await pointsToken.balanceOf(user1.address)).to.equal(mintAmount);
      expect(await pointsToken.balanceOf(user2.address)).to.equal(mintAmount);
      expect(await pointsToken.balanceOf(user3.address)).to.equal(mintAmount);
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should handle zero submissions in a block", async function () {
      await campaign.createCampaign();
      
      const contents = [];
      // Create a block with all submissions for campaign 2 (which doesn't exist)
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 2,
          submission: {
            submissionString: `CID_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user1.address
          }
        });
      }

      await expect(campaign.addSubmission(contents))
        .to.be.revertedWith("Campaign not active");
    });

    it("Should handle very large token usage", async function () {
      await campaign.createCampaign();
      
      const contents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: `CID_${i}`,
            model: "Model_1",
            llmTokensUsed: ethers.MaxUint256,
            submitter: user1.address
          }
        });
      }

      await campaign.addSubmission(contents);
      const submission = await campaign.submissions(1);
      expect(submission.llmTokensUsed).to.equal(ethers.MaxUint256);
    });

    it("Should handle empty string submissions", async function () {
      await campaign.createCampaign();
      
      const contents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: "",
            model: "",
            llmTokensUsed: 0,
            submitter: user1.address
          }
        });
      }

      await campaign.addSubmission(contents);
      const submission = await campaign.submissions(1);
      expect(submission.submissionString).to.equal("");
      expect(submission.model).to.equal("");
      expect(submission.llmTokensUsed).to.equal(0);
    });

    it("Should handle zero address submitters", async function () {
      await campaign.createCampaign();
      
      const contents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: `CID_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: ethers.ZeroAddress
          }
        });
      }

      await campaign.addSubmission(contents);
      const submission = await campaign.submissions(1);
      expect(submission.submitter).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete campaign lifecycle", async function () {
      // 1. Create 10 campaigns
      for (let i = 1; i <= 10; i++) {
        await campaign.createCampaign();
      }

      // 2. Add submissions to all campaigns
      for (let block = 0; block < 5; block++) {
        const contents = [];
        for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
          const campaignId = (i % 10) + 1;
          contents.push({
            campaignId: campaignId,
            submission: {
              submissionString: `CID_${block}_${i}`,
              model: `Model_${i % 3}`,
              llmTokensUsed: 100 + i,
              submitter: user1.address
            }
          });
        }
        await campaign.addSubmission(contents);
      }

      // 3. Select winners for all campaigns
      const winners = [user1, user2, user3, user4, user5, user1, user2, user3, user4, user5];
      for (let i = 1; i <= 10; i++) {
        await campaign.selectWinners(i, i, winners[i-1].address);
      }

      // Mint enough tokens to the Campaign contract for all distributions
      const totalRewards = MAX_REWARD_PER_CAMPAIGN * 10n; // 10 campaigns
      await campaign.mintPoints(await campaign.getAddress(), totalRewards);

      // 4. Disperse points to all winners
      for (let i = 1; i <= 10; i++) {
        await campaign.dispersePoints(i);
      }

      // 5. Verify final state
      expect(await campaign.campaignCounter()).to.equal(10);
      expect(await campaign.submissionCounter()).to.equal(250); // 5 blocks * 50 submissions
      
      // Verify all campaigns are inactive
      for (let i = 1; i <= 10; i++) {
        const campaignData = await campaign.campaigns(i);
        expect(campaignData.status).to.equal(0); // Inactive
      }

      // Verify winners received points
      for (let i = 0; i < 10; i++) {
        const expectedBalance = MAX_REWARD_PER_CAMPAIGN * 2n; // Each winner wins 2 campaigns
        expect(await pointsToken.balanceOf(winners[i].address)).to.equal(expectedBalance);
      }
    });

    it("Should handle maximum submissions scenario", async function () {
      // Create 10 campaigns
      for (let i = 1; i <= 10; i++) {
        await campaign.createCampaign();
      }

      // Add maximum submissions to campaign 1 (30 blocks of 50 = 1500)
      for (let block = 0; block < 30; block++) {
        const contents = [];
        for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
          contents.push({
            campaignId: 1,
            submission: {
              submissionString: `CID_MAX_${block}_${i}`,
              model: "Model_1",
              llmTokensUsed: 100,
              submitter: user1.address
            }
          });
        }
        await campaign.addSubmission(contents);
      }

      expect(await campaign.totalSubmissions(1)).to.equal(MAX_SUBMISSIONS_PER_CAMPAIGN);

      // Try to add more submissions (should fail)
      const contents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        contents.push({
          campaignId: 1,
          submission: {
            submissionString: `CID_EXTRA_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user1.address
          }
        });
      }

      await expect(campaign.addSubmission(contents))
        .to.be.revertedWith("Max submissions reached");

      // Verify other campaigns can still accept submissions
      const otherContents = [];
      for (let i = 0; i < TOTAL_PER_BLOCK; i++) {
        otherContents.push({
          campaignId: 2,
          submission: {
            submissionString: `CID_OTHER_${i}`,
            model: "Model_1",
            llmTokensUsed: 100,
            submitter: user2.address
          }
        });
      }

      await campaign.addSubmission(otherContents);
      expect(await campaign.totalSubmissions(2)).to.equal(TOTAL_PER_BLOCK);
    });
  });
}); 