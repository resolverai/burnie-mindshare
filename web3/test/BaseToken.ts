import { expect } from "chai";
import { ethers } from "hardhat";
import { BaseToken } from "../typechain-types";

describe("BaseToken", function () {
  let baseToken: BaseToken;
  let owner: any;
  let addr1: any;
  let addr2: any;
  let addrs: any[];

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    // Deploy the contract
    const BaseToken = await ethers.getContractFactory("BaseToken");
    baseToken = await BaseToken.deploy("Base Token", "BASE", owner.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await baseToken.owner()).to.equal(owner.address);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await baseToken.balanceOf(owner.address);
      expect(await baseToken.totalSupply()).to.equal(ownerBalance);
    });

    it("Should have correct name and symbol", async function () {
      expect(await baseToken.name()).to.equal("Base Token");
      expect(await baseToken.symbol()).to.equal("BASE");
    });

    it("Should have correct initial supply", async function () {
      const totalSupply = await baseToken.totalSupply();
      expect(totalSupply).to.equal(ethers.parseEther("1000000")); // 1 million tokens
    });
  });

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      // Transfer 50 tokens from owner to addr1
      await baseToken.transfer(addr1.address, 50);
      const addr1Balance = await baseToken.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(50);

      // Transfer 50 tokens from addr1 to addr2
      await baseToken.connect(addr1).transfer(addr2.address, 50);
      const addr2Balance = await baseToken.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(50);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await baseToken.balanceOf(owner.address);

      // Try to send 1 token from addr1 (0 tokens) to owner (1000000 tokens).
      await expect(
        baseToken.connect(addr1).transfer(owner.address, 1)
      ).to.be.revertedWithCustomError(baseToken, "ERC20InsufficientBalance");

      // Owner balance shouldn't have changed.
      expect(await baseToken.balanceOf(owner.address)).to.equal(
        initialOwnerBalance
      );
    });

    it("Should update balances after transfers", async function () {
      const initialOwnerBalance = await baseToken.balanceOf(owner.address);

      // Transfer 100 tokens from owner to addr1.
      await baseToken.transfer(addr1.address, 100);

      // Transfer another 50 tokens from owner to addr2.
      await baseToken.transfer(addr2.address, 50);

      // Check balances.
      const finalOwnerBalance = await baseToken.balanceOf(owner.address);
      expect(finalOwnerBalance).to.equal(initialOwnerBalance - 150n);

      const addr1Balance = await baseToken.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(100);

      const addr2Balance = await baseToken.balanceOf(addr2.address);
      expect(addr2Balance).to.equal(50);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const initialSupply = await baseToken.totalSupply();
      const mintAmount = ethers.parseEther("1000");

      await baseToken.mint(addr1.address, mintAmount);

      expect(await baseToken.totalSupply()).to.equal(initialSupply + mintAmount);
      expect(await baseToken.balanceOf(addr1.address)).to.equal(mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");

      await expect(
        baseToken.connect(addr1).mint(addr1.address, mintAmount)
      ).to.be.revertedWithCustomError(baseToken, "OwnableUnauthorizedAccount");
    });
  });

  describe("Burning", function () {
    it("Should allow users to burn their own tokens", async function () {
      // Transfer some tokens to addr1
      await baseToken.transfer(addr1.address, 1000);

      const initialBalance = await baseToken.balanceOf(addr1.address);
      const burnAmount = 500;

      await baseToken.connect(addr1).burn(burnAmount);

      expect(await baseToken.balanceOf(addr1.address)).to.equal(
        initialBalance - BigInt(burnAmount)
      );
    });

    it("Should not allow users to burn more tokens than they have", async function () {
      // Transfer some tokens to addr1
      await baseToken.transfer(addr1.address, 100);

      await expect(
        baseToken.connect(addr1).burn(200)
      ).to.be.revertedWithCustomError(baseToken, "ERC20InsufficientBalance");
    });
  });
}); 