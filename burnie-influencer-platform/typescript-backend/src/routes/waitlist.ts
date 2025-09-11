import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { logger } from '../config/logger';
import { Waitlist, WaitlistStatus } from '../models/Waitlist';
import { User, UserAccessStatus } from '../models/User';
import { processTwitterHandle } from '../utils/twitterHandleUtils';

const router = Router();

/**
 * @route POST /api/waitlist/join
 * @desc Join the waitlist
 */
router.post('/join', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      walletAddress,
      email,
      username,
      reason,
      twitterHandle,
      discordHandle
    } = req.body;

    if (!walletAddress) {
      res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
      return;
    }

    // Process and validate Twitter handle
    const { sanitized: cleanHandle, isValid, error } = processTwitterHandle(twitterHandle);
    
    if (!isValid) {
      res.status(400).json({
        success: false,
        message: error || 'Invalid Twitter handle'
      });
      return;
    }

    const waitlistRepository = AppDataSource.getRepository(Waitlist);
    const userRepository = AppDataSource.getRepository(User);

    // Check if wallet is already on waitlist
    const existingWaitlist = await waitlistRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (existingWaitlist) {
      res.status(400).json({
        success: false,
        message: 'Wallet address already on waitlist',
        data: {
          status: existingWaitlist.status,
          position: await getWaitlistPosition(existingWaitlist.id)
        }
      });
      return;
    }

    // Check if Twitter handle is already in use in waitlist table
    const existingTwitterHandleInWaitlist = await waitlistRepository.findOne({
      where: { twitterHandle: cleanHandle }
    });

    if (existingTwitterHandleInWaitlist) {
      res.status(400).json({
        success: false,
        message: `Twitter handle @${cleanHandle} is already in use by another waitlist entry`,
        data: {
          conflictingEntry: {
            id: existingTwitterHandleInWaitlist.id,
            walletAddress: existingTwitterHandleInWaitlist.walletAddress,
            status: existingTwitterHandleInWaitlist.status
          }
        }
      });
      return;
    }

    // Check if Twitter handle is already in use by an existing user
    // Check both with and without @ symbol to handle legacy data
    const existingUserWithTwitterHandle = await userRepository.findOne({
      where: [
        { twitterHandle: cleanHandle },
        { twitterHandle: `@${cleanHandle}` }
      ]
    });

    if (existingUserWithTwitterHandle) {
      res.status(400).json({
        success: false,
        message: `Twitter handle @${cleanHandle} is already in use by an existing user`,
        data: {
          conflictingUser: {
            id: existingUserWithTwitterHandle.id,
            walletAddress: existingUserWithTwitterHandle.walletAddress,
            username: existingUserWithTwitterHandle.username,
            accessStatus: existingUserWithTwitterHandle.accessStatus,
            currentTwitterHandle: existingUserWithTwitterHandle.twitterHandle
          }
        }
      });
      return;
    }

    // Check if user already has access
    const existingUser = await userRepository.findOne({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (existingUser && existingUser.hasMarketplaceAccess()) {
      res.status(400).json({
        success: false,
        message: 'User already has marketplace access'
      });
      return;
    }

    // Create waitlist entry
    const waitlistEntry = waitlistRepository.create({
      walletAddress: walletAddress.toLowerCase(),
      email,
      username,
      reason,
      twitterHandle: cleanHandle, // Use cleaned handle
      discordHandle
    });

    await waitlistRepository.save(waitlistEntry);

    // Create or update user with pending status
    if (existingUser) {
      existingUser.accessStatus = UserAccessStatus.PENDING_WAITLIST;
      await userRepository.save(existingUser);
    } else {
      const newUser = userRepository.create({
        walletAddress: walletAddress.toLowerCase(),
        username,
        email,
        accessStatus: UserAccessStatus.PENDING_WAITLIST,
        roleType: 'yapper' as any
      });
      await userRepository.save(newUser);
    }

    const position = await getWaitlistPosition(waitlistEntry.id);

    logger.info(`✅ Added ${walletAddress} to waitlist at position ${position}`);

    res.json({
      success: true,
      data: {
        id: waitlistEntry.id,
        status: waitlistEntry.status,
        position,
        createdAt: waitlistEntry.createdAt
      },
      message: 'Successfully joined waitlist'
    });

  } catch (error) {
    logger.error('❌ Error joining waitlist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join waitlist'
    });
  }
});

