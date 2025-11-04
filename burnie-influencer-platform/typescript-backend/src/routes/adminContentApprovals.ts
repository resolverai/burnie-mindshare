import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { AdminContentApproval } from '../models/AdminContentApproval';
import { ContentMarketplace } from '../models/ContentMarketplace';
import { env } from '../config/env';
import { logger } from '../config/logger';

const router = Router();

// GET /api/admin-content-approvals/:adminWallet - Get content assigned to admin for approval
router.get('/admin-content-approvals/:adminWallet', async (req, res) => {
  try {
    const { adminWallet } = req.params;
    
    // Verify admin wallet is in the configured list
    if (!env.miner.adminWalletAddresses.includes(adminWallet.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Wallet address not in admin list'
      });
    }

    const approvalRepository = AppDataSource.getRepository(AdminContentApproval);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get pending approvals for this admin
    const approvals = await approvalRepository
      .createQueryBuilder('approval')
      .leftJoinAndSelect('approval.content', 'content')
      .where('approval.adminWalletAddress = :adminWallet', { adminWallet: adminWallet.toLowerCase() })
      .orderBy('approval.assignedAt', 'DESC')
      .getMany();

    logger.info(`📋 Found ${approvals.length} content items for admin review: ${adminWallet}`);

    return res.json({
      success: true,
      data: approvals,
      message: `Found ${approvals.length} content items for review`
    });

  } catch (error) {
    logger.error('❌ Error fetching admin content approvals:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch admin content approvals',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST /api/admin-content-approvals/assign - Assign miner content to random admin
router.post('/admin-content-approvals/assign', async (req, res) => {
  try {
    const { contentId, minerWalletAddress } = req.body;

    if (!contentId || !minerWalletAddress) {
      return res.status(400).json({
        success: false,
        message: 'contentId and minerWalletAddress are required'
      });
    }

    // Verify content exists
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);
    const content = await contentRepository.findOne({
      where: { id: contentId }
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Get available admins
    const adminWallets = env.miner.adminWalletAddresses;
    if (adminWallets.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No admin wallets configured'
      });
    }

    // Randomly select an admin
    const randomAdmin = adminWallets[Math.floor(Math.random() * adminWallets.length)];

    // Create approval record
    const approvalRepository = AppDataSource.getRepository(AdminContentApproval);
    const approval = approvalRepository.create({
      adminWalletAddress: randomAdmin.toLowerCase(),
      contentId,
      minerWalletAddress: minerWalletAddress.toLowerCase(),
      status: 'pending'
    });

    await approvalRepository.save(approval);

    logger.info(`✅ Assigned content ${contentId} to admin ${randomAdmin} for review`);

    return res.json({
      success: true,
      data: approval,
      message: `Content assigned to admin ${randomAdmin}`
    });

  } catch (error) {
    logger.error('❌ Error assigning content to admin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign content to admin',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// PUT /api/admin-content-approvals/:approvalId/approve - Approve content
router.put('/admin-content-approvals/:approvalId/approve', async (req, res) => {
  try {
    const { approvalId } = req.params;
    const { adminWallet, biddingEnabled, adminNotes } = req.body;

    // Verify admin wallet
    if (!env.miner.adminWalletAddresses.includes(adminWallet.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Wallet address not in admin list'
      });
    }

    const approvalRepository = AppDataSource.getRepository(AdminContentApproval);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get approval record
    const approval = await approvalRepository.findOne({
      where: { id: approvalId },
      relations: ['content']
    });

    if (!approval) {
      return res.status(404).json({
        success: false,
        message: 'Approval record not found'
      });
    }

    // Verify admin owns this approval
    if (approval.adminWalletAddress.toLowerCase() !== adminWallet.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: This content is not assigned to you'
      });
    }

    // Update approval record
    approval.status = 'approved';
    approval.biddingEnabled = biddingEnabled || false;
    approval.adminNotes = adminNotes || null;
    approval.reviewedAt = new Date();

    await approvalRepository.save(approval);

    // Update content status and wallet_address
    if (approval.content) {
      approval.content.approvalStatus = 'approved';
      approval.content.isBiddable = biddingEnabled || false;
      // IMPORTANT: Set wallet_address to miner wallet address on approval
      approval.content.walletAddress = approval.minerWalletAddress.toLowerCase();
      if (biddingEnabled) {
        approval.content.biddingEnabledAt = new Date();
      }
      await contentRepository.save(approval.content);
    }

    logger.info(`✅ Admin ${adminWallet} approved content ${approval.contentId}, wallet_address set to ${approval.minerWalletAddress}`);

    return res.json({
      success: true,
      data: approval,
      message: 'Content approved successfully'
    });

  } catch (error) {
    logger.error('❌ Error approving content:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to approve content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// PUT /api/admin-content-approvals/:approvalId/reject - Reject content
router.put('/admin-content-approvals/:approvalId/reject', async (req, res) => {
  try {
    const { approvalId } = req.params;
    const { adminWallet, adminNotes } = req.body;

    // Verify admin wallet
    if (!env.miner.adminWalletAddresses.includes(adminWallet.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Wallet address not in admin list'
      });
    }

    const approvalRepository = AppDataSource.getRepository(AdminContentApproval);
    const contentRepository = AppDataSource.getRepository(ContentMarketplace);

    // Get approval record
    const approval = await approvalRepository.findOne({
      where: { id: approvalId },
      relations: ['content']
    });

    if (!approval) {
      return res.status(404).json({
        success: false,
        message: 'Approval record not found'
      });
    }

    // Verify admin owns this approval
    if (approval.adminWalletAddress.toLowerCase() !== adminWallet.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: This content is not assigned to you'
      });
    }

    // Update approval record
    approval.status = 'rejected';
    approval.adminNotes = adminNotes || null;
    approval.reviewedAt = new Date();

    await approvalRepository.save(approval);

    // Update content status and wallet_address
    if (approval.content) {
      approval.content.approvalStatus = 'rejected';
      approval.content.rejectedAt = new Date();
      // IMPORTANT: Set wallet_address to miner wallet address on rejection
      approval.content.walletAddress = approval.minerWalletAddress.toLowerCase();
      await contentRepository.save(approval.content);
    }

    logger.info(`❌ Admin ${adminWallet} rejected content ${approval.contentId}, wallet_address set to ${approval.minerWalletAddress}`);

    return res.json({
      success: true,
      data: approval,
      message: 'Content rejected successfully'
    });

  } catch (error) {
    logger.error('❌ Error rejecting content:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reject content',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
