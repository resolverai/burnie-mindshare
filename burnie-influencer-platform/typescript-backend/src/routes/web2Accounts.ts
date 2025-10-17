import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Account } from '../models/Account';
import { AccountUser } from '../models/AccountUser';
import { AccountClient } from '../models/AccountClient';
import { logger } from '../config/logger';

const router = Router();

/**
 * @route   GET /api/web2-accounts/:accountId
 * @desc    Get account details
 * @access  Private
 */
router.get('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;

    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({
      where: { id: accountId as string },
      relations: ['account_users', 'account_clients', 'brand_contexts']
    });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    logger.error('Error fetching account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch account'
    });
  }
});

/**
 * @route   PUT /api/web2-accounts/:accountId
 * @desc    Update account details
 * @access  Private
 */
router.put('/:accountId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { account_type, business_name, industry, use_case, subscription_tier } = req.body;

    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({ where: { id: accountId as string } });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    // Update fields
    if (account_type) account.account_type = account_type;
    if (business_name) account.business_name = business_name;
    if (industry) account.industry = industry;
    if (use_case) account.use_case = use_case;
    if (subscription_tier) account.subscription_tier = subscription_tier;

    await accountRepo.save(account);

    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    logger.error('Error updating account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update account'
    });
  }
});

/**
 * @route   GET /api/web2-accounts/:accountId/users
 * @desc    Get all users for an account
 * @access  Private
 */
router.get('/:accountId/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;

    const accountUserRepo = AppDataSource.getRepository(AccountUser);
    const users = await accountUserRepo.find({
      where: { account_id: accountId as string },
      select: ['id', 'email', 'full_name', 'role', 'is_primary', 'status', 'last_login', 'created_at']
    });

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    logger.error('Error fetching account users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * @route   POST /api/web2-accounts/:accountId/users
 * @desc    Add a new user to an account (for multi-user businesses)
 * @access  Private
 */
router.post('/:accountId/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { email, full_name, role } = req.body;

    if (!email || !full_name || !role) {
      res.status(400).json({
        success: false,
        error: 'Email, full name, and role are required'
      });
      return;
    }

    // Check if account exists
    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({ where: { id: accountId as string } });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    // Check if user already exists
    const accountUserRepo = AppDataSource.getRepository(AccountUser);
    const existingUser = await accountUserRepo.findOne({ where: { email } });

    if (existingUser) {
      res.status(400).json({
        success: false,
        error: 'User with this email already exists'
      });
      return;
    }

    const newUser = accountUserRepo.create({ account_id: accountId as string,
      email,
      full_name,
      role,
      is_primary: false,
      status: 'active'
    });

    await accountUserRepo.save(newUser);

    res.json({
      success: true,
      data: {
        id: newUser.id,
        email: newUser.email,
        full_name: newUser.full_name,
        role: newUser.role,
        status: newUser.status
      }
    });
  } catch (error) {
    logger.error('Error adding user to account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add user'
    });
  }
});

/**
 * @route   GET /api/web2-accounts/:accountId/clients
 * @desc    Get all clients for an account (for agencies)
 * @access  Private
 */
router.get('/:accountId/clients', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;

    const accountClientRepo = AppDataSource.getRepository(AccountClient);
    const clients = await accountClientRepo.find({
      where: { account_id: accountId as string },
      relations: ['brand_contexts']
    });

    res.json({
      success: true,
      data: clients
    });
  } catch (error) {
    logger.error('Error fetching account clients:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch clients'
    });
  }
});

/**
 * @route   POST /api/web2-accounts/:accountId/clients
 * @desc    Add a new client to an account (for agencies)
 * @access  Private
 */
router.post('/:accountId/clients', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId } = req.params;
    const { client_name, client_industry } = req.body;

    if (!client_name) {
      res.status(400).json({
        success: false,
        error: 'Client name is required'
      });
      return;
    }

    // Check if account exists and is an agency
    const accountRepo = AppDataSource.getRepository(Account);
    const account = await accountRepo.findOne({ where: { id: accountId as string } });

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found'
      });
      return;
    }

    if (account.account_type !== 'agency') {
      res.status(400).json({
        success: false,
        error: 'Only agency accounts can add clients'
      });
      return;
    }

    const accountClientRepo = AppDataSource.getRepository(AccountClient);
    const newClient = accountClientRepo.create({ account_id: accountId as string,
      client_name,
      client_industry,
      status: 'active'
    });

    await accountClientRepo.save(newClient);

    res.json({
      success: true,
      data: newClient
    });
  } catch (error) {
    logger.error('Error adding client to account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add client'
    });
  }
});

/**
 * @route   PUT /api/web2-accounts/:accountId/clients/:clientId
 * @desc    Update client details
 * @access  Private
 */
router.put('/:accountId/clients/:clientId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId, clientId } = req.params;
    const { client_name, client_industry, status } = req.body;

    const accountClientRepo = AppDataSource.getRepository(AccountClient);
    const client = await accountClientRepo.findOne({
      where: { id: clientId as string, account_id: accountId as string }
    });

    if (!client) {
      res.status(404).json({
        success: false,
        error: 'Client not found'
      });
      return;
    }

    if (client_name) client.client_name = client_name;
    if (client_industry) client.client_industry = client_industry;
    if (status) client.status = status;

    await accountClientRepo.save(client);

    res.json({
      success: true,
      data: client
    });
  } catch (error) {
    logger.error('Error updating client:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update client'
    });
  }
});

/**
 * @route   DELETE /api/web2-accounts/:accountId/clients/:clientId
 * @desc    Delete a client
 * @access  Private
 */
router.delete('/:accountId/clients/:clientId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { accountId, clientId } = req.params;

    const accountClientRepo = AppDataSource.getRepository(AccountClient);
    const client = await accountClientRepo.findOne({
      where: { id: clientId as string, account_id: accountId as string }
    });

    if (!client) {
      res.status(404).json({
        success: false,
        error: 'Client not found'
      });
      return;
    }

    await accountClientRepo.remove(client);

    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting client:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete client'
    });
  }
});

export default router;