/**
 * @route GET /api/waitlist/status/:walletAddress
 * @desc Get waitlist status for a wallet address
 */
router.get('/status/:walletAddress', async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.params;

    const waitlistRepository = AppDataSource.getRepository(Waitlist);
    const waitlistEntry = await waitlistRepository.findOne({
      where: { walletAddress: walletAddress!.toLowerCase() }
    });

    if (!waitlistEntry) {
      res.status(404).json({
        success: false,
        message: 'Wallet address not found on waitlist'
      });
      return;
    }

    const position = await getWaitlistPosition(waitlistEntry.id);

    res.json({
      success: true,
      data: {
        id: waitlistEntry.id,
        status: waitlistEntry.status,
        position,
        createdAt: waitlistEntry.createdAt,
        approvedAt: waitlistEntry.approvedAt
      }
    });

  } catch (error) {
    logger.error('❌ Error getting waitlist status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get waitlist status'
    });
  }
});

/**
 * @route GET /api/waitlist/admin/list
 * @desc Get all waitlist entries (Admin only)
 */
router.get('/admin/list', async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const waitlistRepository = AppDataSource.getRepository(Waitlist);
    
    let queryBuilder = waitlistRepository
      .createQueryBuilder('waitlist')
      .leftJoinAndSelect('waitlist.approvedBy', 'approvedBy')
      .orderBy('waitlist.priority', 'DESC')
      .addOrderBy('waitlist.createdAt', 'ASC');

    if (status) {
      queryBuilder = queryBuilder.where('waitlist.status = :status', { status });
    }

    const [entries, total] = await queryBuilder
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    // Add position to each entry
    const entriesWithPosition = await Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        position: await getWaitlistPosition(entry.id)
      }))
    );

    res.json({
      success: true,
      data: {
        entries: entriesWithPosition,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    logger.error('❌ Error getting waitlist entries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get waitlist entries'
    });
  }
});

/**
 * @route PUT /api/waitlist/admin/approve/:id
 * @desc Approve a waitlist entry (Admin only)
 */
router.put('/admin/approve/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { adminUserId, adminNotes } = req.body;

    const waitlistRepository = AppDataSource.getRepository(Waitlist);
    const userRepository = AppDataSource.getRepository(User);

    const waitlistEntry = await waitlistRepository.findOne({
      where: { id: parseInt(id!) }
    });

    if (!waitlistEntry) {
      res.status(404).json({
        success: false,
        message: 'Waitlist entry not found'
      });
      return;
    }

    if (waitlistEntry.status !== WaitlistStatus.PENDING) {
      res.status(400).json({
        success: false,
        message: 'Waitlist entry is not pending'
      });
      return;
    }

    // Check if Twitter handle is already in use by another approved user
    if (waitlistEntry.twitterHandle) {
      const existingUserWithTwitterHandle = await userRepository.findOne({
        where: [
          { 
            twitterHandle: waitlistEntry.twitterHandle,
            accessStatus: UserAccessStatus.APPROVED
          },
          { 
            twitterHandle: `@${waitlistEntry.twitterHandle}`,
            accessStatus: UserAccessStatus.APPROVED
          }
        ]
      });

      if (existingUserWithTwitterHandle) {
        res.status(400).json({
          success: false,
          message: `Cannot approve: Twitter handle @${waitlistEntry.twitterHandle} is already in use by another approved user`,
          data: {
            conflictingUser: {
              id: existingUserWithTwitterHandle.id,
              walletAddress: existingUserWithTwitterHandle.walletAddress,
              username: existingUserWithTwitterHandle.username,
              currentTwitterHandle: existingUserWithTwitterHandle.twitterHandle
            },
            waitlistEntry: {
              id: waitlistEntry.id,
              walletAddress: waitlistEntry.walletAddress,
              twitterHandle: waitlistEntry.twitterHandle
            }
          }
        });
        return;
      }
    }

    // Update waitlist entry
    waitlistEntry.status = WaitlistStatus.APPROVED;
    waitlistEntry.approvedByUserId = adminUserId;
    waitlistEntry.approvedAt = new Date();
    waitlistEntry.adminNotes = adminNotes;

    await waitlistRepository.save(waitlistEntry);

    // Update user access status
    const user = await userRepository.findOne({
      where: { walletAddress: waitlistEntry.walletAddress.toLowerCase() }
    });

    if (user) {
      user.accessStatus = UserAccessStatus.APPROVED;
      // Copy Twitter handle from waitlist entry to user record
      if (waitlistEntry.twitterHandle) {
        user.twitterHandle = waitlistEntry.twitterHandle;
      }
      await userRepository.save(user);
    }

    logger.info(`✅ Approved waitlist entry ${id} for ${waitlistEntry.walletAddress}`);

    res.json({
      success: true,
      data: waitlistEntry,
      message: 'Waitlist entry approved successfully'
    });

  } catch (error) {
    logger.error('❌ Error approving waitlist entry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve waitlist entry'
    });
  }
});

/**
 * @route PUT /api/waitlist/admin/reject/:id
 * @desc Reject a waitlist entry (Admin only)
 */
router.put('/admin/reject/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { adminUserId, adminNotes } = req.body;

    const waitlistRepository = AppDataSource.getRepository(Waitlist);
    const userRepository = AppDataSource.getRepository(User);

    const waitlistEntry = await waitlistRepository.findOne({
      where: { id: parseInt(id!) }
    });

    if (!waitlistEntry) {
      res.status(404).json({
        success: false,
        message: 'Waitlist entry not found'
      });
      return;
    }

    if (waitlistEntry.status !== WaitlistStatus.PENDING) {
      res.status(400).json({
        success: false,
        message: 'Waitlist entry is not pending'
      });
      return;
    }

    // Update waitlist entry
    waitlistEntry.status = WaitlistStatus.REJECTED;
    waitlistEntry.approvedByUserId = adminUserId;
    waitlistEntry.approvedAt = new Date();
    waitlistEntry.adminNotes = adminNotes;

    await waitlistRepository.save(waitlistEntry);

    // Update user access status
    const user = await userRepository.findOne({
      where: { walletAddress: waitlistEntry.walletAddress.toLowerCase() }
    });

    if (user) {
      user.accessStatus = UserAccessStatus.REJECTED;
      await userRepository.save(user);
    }

    logger.info(`❌ Rejected waitlist entry ${id} for ${waitlistEntry.walletAddress}`);

    res.json({
      success: true,
      data: waitlistEntry,
      message: 'Waitlist entry rejected'
    });

  } catch (error) {
    logger.error('❌ Error rejecting waitlist entry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject waitlist entry'
    });
  }
});

/**
 * @route PUT /api/waitlist/admin/priority/:id
 * @desc Update waitlist entry priority (Admin only)
 */
router.put('/admin/priority/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { priority } = req.body;

    if (typeof priority !== 'number') {
      res.status(400).json({
        success: false,
        message: 'Priority must be a number'
      });
      return;
    }

    const waitlistRepository = AppDataSource.getRepository(Waitlist);
    const waitlistEntry = await waitlistRepository.findOne({
      where: { id: parseInt(id!) }
    });

    if (!waitlistEntry) {
      res.status(404).json({
        success: false,
        message: 'Waitlist entry not found'
      });
      return;
    }

    waitlistEntry.priority = priority;
    await waitlistRepository.save(waitlistEntry);

    logger.info(`✅ Updated waitlist entry ${id} priority to ${priority}`);

    res.json({
      success: true,
      data: waitlistEntry,
      message: 'Priority updated successfully'
    });

  } catch (error) {
    logger.error('❌ Error updating priority:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update priority'
    });
  }
});

// Helper function to get waitlist position
async function getWaitlistPosition(entryId: number): Promise<number> {
  const waitlistRepository = AppDataSource.getRepository(Waitlist);
  
  const entry = await waitlistRepository.findOne({
    where: { id: entryId }
  });

  if (!entry) return 0;

  const position = await waitlistRepository
    .createQueryBuilder('waitlist')
    .where('waitlist.status = :status', { status: WaitlistStatus.PENDING })
    .andWhere('(waitlist.priority > :priority OR (waitlist.priority = :priority AND waitlist.id < :id))', {
      priority: entry.priority,
      id: entryId
    })
    .getCount();

  return position + 1;
}

export default router;
